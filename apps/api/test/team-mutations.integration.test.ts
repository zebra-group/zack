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
      await seedMember("u_assign_1", "assign1@zack.test");
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
      await seedMember("u_assign_2", "assign2@zack.test");
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
      await seedMember("u_promote_1", "promote1@zack.test");
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
      await seedInitialAdmin(prisma, "demote-primary@zack.test");
      await seedInitialAdmin(prisma, "demote-target@zack.test");
      const target = await prisma.user.findUniqueOrThrow({
        where: { email: "demote-target@zack.test" },
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
      await seedMember("u_remove_1", "remove1@zack.test");
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
      await seedMember("u_remove_2", "remove2@zack.test");
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
      await seedInitialAdmin(prisma, "sole-admin-remove@zack.test");
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: "sole-admin-remove@zack.test" },
      });

      const result = await removeMember(prisma, admin.id);
      expect(result).toEqual({ ok: false, error: "LAST_ADMIN" });

      const stillThere = await prisma.user.findUnique({ where: { id: admin.id } });
      expect(stillThere).not.toBeNull();
    });

    it("changeMemberRole('member') on the only admin returns LAST_ADMIN and changes nothing", async () => {
      await seedInitialAdmin(prisma, "sole-admin-demote@zack.test");
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: "sole-admin-demote@zack.test" },
      });

      const result = await changeMemberRole(prisma, admin.id, "member");
      expect(result).toEqual({ ok: false, error: "LAST_ADMIN" });

      const stillAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(stillAdmin.accountRole).toBe("admin");
    });

    it("with two admins, removing one succeeds and the other remains the sole admin", async () => {
      await seedInitialAdmin(prisma, "two-admin-remove-a@zack.test");
      await seedInitialAdmin(prisma, "two-admin-remove-b@zack.test");
      const toRemove = await prisma.user.findUniqueOrThrow({
        where: { email: "two-admin-remove-b@zack.test" },
      });

      const result = await removeMember(prisma, toRemove.id);
      expect(result).toEqual({ ok: true });

      const remainingAdmins = await prisma.user.count({ where: { accountRole: "admin" } });
      expect(remainingAdmins).toBe(1);
    });

    it("with two admins, demoting one succeeds and the other remains admin", async () => {
      await seedInitialAdmin(prisma, "two-admin-demote-a@zack.test");
      await seedInitialAdmin(prisma, "two-admin-demote-b@zack.test");
      const toDemote = await prisma.user.findUniqueOrThrow({
        where: { email: "two-admin-demote-b@zack.test" },
      });

      const result = await changeMemberRole(prisma, toDemote.id, "member");
      expect(result.ok).toBe(true);

      const remainingAdmins = await prisma.user.count({ where: { accountRole: "admin" } });
      expect(remainingAdmins).toBe(1);
    });

    it("never lets two concurrent demote requests both succeed and leave zero admins", async () => {
      await seedInitialAdmin(prisma, "concurrent-admin-a@zack.test");
      await seedInitialAdmin(prisma, "concurrent-admin-b@zack.test");
      const adminA = await prisma.user.findUniqueOrThrow({
        where: { email: "concurrent-admin-a@zack.test" },
      });
      const adminB = await prisma.user.findUniqueOrThrow({
        where: { email: "concurrent-admin-b@zack.test" },
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

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value. */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Extracts the `token` query param from a captured magic-link verify URL. */
function extractToken(magicLinkUrl: string): string {
  const token = new URL(magicLinkUrl).searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in magic-link URL: ${magicLinkUrl}`);
  }
  return token;
}

/** Requests a magic link for `email` and returns the captured verify URL. */
async function requestMagicLinkUrl(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const url = call?.[0]?.url;
  if (!url) {
    throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  }
  return url;
}

/** Signs `email` in via the full magic-link round trip and returns a Cookie header. */
async function signInAs(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);
  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}

const ROUTE_ADMIN_EMAIL = "route-admin@zack.test";
const ROUTE_MEMBER_EMAIL = "route-member@zack.test";

describe("Team mutation routes (TEAM-03/04/05, D-09-05/06/07)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    await seedInitialAdmin(prisma, ROUTE_ADMIN_EMAIL);
    await prisma.user.upsert({
      where: { email: ROUTE_MEMBER_EMAIL },
      update: { emailVerified: true, accountRole: "member" },
      create: {
        id: "u_route_member",
        name: "Route Member",
        email: ROUTE_MEMBER_EMAIL,
        emailVerified: true,
        accountRole: "member",
      },
    });
  });

  describe("PATCH /api/team/:id/role", () => {
    it("promotes a member as admin, clearing the target's domains", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);

      const domain = await seedDomain("route-role-domain.test");
      await prisma.domainMembership.create({
        data: { userId: "u_route_member", domainId: domain, role: "member" },
      });

      const res = await app.inject({
        method: "PATCH",
        url: "/api/team/u_route_member/role",
        headers: { cookie },
        payload: { accountRole: "admin" },
      });

      expect(res.statusCode).toBe(200);
      const member = res.json();
      expect(member.accountRole).toBe("admin");
      expect(member.domains).toEqual([]);

      await app.close();
    });

    it("returns 409 LAST_ADMIN and changes nothing when demoting the sole admin", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: ROUTE_ADMIN_EMAIL } });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/team/${admin.id}/role`,
        headers: { cookie },
        payload: { accountRole: "member" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "LAST_ADMIN" });

      const stillAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(stillAdmin.accountRole).toBe("admin");

      await app.close();
    });

    it("returns 403 for a non-admin member caller", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_MEMBER_EMAIL);

      const res = await app.inject({
        method: "PATCH",
        url: "/api/team/u_route_member/role",
        headers: { cookie },
        payload: { accountRole: "admin" },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 for an unknown target id", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/team/${UNKNOWN_ID}/role`,
        headers: { cookie },
        payload: { accountRole: "admin" },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("returns 401 with no session", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({
        method: "PATCH",
        url: "/api/team/u_route_member/role",
        payload: { accountRole: "admin" },
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("PUT /api/team/:id/domains", () => {
    it("assigns exactly the given domains as admin", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);
      const domain = await seedDomain("route-domains-assign.test");

      const res = await app.inject({
        method: "PUT",
        url: "/api/team/u_route_member/domains",
        headers: { cookie },
        payload: { domainIds: [domain] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().domains).toEqual([{ id: domain, hostname: "route-domains-assign.test" }]);

      await app.close();
    });

    it("returns 400 INVALID_DOMAIN for an unknown domain id", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);

      const res = await app.inject({
        method: "PUT",
        url: "/api/team/u_route_member/domains",
        headers: { cookie },
        payload: { domainIds: ["not-a-real-domain-id"] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "INVALID_DOMAIN" });

      await app.close();
    });

    it("returns 403 for a non-admin member caller", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_MEMBER_EMAIL);

      const res = await app.inject({
        method: "PUT",
        url: "/api/team/u_route_member/domains",
        headers: { cookie },
        payload: { domainIds: [] },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("DELETE /api/team/:id", () => {
    it("removes a user as admin (204)", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/team/u_route_member",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(204);
      const gone = await prisma.user.findUnique({ where: { id: "u_route_member" } });
      expect(gone).toBeNull();

      await app.close();
    });

    it("returns 409 LAST_ADMIN and deletes nothing when removing the sole admin", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: ROUTE_ADMIN_EMAIL } });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/team/${admin.id}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "LAST_ADMIN" });

      const stillThere = await prisma.user.findUnique({ where: { id: admin.id } });
      expect(stillThere).not.toBeNull();

      await app.close();
    });

    it("returns 403 for a non-admin member caller", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_MEMBER_EMAIL);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/team/u_route_member",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 for an unknown target id", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ROUTE_ADMIN_EMAIL);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/team/${UNKNOWN_ID}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("returns 401 with no session", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/team/u_route_member",
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });
});
