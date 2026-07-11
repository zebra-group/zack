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
 *   4. API routes under the `/api` prefix (canary).
 *   5. The better-auth catch-all `GET/POST /api/auth/*` (NEW — registered
 *      directly on `app`, not nested in the `/api`-prefixed scope above,
 *      since its own route urls already include the `/api/auth` segment —
 *      see routes/auth.ts's header comment).
 *   6. `POST/GET /api/domains` (Phase 3, DOMAIN-01 — registered directly on
 *      `app` for the same reason as the auth catch-all: its own route urls
 *      already include the `/api/domains` segment).
 *   7. `GET /api/tls-check` (Phase 3, DOMAIN-03 reformulated/D-01 — the
 *      operator-delegated TLS ask endpoint; no session, registered directly
 *      on `app` for the same reason as domains/auth above).
 *   8. `GET /health`.
 *   9. The redirect-handler stub `GET /:slug` (Phase 5 replaces this).
 *   10. `@fastify/static` (`wildcard: false` — see plugins/static.ts).
 *   11. `setNotFoundHandler`: JSON 404 for unmatched `/api/*` paths, the SPA
 *      shell (`index.html`) for every other unmatched path.
 *
 * API routes (including the auth catch-all) are registered before the
 * static plugin + not-found handler so they are never shadowed by the SPA
 * fallback (Pitfall 5).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma as defaultPrisma } from "./db.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { auth as defaultAuth, createAuth } from "./lib/auth.js";
import type { DnsResolver } from "./lib/dnsClient.js";
import { authRoute } from "./routes/auth.js";
import { canaryRoute } from "./routes/canary.js";
import { domainsRoute } from "./routes/domains.js";
import { healthRoute } from "./routes/health.js";
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
  });

  await registerCors(app, nodeEnv);
  await registerHelmet(app);
  await registerRateLimit(app);

  await app.register(
    async (apiScope) => {
      await apiScope.register(canaryRoute(prisma));
    },
    { prefix: "/api" },
  );
  await app.register(authRoute(auth));
  await app.register(domainsRoute(prisma, auth, options.dnsResolver));
  await app.register(tlsCheckRoute(prisma));
  await app.register(healthRoute);
  await app.register(redirectRoute);

  await registerStatic(app, publicDir);

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not Found" });
    }
    return reply.sendFile("index.html");
  });

  return app;
}
