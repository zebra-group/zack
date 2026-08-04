/**
 * Fail-fast ENV validation (D-06, INFRA-02).
 *
 * `parseEnv()` is the single validation gate every process (server,
 * migration entrypoint, tests) runs before touching DB/SMTP. Operator-
 * supplied environment variables are untrusted input (ASVS V5) — a
 * missing `DATABASE_URL` or a weak `BETTER_AUTH_SECRET` (ASVS V6, min
 * 32 chars) must fail loudly at boot, not crash cryptically later deep
 * inside a query or a mail send.
 *
 * `parseEnv()` stays pure (no process.exit, no console output) so it is
 * directly unit-testable. `loadEnv()` is the thin boot wrapper: on
 * failure it prints the formatted issues to stderr and calls
 * `process.exit(1)`; on success it returns the typed, coerced config.
 */
import { z } from "zod";

/**
 * Single source of truth for the Domain-verification fallback literals
 * (IN-02) — `envSchema`'s own `.default()`s below reference these directly,
 * and `routes/domains.ts`'s `computeVerificationTarget` imports the SAME
 * constants for its `process.env`-read fallback (that module intentionally
 * reads `process.env` directly rather than the parsed `loadEnv()` result,
 * see its own header comment, so it needs its own fallback — but now both
 * boot paths can never drift apart on what that fallback actually is).
 */
export const DOMAIN_VERIFICATION_DEFAULTS = {
  CNAME_TARGET: "shortener.zack.local",
  A_RECORD_IP: "0.0.0.0",
} as const;

/**
 * Exported so `test/env-example-drift.test.ts` can introspect the schema
 * shape and assert `.env.example` documents exactly this key set — the
 * schema is the single source of truth (see plan 01-04 task 2).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.email(),
  BASE_URL: z.url(),
  // `.min(32)` alone lets `.env.example`'s own documented placeholder
  // value pass validation as-is (it happens to be >= 32 chars) — the
  // `.refine()` explicitly rejects that literal string so an operator who
  // copies `.env.example` -> `.env` without editing this line fails fast
  // instead of silently shipping a publicly-known signing secret (WR-06).
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((v) => v !== "changeme-generate-a-real-32-plus-char-secret", {
      message:
        "BETTER_AUTH_SECRET is still the .env.example placeholder — generate a real secret (e.g. `openssl rand -base64 32`).",
    }),
  // First-admin bootstrap (D-01): the invite-only allowlist starts empty,
  // so a fresh deployment must name one seeded owner/admin email or nobody
  // can ever log in. Required (not optional) — fail fast at boot rather
  // than silently shipping an un-loginable instance.
  INITIAL_ADMIN_EMAIL: z.email(),
  // WR-02 fix: `docker-compose.yml` documents TLS/reverse-proxy termination
  // as "the operator's own responsibility" — the documented production
  // topology sits behind a reverse proxy. Without `trustProxy` wired into
  // Fastify, `request.ip` (and therefore `@fastify/rate-limit`'s default
  // per-IP key) resolves to the proxy's own address for every request,
  // collapsing every user's rate-limit bucket into one shared bucket — a
  // single bad actor's 5 bogus magic-link requests would then lock out
  // every legitimate user for 15 minutes. Default `false` (fail safe: an
  // operator running this directly on the public internet without a proxy
  // must opt in explicitly, or `request.ip` would otherwise trust a
  // spoofable X-Forwarded-For header from any client).
  TRUST_PROXY: z.coerce.boolean().default(false),
  // Domain verification (Phase 3, D-02) — the fixed CNAME target subdomain
  // owners must point their DNS at. Optional with a fail-safe default so a
  // fresh deployment still boots before the operator configures a real
  // value; used to compute Domain.verificationTarget for `type: subdomain`.
  CNAME_TARGET: z.string().min(1).optional().default(DOMAIN_VERIFICATION_DEFAULTS.CNAME_TARGET),
  // Domain verification (Phase 3, D-02) — the fixed A-record IPv4 apex
  // domain owners must point their DNS at. Optional with a fail-safe
  // default (mirrors CNAME_TARGET); used to compute Domain.verificationTarget
  // for `type: apex`.
  A_RECORD_IP: z.ipv4().optional().default(DOMAIN_VERIFICATION_DEFAULTS.A_RECORD_IP),
  // Branding (Phase 5, D-10) — consumed only by the server-rendered public
  // HTML layer (password/expiry/404 pages + bot-OG tags), NOT retrofitted
  // into the already-shipped dashboard SPA (Phase 2-4 scope). Optional with
  // a fail-safe default so a fresh instance boots unchanged without config.
  BRAND_NAME: z.string().min(1).optional().default("Zack"),
  // Overrides --accent only in the public pages' inline <style> block.
  BRAND_ACCENT: z.string().min(1).optional().default("#d7ff01"),
  // bcryptjs hash cost (Phase 5, D-02). RESEARCH Pitfall 2: start
  // conservative at 10-11, not 12, and keep it ENV-tunable so the redirect
  // hot path doesn't block under concurrent password-verify load.
  PASSWORD_HASH_COST: z.coerce.number().int().positive().optional().default(11),
  // GeoIP (Phase 6, D-03) — operator override path for a bind-mounted
  // .mmdb database. Optional with NO default: absence means "use the
  // build-baked /prod/api/geo/dbip-country-lite.mmdb", not a fail-safe
  // fallback value like CNAME_TARGET/A_RECORD_IP above.
  GEOIP_DB_PATH: z.string().min(1).optional(),
  // Click retention window (Phase 6, D-12) — number of days raw
  // ClickEvent rows are kept before pruning. Optional with NO default:
  // absence must mean "retention pruning is off", not a silently-applied
  // window — a fresh instance must boot with zero tracking config.
  CLICK_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  // OIDC/SSO (Phase 10, D-10-07) — optional with NO default: absence of
  // all three means SSO is off, mirroring GEOIP_DB_PATH's absence=feature
  // -off pattern above. All three must be present TOGETHER — enforced by
  // the all-three-or-none guard in parseEnv() below (a partial set is a
  // boot-time configuration error, never a half-enabled login path).
  OIDC_ISSUER_URL: z.url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export type ParseEnvResult =
  | { success: true; data: Env }
  | { success: false; issues: z.core.$ZodIssue[] };

/**
 * Shared predicate for the `E2E_COMPOSE_OVERLAY` marker (CR-05 follow-up,
 * 11-REVIEW.md iteration 3) — `apps/api/src/plugins/rateLimit.ts`'s bypass
 * gate and this file's own boot guard below both need the identical
 * "is this the E2E compose overlay" check; duplicating the inline
 * `typeof ... === "string" && ... .trim() !== ""` logic in two files is
 * exactly the kind of drift risk that produced CR-05 in the first place —
 * one copy could be edited without the other. Single source of truth here.
 */
export function isE2EComposeOverlay(source: NodeJS.ProcessEnv): boolean {
  return typeof source.E2E_COMPOSE_OVERLAY === "string" && source.E2E_COMPOSE_OVERLAY.trim() !== "";
}

/**
 * Pure schema validation over an arbitrary env-shaped source. Returns a
 * discriminated result instead of throwing, so callers (including tests)
 * can inspect the offending key(s) without unstructured errors.
 */
const OIDC_KEYS = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;

/**
 * CR-01 fix: the OPTIONAL env vars (`.optional()` in `envSchema`, whether or
 * not they carry a `.default()`). `import "dotenv/config"` turns a bare
 * `KEY=` line in `.env` into the empty **string** `""`, not `undefined` — but
 * `.optional()` only admits `undefined`, so `""` flows into the inner
 * validator (`z.url()` / `z.string().min(1)` / `z.coerce.number().positive()`)
 * and is rejected. That bricks the ENTIRE boot (magic-link included) for a
 * self-hosted operator who copies `.env.example` verbatim without wanting SSO
 * — contradicting the documented "leaving all three empty disables SSO"
 * contract, and the same latent defect the older `GEOIP_DB_PATH` /
 * `CLICK_RETENTION_DAYS` vars shipped with. Normalizing an empty/whitespace-
 * only value on these keys to "unset" BEFORE validation makes `KEY=` behave
 * as absent everywhere (matching `readSsoConfig`'s own `!issuer` semantics).
 *
 * REQUIRED keys are deliberately NOT in this list: an empty required var must
 * still fail loudly through its own validator rather than being silently
 * dropped to a different error.
 */
const OPTIONAL_ENV_KEYS = [
  "SMTP_USER",
  "SMTP_PASS",
  "CNAME_TARGET",
  "A_RECORD_IP",
  "BRAND_NAME",
  "BRAND_ACCENT",
  "PASSWORD_HASH_COST",
  "GEOIP_DB_PATH",
  "CLICK_RETENTION_DAYS",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
] as const;

export function parseEnv(source: NodeJS.ProcessEnv): ParseEnvResult {
  // Normalize empty/whitespace-only OPTIONAL vars to "unset" (delete the key)
  // so a verbatim `.env.example` copy — where dotenv yields `KEY=""` — reads
  // as absent and either falls back to `.default()` or stays optional-off,
  // instead of being rejected by the inner validator (CR-01).
  const normalized: NodeJS.ProcessEnv = { ...source };
  for (const key of OPTIONAL_ENV_KEYS) {
    const value = normalized[key];
    if (typeof value === "string" && value.trim() === "") {
      delete normalized[key];
    }
  }

  const result = envSchema.safeParse(normalized);
  if (!result.success) {
    return { success: false, issues: result.error.issues };
  }

  // OIDC/SSO all-three-or-none boot guard (D-10-07, T-10-PARTIAL-CONFIG).
  // `envSchema` keeps all three OIDC keys `.optional()` so it stays a plain
  // ZodObject (test/env-example-drift.test.ts and test/env.test.ts both
  // introspect `envSchema.shape` — wrapping it in `.refine()`/`.superRefine()`
  // would make `.shape` undefined and break both). The cross-field
  // all-three-or-none check therefore lives HERE, after the object-level
  // safeParse succeeds, as a synthetic issue per missing key rather than a
  // schema-level refinement.
  const presentOidcKeys = OIDC_KEYS.filter((key) => Boolean(result.data[key]));
  if (presentOidcKeys.length > 0 && presentOidcKeys.length < OIDC_KEYS.length) {
    const missingOidcKeys = OIDC_KEYS.filter((key) => !result.data[key]);
    const issues: z.core.$ZodIssue[] = missingOidcKeys.map((key) => ({
      code: "custom",
      path: [key],
      message:
        "SSO requires all three of OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET or none — a partial OIDC configuration is a boot-time error, not a half-enabled login path (D-10-07).",
    }));
    return { success: false, issues };
  }

  // WR-03 (11-REVIEW.md), defense-in-depth alongside CR-02's runtime gate in
  // rateLimit.ts: `envSchema` deliberately stays a plain `z.object({...})`
  // with no `.strict()` (env-example-drift.test.ts / env.test.ts both
  // introspect `envSchema.shape`, which `.strict()`'s wider tightening would
  // risk destabilizing, AND `process.env` always carries OS-level keys like
  // `PATH`/`HOME` that `.strict()` would reject outright — bricking every
  // boot, not just catching a leaked secret). That means an unrecognized key
  // — including `E2E_RATE_LIMIT_BYPASS_SECRET` itself — silently passes
  // `safeParse` with zero boot-time signal. Fail loudly here, specifically
  // and only for this one already-known-dangerous key, rather than widening
  // schema strictness for every unrelated env var.
  //
  // CR-05 (11-REVIEW.md iteration 2): `docker-compose.e2e.yml` deliberately
  // boots the built image with `NODE_ENV=production` (INFRA-01 — production
  // SHAPE topology fidelity) while ALSO setting a real
  // `E2E_RATE_LIMIT_BYPASS_SECRET` (INFRA-06) — exactly the combination this
  // guard used to treat as an unconditional boot-time misconfiguration,
  // crash-looping the entire E2E stack. `NODE_ENV` can therefore no longer
  // serve as "is this a real production deployment" on its own —
  // `isE2EComposeOverlay()` (shared with `plugins/rateLimit.ts`, WARNING
  // follow-up in 11-REVIEW.md iteration 3) answers that question instead: it
  // checks for `E2E_COMPOSE_OVERLAY`, a fixed literal ("true") hardcoded ONLY
  // in `docker-compose.e2e.yml`'s `app.environment` — structurally absent
  // from `docker-compose.yml` (the real prod file), `.env.example`, and
  // `envSchema` itself, mirroring `E2E_RATE_LIMIT_BYPASS_SECRET`'s own
  // "never in the documented config surface" discipline. A real production
  // deployment would need BOTH vars to leak in together (not just one) for
  // this guard to stay silent — strictly more defense-in-depth than the
  // single-signal check it replaces, not less.
  if (
    result.data.NODE_ENV === "production" &&
    !isE2EComposeOverlay(source) &&
    typeof source.E2E_RATE_LIMIT_BYPASS_SECRET === "string" &&
    source.E2E_RATE_LIMIT_BYPASS_SECRET.trim() !== ""
  ) {
    const issues: z.core.$ZodIssue[] = [
      {
        code: "custom",
        path: ["E2E_RATE_LIMIT_BYPASS_SECRET"],
        message:
          "E2E_RATE_LIMIT_BYPASS_SECRET must never be set when NODE_ENV=production outside the E2E compose overlay (CR-02/WR-03/CR-05, 11-REVIEW.md) — this is an E2E-only rate-limit bypass; its presence in a production environment (without the E2E_COMPOSE_OVERLAY marker) is always a misconfiguration.",
      },
    ];
    return { success: false, issues };
  }

  return { success: true, data: result.data };
}

/**
 * Boot wrapper: validates `source` (defaults to `process.env`) and, on
 * failure, prints the formatted issues to stderr and aborts the process
 * with `exit(1)` instead of allowing an invalid config to reach the
 * server/DB/SMTP layers.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = parseEnv(source);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const issue of result.issues) {
      console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
