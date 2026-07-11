/**
 * better-auth instance factory (AUTH-01..04, D-01, D-02b).
 *
 * `createAuth(prisma)` is a factory — mirrors `routes/canary.ts`'s
 * `canaryRoute(prisma)` pattern (RESEARCH Pattern 4/Standard Stack
 * convention) — so callers supply the Prisma client the instance's
 * `prismaAdapter` and the D-01 allowlist check (`isEmailAllowed`) both
 * query through. Production (`app.ts`'s default path) wires `db.ts`'s
 * singleton via the `auth` export below (Single-client discipline,
 * Pitfall 2, T-02-02 — never a second ad hoc `PrismaClient`). Tests
 * (02-04 Task 3, `auth.integration.test.ts`) wire the SAME
 * transaction-wrapped client `test/setupFileEach.ts` uses via
 * `buildApp({ prisma })` (D-09) — without this factory, the `auth`
 * singleton would always be bound to `db.ts`'s default client, which
 * points at a placeholder/unreachable `DATABASE_URL` under Vitest AND
 * (even if pointed at the real testcontainers URL) would run on a
 * SEPARATE physical connection whose writes are invisible to — and never
 * rolled back with — the test's own BEGIN/ROLLBACK transaction.
 *
 * `prismaAdapter` comes from the BUNDLED `better-auth/adapters/prisma`
 * import (re-exports the first-party `@better-auth/prisma-adapter`
 * package, which ships as a transitive dependency of `better-auth` itself
 * — see 02-01-SUMMARY.md and RESEARCH.md OQ-2's resolution).
 * `@better-auth/prisma-adapter` is deliberately NOT a direct dependency of
 * `apps/api/package.json`.
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
import { prisma as defaultPrisma } from "../db.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { isEmailAllowed } from "./allowlist.js";
import { sendMagicLinkEmail } from "./mailer.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set — auth.ts must only be imported after env validation.`);
  }
  return value;
}

export function createAuth(prisma: PrismaClient) {
  return betterAuth({
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
          // WR-01 fix: better-auth `await`s this callback before responding
          // to the client, so awaiting the SMTP send here would make an
          // allowlisted email's response measurably slower than a
          // non-allowlisted one (which returns right after the single fast
          // DB lookup above) — a timing side-channel that leaks account
          // existence, exactly what this module's header comment and
          // `lib/allowlist.ts`'s own comment call out as unacceptable.
          // Fire-and-forget instead: the mail send still happens, but the
          // response no longer waits on it, so both branches return in
          // comparable wall-clock time. Errors are logged, not thrown —
          // throwing here would surface as a distinguishable non-200
          // response, reintroducing the same leak this fix closes.
          void sendMagicLinkEmail({ to: email, url }).catch((error: unknown) => {
            console.error(`Failed to send magic-link email to ${email}:`, error);
          });
        },
      }),
    ],
  });
}

export const auth = createAuth(defaultPrisma);
