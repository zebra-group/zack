/**
 * better-auth instance (AUTH-01..04, D-01, D-02b).
 *
 * Single-client discipline (Pitfall 2, T-02-02): imports the SAME `prisma`
 * singleton `db.ts` already constructs (Prisma 7 + `@prisma/adapter-pg`) —
 * never a second `PrismaClient`. `prismaAdapter` comes from the BUNDLED
 * `better-auth/adapters/prisma` import (re-exports the first-party
 * `@better-auth/prisma-adapter` package, which ships as a transitive
 * dependency of `better-auth` itself — see 02-01-SUMMARY.md and
 * RESEARCH.md OQ-2's resolution). `@better-auth/prisma-adapter` is
 * deliberately NOT a direct dependency of `apps/api/package.json`.
 *
 * `magicLink()` is the ONLY login plugin (no email/password, no SSO in
 * this phase). `disableSignUp: true` blocks auto-creation of a `User` row
 * on verify — combined with the in-callback allowlist check below
 * (`isEmailAllowed`), this implements D-01's invite-only, neutral-response
 * policy: `sendMagicLink` fires for every request regardless of allowlist
 * status and returns silently (no throw, no distinguishable response) for
 * a non-allowlisted email, so better-auth's own HTTP response is
 * byte-identical either way (verified empirically in 02-04's canary test,
 * RESEARCH.md OQ-1).
 *
 * `BASE_URL`/`BETTER_AUTH_SECRET` are read directly from `process.env`
 * (not `loadEnv()`) for the same reason `db.ts` and `lib/mailer.ts` do —
 * this module is only imported after `server.ts`'s boot-time `loadEnv()`
 * has already validated the full environment; re-validating here would
 * crash any test that imports this module without the full ENV surface
 * set (see `vitest.config.ts`).
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
import { prisma } from "../db.js";
import { isEmailAllowed } from "./allowlist.js";
import { sendMagicLinkEmail } from "./mailer.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set — auth.ts must only be imported after env validation.`);
  }
  return value;
}

export const auth = betterAuth({
  baseURL: requireEnv("BASE_URL"),
  secret: requireEnv("BETTER_AUTH_SECRET"),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  session: {
    // 7-day sliding session (AUTH-03): survives a browser refresh, and the
    // 1-day `updateAge` refreshes the expiry on activity rather than
    // forcing a hard 7-day logout.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    magicLink({
      expiresIn: 900, // 15 minutes — AUTH-02
      disableSignUp: true, // D-01 — no auto-signup, invite-only
      sendMagicLink: async ({ email, url }) => {
        // D-01 neutral response: the allowlist check lives INSIDE this
        // callback, never in a separate pre-check route (T-02-01). A
        // non-allowlisted email returns silently — no throw, no error
        // object — so better-auth's own response to the client is
        // byte-identical to the allowlisted path.
        const allowed = await isEmailAllowed(prisma, email);
        if (!allowed) return;
        await sendMagicLinkEmail({ to: email, url });
      },
    }),
  ],
});
