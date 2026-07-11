import { describe, expect, it } from "vitest";
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

  describe("requireDomainAccess", () => {
    it("resolves when an owner membership meets minRole 'admin' (owner rank 2 >= admin rank 1)", async () => {
      const user = await seedUser();
      const domain = await prisma.domain.create({ data: {} });
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "owner" },
      });

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).resolves.toBeUndefined();
    });

    it("throws ForbiddenError when a member membership is below minRole 'admin' (member rank 0 < admin rank 1)", async () => {
      const user = await seedUser();
      const domain = await prisma.domain.create({ data: {} });
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "member" },
      });

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("resolves when an admin membership exactly meets minRole 'admin' (equal rank allowed)", async () => {
      const user = await seedUser();
      const domain = await prisma.domain.create({ data: {} });
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "admin" },
      });

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).resolves.toBeUndefined();
    });

    it("throws ForbiddenError for an unknown user/domain pair (no membership row — deny-by-default)", async () => {
      const user = await seedUser();
      const domain = await prisma.domain.create({ data: {} });
      // Deliberately no DomainMembership row created for this pair.

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "member"),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("scopedDomainIds", () => {
    it("returns exactly the domain IDs a user is a member of (order-independent, length 2)", async () => {
      const user = await seedUser();
      const domainA = await prisma.domain.create({ data: {} });
      const domainB = await prisma.domain.create({ data: {} });
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
