/**
 * Redirect-precedence engine (D-14, REDIR-01..05, RESEARCH "Redirect
 * Handler Skeleton" + Architecture Patterns 1/2/3/4/5) — replaces the
 * Phase 1 stub. Two routes, one factory (mirrors `tlsCheckRoute(prisma)`/
 * `linksRoute(prisma, auth)`'s shape):
 *
 *   `GET  /:slug`         host+slug resolution -> expiry (410) ->
 *                          password-gate (200) -> bot/OG branch (200) ->
 *                          302 redirect, with forwardQuery merge (D-12/D-13)
 *                          and a no-op click-tracking seam (D-17).
 *   `POST /:slug/verify`  bcrypt-compares the submitted password -> on
 *                          success, issues the self-invalidating unlock
 *                          cookie and 302s; on failure, re-renders the
 *                          password page with the LOCKED inline error.
 *
 * Every response sets `Cache-Control: no-store` (D-18) as the FIRST thing
 * the handler does, so no early-return branch can ever forget it.
 *
 * NO-LEAK (T-05-NOLEAK): a protected/expired link's `targetUrl` is NEVER
 * passed to any renderer ahead of a successful password check or an
 * unexpired state — `renderPasswordPage`/`renderExpiredPage`/
 * `renderNotFoundPage`/`renderBotOgPage` structurally have no `target`
 * field to leak (see `lib/publicHtml.ts`'s header comment).
 *
 * WRITES (Phase 6, D-13/D-17): Phase 5's "reads only" invariant now has
 * exactly one exception — `recordClickHook`'s body, the ONLY
 * `prisma.clickEvent.create` call site in the codebase and a second (but
 * intentional, TRACK-01/D-13-driven) `prisma.link.update` call site beside
 * `lib/links.ts`'s `updateLink`, confined to incrementing `lifetimeClicks`
 * only, batched atomically with the ClickEvent insert in a single
 * `$transaction`. Every OTHER `prisma.link.*` call in this file remains a
 * `findUnique` (a read). Password/expiry/forwardQuery/trackingEnabled
 * *content* persistence still happens exclusively through `lib/links.ts`'s
 * `createLink`/`updateLink` (the D-01 sole write path for link fields) —
 * `recordClickHook` never touches any Link column besides the counter.
 *
 * REUSE (Phase 7, 07-06): `recordClickHook` and `brandCtx` are exported so
 * `routes/qrRedirect.ts` can reuse them verbatim — `source` is now a
 * caller-supplied `ScanSource` parameter (still defaulting the `GET /:slug`
 * call site below to `'link'`) rather than a hardcoded literal, so the `/q`
 * scan path can pass `'qr'` through the SAME single ClickEvent insert site
 * instead of a second, drifting write path (T-07-CLICK-DRIFT).
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import type { Link, PrismaClient, ScanSource } from "../generated/prisma/client.js";
import { resolveActiveDomainByHost } from "../lib/domainResolution.js";
import { resolveLinkState, mergeQuery, applyUtmParams, QR_SCAN_PARAM } from "../lib/redirectEngine.js";
import { isBotRequest } from "../lib/botDetection.js";
import { hasValidUnlockCookie, issueUnlockCookie } from "../lib/unlockCookie.js";
import {
  renderPasswordPage,
  renderExpiredPage,
  renderNotFoundPage,
  renderBotOgPage,
} from "../lib/publicHtml.js";
import { REDIRECT_RATE_LIMIT, VERIFY_RATE_LIMIT_PER_LINK } from "../plugins/rateLimit.js";
import { getCountryForIp } from "../lib/geoip.js";
import { normalizeReferrer } from "../lib/referrer.js";
import { computeVisitorHash, resolveDailySalt } from "../lib/visitorHash.js";

/** Branding context (D-10) shared by every public-HTML render call below — read directly from `process.env` (not `loadEnv()`), mirroring `lib/links.ts`'s `resolvePasswordHashCost` convention so this module works under Vitest without a boot-time ENV parse. Exported (Phase 7, 07-06) so `routes/qrRedirect.ts` reuses the identical branding read instead of a second copy. */
export function brandCtx(): { brand: string; accent: string } {
  return {
    brand: process.env.BRAND_NAME ?? "Kurzly",
    accent: process.env.BRAND_ACCENT ?? "#d7ff01",
  };
}

/**
 * D-17 seam, filled (Phase 6, TRACK-02/03, D-13). The ONLY
 * `prisma.clickEvent.create` call site in the codebase.
 *
 * Structural zero-rows guarantee (TRACK-02): the very first line early-
 * returns on `!link.trackingEnabled`, BEFORE any Prisma call — a
 * tracking-off link produces literally zero rows, proven by a direct DB
 * row-count in the test suite, not a display-time filter.
 *
 * Reuses the already-fetched `link` object from the caller (no re-query,
 * RESEARCH Pitfall 4). The whole body below the guard is wrapped in
 * try/catch: a GeoIP/salt/DB hiccup is logged and swallowed, NEVER thrown
 * into the redirect response path (T-06-HOTPATH) — the 302 must fire
 * regardless of tracking success.
 *
 * When tracking is on, the `ClickEvent` insert and `Link.lifetimeClicks`
 * increment run as one `prisma.$transaction` batch (D-13, Pitfall 5) so
 * the counter can never drift from the event rows.
 *
 * `source` (Phase 7, 07-06): a caller-supplied `ScanSource` rather than a
 * hardcoded `'link'` literal — the ONLY change this refactor makes to this
 * function's behavior. `GET /:slug` below passes `'link'` explicitly (same
 * value as before, so its behavior is unchanged); `routes/qrRedirect.ts`
 * imports and calls this SAME function with `'qr'` instead of duplicating
 * the transaction (T-07-CLICK-DRIFT — exactly one ClickEvent insert site).
 */
export async function recordClickHook(ctx: {
  prisma: PrismaClient;
  link: Link;
  ip: string;
  userAgent: string | undefined;
  referer: string | undefined;
  log: FastifyBaseLogger;
  source: ScanSource;
}): Promise<void> {
  const { prisma, link, ip, userAgent, referer, log, source } = ctx;
  if (!link.trackingEnabled) return; // TRACK-02: structural guard, no Prisma call below this line when off.

  try {
    const country = await getCountryForIp(ip);
    const referrerHost = normalizeReferrer(referer);
    const salt = await resolveDailySalt(prisma);
    const visitorHash = computeVisitorHash(salt, ip, userAgent ?? "", link.id);

    await prisma.$transaction([
      prisma.clickEvent.create({
        data: { linkId: link.id, country, referrerHost, visitorHash, source },
      }),
      prisma.link.update({
        where: { id: link.id },
        data: { lifetimeClicks: { increment: 1 } },
      }),
    ]);
  } catch (err) {
    // Never let a tracking failure break or slow the redirect hot path.
    log?.warn({ err, linkId: link.id }, "recordClickHook: tracking write failed, swallowed");
  }
}

/**
 * The ONE `prisma.qrCode.update` call site outside `lib/qrCodes.ts` — a
 * documented exception (see that module's header), not a second write path:
 * it touches `lifetimeScans` and nothing else. Shared by both scan routes,
 * `GET /q/:code` (dynamic) and `GET /:slug?qr=` (static). Wrapped in the same
 * swallow-and-log discipline as `recordClickHook` (T-06-HOTPATH): a counter
 * hiccup must never break or slow a redirect.
 */
export async function incrementLifetimeScans(
  prisma: PrismaClient,
  qrCodeId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await prisma.qrCode.update({
      where: { id: qrCodeId },
      data: { lifetimeScans: { increment: 1 } },
    });
  } catch (err) {
    log?.warn({ err, qrCodeId }, "incrementLifetimeScans: counter write failed, swallowed");
  }
}

/**
 * Resolves the `?qr=` marker a static QR code's encoded URL carries (QR-07)
 * to the `QrCode` row it names, or `null` when this is an ordinary visit.
 *
 * The marker is attacker-supplied, so it is never trusted as an identity: a
 * row only counts when it is actually STATIC and actually bound to the link
 * being visited. Without that check anyone could inflate an arbitrary code's
 * counter by appending someone else's id to any short link.
 */
async function resolveScannedQrCodeId(
  prisma: PrismaClient,
  link: Link,
  rawMarker: unknown,
  log: FastifyBaseLogger,
): Promise<string | null> {
  if (typeof rawMarker !== "string" || rawMarker === "") return null;

  try {
    const qrCode = await prisma.qrCode.findUnique({
      where: { id: rawMarker },
      select: { id: true, variant: true, linkId: true },
    });
    if (!qrCode || qrCode.variant !== "static" || qrCode.linkId !== link.id) return null;
    return qrCode.id;
  } catch (err) {
    log?.warn({ err, linkId: link.id }, "resolveScannedQrCodeId: lookup failed, swallowed");
    return null;
  }
}

/**
 * Adapts `VERIFY_RATE_LIMIT_PER_LINK`'s pure, Fastify-free `keyGenerator`
 * (typed against `RateLimitKeyRequest`, per 05-04's "stays directly
 * unit-testable with a stub" design) to the signature `@fastify/rate-limit`'s
 * own `config.rateLimit` type actually requires: `(req: FastifyRequest) =>
 * string`, where `FastifyRequest.params` is `unknown` on an untyped route.
 * The runtime cast below is safe — this config is only ever attached to
 * `POST /:slug/verify`, so Fastify's router guarantees `request.params.slug`
 * exists by the time any preHandler hook (rate-limit's included) runs.
 */
const verifyRateLimitConfig = {
  ...VERIFY_RATE_LIMIT_PER_LINK,
  keyGenerator: (request: FastifyRequest): string =>
    VERIFY_RATE_LIMIT_PER_LINK.keyGenerator({
      ip: request.ip,
      hostname: request.hostname,
      params: request.params as { slug: string },
    }),
};

export function redirectRoute(prisma: PrismaClient) {
  return async function registerRedirectRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/:slug",
      config: { rateLimit: REDIRECT_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store"); // D-18, every branch below.

        // WR-01 discipline (mirrors tlsCheck.ts): `request.params` is an
        // unchecked type assertion, not a runtime guarantee.
        const { slug } = request.params as { slug: string };
        const ctx = { ...brandCtx(), domain: request.hostname, slug };

        const domain = await resolveActiveDomainByHost(prisma, request.hostname);
        if (!domain) {
          return reply.code(404).type("text/html").send(renderNotFoundPage(ctx));
        }

        const link = await prisma.link.findUnique({
          where: { domainId_slug: { domainId: domain.id, slug } },
        });
        if (!link) {
          return reply.code(404).type("text/html").send(renderNotFoundPage(ctx));
        }

        const bot = isBotRequest(request.headers["user-agent"]);
        const state = resolveLinkState(link, hasValidUnlockCookie(request, link));

        // D-06: a detected bot ALWAYS gets the generic-OG 200, regardless of
        // state — never the human error pages, never a redirect. D-08-03:
        // serving the owner's typed OG values here preserves exactly the
        // property D-06 exists to protect, because none of the three fields
        // can carry the destination (same spread-and-extend shape the
        // expired branch below uses for expiresAt).
        if (bot) {
          return reply
            .code(200)
            .type("text/html")
            .send(
              renderBotOgPage({
                ...ctx,
                ogTitle: link.ogTitle,
                ogDescription: link.ogDescription,
                ogImageUrl: link.ogImageUrl,
              }),
            );
        }

        if (state === "expired") {
          return reply
            .code(410)
            .type("text/html")
            .send(renderExpiredPage({ ...ctx, expiresAt: link.expiresAt! }));
        }
        if (state === "protected") {
          return reply
            .code(200)
            .type("text/html")
            .send(renderPasswordPage({ ...ctx, errorState: false }));
        }

        // state === "ok" -> normal link, or protected link with a valid
        // unlock cookie. D-17 seam: Phase 6's tracking write (D-05:
        // request.ip is already trust-proxy-aware via app.ts's trustProxy
        // option — no new proxy config needed here).
        //
        // A static QR code's scan arrives here rather than on /q/:code, so it
        // is identified by the marker its encoded URL carries (QR-07). Only a
        // completed redirect counts — the gated branches above already
        // returned, matching the dynamic handler's behaviour.
        const incoming = new URL(request.url, "http://placeholder.invalid").searchParams;
        const scannedQrCodeId = await resolveScannedQrCodeId(
          prisma,
          link,
          incoming.get(QR_SCAN_PARAM),
          request.log,
        );

        await recordClickHook({
          prisma,
          link,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          referer: request.headers.referer,
          log: request.log,
          source: scannedQrCodeId ? "qr" : "link",
        });

        if (scannedQrCodeId) {
          await incrementLifetimeScans(prisma, scannedQrCodeId, request.log);
        }

        // The marker is Kurzly-internal plumbing — strip it so `forwardQuery`
        // never leaks it to the destination.
        incoming.delete(QR_SCAN_PARAM);
        const forwarded = incoming.toString();
        // D-08-02 composition order (redirectEngine.ts's module header):
        // the owner's UTM parameters are applied to the stored target FIRST,
        // overriding any same-named key already there — the owner typed
        // these into this link's own builder, so their intent is
        // authoritative over the stored target. Only THEN, if forwardQuery
        // is on, does the visitor's incoming query merge onto that result
        // via mergeQuery's unchanged target-wins rule — the visitor must
        // never be able to rewrite what the owner just set.
        const utmTarget = applyUtmParams(link.targetUrl, link);
        const target = link.forwardQuery
          ? mergeQuery(utmTarget, forwarded ? `?${forwarded}` : "")
          : utmTarget;
        return reply.code(302).redirect(target);
      },
    });

    app.route({
      method: "POST",
      url: "/:slug/verify",
      config: { rateLimit: verifyRateLimitConfig },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store"); // D-18, every branch below.

        const { slug } = request.params as { slug: string };
        // WR-01 discipline: never trust an unchecked `request.body` type
        // assertion without a runtime guard (mirrors links.ts's Zod
        // allowlist discipline, applied here without a full schema since the
        // only field is a single optional string).
        const rawBody = request.body as { password?: unknown } | undefined;
        const password = typeof rawBody?.password === "string" ? rawBody.password : undefined;

        const ctx = { ...brandCtx(), domain: request.hostname, slug };

        const domain = await resolveActiveDomainByHost(prisma, request.hostname);
        const link = domain
          ? await prisma.link.findUnique({
              where: { domainId_slug: { domainId: domain.id, slug } },
            })
          : null;

        if (!link || !link.passwordHash) {
          return reply.code(404).type("text/html").send(renderNotFoundPage(ctx));
        }

        // Expiry still precedes the password gate on the verify path too
        // (D-14) — an expired+protected link's verify endpoint must not leak
        // "your password would have worked" information via a different
        // response shape than the GET branch.
        if (resolveLinkState(link, false) === "expired") {
          return reply
            .code(410)
            .type("text/html")
            .send(renderExpiredPage({ ...ctx, expiresAt: link.expiresAt! }));
        }

        const ok = password ? await bcrypt.compare(password, link.passwordHash) : false;
        if (!ok) {
          return reply
            .code(200)
            .type("text/html")
            .send(renderPasswordPage({ ...ctx, errorState: true }));
        }

        issueUnlockCookie(reply, link.id, `/${slug}`, link.passwordHash);
        // RESEARCH's verify skeleton redirects straight to the stored
        // target with no query merge here — a visitor's original GET (the
        // request the query params, if any, actually arrived on) already
        // took the GET branch's forwardQuery merge before ever reaching
        // this form's action URL.
        return reply.code(302).redirect(link.targetUrl);
      },
    });
  };
}
