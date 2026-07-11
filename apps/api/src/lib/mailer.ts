/**
 * SMTP transport for magic-link email delivery (AUTH-01).
 *
 * Reads `SMTP_*` directly from `process.env` at module init, mirroring
 * `db.ts`'s singleton pattern (see that file's header comment) rather than
 * calling `loadEnv()` here. `loadEnv()` validates and requires the FULL
 * `envSchema` (including keys unrelated to mail, e.g. `DATABASE_URL`,
 * `BETTER_AUTH_SECRET`) and calls `process.exit(1)` on any missing key —
 * that is correct as `server.ts`'s single boot-time gate, but wrong for a
 * module that other files (and, transitively, test files that only care
 * about a narrow slice of the app) may import independently. This module
 * is only ever imported via `lib/auth.ts` after `server.ts` has already
 * run `loadEnv()` successfully at boot, so re-validating here would be
 * redundant in production and would crash the whole Vitest process in any
 * test that imports it without every unrelated ENV key set (see
 * `vitest.config.ts`'s minimal `DATABASE_URL`-only test env).
 */
import nodemailer from "nodemailer";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set — mailer.ts must only be imported after env validation.`);
  }
  return value;
}

const host = requireEnv("SMTP_HOST");
const port = Number(requireEnv("SMTP_PORT"));
const secure = process.env.SMTP_SECURE === "true";
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = requireEnv("SMTP_FROM");

export const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  ...(user && pass ? { auth: { user, pass } } : {}),
});

export type SendMagicLinkEmailInput = {
  to: string;
  url: string;
};

/**
 * Sends the magic-link email itself. Callers (`lib/auth.ts`'s
 * `sendMagicLink`) are responsible for the D-01 allowlist gate — this
 * function unconditionally sends, by design, so the gate stays the single
 * source of truth (see `lib/allowlist.ts`).
 */
export async function sendMagicLinkEmail({ to, url }: SendMagicLinkEmailInput): Promise<void> {
  await transporter.sendMail({
    from,
    to,
    subject: "Dein Kurzly Magic Link",
    html: `<p>Klicke auf den folgenden Link, um dich bei Kurzly anzumelden:</p><p><a href="${url}">${url}</a></p><p>Dieser Link ist 15 Minuten gültig und kann nur einmal verwendet werden.</p>`,
  });
}
