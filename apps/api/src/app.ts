/**
 * Fastify application factory (D-01 single-image; RESEARCH Pattern 6).
 *
 * `buildApp()` constructs and configures a Fastify instance WITHOUT
 * listening, so tests can exercise it via `fastify.inject` (see
 * test/server.integration.test.ts, test/canary.integration.test.ts).
 * `server.ts` is the only caller that actually calls `.listen()`.
 *
 * Registration order (Pattern 6, T-01-10 — mitigated):
 *   1. Dev-only CORS (T-01-12).
 *   2. API routes under the `/api` prefix.
 *   3. `GET /health`.
 *   4. The redirect-handler stub `GET /:slug` (Phase 5 replaces this).
 *   5. `@fastify/static` (`wildcard: false` — see plugins/static.ts).
 *   6. `setNotFoundHandler`: JSON 404 for unmatched `/api/*` paths, the SPA
 *      shell (`index.html`) for every other unmatched path.
 *
 * API routes are registered before the static plugin + not-found handler
 * so they are never shadowed by the SPA fallback.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma as defaultPrisma } from "./db.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { canaryRoute } from "./routes/canary.js";
import { healthRoute } from "./routes/health.js";
import { redirectRoute } from "./routes/redirect.js";
import { registerCors } from "./plugins/cors.js";
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

  await app.register(
    async (apiScope) => {
      await apiScope.register(canaryRoute(prisma));
    },
    { prefix: "/api" },
  );
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
