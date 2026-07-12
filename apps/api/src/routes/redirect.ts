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
 * READS ONLY (D-01): this file performs ZERO Prisma Link writes — every
 * `prisma.link.*` call below is a `findUnique` (a read). Password/expiry/
 * forwardQuery persistence happens exclusively through `lib/links.ts`'s
 * `createLink`/`updateLink` (the D-01 sole write path), never here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "../generated/prisma/client.js";
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

/** Branding context (D-10) shared by every public-HTML render call below — read directly from `process.env` (not `loadEnv()`), mirroring `lib/links.ts`'s `resolvePasswordHashCost` convention so this module works under Vitest without a boot-time ENV parse. */
function brandCtx(): { brand: string; accent: string } {
  return {
    brand: process.env.BRAND_NAME ?? "Kurzly",
    accent: process.env.BRAND_ACCENT ?? "#d7ff01",
  };
}

/**
 * D-17 seam — Phase 6 replaces this body with a real click-event write
 * (linkId, timestamp, host, etc.). Signature stays stable; today it is a
 * pure no-op so this plan writes NO tracking data.
 */
async function recordClickHook(_ctx: { linkId: string }): Promise<void> {
  // intentionally empty — Phase 6's tracking write lands here.
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
        // unlock cookie. D-17 seam: Phase 6 hooks its click-write in here.
        await recordClickHook({ linkId: link.id });

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
