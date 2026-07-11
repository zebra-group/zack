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
 *   6. `GET /health`.
 *   7. The redirect-handler stub `GET /:slug` (Phase 5 replaces this).
 *   8. `@fastify/static` (`wildcard: false` — see plugins/static.ts).
 *   9. `setNotFoundHandler`: JSON 404 for unmatched `/api/*` paths, the SPA
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
import { authRoute } from "./routes/auth.js";
import { canaryRoute } from "./routes/canary.js";
import { healthRoute } from "./routes/health.js";
import { redirectRoute } from "./routes/redirect.js";
import { registerCors } from "./plugins/cors.js";
import { registerHelmet } from "./plugins/helmet.js";
import { registerRateLimit } from "./plugins/rateLimit.js";
import { registerStatic } from "./plugins/static.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type BuildAppOptions = {
  nodeEnv?: string;
  publicDir?: string;
  /**
   * Prisma client to wire into `/api` routes (currently only the
   * PersistenceCanary route). Defaults to the `db.ts` singleton. Tests
   * override this with the SAME transaction-wrapped client
   * `test/setupFileEach.ts` uses, so route reads/writes participate in
   * that test's rolled-back transaction (D-09).
   */
  prisma?: PrismaClient;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const publicDir = options.publicDir ?? path.join(__dirname, "..", "public");
  const prisma = options.prisma ?? defaultPrisma;

  const app = Fastify({
    logger: nodeEnv === "production" ? true : { transport: { target: "pino-pretty" } },
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
  await app.register(authRoute);
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
