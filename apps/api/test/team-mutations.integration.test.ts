/**
 * Team mutation suite (Phase 9 Plan 4, TEAM-03/TEAM-04/TEAM-05,
 * D-09-05/D-09-06/D-09-07) — a NEW file, separate from 09-03's
 * `team.integration.test.ts` (list + invite), per the plan's explicit
 * instruction not to edit that file.
 *
 * Task 1 (this file's first describe block) exercises `lib/team.ts`'s
 * mutation functions directly against `setupFileEach.ts`'s per-file real
 * Postgres database — no HTTP layer involved yet. Task 2 appends the
 * route-level (`app.inject`) cases below, reusing `team.integration.test
 * .ts`'s signInAs/mailer-mock/seed harness pattern verbatim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import {
  assignMemberDomains,
  changeMemberRole,
  removeMember,
} from "../src/lib/team.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const UNKNOWN_ID = "nonexistent-user-id";

/** Seeds a plain `accountRole: "member"` User row directly via Prisma. */
async function seedMember(id: string, email: string): Promise<void> {
  await prisma.user.create({
    data: { id, name: email.split("@")[0] ?? email, email, emailVerified: true, accountRole: "member" },
  });
}

/** Seeds an active Domain (no ownership membership needed for these lib-level tests). */
async function seedDomain(hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.kurzly.local",
    },
  });
  return domain.id;
}

describe("lib/team.ts mutations (TEAM-03/04/05, D-09-05/06/07)", () => {
  describe("assignMemberDomains (TEAM-03)", () => {
    it("replaces the target's domain set exactly, and clears it when passed []", async () => {
      await seedMember("u_assign_1", "assign1@kurzly.test");
      const domainA = await seedDomain("assign-a.test");
      const domainB = await seedDomain("assign-b.test");
      const domainC = await seedDomain("assign-c.test");

      await prisma.domainMembership.create({
        data: { userId: "u_assign_1", domainId: domainA, role: "member" },
      });

      const result = await assignMemberDomains(prisma, "u_assign_1", [domainB, domainC]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.member.domains.map((d) => d.id).sort()).toEqual([domainB, domainC].sort());

      const cleared = await assignMemberDomains(prisma, "u_assign_1", []);
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) throw new Error("unreachable");
      expect(cleared.member.domains).toEqual([]);

      const rows = await prisma.domainMembership.findMany({ where: { userId: "u_assign_1" } });
      expect(rows).toHaveLength(0);
    });

    it("rejects an unknown domain id with INVALID_DOMAIN and makes no change", async () => {
      await seedMember("u_assign_2", "assign2@kurzly.test");
      const domainA = await seedDomain("assign-invalid-a.test");
      await prisma.domainMembership.create({
        data: { userId: "u_assign_2", domainId: domainA, role: "member" },
      });

      const result = await assignMemberDomains(prisma, "u_assign_2", ["not-a-real-domain-id"]);
      expect(result).toEqual({ ok: false, error: "INVALID_DOMAIN" });

      const rows = await prisma.domainMembership.findMany({ where: { userId: "u_assign_2" } });
      expect(rows.map((r) => r.domainId)).toEqual([domainA]);
    });

    it("returns NOT_FOUND for an unknown target id", async () => {
      const result = await assignMemberDomains(prisma, UNKNOWN_ID, []);
      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    });
  });

  describe("changeMemberRole (TEAM-04, D-09-05)", () => {
    it("promoting a member with domains to admin clears ALL domain memberships atomically", async () => {
      await seedMember("u_promote_1", "promote1@kurzly.test");
      const domainA = await seedDomain("promote-a.test");
      const domainB = await seedDomain("promote-b.test");
      await prisma.domainMembership.createMany({
        data: [
          { userId: "u_promote_1", domainId: domainA, role: "member" },
          { userId: "u_promote_1", domainId: domainB, role: "member" },
        ],
      });

      const result = await changeMemberRole(prisma, "u_promote_1", "admin");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.member.accountRole).toBe("admin");
      expect(result.member.domains).toEqual([]);

      const rows = await prisma.domainMembership.findMany({ where: { userId: "u_promote_1" } });
      expect(rows).toHaveLength(0);
    });

    it("demoting the sole extra admin (two admins present) leaves them with zero domain assignments", async () => {
      await seedInitialAdmin(prisma, "demote-primary@kurzly.test");
      await seedInitialAdmin(prisma, "demote-target@kurzly.test");
      const target = await prisma.user.findUniqueOrThrow({
        where: { email: "demote-target@kurzly.test" },
      });

      const result = await changeMemberRole(prisma, target.id, "member");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.member.accountRole).toBe("member");
      expect(result.member.domains).toEqual([]);
    });

    it("returns NOT_FOUND for an unknown target id", async () => {
      const result = await changeMemberRole(prisma, UNKNOWN_ID, "admin");
      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    });
  });

  describe("removeMember (TEAM-05, D-09-06)", () => {
    it("deletes the User row and cascades away their DomainMembership rows", async () => {
      await seedMember("u_remove_1", "remove1@kurzly.test");
      const domainA = await seedDomain("remove-a.test");
      await prisma.domainMembership.create({
        data: { userId: "u_remove_1", domainId: domainA, role: "member" },
      });

      const result = await removeMember(prisma, "u_remove_1");
      expect(result).toEqual({ ok: true });

      const user = await prisma.user.findUnique({ where: { id: "u_remove_1" } });
      expect(user).toBeNull();
      const rows = await prisma.domainMembership.findMany({ where: { userId: "u_remove_1" } });
      expect(rows).toHaveLength(0);
    });

    it("preserves a removed user's created Link with createdBy set to null (D-09-06)", async () => {
      await seedMember("u_remove_2", "remove2@kurzly.test");
      const domainA = await seedDomain("remove-content-a.test");
      const link = await prisma.link.create({
        data: {
          domainId: domainA,
          slug: "survives-removal",
          targetUrl: "https://example.com/still-here",
          createdBy: "u_remove_2",
        },
      });

      const result = await removeMember(prisma, "u_remove_2");
      expect(result).toEqual({ ok: true });

      const survivingLink = await prisma.link.findUnique({ where: { id: link.id } });
      expect(survivingLink).not.toBeNull();
      expect(survivingLink?.createdBy).toBeNull();
    });

    it("returns NOT_FOUND for an unknown target id", async () => {
      const result = await removeMember(prisma, UNKNOWN_ID);
      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    });
  });

  describe("Lockout guards (D-09-07) — at least one accountRole=admin must always remain", () => {
    it("removeMember on the only admin returns LAST_ADMIN and deletes nothing", async () => {
      await seedInitialAdmin(prisma, "sole-admin-remove@kurzly.test");
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: "sole-admin-remove@kurzly.test" },
      });

      const result = await removeMember(prisma, admin.id);
      expect(result).toEqual({ ok: false, error: "LAST_ADMIN" });

      const stillThere = await prisma.user.findUnique({ where: { id: admin.id } });
      expect(stillThere).not.toBeNull();
    });

    it("changeMemberRole('member') on the only admin returns LAST_ADMIN and changes nothing", async () => {
      await seedInitialAdmin(prisma, "sole-admin-demote@kurzly.test");
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: "sole-admin-demote@kurzly.test" },
      });

      const result = await changeMemberRole(prisma, admin.id, "member");
      expect(result).toEqual({ ok: false, error: "LAST_ADMIN" });

      const stillAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(stillAdmin.accountRole).toBe("admin");
    });

    it("with two admins, removing one succeeds and the other remains the sole admin", async () => {
      await seedInitialAdmin(prisma, "two-admin-remove-a@kurzly.test");
      await seedInitialAdmin(prisma, "two-admin-remove-b@kurzly.test");
      const toRemove = await prisma.user.findUniqueOrThrow({
        where: { email: "two-admin-remove-b@kurzly.test" },
      });

      const result = await removeMember(prisma, toRemove.id);
      expect(result).toEqual({ ok: true });

      const remainingAdmins = await prisma.user.count({ where: { accountRole: "admin" } });
      expect(remainingAdmins).toBe(1);
    });

    it("with two admins, demoting one succeeds and the other remains admin", async () => {
      await seedInitialAdmin(prisma, "two-admin-demote-a@kurzly.test");
      await seedInitialAdmin(prisma, "two-admin-demote-b@kurzly.test");
      const toDemote = await prisma.user.findUniqueOrThrow({
        where: { email: "two-admin-demote-b@kurzly.test" },
      });

      const result = await changeMemberRole(prisma, toDemote.id, "member");
      expect(result.ok).toBe(true);

      const remainingAdmins = await prisma.user.count({ where: { accountRole: "admin" } });
      expect(remainingAdmins).toBe(1);
    });

    it("never lets two concurrent demote requests both succeed and leave zero admins", async () => {
      await seedInitialAdmin(prisma, "concurrent-admin-a@kurzly.test");
      await seedInitialAdmin(prisma, "concurrent-admin-b@kurzly.test");
      const adminA = await prisma.user.findUniqueOrThrow({
        where: { email: "concurrent-admin-a@kurzly.test" },
      });
      const adminB = await prisma.user.findUniqueOrThrow({
        where: { email: "concurrent-admin-b@kurzly.test" },
      });

      const [resultA, resultB] = await Promise.all([
        changeMemberRole(prisma, adminA.id, "member"),
        changeMemberRole(prisma, adminB.id, "member"),
      ]);

      const outcomes = [resultA.ok, resultB.ok].sort();
      // Exactly one of the two concurrent demotes must succeed — the other
      // must observe LAST_ADMIN once the first has committed (D-09-07
      // concurrency safety, T-09-LOCKOUT).
      expect(outcomes).toEqual([false, true]);

      const remainingAdmins = await prisma.user.count({ where: { accountRole: "admin" } });
      expect(remainingAdmins).toBe(1);
    });
  });
});
