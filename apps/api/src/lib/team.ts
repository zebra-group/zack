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
import type { InviteMemberInput, TeamMemberDTO } from "@kurzly/shared";
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
 * an `"admin"` invite). An out-of-existence `domainId` is rejected with
 * `INVALID_DOMAIN` before any write, rather than surfacing as an unhandled
 * foreign-key violation.
 */
export async function inviteMember(
  prisma: PrismaClient,
  auth: Auth,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const domainIds = input.accountRole === "member" ? (input.domainIds ?? []) : [];

  if (domainIds.length > 0) {
    const existingDomains = await prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true },
    });
    if (existingDomains.length !== new Set(domainIds).size) {
      return { ok: false, error: "INVALID_DOMAIN" };
    }
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    include: MEMBERSHIPS_INCLUDE,
  });

  let user: UserWithMemberships;
  if (existingUser) {
    // D-09-04: a resend — no role change, no duplicate row, no membership
    // mutation (assigning domains to an existing member is TEAM-03's job).
    user = existingUser;
  } else {
    const created = await prisma.user.create({
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
      await prisma.domainMembership.createMany({
        data: domainIds.map((domainId) => ({
          userId: created.id,
          domainId,
          role: "member" as const,
        })),
      });
    }

    user = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      include: MEMBERSHIPS_INCLUDE,
    });
  }

  await triggerMagicLinkSend(auth, input.email);

  return { ok: true, member: toTeamMemberDto(user) };
}
