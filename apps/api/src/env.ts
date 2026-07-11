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
});

export type Env = z.infer<typeof envSchema>;

export type ParseEnvResult =
  | { success: true; data: Env }
  | { success: false; issues: z.core.$ZodIssue[] };

/**
 * Pure schema validation over an arbitrary env-shaped source. Returns a
 * discriminated result instead of throwing, so callers (including tests)
 * can inspect the offending key(s) without unstructured errors.
 */
export function parseEnv(source: NodeJS.ProcessEnv): ParseEnvResult {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, issues: result.error.issues };
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
