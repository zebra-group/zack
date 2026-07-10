/**
 * GET /health — liveness probe (Pattern 6).
 *
 * Registered before `@fastify/static` + the SPA-fallback not-found handler
 * (see app.ts), so it always resolves as a real, static-matched route and
 * is never shadowed by the static plugin (T-01-10).
 */
import type { FastifyInstance } from "fastify";
import type { HealthStatus } from "@kurzly/shared";

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async (): Promise<HealthStatus> => ({ status: "ok" }));
}
