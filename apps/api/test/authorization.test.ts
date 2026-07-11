import { describe, expect, it, vi } from "vitest";
import { prisma } from "./setupFileEach.js";
import {
  ForbiddenError,
  requireDomainAccess,
  scopedDomainIds,
} from "../src/lib/authorization.js";

/**
 * Real-Postgres unit suite for the domain-scoped authorization core (D-02).
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test) — no mocked Prisma.
 *
 * `requireDomainAccess`/`scopedDomainIds` are the single server-side
 * authorization path Phases 3–9 will call; their (prisma, userId, domainId,
 * minRole) / (prisma, userId) signatures are frozen here. Zero callers exist
 * in Phase 2 by design — correctness comes entirely from this suite.
 */
describe("Authorization core (D-02)", () => {
  let userSeq = 0;
  let domainSeq = 0;

  async function seedUser() {
    userSeq += 1;
    return prisma.user.create({
      data: {
        id: `u_authz_${userSeq}`,
        name: `Authz Test User ${userSeq}`,
        email: `authz-${userSeq}@test.kurzly`,
      },
    });
  }

  /**
   * Phase 3 extended `Domain` with required `hostname`/`type`/
   * `verificationTarget` fields (RESEARCH Pitfall 2) — this suite only
   * exercises `requireDomainAccess`/`scopedDomainIds` against
   * `DomainMembership` rows, so the Domain's own field values are
   * incidental; a unique hostname per call just satisfies the schema.
   */
  async function seedDomain() {
    domainSeq += 1;
    return prisma.domain.create({
      data: {
        hostname: `authz-domain-${domainSeq}.test.kurzly`,
        type: "subdomain",
        verificationTarget: "shortener.kurzly.local",
      },
    });
  }

  describe("requireDomainAccess", () => {
    it("resolves when an owner membership meets minRole 'admin' (owner rank 2 >= admin rank 1)", async () => {
      const user = await seedUser();
      const domain = await seedDomain();
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "owner" },
      });

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).resolves.toBeUndefined();
    });

    it("throws ForbiddenError when a member membership is below minRole 'admin' (member rank 0 < admin rank 1)", async () => {
      const user = await seedUser();
      const domain = await seedDomain();
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "member" },
      });

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("resolves when an admin membership exactly meets minRole 'admin' (equal rank allowed)", async () => {
      const user = await seedUser();
      const domain = await seedDomain();
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "admin" },
      });

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).resolves.toBeUndefined();
    });

    it("throws ForbiddenError for an unknown user/domain pair (no membership row — deny-by-default)", async () => {
      const user = await seedUser();
      const domain = await seedDomain();
      // Deliberately no DomainMembership row created for this pair.

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "member"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("CR-01 regression: DENIES access when the membership row holds a role outside the known enum (fail-closed, not fail-open)", async () => {
      // `DomainMembership.role` is now a native Postgres enum (schema.prisma),
      // so this can no longer happen via any normal Prisma write — this test
      // stubs `findUnique`'s resolved value directly to prove the CODE-level
      // guard in `requireDomainAccess` is ALSO fail-closed (defense-in-depth),
      // independent of the schema constraint. Before the CR-01 fix,
      // `ROLE_RANK["not-a-real-role"]` evaluated to `undefined`, and
      // `undefined < ROLE_RANK[minRole]` is always `false` in JS — so the
      // guard condition `!membership || false` was `false` and access was
      // silently GRANTED. This must now throw.
      const user = await seedUser();
      const domain = await seedDomain();
      const findUniqueSpy = vi
        .spyOn(prisma.domainMembership, "findUnique")
        .mockResolvedValueOnce({
          userId: user.id,
          domainId: domain.id,
          // Deliberately outside the Role enum — simulates a bypass of the
          // schema-level constraint (e.g. a stale build, a downgraded
          // migration, or a direct SQL write) to prove the code guard alone
          // still denies.
          role: "not-a-real-role",
        } as never);

      try {
        await expect(
          requireDomainAccess(prisma, user.id, domain.id, "member"),
        ).rejects.toThrow(ForbiddenError);
      } finally {
        findUniqueSpy.mockRestore();
      }
    });
  });

  describe("scopedDomainIds", () => {
    it("returns exactly the domain IDs a user is a member of (order-independent, length 2)", async () => {
      const user = await seedUser();
      const domainA = await seedDomain();
      const domainB = await seedDomain();
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domainA.id, role: "owner" },
      });
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domainB.id, role: "member" },
      });

      const ids = await scopedDomainIds(prisma, user.id);

      expect(ids).toEqual(expect.arrayContaining([domainA.id, domainB.id]));
      expect(ids).toHaveLength(2);
    });

    it("returns an empty array for a user with zero memberships", async () => {
      const user = await seedUser();

      const ids = await scopedDomainIds(prisma, user.id);

      expect(ids).toEqual([]);
    });
  });
});
