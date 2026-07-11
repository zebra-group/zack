import type { PrismaClient } from "../generated/prisma/client.js";

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
  const membership = await prisma.domainMembership.findUnique({
    where: { userId_domainId: { userId, domainId } },
  });

  if (!membership || ROLE_RANK[membership.role as Role] < ROLE_RANK[minRole]) {
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
  const memberships = await prisma.domainMembership.findMany({
    where: { userId },
    select: { domainId: true },
  });

  return memberships.map((membership) => membership.domainId);
}
