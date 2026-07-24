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

/**
 * Applied to `POST /api/domains` (Phase 3 review IN-01) — mirrors
 * `VERIFY_RATE_LIMIT`'s shape/rationale: creation only requires an
 * authenticated allowlisted session (same trust boundary as any other
 * allowlisted action), but without a dedicated override it fell back to the
 * permissive 100-req/15-min global default, letting a careless-but-legitimate
 * client create up to 100 pending `Domain` rows in that window. Tighter than
 * the global default, looser than `MAGIC_LINK_RATE_LIMIT` (no email-bombing
 * risk here — just row-creation noise).
 */
export const DOMAIN_CREATE_RATE_LIMIT = {
  max: 20,
  timeWindow: "15 minutes",
} as const;

/**
 * Applied to `POST /api/links` (Phase 4, LINK-01, D-01) — mirrors
 * `DOMAIN_CREATE_RATE_LIMIT`'s shape/rationale: manual creation only
 * requires an authenticated member+ session (same trust boundary as any
 * other authorized action), but without a dedicated override it would fall
 * back to the permissive 100-req/15-min global default.
 */
export const LINK_CREATE_RATE_LIMIT = {
  max: 20,
  timeWindow: "15 minutes",
} as const;

/**
 * Applied to `POST /api/links/import/preview` and `.../import/commit`
 * (Phase 4, D-05, RESEARCH Security Domain CSV-DoS row) — a tighter bucket
 * than `LINK_CREATE_RATE_LIMIT` since a single CSV import request can carry
 * many rows worth of parsing/validation/DB work, making it a much heavier
 * per-request cost than a single manual create.
 */
export const LINK_IMPORT_RATE_LIMIT = {
  max: 5,
  timeWindow: "15 minutes",
} as const;

/**
 * Applied to `GET /:slug` (Phase 5, D-16) — generous, since this is the
 * redirect handler's own hot path (REDIR-01's "fast redirect" success
 * criterion): a legitimate high-traffic short link can receive many
 * requests per minute from distinct visitors, and this limit only needs to
 * guard against gross abuse, not throttle normal traffic.
 */
export const REDIRECT_RATE_LIMIT = {
  max: 300,
  timeWindow: "1 minute",
} as const;

/**
 * The minimal request shape `VERIFY_RATE_LIMIT_PER_LINK`'s `keyGenerator`
 * needs — deliberately NOT `FastifyRequest` (this file stays Fastify-free
 * and directly unit-testable with a stub, per 05-04-PLAN.md's critical
 * notes). `request.ip`/`request.hostname` and the route's `:slug` param are
 * both already available at Fastify's rate-limit hook time, before the
 * route handler runs, so no extra DB lookup is needed here.
 */
export type RateLimitKeyRequest = {
  ip: string;
  hostname: string;
  params: { slug: string };
};

/**
 * Applied to `POST /:slug/verify` (Phase 5, D-15, RESEARCH Pitfall 4) — a
 * tight per-(IP, host, slug) bucket, NOT per-(IP, slug): two different
 * custom domains can legitimately share an identically-named slug pointing
 * at two different `Link` rows (`@@unique([domainId, slug])`, not a global
 * slug uniqueness), so keying on `slug` alone would collapse an attacker
 * brute-forcing domain A's `/promo` with domain B's unrelated `/promo`.
 */
export const VERIFY_RATE_LIMIT_PER_LINK = {
  max: 5,
  timeWindow: "1 minute",
  keyGenerator: (request: RateLimitKeyRequest): string =>
    `${request.ip}:${request.hostname}:${request.params.slug}`,
} as const;

/**
 * Applied to `POST /api/qr-codes` (Phase 7, QR-01) — mirrors
 * `LINK_CREATE_RATE_LIMIT`'s shape/rationale verbatim: manual QR creation
 * only requires an authenticated member+ session (same trust boundary as
 * any other authorized action), but without a dedicated override it would
 * fall back to the permissive 100-req/15-min global default.
 */
export const QR_CREATE_RATE_LIMIT = {
  max: 20,
  timeWindow: "15 minutes",
} as const;

/**
 * Applied to `GET /api/qr-codes/:id/render.png` and `.svg` (Phase 7,
 * 07-RESEARCH.md Open-Question 2) — generous, mirrors `TLS_CHECK_RATE_LIMIT`'s
 * "hot interactive path" rationale: the QR Studio live preview debounces at
 * 300ms per the UI-SPEC ("kein Client-seitiges Neuzeichnen, D-Server-Only"),
 * so every color/rounding/logo tweak round-trips through this endpoint —
 * a legitimate editing session can burst well past the permissive
 * 100-req/15-min global default within seconds. A tight bucket here would
 * make the live preview feel broken, not just rate-limited.
 */
export const QR_RENDER_RATE_LIMIT = {
  max: 120,
  timeWindow: "1 minute",
} as const;

export async function registerRateLimit(app: FastifyInstance, nodeEnv: string): Promise<void> {
  // INFRA-06 (11-02-PLAN.md): a narrow, env-gated E2E-only bypass — NOT a
  // blanket disable. Read directly from `process.env` (mirrors
  // `routes/domains.ts`'s `computeVerificationTarget` precedent) rather than
  // adding it to `env.ts`'s `envSchema`, so it is structurally impossible to
  // set via `.env`/`.env.example`/production config (T-11-01 mitigation,
  // proven by the schema-absence guard test in
  // test/rate-limit-bypass.test.ts). `allowList`'s function form, set once
  // here at global registration, covers the global default bucket AND every
  // named per-route override (`MAGIC_LINK_RATE_LIMIT`, etc.) per the
  // plugin's own documented encapsulation-scope behavior — no per-route
  // edits needed (RESEARCH "Don't Hand-Roll").
  //
  // CR-02 (11-REVIEW.md): the schema-absence guard above only proves the
  // bypass secret can't be set via the *documented* config surface
  // (`.env`/`.env.example`/`envSchema`). It does NOT prevent an operator,
  // misconfigured hosting platform, or leaked CI env var from setting the
  // raw `E2E_RATE_LIMIT_BYPASS_SECRET` process env var directly in a
  // production deployment. Gate explicitly on `nodeEnv` (mirrors
  // `registerCors(app, nodeEnv)`'s precedent one line above this call in
  // app.ts) so the bypass is structurally inert whenever
  // `NODE_ENV=production`, regardless of what's in the environment.
  const bypassSecret =
    nodeEnv === "production" ? undefined : process.env.E2E_RATE_LIMIT_BYPASS_SECRET;

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "15 minutes",
    // Omitted entirely (not just falsy) when `bypassSecret` is unset, so
    // production/dev behavior is byte-identical to before this change
    // (T-11-01: a leaked `x-e2e-bypass` header bypasses nothing without a
    // configured secret).
    allowList: bypassSecret
      ? (request) => request.headers["x-e2e-bypass"] === bypassSecret
      : undefined,
  });
}
