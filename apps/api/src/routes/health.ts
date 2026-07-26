/**
 * GET /health — liveness probe (Pattern 6).
 *
 * Registered before `@fastify/static` + the SPA-fallback not-found handler
 * (see app.ts), so it always resolves as a real, static-matched route and
 * is never shadowed by the static plugin (T-01-10).
 *
 * D-17-05-02: `config: { rateLimit: false }` exempts the liveness probe from
 * `@fastify/rate-limit`'s global default bucket UNCONDITIONALLY (every
 * environment, not just E2E). A liveness/boot probe must never be throttled:
 * under real production load a Docker/k8s healthcheck that shares the app's
 * per-IP rate-limit bucket (e.g. behind a proxy, or a burst of probes) would
 * otherwise start receiving 429s and the orchestrator would kill an
 * otherwise-healthy container. `/health` returns a trivial static JSON with
 * no DB/side-effect and no sensitive data, so it is not a rate-limit-worthy
 * abuse surface. This also makes the E2E boot smoke check
 * (apps/e2e/tests/smoke/boot.spec.ts) robust to suite-wide bucket exhaustion.
 * Per @fastify/rate-limit's onRoute hook, `rateLimit: false` adds no
 * rate-limit hook at all for this route.
 */
import type { FastifyInstance } from "fastify";
import type { HealthStatus } from "@kurzly/shared";

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    { config: { rateLimit: false } },
    async (): Promise<HealthStatus> => ({ status: "ok" }),
  );
}
