/**
 * Domain registration + list integration suite (DOMAIN-01, D-04, RESEARCH
 * Pattern 1/A1) — the completion evidence for DOMAIN-01 (Nyquist Wave 0).
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test) via `buildApp({ prisma
 * })` (D-09), reusing `auth.integration.test.ts`'s magic-link ->
 * verify -> cookie flow to obtain a real authenticated session (no session
 * mocking — `domainsRoute` resolves the caller via
 * `auth.api.getSession({ headers: fromNodeHeaders(request.headers) })`,
 * exactly as production does).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { DnsResolver } from "../src/lib/dnsClient.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const ADMIN_EMAIL = "domain-admin@zack.test";
const SECOND_USER_EMAIL = "domain-second@zack.test";

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

/**
 * Injectable fake resolver (03-02, mirrors dnsClient.test.ts) — used to
 * deterministically drive the verify route's status transitions without
 * ever touching real DNS in CI (RESEARCH Environment Availability).
 */
function fakeDnsResolver(cnameRecords: string[], aRecords: string[]): DnsResolver {
  return {
    resolveCname: async () => cnameRecords,
    resolve4: async () => aRecords,
  };
}

describe("Domain registration + list (DOMAIN-01, D-04, RESEARCH A1)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    // Deliberately a plain `prisma.user.upsert` (not `seedInitialAdmin`,
    // which since Phase 9/D-09-01 always sets `accountRole: "admin"`) —
    // this fixture tests per-domain deny-by-default scoping (e.g. "unknown
    // domain id -> 403"), not the D-09-02 account-admin bypass, and must
    // default to `accountRole: "member"` (schema default) so it stays
    // denied on domains it holds no membership on.
    await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { emailVerified: true },
      create: {
        id: "u_domain_admin",
        name: "Domain Admin Test User",
        email: ADMIN_EMAIL,
        emailVerified: true,
      },
    });
    // A second allowlisted user (Phase 2 admin-seed only allows one row via
    // env, but the User table itself doubles as the allowlist — RESEARCH
    // OQ-3 resolution) so GET-list scoping can be proven against a real
    // second identity with zero memberships of its own.
    await prisma.user.upsert({
      where: { email: SECOND_USER_EMAIL },
      update: { emailVerified: true },
      create: {
        id: "u_domain_second",
        name: "Domain Second User",
        email: SECOND_USER_EMAIL,
        emailVerified: true,
      },
    });
  });

  describe("POST /api/domains", () => {
    it("DOMAIN-01: creates a pending Domain + owner DomainMembership in one transaction", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "s.example.com", type: "subdomain" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.hostname).toBe("s.example.com");
      expect(body.type).toBe("subdomain");
      expect(body.status).toBe("pending");

      const domainRow = await prisma.domain.findUniqueOrThrow({
        where: { hostname: "s.example.com" },
      });
      expect(domainRow.status).toBe("pending");
      // env.ts's documented default (no CNAME_TARGET set in vitest.config.ts's
      // test env — this exercises the fail-safe-default path, D-02).
      expect(domainRow.verificationTarget).toBe("shortener.zack.local");

      // Look up the owner membership directly via the session's user id
      // (better-auth generates the id — no hardcoded value to assert against).
      const session = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: cookieHeader },
      });
      const userId = session.json()?.user?.id as string;
      const ownerMembership = await prisma.domainMembership.findUnique({
        where: { userId_domainId: { userId, domainId: domainRow.id } },
      });
      expect(ownerMembership?.role).toBe("owner");

      await app.close();
    });

    it("computes verificationTarget from A_RECORD_IP for apex domains", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "example.com", type: "apex" },
      });

      expect(res.statusCode).toBe(201);
      const domainRow = await prisma.domain.findUniqueOrThrow({
        where: { hostname: "example.com" },
      });
      // env.ts's documented default (no A_RECORD_IP set in vitest.config.ts's
      // test env — this exercises the fail-safe-default path, D-02).
      expect(domainRow.verificationTarget).toBe("0.0.0.0");

      await app.close();
    });

    it("401s an unauthenticated create and writes zero rows", async () => {
      const app = await buildApp({ prisma });

      const before = await prisma.domain.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        payload: { hostname: "unauth.example.com", type: "subdomain" },
      });

      expect(res.statusCode).toBe(401);
      const after = await prisma.domain.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("400s an invalid body (missing hostname)", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { type: "subdomain" },
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });

    it("400s an invalid body (bad type)", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "bad-type.example.com", type: "wildcard" },
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });

    it("409s a duplicate hostname and creates no second row", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const first = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "dup.example.com", type: "subdomain" },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "dup.example.com", type: "subdomain" },
      });
      expect(second.statusCode).toBe(409);

      const count = await prisma.domain.count({ where: { hostname: "dup.example.com" } });
      expect(count).toBe(1);

      await app.close();
    });

    it("CR-01: normalizes hostname casing + a trailing dot before persisting", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "Normalize-CR01.EXAMPLE.com.", type: "apex" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.hostname).toBe("normalize-cr01.example.com");

      const domainRow = await prisma.domain.findUniqueOrThrow({
        where: { hostname: "normalize-cr01.example.com" },
      });
      expect(domainRow.hostname).toBe("normalize-cr01.example.com");

      await app.close();
    });

    it("CR-01: a case/dot variant of an already-registered hostname is rejected as a 409 duplicate, not a second row (DNS-ownership-proof bypass closed)", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, ADMIN_EMAIL);
      const otherUserCookie = await signInAs(app, SECOND_USER_EMAIL);

      const first = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: ownerCookie },
        payload: { hostname: "casevariant.example.com", type: "subdomain" },
      });
      expect(first.statusCode).toBe(201);

      // A different (unrelated, non-owning) user attempts to register a
      // case+trailing-dot variant of the SAME hostname — must be rejected
      // as a duplicate, never create a second row a second user could ride
      // to a spoofed "active" status via DNS's own case/dot tolerance.
      const second = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: otherUserCookie },
        payload: { hostname: "CaseVariant.Example.COM.", type: "subdomain" },
      });
      expect(second.statusCode).toBe(409);

      const count = await prisma.domain.count({ where: { hostname: "casevariant.example.com" } });
      expect(count).toBe(1);

      await app.close();
    });

    it("WR-02: 400s a whitespace-only hostname (fails format validation post-normalization)", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "   ", type: "subdomain" },
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });

    it("WR-02: 400s a malformed hostname (invalid charset, no dot)", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "not_a_valid_host!!", type: "subdomain" },
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });
  });

  describe("GET /api/domains", () => {
    it("returns only the caller's domains (scopedDomainIds) — never another user's", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, ADMIN_EMAIL);
      const otherCookie = await signInAs(app, SECOND_USER_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: ownerCookie },
        payload: { hostname: "scoped.example.com", type: "subdomain" },
      });
      expect(created.statusCode).toBe(201);

      const ownerList = await app.inject({
        method: "GET",
        url: "/api/domains",
        headers: { cookie: ownerCookie },
      });
      expect(ownerList.statusCode).toBe(200);
      const ownerDomains = ownerList.json();
      expect(ownerDomains.some((d: { hostname: string }) => d.hostname === "scoped.example.com")).toBe(
        true,
      );

      const otherList = await app.inject({
        method: "GET",
        url: "/api/domains",
        headers: { cookie: otherCookie },
      });
      expect(otherList.statusCode).toBe(200);
      expect(otherList.json()).toEqual([]);

      await app.close();
    });

    it("401s an unauthenticated list request", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({ method: "GET", url: "/api/domains" });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });

  describe("POST /api/domains/:id/verify (DOMAIN-02, D-04)", () => {
    it("owner/admin + matching fake resolver → 200, status flips to active, verifiedAt + lastCheckedAt set", async () => {
      const matchingResolver = fakeDnsResolver(["shortener.zack.local"], []);
      const app = await buildApp({ prisma, dnsResolver: matchingResolver });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "verify-match.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/domains/${domainId}/verify`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("active");

      const row = await prisma.domain.findUniqueOrThrow({ where: { id: domainId } });
      expect(row.status).toBe("active");
      expect(row.verifiedAt).not.toBeNull();
      expect(row.lastCheckedAt).not.toBeNull();
      expect(row.lastCheckError).toBeNull();

      await app.close();
    });

    it("owner/admin + non-matching fake resolver → 200, status flips to failed, lastCheckError set", async () => {
      const nonMatchingResolver = fakeDnsResolver(["wrong.target.example"], []);
      const app = await buildApp({ prisma, dnsResolver: nonMatchingResolver });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "verify-mismatch.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/domains/${domainId}/verify`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("failed");

      const row = await prisma.domain.findUniqueOrThrow({ where: { id: domainId } });
      expect(row.status).toBe("failed");
      expect(row.lastCheckError).toBeTruthy();
      expect(row.verifiedAt).toBeNull();

      await app.close();
    });

    it("member-role caller → 403 (deny-by-default, requireDomainAccess admin+)", async () => {
      const app = await buildApp({ prisma, dnsResolver: fakeDnsResolver(["irrelevant"], []) });
      const ownerCookie = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: ownerCookie },
        payload: { hostname: "verify-member-denied.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const memberCookie = await signInAs(app, SECOND_USER_EMAIL);
      const memberSession = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: memberCookie },
      });
      const memberUserId = memberSession.json()?.user?.id as string;
      await prisma.domainMembership.create({
        data: { userId: memberUserId, domainId, role: "member" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/domains/${domainId}/verify`,
        headers: { cookie: memberCookie },
      });

      expect(res.statusCode).toBe(403);

      await app.close();
    });

    it("unknown domain id → 403 (deny-by-default, no membership row)", async () => {
      const app = await buildApp({ prisma, dnsResolver: fakeDnsResolver([], []) });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/domains/nonexistent-domain-id/verify",
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(403);

      await app.close();
    });
  });

  describe("DELETE /api/domains/:id (D-04)", () => {
    it("owner/admin → 204 and the row is gone", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "delete-me.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const res = await app.inject({
        method: "DELETE",
        url: `/api/domains/${domainId}`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(204);

      const row = await prisma.domain.findUnique({ where: { id: domainId } });
      expect(row).toBeNull();

      await app.close();
    });

    it("member-role caller → 403", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: ownerCookie },
        payload: { hostname: "delete-member-denied.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const memberCookie = await signInAs(app, SECOND_USER_EMAIL);
      const memberSession = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: memberCookie },
      });
      const memberUserId = memberSession.json()?.user?.id as string;
      await prisma.domainMembership.create({
        data: { userId: memberUserId, domainId, role: "member" },
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/domains/${domainId}`,
        headers: { cookie: memberCookie },
      });

      expect(res.statusCode).toBe(403);

      const row = await prisma.domain.findUnique({ where: { id: domainId } });
      expect(row).not.toBeNull();

      await app.close();
    });
  });

  describe("GET /api/domains/:id/instructions (DOMAIN-04, D-04)", () => {
    it("subdomain → returns a CNAME record line", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "instructions-sub.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const res = await app.inject({
        method: "GET",
        url: `/api/domains/${domainId}/instructions`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe("subdomain");
      expect(body.instructions).toContain("IN  CNAME");
      expect(body.alternativeForApex).toBeNull();

      await app.close();
    });

    it("apex → returns an A record line plus a non-null ALIAS alternative", async () => {
      const app = await buildApp({ prisma });
      const cookieHeader = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: cookieHeader },
        payload: { hostname: "instructions-apex.example.com", type: "apex" },
      });
      const domainId = created.json().id as string;

      const res = await app.inject({
        method: "GET",
        url: `/api/domains/${domainId}/instructions`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe("apex");
      expect(body.instructions).toContain("IN  A");
      expect(body.alternativeForApex).toBeTruthy();
      expect(body.alternativeForApex).toContain("ALIAS");

      await app.close();
    });

    it("member-role caller → 403", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, ADMIN_EMAIL);

      const created = await app.inject({
        method: "POST",
        url: "/api/domains",
        headers: { cookie: ownerCookie },
        payload: { hostname: "instructions-member-denied.example.com", type: "subdomain" },
      });
      const domainId = created.json().id as string;

      const memberCookie = await signInAs(app, SECOND_USER_EMAIL);
      const memberSession = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: memberCookie },
      });
      const memberUserId = memberSession.json()?.user?.id as string;
      await prisma.domainMembership.create({
        data: { userId: memberUserId, domainId, role: "member" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/domains/${domainId}/instructions`,
        headers: { cookie: memberCookie },
      });

      expect(res.statusCode).toBe(403);

      await app.close();
    });
  });
});
