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

/**
 * Applied to `POST /api/domains/:id/verify` (Phase 3, RESEARCH Pitfall 4)
 * via route-level `config: { rateLimit: VERIFY_RATE_LIMIT }` — looser than
 * `MAGIC_LINK_RATE_LIMIT` (a DNS "check now" click is lower-risk than
 * email-bombing) but still protective against DNS-amplification abuse
 * against the operator's resolver and unnecessary Postgres write load.
 */
export const VERIFY_RATE_LIMIT = {
  max: 10,
  timeWindow: "5 minutes",
} as const;

/**
 * Applied to `GET /api/tls-check` (Phase 3, RESEARCH Pitfall 3, Pattern 3)
 * — generous since this endpoint sits directly on an operator reverse
 * proxy's TLS handshake critical path (Caddy `on_demand_tls.ask`) and must
 * respond in milliseconds; a legitimate proxy issues multiple lookups per
 * new hostname/connection burst.
 */
export const TLS_CHECK_RATE_LIMIT = {
  max: 60,
  timeWindow: "1 minute",
} as const;

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "15 minutes",
  });
}
