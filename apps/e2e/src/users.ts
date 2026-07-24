/**
 * E2E fixture helper for `User` rows this phase's specs need beyond the
 * seeded baseline (13-02-PLAN.md, AUTH-E2E-05). Mirrors `apps/e2e/src/db.ts`'s
 * / `apps/e2e/src/links.ts`'s raw-Prisma-consumer convention: every write
 * goes through the SAME reused `@kurzly/api/prisma-client` (never raw SQL,
 * never a second driver) and accepts a Prisma client / transaction client
 * argument, exactly like `createE2eLink`.
 *
 * Two states are needed:
 *
 *   - `createAllowlistedUser` — `emailVerified: true`, so the email passes
 *     `lib/allowlist.ts`'s `isEmailAllowed` check (the allowlist IS the
 *     `User` table) and can complete a real magic-link round trip.
 *   - `createInvitedUnverifiedUser` — reproduces `apps/api/src/lib/team.ts`'s
 *     `inviteMember` new-invitee write EXACTLY: `emailVerified: false`, name
 *     = email local part, given `accountRole` (default `"member"`), and NO
 *     `Account` row. This is AUTH-E2E-05's precondition — a real invited-but-
 *     never-activated account that a subsequent SSO login must merge into,
 *     not duplicate.
 *
 * Both helpers require the caller to supply a unique email — never the
 * seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` (whose magic-link login is owned by
 * the `setup` project) and never colliding with each other. Neither helper
 * truncates/reseeds — that stays `db.ts`'s `withResetDbLock` job; these are
 * additive fixture writers, and `withResetDbLock` never truncates `User`,
 * so rows created here persist for the spec's duration.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, User } from "@kurzly/api/prisma-client";

/** Accepts either a top-level PrismaClient or a `withResetDbLock` transaction client. */
type E2ePrismaLike = PrismaClient | Prisma.TransactionClient;

export type CreateUserOptions = {
  email: string;
  accountRole?: "admin" | "member";
};

/**
 * Upserts a `User` row with `emailVerified: true` — passes
 * `lib/allowlist.ts`'s existence check and can complete a real magic-link
 * round trip. Defaults `accountRole` to `"member"`, matching
 * `seedBaseline`'s least-privilege discipline (T-11-03). `name` follows the
 * same email-local-part convention `admin-seed.ts`/`inviteMember` use.
 */
export async function createAllowlistedUser(
  prisma: E2ePrismaLike,
  opts: CreateUserOptions,
): Promise<User> {
  const accountRole = opts.accountRole ?? "member";
  return prisma.user.upsert({
    where: { email: opts.email },
    update: { emailVerified: true, accountRole },
    create: {
      id: randomUUID(),
      name: opts.email.split("@")[0] ?? opts.email,
      email: opts.email,
      emailVerified: true,
      accountRole,
    },
  });
}

/**
 * Creates a `User` row exactly as `lib/team.ts`'s `inviteMember` does for a
 * NEW invitee: `emailVerified: false`, `accountRole` defaulted to `"member"`
 * (T-13-03 — least-privilege by default; an admin invite requires an
 * explicit caller opt-in), `name` = email local part, and NO `Account` row.
 * This is AUTH-E2E-05's precondition — an invited-but-never-activated
 * account.
 *
 * Deliberately `.create` (not `.upsert`) — a caller creating this fixture
 * twice for the same email indicates a test bug (a colliding email), not a
 * legitimate resend; `inviteMember`'s own resend path is a higher-level
 * concern this raw fixture helper does not reproduce.
 */
export async function createInvitedUnverifiedUser(
  prisma: E2ePrismaLike,
  opts: CreateUserOptions,
): Promise<User> {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      name: opts.email.split("@")[0] ?? opts.email,
      email: opts.email,
      emailVerified: false,
      accountRole: opts.accountRole ?? "member",
    },
  });
}
