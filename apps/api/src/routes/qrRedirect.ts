/**
 * Public dynamic-QR redirect handler (Phase 7, QR-02/03/07, 07-06) —
 * `GET /q/:code` resolves a `dynamic` QrCode's CURRENT target Link and
 * 302-redirects there, mirroring `routes/redirect.ts`'s `GET /:slug`
 * structurally but REUSING two of its pieces instead of reimplementing
 * them (Pitfall 3/4, RESEARCH Architecture Pattern 3):
 *
 *   - `lib/redirectEngine.ts`'s `resolveLinkState`/`mergeQuery` — the SAME
 *     precedence engine (expiry beats password, D-14) runs on every scan,
 *     so a printed QR can never bypass the target Link's gates
 *     (T-07-GATE-BYPASS). The target is read FRESH via `prisma.link.findUnique`
 *     on every request (never a baked-in value), so a remap
 *     (`lib/qrCodes.ts`'s `remapQrCode`) is honored on the very next scan
 *     while the printed `/q/:code` URL itself never changes (QR-03's
 *     headline correctness guarantee).
 *   - `routes/redirect.ts`'s `recordClickHook` (now parameterized by
 *     `source: ScanSource`, 07-06 Task 1) — called here with `source: 'qr'`
 *     against the resolved target Link. This is still the ONLY
 *     `prisma.clickEvent.create` call site in the codebase
 *     (T-07-CLICK-DRIFT); this file contains no event-insert logic of its
 *     own.
 *
 * Host-agnostic (resolved Open-Question 1, 07-RESEARCH.md): unlike `/:slug`,
 * this route does NOT call `resolveActiveDomainByHost` — `QrCode.code` is a
 * flat, globally-unique namespace (schema.prisma's QrCode model comment),
 * not domain-scoped like `Link.slug`, so a dynamic QR resolves on ANY host
 * the API answers requests for.
 *
 * WRITES: `recordClickHook` (above) plus ONE additional, narrowly-scoped
 * `prisma.qrCode.update` incrementing `lifetimeScans` only —
 * `incrementLifetimeScans` below is the ONE documented `prisma.qrCode.update`
 * call site outside `lib/qrCodes.ts` (that file's header comment reserves
 * exactly this exception, mirroring `recordClickHook`'s own
 * `Link.lifetimeClicks` increment living outside `lib/links.ts`).
 * `lifetimeScans` increments unconditionally on every completed scan —
 * unlike the ClickEvent write, it is not gated by the target Link's
 * `trackingEnabled` preference, since it is a QR-code-level scan counter
 * (QR-07), not a privacy-sensitive per-visit event.
 *
 * `POST /q/:code/verify` (protected-branch password unlock flow) is added
 * in 07-06 Task 3, below the GET handler's protected-state branch here.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { resolveLinkState, mergeQuery } from "../lib/redirectEngine.js";
import { isBotRequest } from "../lib/botDetection.js";
import { hasValidUnlockCookie } from "../lib/unlockCookie.js";
import {
  renderPasswordPage,
  renderExpiredPage,
  renderNotFoundPage,
  renderBotOgPage,
} from "../lib/publicHtml.js";
import { REDIRECT_RATE_LIMIT } from "../plugins/rateLimit.js";
import { brandCtx, recordClickHook } from "./redirect.js";

/**
 * The ONE `prisma.qrCode.update` call site outside `lib/qrCodes.ts` — see
 * this file's header comment and `lib/qrCodes.ts`'s own header for why this
 * is a documented exception, not a second write path. Wrapped in the same
 * swallow-and-log discipline as `recordClickHook` (T-06-HOTPATH precedent
 * applied here too): a counter-write hiccup must never break or slow the
 * redirect.
 */
async function incrementLifetimeScans(
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

export function qrRedirectRoute(prisma: PrismaClient) {
  return async function registerQrRedirectRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/q/:code",
      // T-07-DOS-SCAN: reuses the SAME bucket posture as /:slug (D-16) —
      // this handler is the redirect hot path's QR twin.
      config: { rateLimit: REDIRECT_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store"); // D-18, every branch below.

        const { code } = request.params as { code: string };
        const ctx = { ...brandCtx(), domain: request.hostname, slug: code };

        // T-07-ENUM: unknown/orphaned/static code -> the SAME generic 404 as
        // an unknown slug (no existence oracle).
        const qrCode = await prisma.qrCode.findUnique({ where: { code } });
        if (!qrCode || qrCode.variant !== "dynamic") {
          return reply.code(404).type("text/html").send(renderNotFoundPage(ctx));
        }

        // Read the CURRENT target fresh, every request (QR-03) — never a
        // cached/baked-in value.
        const link = await prisma.link.findUnique({ where: { id: qrCode.linkId } });
        if (!link) {
          return reply.code(404).type("text/html").send(renderNotFoundPage(ctx));
        }

        const bot = isBotRequest(request.headers["user-agent"]);
        const state = resolveLinkState(link, hasValidUnlockCookie(request, link));

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

        // state === "ok" -> record the scan through the SAME shared hook
        // `/:slug` uses (T-07-CLICK-DRIFT), then the QR-only scan counter.
        await recordClickHook({
          prisma,
          link,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          referer: request.headers.referer,
          log: request.log,
          source: "qr",
        });
        await incrementLifetimeScans(prisma, qrCode.id, request.log);

        const target = link.forwardQuery
          ? mergeQuery(link.targetUrl, new URL(request.url, "http://placeholder.invalid").search)
          : link.targetUrl;
        return reply.code(302).redirect(target);
      },
    });
  };
}
