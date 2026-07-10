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

const envSchema = z.object({
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
  BETTER_AUTH_SECRET: z.string().min(32),
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
