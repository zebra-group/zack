/**
 * Team route integration suite (TEAM-01/TEAM-02, D-09-02/D-09-03/D-09-04) —
 * the completion evidence for `GET /api/team` and `POST /api/team/invite`.
 *
 * Runs against `setupFileEach.ts`'s per-file real-Postgres database via
 * `buildApp({ prisma })`, reusing `links.integration.test.ts`'s
 * signInAs/mailer-mock/seed harness pattern verbatim.
 *
 * The headline case (D-09-03) is the real pending -> active round trip: an
 * invited user is created with `emailVerified: false`, and only after a
 * REAL magic-link sign-in (not a manually-flipped column) does
 * `GET /api/team` show them as `"active"` — proving the `status` derivation
 * end to end, so a future better-auth behavior change fails loudly here
 * instead of the UI quietly lying.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const ADMIN_EMAIL = "team-admin@kurzly.test";
const MEMBER_EMAIL = "team-member@kurzly.test";

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
async function signInAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);
  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}

describe("Team routes (TEAM-01/TEAM-02, D-09-02/D-09-03/D-09-04)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    await seedInitialAdmin(prisma, ADMIN_EMAIL);
    await prisma.user.upsert({
      where: { email: MEMBER_EMAIL },
      update: { emailVerified: true, accountRole: "member" },
      create: {
        id: "u_team_member",
        name: "Team Member",
        email: MEMBER_EMAIL,
        emailVerified: true,
        accountRole: "member",
      },
    });
  });

  describe("GET /api/team", () => {
    it("returns 401 with no session", async () => {
      const app = await buildApp({ prisma });
      const res = await app.inject({ method: "GET", url: "/api/team" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 for a signed-in non-admin member", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, MEMBER_EMAIL);

      const res = await app.inject({
        method: "GET",
        url: "/api/team",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("returns 200 with the full member list for the account admin", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "GET",
        url: "/api/team",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const members = res.json();
      expect(Array.isArray(members)).toBe(true);
      const emails = members.map((m: { email: string }) => m.email);
      expect(emails).toEqual(expect.arrayContaining([ADMIN_EMAIL, MEMBER_EMAIL]));
      const admin = members.find((m: { email: string }) => m.email === ADMIN_EMAIL);
      expect(admin.status).toBe("active");
      expect(admin.accountRole).toBe("admin");

      await app.close();
    });
  });

  describe("POST /api/team/invite", () => {
    it("returns 403 for a non-admin member", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, MEMBER_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie },
        payload: { email: "should-not-work@kurzly.test", accountRole: "member" },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("returns 400 for an invalid/empty email", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie },
        payload: { email: "", accountRole: "member" },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("creates a pending member invitee with domains assigned and sends exactly one magic link", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ADMIN_EMAIL);
      vi.mocked(sendMagicLinkEmail).mockClear();

      const domain = await prisma.domain.create({
        data: {
          hostname: "team-invite-domain.test",
          type: "subdomain",
          status: "active",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const inviteEmail = "new-member@kurzly.test";
      const res = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie },
        payload: { email: inviteEmail, accountRole: "member", domainIds: [domain.id] },
      });

      expect(res.statusCode).toBe(201);
      const member = res.json();
      expect(member.email).toBe(inviteEmail);
      expect(member.accountRole).toBe("member");
      expect(member.status).toBe("pending");
      expect(member.domains).toEqual([{ id: domain.id, hostname: domain.hostname }]);

      expect(vi.mocked(sendMagicLinkEmail).mock.calls.filter((c) => c[0]?.to === inviteEmail)).toHaveLength(1);

      await app.close();
    });

    it("creates a pending admin invitee with no domains", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ADMIN_EMAIL);
      vi.mocked(sendMagicLinkEmail).mockClear();

      const inviteEmail = "new-admin@kurzly.test";
      const res = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie },
        payload: { email: inviteEmail, accountRole: "admin" },
      });

      expect(res.statusCode).toBe(201);
      const member = res.json();
      expect(member.accountRole).toBe("admin");
      expect(member.status).toBe("pending");
      expect(member.domains).toEqual([]);

      await app.close();
    });

    it("re-inviting an existing address re-sends the magic link, creates no duplicate, and leaves accountRole unchanged", async () => {
      const app = await buildApp({ prisma });
      const cookie = await signInAs(app, ADMIN_EMAIL);
      vi.mocked(sendMagicLinkEmail).mockClear();

      const inviteEmail = "resend-member@kurzly.test";
      const first = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie },
        payload: { email: inviteEmail, accountRole: "member" },
      });
      expect(first.statusCode).toBe(201);
      const firstMember = first.json();

      const second = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie },
        // Deliberately request a DIFFERENT role — the resend must NOT change it.
        payload: { email: inviteEmail, accountRole: "admin" },
      });
      expect(second.statusCode).toBe(201);
      const secondMember = second.json();

      expect(secondMember.id).toBe(firstMember.id);
      expect(secondMember.accountRole).toBe("member");
      expect(secondMember.status).toBe("pending");

      const rows = await prisma.user.findMany({ where: { email: inviteEmail } });
      expect(rows).toHaveLength(1);

      expect(vi.mocked(sendMagicLinkEmail).mock.calls.filter((c) => c[0]?.to === inviteEmail)).toHaveLength(2);

      await app.close();
    });

    it("flips an invited user from pending to active after a real magic-link sign-in round trip (D-09-03)", async () => {
      const app = await buildApp({ prisma });
      const adminCookie = await signInAs(app, ADMIN_EMAIL);
      vi.mocked(sendMagicLinkEmail).mockClear();

      const inviteEmail = "activates@kurzly.test";
      const inviteRes = await app.inject({
        method: "POST",
        url: "/api/team/invite",
        headers: { cookie: adminCookie },
        payload: { email: inviteEmail, accountRole: "member" },
      });
      expect(inviteRes.statusCode).toBe(201);
      expect(inviteRes.json().status).toBe("pending");

      // The real magic-link round trip — not a manually-flipped column.
      await signInAs(app, inviteEmail);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/team",
        headers: { cookie: adminCookie },
      });
      expect(listRes.statusCode).toBe(200);
      const invitee = listRes
        .json()
        .find((m: { email: string }) => m.email === inviteEmail);
      expect(invitee.status).toBe("active");

      await app.close();
    });
  });
});
