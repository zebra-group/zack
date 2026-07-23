/**
 * Global account-role primitive (Phase 9, D-09-01).
 *
 * `isAccountAdmin` is the ONE shared way to check whether a user is an
 * account (installation-wide) admin — both the authorization-helper admin
 * bypass (`apps/api/src/lib/authorization.ts`, plan 09-02) and the team
 * routes (plans 09-03/09-04) import this rather than re-deriving the check
 * ad hoc. This mirrors `lib/authorization.ts`'s own header comment: a
 * single source of truth prevents scattered, drift-prone authorization
 * logic.
 */
import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Resolves `true` only when `userId` refers to a User whose `accountRole`
 * is `"admin"`. An unknown/nonexistent `userId` resolves `false` —
 * deny-by-default, matching `requireDomainAccess`'s own "absence of proof
 * is denial" convention.
 */
export async function isAccountAdmin(prisma: PrismaClient, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountRole: true },
  });

  return user?.accountRole === "admin";
}
