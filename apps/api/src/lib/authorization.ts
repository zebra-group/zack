import type { PrismaClient } from "../generated/prisma/client.js";
import { isAccountAdmin } from "./accountRole.js";

/**
 * Domain-scoped authorization core (D-02).
 *
 * This is the SINGLE server-side authorization path every domain-scoped
 * route in Phases 3–9 must call — centralizing the role-hierarchy check
 * here prevents scattered ad-hoc authorization that causes
 * privilege-escalation bugs. The (prisma, userId, domainId, minRole) /
 * (prisma, userId) signatures are FROZEN: downstream phases depend on
 * them not churning.
 *
 * Zero callers exist in this phase by design — correctness is proven
 * entirely by test/authorization.test.ts's real-Postgres unit suite.
 *
 * Phase 9 (D-09-02) additive note: both functions below now start with an
 * account-admin bypass (`isAccountAdmin`) — an installation-wide admin
 * reaches every domain regardless of `DomainMembership`. This is checked
 * FIRST, before any membership lookup, and is the ONLY new branch; the
 * deny-by-default membership/CR-01 rank logic for everyone else (an
 * accountRole="member" user) is completely unchanged below it.
 */

export const ROLE_RANK = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_RANK;

export class ForbiddenError extends Error {}

/**
 * Resolves when `userId` has a DomainMembership on `domainId` whose role
 * rank is >= `minRole`'s rank. Throws ForbiddenError otherwise — including
 * when no membership row exists at all (unknown user, unknown domain, or
 * simply never invited). Deny-by-default: absence of proof of access is
 * treated as denial, never as implicit access.
 */
export async function requireDomainAccess(
  prisma: PrismaClient,
  userId: string,
  domainId: string,
  minRole: Role,
): Promise<void> {
  // D-09-02: an account-admin reaches every domain, regardless of
  // DomainMembership or minRole. Checked first so every existing call
  // site (lib/links.ts, lib/qrCodes.ts, routes/analytics.ts) inherits
  // the bypass with zero route edits. A non-admin falls through
  // unchanged to the deny-by-default membership check below.
  if (await isAccountAdmin(prisma, userId)) {
    return;
  }

  const membership = await prisma.domainMembership.findUnique({
    where: { userId_domainId: { userId, domainId } },
  });

  // CR-01 fix: `ROLE_RANK[minRole]` must ALSO be validated — an
  // out-of-enum `minRole` (a future caller passing a typo'd literal) would
  // otherwise make every comparison `x < undefined` evaluate to `false`,
  // silently granting access. `membership.role`'s rank is checked the same
  // way: `ROLE_RANK[...]` on an unexpected value is `undefined`, and
  // `undefined < n` is ALWAYS `false` in JS (never `true`, never a thrown
  // error) — comparing against `undefined` directly, instead of relying on
  // that comparison's truthiness, is what closes the fail-open bypass this
  // fixes. Schema-level defense-in-depth: `DomainMembership.role` is now a
  // native Postgres enum (see schema.prisma), so this branch should be
  // unreachable in practice — this guard remains as the second layer.
  const membershipRank = membership ? ROLE_RANK[membership.role] : undefined;
  const requiredRank = ROLE_RANK[minRole];

  if (
    membershipRank === undefined ||
    requiredRank === undefined ||
    membershipRank < requiredRank
  ) {
    throw new ForbiddenError(
      `User ${userId} lacks ${minRole}+ access to domain ${domainId}`,
    );
  }
}

/**
 * Returns the set of domain IDs `userId` holds any membership in (empty
 * array for a user with no memberships). Used to scope list/query
 * operations to exactly the domains a caller is allowed to see — never
 * leaks other tenants' domains.
 */
export async function scopedDomainIds(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  // D-09-02: an account-admin's "scope" is every domain, not just their
  // memberships. A non-admin falls through unchanged to the existing
  // membership-only query below — never sees another tenant's domains.
  if (await isAccountAdmin(prisma, userId)) {
    const domains = await prisma.domain.findMany({ select: { id: true } });
    return domains.map((domain) => domain.id);
  }

  const memberships = await prisma.domainMembership.findMany({
    where: { userId },
    select: { domainId: true },
  });

  return memberships.map((membership) => membership.domainId);
}
