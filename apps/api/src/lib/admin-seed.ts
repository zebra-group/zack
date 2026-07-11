/**
 * Seeds the `INITIAL_ADMIN_EMAIL` User at boot (D-01, RESEARCH Pitfall 1 /
 * Assumption A3, T-02-08).
 *
 * `disableSignUp: true` on the `magicLink()` plugin (`lib/auth.ts`) blocks
 * auto-creation of a `User` row on verify for EVERYONE, including the first
 * admin — so the admin's `User` row must be upserted directly via Prisma,
 * never through better-auth's own signup flow, or the operator's very first
 * magic-link click would fail with "new_user_signup_disabled" and there
 * would be no other way in (no password login exists in this project).
 *
 * `upsert` (not `create`) makes this idempotent across repeated boots: a
 * fresh deployment gets the row created once; a redeploy of an already-
 * seeded instance is a no-op besides re-affirming `emailVerified: true`.
 *
 * RESEARCH.md OQ-3 resolution: no schema-level "global admin" flag is added
 * here — a plain `User` row (emailVerified) is sufficient for AUTH-01..04
 * and the invite-only allowlist (`lib/allowlist.ts`'s `isEmailAllowed` only
 * checks row existence). The full global-admin/allowlist-management model
 * is deferred to Phase 9 (Team Management) — see this plan's SUMMARY.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

export async function seedInitialAdmin(prisma: PrismaClient, email: string): Promise<void> {
  await prisma.user.upsert({
    where: { email },
    update: { emailVerified: true },
    create: {
      id: randomUUID(),
      // No real display name is collected at bootstrap time (there is no
      // signup form — this is a direct DB seed); the email's local part is
      // a reasonable placeholder the operator can change later once a
      // profile-editing screen exists.
      name: email.split("@")[0] ?? email,
      email,
      emailVerified: true,
    },
  });
}
