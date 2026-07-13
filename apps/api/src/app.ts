/**
 * Fastify application factory (D-01 single-image; RESEARCH Pattern 6).
 *
 * `buildApp()` constructs and configures a Fastify instance WITHOUT
 * listening, so tests can exercise it via `fastify.inject` (see
 * test/server.integration.test.ts, test/canary.integration.test.ts).
 * `server.ts` is the only caller that actually calls `.listen()`.
 *
 * Registration order (Pattern 6, T-01-10 — mitigated; extended Phase 2
 * D-07/Pitfall 5):
 *   1. Dev-only CORS (T-01-12).
 *   2. `@fastify/helmet` (NEW, D-07 — security headers, all routes).
 *   3. `@fastify/rate-limit` (NEW, D-07 — permissive global default; the
 *      tight per-route magic-link override lives in routes/auth.ts).
 *   4. `@fastify/cookie` (Phase 5, D-07/D-08 — signed cookies for the
 *      redirect engine's link-bound unlock cookie, `lib/unlockCookie.ts`;
 *      NOT a second session system, better-auth still owns its own cookies
 *      independently via its own handler).
 *   5. API routes under the `/api` prefix (canary).
 *   6. The better-auth catch-all `GET/POST /api/auth/*` (NEW — registered
 *      directly on `app`, not nested in the `/api`-prefixed scope above,
 *      since its own route urls already include the `/api/auth` segment —
 *      see routes/auth.ts's header comment).
 *   7. `POST/GET /api/domains` (Phase 3, DOMAIN-01 — registered directly on
 *      `app` for the same reason as the auth catch-all: its own route urls
 *      already include the `/api/domains` segment).
 *   8. `GET /api/tls-check` (Phase 3, DOMAIN-03 reformulated/D-01 — the
 *      operator-delegated TLS ask endpoint; no session, registered directly
 *      on `app` for the same reason as domains/auth above).
 *   9. `POST/GET /api/links` (Phase 4, LINK-01/02/03 — registered directly
 *      on `app` for the same reason as domains/tls-check above; every
 *      write delegates to lib/links.ts's createLink, the D-01 sole insert
 *      site).
 *   9b. `GET /api/links/:id/analytics`, `GET /api/analytics` (Phase 6,
 *      TRACK-04/05 — registered directly on `app`, immediately after
 *      linksRoute, for the same shadowing reason as domains/tls-check/links
 *      above; read-only, delegates all aggregation to lib/analytics.ts).
 *   10. `GET /health`.
 *   11. `redirectRoute(prisma)` (Phase 5, REDIR-01..05 — replaces the Phase
 *      1 stub; `GET /:slug` + `POST /:slug/verify`, the precedence engine).
 *   12. `@fastify/static` (`wildcard: false` — see plugins/static.ts).
 *   13. `setNotFoundHandler`: JSON 404 for unmatched `/api/*` paths, the SPA
 *      shell (`index.html`) for every other unmatched path.
 *
 * API routes (including the auth catch-all) are registered before the
 * static plugin + not-found handler so they are never shadowed by the SPA
 * fallback (Pitfall 5).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { prisma as defaultPrisma } from "./db.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { auth as defaultAuth, createAuth } from "./lib/auth.js";
import type { DnsResolver } from "./lib/dnsClient.js";
import { analyticsRoute } from "./routes/analytics.js";
import { authRoute } from "./routes/auth.js";
import { canaryRoute } from "./routes/canary.js";
import { domainsRoute } from "./routes/domains.js";
import { healthRoute } from "./routes/health.js";
import { linksRoute } from "./routes/links.js";
import { redirectRoute } from "./routes/redirect.js";
import { tlsCheckRoute } from "./routes/tlsCheck.js";
import { registerCors } from "./plugins/cors.js";
import { registerHelmet } from "./plugins/helmet.js";
import { registerRateLimit } from "./plugins/rateLimit.js";
import { registerStatic } from "./plugins/static.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type BuildAppOptions = {
  nodeEnv?: string;
  publicDir?: string;
  /**
   * Wired into Fastify's own `trustProxy` constructor option (WR-02, D-07).
   * When `true`, `request.ip` (and therefore `@fastify/rate-limit`'s
   * default per-IP key) is derived from the `X-Forwarded-For` header set
   * by a trusted reverse proxy, instead of the raw socket address (which,
   * behind a proxy, would be the proxy's own address for every request —
   * collapsing every user's rate limit into one shared bucket). Defaults to
   * `false` — only enable this when a reverse proxy actually sits in front
   * of the app (see `.env.example`'s `TRUST_PROXY`), or a client could
   * spoof its rate-limit identity via a forged header.
   */
  trustProxy?: boolean;
  /**
   * Prisma client to wire into `/api` routes (the PersistenceCanary route)
   * AND into the better-auth instance the auth catch-all forwards to.
   * Defaults to the `db.ts` singleton. Tests override this with the SAME
   * transaction-wrapped client `test/setupFileEach.ts` uses, so route
   * reads/writes — including better-auth's own User/Session/Verification
   * writes — participate in that test's rolled-back transaction (D-09).
   * When overridden, a fresh `createAuth(prisma)` instance is built bound
   * to that client (see lib/auth.ts's header comment for why the default
   * `auth` singleton, bound to `db.ts`'s client, cannot be reused here).
   */
  prisma?: PrismaClient;
  /**
   * DNS resolver wired into `domainsRoute`'s `POST /:id/verify` (Phase 3,
   * DOMAIN-02). Defaults to `nodeDnsResolver` (real `node:dns/promises`
   * lookups) inside `domainsRoute` itself when omitted. Tests override this
   * with a fake resolver so the verify route's status-transition logic is
   * deterministic and CI never touches live DNS (RESEARCH Environment
   * Availability, 03-PATTERNS.md Pattern 2).
   */
  dnsResolver?: DnsResolver;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const publicDir = options.publicDir ?? path.join(__dirname, "..", "public");
  const prisma = options.prisma ?? defaultPrisma;
  const auth = options.prisma ? createAuth(options.prisma) : defaultAuth;

  const app = Fastify({
    logger: nodeEnv === "production" ? true : { transport: { target: "pino-pretty" } },
    // WR-02 (D-07): see BuildAppOptions.trustProxy's header comment.
    trustProxy: options.trustProxy ?? false,
    // IN-02 fix (04-REVIEW.md): explicit, visible request-body ceiling —
    // was previously Fastify's un-stated implicit 1 MiB default, which a
    // future Fastify version bump could silently change with no local
    // signal. Sized to comfortably fit a CSV bulk-import request
    // (routes/links.ts's `CSV_MAX_LENGTH`) plus its JSON envelope.
    bodyLimit: 2 * 1024 * 1024, // 2 MiB
  });

  await registerCors(app, nodeEnv);
  await registerHelmet(app);
  await registerRateLimit(app);
  // Phase 5 (D-07/D-08): signed cookies for the redirect engine's
  // link-bound unlock cookie (lib/unlockCookie.ts) — reuses the
  // already-validated BETTER_AUTH_SECRET (>= 32 chars, env.ts) as the HMAC
  // signing secret. This is NOT a second session system: better-auth
  // continues to manage its own session cookies entirely independently via
  // its own handler (routes/auth.ts) — @fastify/cookie only lets THIS
  // route layer sign/verify a separate, non-auth, per-link cookie.
  await app.register(fastifyCookie, { secret: process.env.BETTER_AUTH_SECRET });

  await app.register(
    async (apiScope) => {
      await apiScope.register(canaryRoute(prisma));
    },
    { prefix: "/api" },
  );
  await app.register(authRoute(auth));
  await app.register(domainsRoute(prisma, auth, options.dnsResolver));
  await app.register(tlsCheckRoute(prisma));
  // Phase 4 (LINK-01/02/03): registered directly on `app` for the same
  // reason as domains/auth/tls-check above (its urls already include the
  // `/api/links` segment) — AFTER domains/tls-check and BEFORE the
  // redirect stub + static registration (Pitfall 5) so /api/links is never
  // shadowed by the `/:slug` stub or the SPA fallback.
  await app.register(linksRoute(prisma, auth));
  // Phase 6 (TRACK-04/05): registered directly on `app`, immediately AFTER
  // linksRoute and BEFORE redirectRoute/registerStatic (Pitfall 5) — its
  // urls already include the /api/links and /api/analytics segments, so it
  // must never be shadowed by the /:slug redirect route or the SPA
  // fallback.
  await app.register(analyticsRoute(prisma, auth));
  await app.register(healthRoute);
  // Phase 5 (REDIR-01..05): the real precedence engine replaces the Phase 1
  // stub — stays in the SAME slot (AFTER linksRoute, BEFORE
  // registerStatic/setNotFoundHandler, Pitfall 5) so /api/links is never
  // shadowed and the SPA fallback never shadows /:slug.
  await app.register(redirectRoute(prisma));

  await registerStatic(app, publicDir);

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not Found" });
    }
    return reply.sendFile("index.html");
  });

  return app;
}
