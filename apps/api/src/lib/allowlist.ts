/**
 * Invite-only allowlist check (D-01).
 *
 * The allowlist IS the `User` table: a seeded/invited row existing for an
 * email address is what makes that address eligible to sign in. There is
 * deliberately no separate "AllowedEmail" table in Phase 2 (RESEARCH.md
 * Open Question 3 / OQ-3resolution) — `disableSignUp: true` on the
 * `magicLink()` plugin (see `lib/auth.ts`) already prevents anyone without
 * an existing `User` row from ever completing sign-in, so gating
 * `sendMagicLink` on "does a User row exist" is both correct and minimal.
 *
 * MUST be called only from inside `sendMagicLink` (see `lib/auth.ts`) —
 * never from a separate pre-check route, which would leak account
 * existence via response-shape/timing differences (D-01's neutral-response
 * requirement, RESEARCH.md Pattern 2 / Anti-Patterns).
 */
import type { PrismaClient } from "../generated/prisma/client.js";

export async function isEmailAllowed(prisma: PrismaClient, email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email } });
  return user !== null;
}
