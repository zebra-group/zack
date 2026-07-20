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
import { resolveLinkState, mergeQuery } from "../lib/redirectEngine.js";
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
        // state — never the human error pages, never a redirect.
        if (bot) {
          return reply.code(200).type("text/html").send(renderBotOgPage(ctx));
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
        await recordClickHook({
          prisma,
          link,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          referer: request.headers.referer,
          log: request.log,
          source: "link",
        });

        const target = link.forwardQuery
          ? mergeQuery(link.targetUrl, new URL(request.url, "http://placeholder.invalid").search)
          : link.targetUrl;
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

        issueUnlockCookie(reply, link.id, slug, link.passwordHash);
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
