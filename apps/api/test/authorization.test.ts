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
   * Account-admin variant of seedUser (D-09-02) — creates a User whose
   * `accountRole` is `"admin"`, the sole condition `isAccountAdmin`
   * (09-01) checks. Deliberately still a plain function (not a shared
   * fixture file) to match this suite's existing seedUser/seedDomain style.
   */
  async function seedAdminUser() {
    userSeq += 1;
    return prisma.user.create({
      data: {
        id: `u_authz_admin_${userSeq}`,
        name: `Authz Admin Test User ${userSeq}`,
        email: `authz-admin-${userSeq}@test.kurzly`,
        accountRole: "admin",
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

  describe("account-admin bypass (D-09-02)", () => {
    it("requireDomainAccess resolves for an account-admin on a domain they hold NO membership on, at minRole 'admin'", async () => {
      const admin = await seedAdminUser();
      const domain = await seedDomain();
      // Deliberately no DomainMembership row for this admin/domain pair.

      await expect(
        requireDomainAccess(prisma, admin.id, domain.id, "admin"),
      ).resolves.toBeUndefined();
    });

    it("requireDomainAccess resolves for an account-admin on a domain they hold NO membership on, at minRole 'member'", async () => {
      const admin = await seedAdminUser();
      const domain = await seedDomain();

      await expect(
        requireDomainAccess(prisma, admin.id, domain.id, "member"),
      ).resolves.toBeUndefined();
    });

    it("member-unchanged regression: still throws ForbiddenError for a plain member on a domain they hold no membership on", async () => {
      const member = await seedUser();
      const domain = await seedDomain();
      // Deliberately no DomainMembership row — this member's accountRole
      // defaults to "member", so the D-09-02 bypass must NOT engage.

      await expect(
        requireDomainAccess(prisma, member.id, domain.id, "member"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("scopedDomainIds returns EVERY domain id for an account-admin, including domains they hold no membership on", async () => {
      const admin = await seedAdminUser();
      const memberDomain = await seedDomain();
      const unassignedDomain = await seedDomain();
      await prisma.domainMembership.create({
        data: { userId: admin.id, domainId: memberDomain.id, role: "member" },
      });
      // unassignedDomain deliberately has no membership row for this admin.

      const ids = await scopedDomainIds(prisma, admin.id);

      expect(ids).toEqual(
        expect.arrayContaining([memberDomain.id, unassignedDomain.id]),
      );
    });

    it("member-unchanged regression: scopedDomainIds still returns EXACTLY a member's own memberships, never all domains", async () => {
      const member = await seedUser();
      const ownDomain = await seedDomain();
      const otherDomain = await seedDomain();
      await prisma.domainMembership.create({
        data: { userId: member.id, domainId: ownDomain.id, role: "member" },
      });
      // otherDomain deliberately has no membership row for this member.

      const ids = await scopedDomainIds(prisma, member.id);

      expect(ids).toEqual([ownDomain.id]);
      expect(ids).not.toContain(otherDomain.id);
    });
  });
});
