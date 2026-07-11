/**
 * Rate limiting (D-07, WR-02, T-02-05) — mirrors `plugins/cors.ts`'s
 * registration-function shape.
 *
 * A single global default alone does not meaningfully stop email-bombing on
 * the magic-link request endpoint (RESEARCH Pitfall 3) — `registerRateLimit`
 * only installs the permissive global default (protects every route as a
 * baseline). `MAGIC_LINK_RATE_LIMIT` is the materially tighter per-route
 * override `routes/auth.ts` applies specifically to
 * `POST /api/auth/sign-in/magic-link` via `@fastify/rate-limit`'s route-level
 * `config.rateLimit` mechanism (see that plugin's README, "Options on the
 * endpoint itself") — the only per-route API this installed version
 * supports.
 */
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/**
 * Applied to `POST /api/auth/sign-in/magic-link` only (routes/auth.ts) via
 * `{ config: { rateLimit: MAGIC_LINK_RATE_LIMIT } }` — 5 requests / 15
 * minutes per IP, matching the email-bombing threat this exists to stop
 * (RESEARCH Pitfall 3).
 */
export const MAGIC_LINK_RATE_LIMIT = {
  max: 5,
  timeWindow: "15 minutes",
} as const;

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "15 minutes",
  });
}
