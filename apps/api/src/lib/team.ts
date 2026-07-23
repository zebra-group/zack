/**
 * Team core (Phase 9, TEAM-01/TEAM-02, D-09-03/D-09-04) — list + invite,
 * mirroring `lib/links.ts`'s single-write-path discipline: `inviteMember`
 * is the ONLY `prisma.user.create` call site added by this phase (the
 * pre-existing `admin-seed.ts` bootstrap upsert is orthogonal — it seeds
 * the operator at boot, never invited by an admin).
 *
 * `toTeamMemberDto` is the ONE place `status` is computed
 * (`user.emailVerified ? "active" : "pending"`, D-09-03) — the API
 * boundary, never re-derived by the frontend.
 *
 * `inviteMember` implements D-09-04 verbatim: creating a `User` row with
 * the chosen `accountRole` and `emailVerified: false` is what makes the
 * address pass `lib/allowlist.ts`'s `isEmailAllowed` check (the allowlist
 * IS the `User` table), then the ordinary magic link is sent through the
 * SAME `sendMagicLink` callback the login flow uses (`lib/auth.ts`) — no
 * second email path, no `Invitation` table. The magic link is triggered via
 * better-auth's server-side `auth.api.signInMagicLink` method — CONFIRMED
 * (not guessed) against the installed better-auth@1.6.23 package's own type
 * surface: `node_modules/better-auth/dist/plugins/magic-link/index.d.mts`
 * documents `signInMagicLink` as the exact "server: `auth.api
 * .signInMagicLink`" API method for the `POST /sign-in/magic-link`
 * endpoint (the same endpoint `routes/auth.ts` forwards the login flow's
 * own magic-link request to). Reading the endpoint's own implementation
 * (`dist/plugins/magic-link/index.mjs`) additionally confirms
 * `signInMagicLink` unconditionally calls `sendMagicLink` regardless of
 * `disableSignUp`/allowlist status (that gate lives only inside our own
 * `sendMagicLink` callback and, separately, inside `magicLinkVerify`) — so
 * calling it here after the User row already exists reaches the exact same
 * mailer path a real login request would.
 *
 * Re-inviting an existing email is a resend, not a re-create (D-09-04): the
 * existing row is looked up first, its `accountRole` is left untouched, and
 * the SAME `signInMagicLink` call fires again — indistinguishable to the
 * admin from a first invite except that no new row/membership is created.
 */
import { randomUUID } from "node:crypto";
import type {
  AssignDomainsInput,
  InviteMemberInput,
  TeamErrorCode,
  TeamMemberDTO,
  UpdateMemberRoleInput,
} from "@kurzly/shared";
import { Prisma } from "../generated/prisma/client.js";
import type { Domain, DomainMembership, PrismaClient, User } from "../generated/prisma/client.js";
import type { createAuth } from "./auth.js";

type Auth = ReturnType<typeof createAuth>;

type UserWithMemberships = User & {
  memberships: (DomainMembership & { domain: Pick<Domain, "id" | "hostname"> })[];
};

/** Included shape shared by `listTeamMembers` and `inviteMember`'s reads. */
const MEMBERSHIPS_INCLUDE = {
  memberships: { include: { domain: { select: { id: true, hostname: true } } } },
} as const;

/** D-09-03 — the ONE place `status` is computed. */
export function toTeamMemberDto(user: UserWithMemberships): TeamMemberDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    accountRole: user.accountRole,
    status: user.emailVerified ? "active" : "pending",
    domains: user.memberships.map((membership) => ({
      id: membership.domain.id,
      hostname: membership.domain.hostname,
    })),
  };
}

/** Every user on the installation, with their assigned domains and derived status. */
export async function listTeamMembers(prisma: PrismaClient): Promise<TeamMemberDTO[]> {
  const users = await prisma.user.findMany({
    include: MEMBERSHIPS_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return users.map(toTeamMemberDto);
}

export type InviteMemberResult =
  | { ok: true; member: TeamMemberDTO }
  | { ok: false; error: "INVALID_DOMAIN" };

/**
 * Triggers the SAME better-auth magic-link send the login flow uses — see
 * this file's header comment for the confirmed method name and why no
 * fallback HTTP path is needed. `headers: new Headers()` satisfies the
 * endpoint's `requireHeaders: true` validator (it only checks `context
 * .headers` is truthy — verified against `better-call`'s own validator
 * source, `node_modules/better-call/dist/validator.mjs`); there is no real
 * inbound HTTP request to forward headers from here, this call originates
 * server-side from the admin-gated invite route.
 */
async function triggerMagicLinkSend(auth: Auth, email: string): Promise<void> {
  await auth.api.signInMagicLink({
    body: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
    headers: new Headers(),
  });
}

/**
 * Invite-or-resend (D-09-04). `domainIds` are only applied when
 * `accountRole` is `"member"` (D-09-02 makes per-domain assignment
 * meaningless for an account admin — silently ignored, never an error, for
 * an `"admin"` invite) AND only on the NEW-user path. On a resend the
 * existing row is returned untouched, so `domainIds` are neither applied nor
 * validated there (WR-03) — per-domain assignment is the dedicated
 * `PUT /:id/domains` endpoint's job. An out-of-existence `domainId` on the
 * new-user path is rejected with `INVALID_DOMAIN` before any write, rather
 * than surfacing as an unhandled foreign-key violation.
 */
export async function inviteMember(
  prisma: PrismaClient,
  auth: Auth,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const domainIds = input.accountRole === "member" ? (input.domainIds ?? []) : [];

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    include: MEMBERSHIPS_INCLUDE,
  });

  let user: UserWithMemberships;
  if (existingUser) {
    // D-09-04: a resend — no role change, no duplicate row, no membership
    // mutation (assigning domains to an existing member is TEAM-03's job).
    // WR-03: `domainIds` are intentionally NOT validated here — validating an
    // input this branch never applies was a footgun (a valid-but-unapplied,
    // or invalid-and-rejected, id that the resend would ignore either way).
    user = existingUser;
  } else {
    // WR-03: validate domain existence only on the path that actually applies
    // them, so the request cost matches what the operation really does.
    if (domainIds.length > 0) {
      const existingDomains = await prisma.domain.findMany({
        where: { id: { in: domainIds } },
        select: { id: true },
      });
      if (existingDomains.length !== new Set(domainIds).size) {
        return { ok: false, error: "INVALID_DOMAIN" };
      }
    }

    // WR-01: the User row and its membership rows are created atomically in
    // ONE `$transaction`, mirroring `assignMemberDomains`/`changeMemberRole`.
    // A failed membership write (e.g. the domain-existence TOCTOU) can no
    // longer leave an orphaned, half-initialized User behind — which a later
    // re-invite would otherwise treat as a resend and never assign the
    // intended domains. The magic-link send stays AFTER the commit (below),
    // so an invitee is never mailed for a row that then rolls back.
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: randomUUID(),
          // No signup form exists for an invitee — the email's local part is
          // the same placeholder-name convention `admin-seed.ts` establishes.
          name: input.email.split("@")[0] ?? input.email,
          email: input.email,
          emailVerified: false,
          accountRole: input.accountRole,
        },
      });

      if (domainIds.length > 0) {
        await tx.domainMembership.createMany({
          data: domainIds.map((domainId) => ({
            userId: created.id,
            domainId,
            role: "member" as const,
          })),
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: MEMBERSHIPS_INCLUDE,
      });
    });
  }

  await triggerMagicLinkSend(auth, input.email);

  return { ok: true, member: toTeamMemberDto(user) };
}

/*
 * ---------------------------------------------------------------------
 * Mutations (Phase 9 Plan 4, TEAM-03/TEAM-04/TEAM-05, D-09-05/06/07) —
 * assign domains, change role (promote-clears), remove. Every function
 * below returns a typed discriminated-union result and never throws for
 * an expected outcome (unknown target -> NOT_FOUND, lockout -> LAST_ADMIN,
 * bad domain id -> INVALID_DOMAIN) — mirrors `inviteMember`'s own
 * typed-result convention above.
 * ---------------------------------------------------------------------
 */

export type TeamMutationResult =
  | { ok: true; member: TeamMemberDTO }
  | { ok: false; error: TeamErrorCode };

/** `removeMember`'s result carries no DTO — the row is gone. */
export type RemoveMemberResult = { ok: true } | { ok: false; error: TeamErrorCode };

/**
 * D-09-07 concurrency safety (T-09-LOCKOUT, high severity — mitigate):
 * locks every `accountRole="admin"` row (`SELECT ... FOR UPDATE`) before
 * counting. A plain `count()` re-asserted inside a `prisma.$transaction` is
 * NOT sufficient to prevent two concurrent demote/remove requests from both
 * observing the same pre-mutation count under Postgres' default READ
 * COMMITTED isolation — each transaction's own SELECT only ever sees the
 * last COMMITTED state, never another transaction's in-flight write, so two
 * admins concurrently demoting/removing two DIFFERENT admin rows would both
 * see count===2 and both proceed, leaving zero admins. `FOR UPDATE` closes
 * this: Postgres blocks the second transaction's lock acquisition until the
 * first COMMITS, so the second re-reads the POST-mutation admin set and
 * correctly observes count===1. Usable with either the base client (no
 * durable lock outside an explicit transaction) or a transaction client
 * (the intended, guarded usage — see `changeMemberRole`/`removeMember`
 * below). The promote-to-admin path (D-09-05) never reduces the admin
 * count, so it does not need this guard.
 */
async function countAdmins(client: PrismaClient | Prisma.TransactionClient): Promise<number> {
  const rows = await client.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "user" WHERE "accountRole" = ${"admin"}::"AccountRole" FOR UPDATE`,
  );
  return rows.length;
}

/**
 * TEAM-03 — replaces the target's `DomainMembership` set with EXACTLY
 * `domainIds` (always `role: "member"`), in one transaction so a partial
 * add/remove can never be observed. Passing `[]` clears every assignment.
 * An unknown `domainId` is rejected with `INVALID_DOMAIN` before any write
 * (mirrors `inviteMember`'s own pre-write domain-existence guard above).
 */
export async function assignMemberDomains(
  prisma: PrismaClient,
  targetUserId: string,
  domainIds: AssignDomainsInput["domainIds"],
): Promise<TeamMutationResult> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { ok: false, error: "NOT_FOUND" };

  if (domainIds.length > 0) {
    const existingDomains = await prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true },
    });
    if (existingDomains.length !== new Set(domainIds).size) {
      return { ok: false, error: "INVALID_DOMAIN" };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.domainMembership.deleteMany({ where: { userId: targetUserId } });
    if (domainIds.length > 0) {
      await tx.domainMembership.createMany({
        data: domainIds.map((domainId) => ({
          userId: targetUserId,
          domainId,
          role: "member" as const,
        })),
      });
    }
  });

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    include: MEMBERSHIPS_INCLUDE,
  });
  return { ok: true, member: toTeamMemberDto(updated) };
}

/**
 * TEAM-04 — changes the target's `accountRole`.
 *
 * Promoting to `"admin"` (D-09-05): the target's entire `DomainMembership`
 * set is deleted AND `accountRole` is set to `"admin"` inside ONE
 * `prisma.$transaction`, so no partial "admin still scoped to a domain"
 * state can ever be observed — an admin already reaches every domain
 * (D-09-02), so a leftover membership row would be meaningless AND stale.
 *
 * Demoting to `"member"` (D-09-07): leaves the target with NO domain
 * assignments (the safe direction — a demotion never silently hands out
 * access) and is guarded against removing the last admin. The guard and
 * the update run inside ONE `prisma.$transaction`, re-reading the target's
 * CURRENT role and `countAdmins(tx)` (FOR UPDATE-locked) inside it — never
 * trusting the role read before the transaction started — so a concurrent
 * second demote cannot slip past a stale check.
 */
export async function changeMemberRole(
  prisma: PrismaClient,
  targetUserId: string,
  newRole: UpdateMemberRoleInput["accountRole"],
): Promise<TeamMutationResult> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { ok: false, error: "NOT_FOUND" };

  if (newRole === "admin") {
    await prisma.$transaction(async (tx) => {
      await tx.domainMembership.deleteMany({ where: { userId: targetUserId } });
      await tx.user.update({ where: { id: targetUserId }, data: { accountRole: "admin" } });
    });
  } else {
    const guard = await prisma.$transaction(async (tx): Promise<RemoveMemberResult> => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: targetUserId },
        select: { accountRole: true },
      });
      if (current.accountRole === "admin") {
        const admins = await countAdmins(tx);
        if (admins <= 1) {
          return { ok: false, error: "LAST_ADMIN" };
        }
      }
      await tx.user.update({ where: { id: targetUserId }, data: { accountRole: "member" } });
      return { ok: true };
    });
    if (!guard.ok) return guard;
  }

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    include: MEMBERSHIPS_INCLUDE,
  });
  return { ok: true, member: toTeamMemberDto(updated) };
}

/**
 * TEAM-05 — deletes the target `User` row. D-09-06: relies ENTIRELY on the
 * schema's own constraints for cleanup — `Link.creator` is
 * `onDelete: SetNull` (a removed user's Links/QR codes survive with
 * `createdBy: null`) and `DomainMembership` is `onDelete: Cascade` (their
 * access rows vanish) — no manual cleanup query is ever issued here.
 *
 * D-09-07: guarded exactly like `changeMemberRole`'s demote branch — the
 * target's CURRENT role and `countAdmins(tx)` are re-read inside the SAME
 * transaction as the delete, so this also covers "remove your own account
 * while sole admin" (the caller IS the target in that case; the route
 * layer does not special-case it, the guard already does).
 */
export async function removeMember(
  prisma: PrismaClient,
  targetUserId: string,
): Promise<RemoveMemberResult> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { ok: false, error: "NOT_FOUND" };

  return prisma.$transaction(async (tx): Promise<RemoveMemberResult> => {
    const current = await tx.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { accountRole: true },
    });
    if (current.accountRole === "admin") {
      const admins = await countAdmins(tx);
      if (admins <= 1) {
        return { ok: false, error: "LAST_ADMIN" };
      }
    }
    await tx.user.delete({ where: { id: targetUserId } });
    return { ok: true };
  });
}
