/**
 * Link core + route integration suite (LINK-01/02/03, D-01/D-02/D-03) — the
 * completion evidence for the D-01 single-write-path core and the
 * POST/GET /api/links routes (Nyquist Wave 2).
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test) via `buildApp({ prisma
 * })` (D-09), reusing `domains.integration.test.ts`'s magic-link ->
 * verify -> cookie flow to obtain a real authenticated session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import {
  createLink,
  previewLink,
  RESERVED_SLUGS,
  validateLinkInput,
  validateTargetUrl,
} from "../src/lib/links.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const OWNER_EMAIL = "link-owner@kurzly.test";
const OUTSIDER_EMAIL = "link-outsider@kurzly.test";

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

/** Resolves the userId behind an already-signed-in cookie header. */
async function resolveSessionUserId(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookieHeader: string,
): Promise<string> {
  const session = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie: cookieHeader },
  });
  return session.json()?.user?.id as string;
}

/** Creates a Domain + owner DomainMembership for `userId` directly via Prisma (test seed helper). */
async function seedOwnedDomain(userId: string, hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "pending",
      verificationTarget: "shortener.kurzly.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

describe("Link core + routes (LINK-01/02/03, D-01/D-02/D-03)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    await seedInitialAdmin(prisma, OWNER_EMAIL);
    await prisma.user.upsert({
      where: { email: OUTSIDER_EMAIL },
      update: { emailVerified: true },
      create: {
        id: "u_link_outsider",
        name: "Link Outsider",
        email: OUTSIDER_EMAIL,
        emailVerified: true,
      },
    });
  });

  describe("validateTargetUrl", () => {
    it("accepts https:// and http:// URLs", () => {
      expect(validateTargetUrl("https://example.com/x")).toBe("https://example.com/x");
      expect(validateTargetUrl("http://x.io")).toBe("http://x.io");
    });

    it("rejects javascript:, data:, file: schemes and a bare non-URL string", () => {
      expect(validateTargetUrl("javascript:alert(1)")).toBeUndefined();
      expect(validateTargetUrl("data:text/html,x")).toBeUndefined();
      expect(validateTargetUrl("file:///etc/passwd")).toBeUndefined();
      expect(validateTargetUrl("not a url")).toBeUndefined();
    });
  });

  describe("validateLinkInput (D-01 pure core)", () => {
    it("UNAUTHORIZED_DOMAIN: denies a caller with no member+ membership on the target domain", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "unauthorized-core.example.com");

      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);
      const outsiderId = await resolveSessionUserId(app, outsiderCookie);

      const result = await validateLinkInput(prisma, {
        userId: outsiderId,
        domainId,
        targetUrl: "https://example.com",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("UNAUTHORIZED_DOMAIN");

      await app.close();
    });

    it("INVALID_TARGET_URL: rejects a non-http(s) scheme for a member", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "invalid-target.example.com");

      const result = await validateLinkInput(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "javascript:alert(1)",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("INVALID_TARGET_URL");

      await app.close();
    });

    it("SLUG_RESERVED: rejects a reserved custom slug case-insensitively", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "reserved-slug.example.com");

      for (const candidate of ["api", "Health", "q"]) {
        const result = await validateLinkInput(prisma, {
          userId: ownerId,
          domainId,
          targetUrl: "https://example.com",
          slug: candidate,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("SLUG_RESERVED");
      }

      await app.close();
    });

    it("SLUG_TAKEN: rejects a custom slug already used in the same domain, but allows it on a different domain", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainAId = await seedOwnedDomain(ownerId, "slug-taken-a.example.com");
      const domainBId = await seedOwnedDomain(ownerId, "slug-taken-b.example.com");

      const created = await createLink(prisma, {
        userId: ownerId,
        domainId: domainAId,
        targetUrl: "https://example.com/first",
        slug: "shared-slug",
      });
      expect(created.ok).toBe(true);

      const collision = await validateLinkInput(prisma, {
        userId: ownerId,
        domainId: domainAId,
        targetUrl: "https://example.com/second",
        slug: "shared-slug",
      });
      expect(collision.ok).toBe(false);
      if (!collision.ok) expect(collision.error).toBe("SLUG_TAKEN");

      const otherDomain = await validateLinkInput(prisma, {
        userId: ownerId,
        domainId: domainBId,
        targetUrl: "https://example.com/second",
        slug: "shared-slug",
      });
      expect(otherDomain.ok).toBe(true);

      await app.close();
    });

    it("blank slug auto-generates a 7-char Base62 slug", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "auto-slug.example.com");

      const result = await validateLinkInput(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.slug).toMatch(/^[0-9A-Za-z]{7}$/);
      }

      await app.close();
    });
  });

  describe("RESERVED_SLUGS coverage", () => {
    it("every reserved slug is rejected by createLink", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "reserved-coverage.example.com");

      for (const reserved of RESERVED_SLUGS) {
        const result = await createLink(prisma, {
          userId: ownerId,
          domainId,
          targetUrl: "https://example.com",
          slug: reserved,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("SLUG_RESERVED");
      }

      await app.close();
    });
  });

  describe("createLink / previewLink write behavior (D-01)", () => {
    it("createLink writes exactly one row; previewLink writes zero rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "write-count.example.com");

      const beforePreview = await prisma.link.count();
      const preview = await previewLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/preview",
        slug: "preview-only",
      });
      expect(preview.ok).toBe(true);
      const afterPreview = await prisma.link.count();
      expect(afterPreview).toBe(beforePreview);

      const beforeCreate = await prisma.link.count();
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/created",
        slug: "created-only",
      });
      expect(created.ok).toBe(true);
      const afterCreate = await prisma.link.count();
      expect(afterCreate).toBe(beforeCreate + 1);

      await app.close();
    });
  });

  describe("POST /api/links (route layer)", () => {
    it("201s a blank-slug create with a 7-char Base62 slug and persists createdBy", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-blank-slug.example.com");

      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "https://example.com/blank" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.slug).toMatch(/^[0-9A-Za-z]{7}$/);

      const row = await prisma.link.findUniqueOrThrow({ where: { id: body.id } });
      expect(row.domainId).toBe(domainId);
      expect(row.createdBy).toBe(ownerId);

      await app.close();
    });

    it("201s a custom-slug create using that exact slug", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-custom-slug.example.com");

      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "https://example.com/custom", slug: "my-custom-slug" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.slug).toBe("my-custom-slug");

      await app.close();
    });

    it("401s an unauthenticated create and writes zero rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-401.example.com");

      const before = await prisma.link.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        payload: { domainId, targetUrl: "https://example.com" },
      });

      expect(res.statusCode).toBe(401);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("403s a cross-domain create (member of A posting to domain B) and writes zero rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      await seedOwnedDomain(ownerId, "route-cross-a.example.com");
      const domainBId = await seedOwnedDomain(ownerId, "route-cross-b.example.com");

      // Outsider has zero memberships anywhere - not a member of domain B.
      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);

      const before = await prisma.link.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: outsiderCookie },
        payload: { domainId: domainBId, targetUrl: "https://example.com" },
      });

      expect(res.statusCode).toBe(403);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("400s an invalid targetUrl scheme (javascript:) and writes zero rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-bad-scheme.example.com");

      const before = await prisma.link.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "javascript:alert(1)" },
      });

      expect(res.statusCode).toBe(400);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("400s a reserved custom slug (e.g. 'api') and writes zero rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-reserved.example.com");

      const before = await prisma.link.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "https://example.com", slug: "api" },
      });

      expect(res.statusCode).toBe(400);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("400s a malformed body (missing domainId)", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);

      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { targetUrl: "https://example.com" },
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });

    it("409s a custom-slug-taken create and leaves exactly one row for that (domainId, slug)", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-slug-taken.example.com");

      const first = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "https://example.com/first", slug: "dup-route-slug" },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "https://example.com/second", slug: "dup-route-slug" },
      });
      expect(second.statusCode).toBe(409);

      const count = await prisma.link.count({ where: { domainId, slug: "dup-route-slug" } });
      expect(count).toBe(1);

      await app.close();
    });

    it("mass-assignment: request body cannot set id/createdBy/createdAt", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-mass-assign.example.com");

      const res = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: {
          domainId,
          targetUrl: "https://example.com/mass-assign",
          id: "attacker-chosen-id",
          createdBy: "someone-else",
          createdAt: "2000-01-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).not.toBe("attacker-chosen-id");
      expect(body.createdBy).toBe(ownerId);
      expect(body.createdAt).not.toBe("2000-01-01T00:00:00.000Z");

      await app.close();
    });
  });

  describe("GET /api/links (route layer)", () => {
    it("scopes results to the caller's domains - a second user with no memberships sees none of the first user's links", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-scoping.example.com");

      const created = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId, targetUrl: "https://example.com/scoped", slug: "scoped-link" },
      });
      expect(created.statusCode).toBe(201);

      const ownerList = await app.inject({
        method: "GET",
        url: "/api/links",
        headers: { cookie: ownerCookie },
      });
      expect(ownerList.statusCode).toBe(200);
      const ownerLinks = ownerList.json();
      expect(ownerLinks.some((l: { slug: string }) => l.slug === "scoped-link")).toBe(true);

      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);
      const outsiderList = await app.inject({
        method: "GET",
        url: "/api/links",
        headers: { cookie: outsiderCookie },
      });
      expect(outsiderList.statusCode).toBe(200);
      expect(outsiderList.json()).toEqual([]);

      await app.close();
    });

    it("?domainId= narrows to that domain only when it is in scope; an out-of-scope domainId yields []", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainAId = await seedOwnedDomain(ownerId, "route-filter-a.example.com");
      const domainBId = await seedOwnedDomain(ownerId, "route-filter-b.example.com");

      await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId: domainAId, targetUrl: "https://example.com/a", slug: "filter-a-link" },
      });
      await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: { domainId: domainBId, targetUrl: "https://example.com/b", slug: "filter-b-link" },
      });

      const filteredA = await app.inject({
        method: "GET",
        url: `/api/links?domainId=${domainAId}`,
        headers: { cookie: ownerCookie },
      });
      expect(filteredA.statusCode).toBe(200);
      const filteredALinks = filteredA.json();
      expect(filteredALinks.every((l: { domainId: string }) => l.domainId === domainAId)).toBe(true);
      expect(filteredALinks.some((l: { slug: string }) => l.slug === "filter-a-link")).toBe(true);

      // An out-of-scope domainId (owned by nobody the outsider has membership
      // with) yields [] even though rows exist for it.
      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);
      const outOfScope = await app.inject({
        method: "GET",
        url: `/api/links?domainId=${domainAId}`,
        headers: { cookie: outsiderCookie },
      });
      expect(outOfScope.statusCode).toBe(200);
      expect(outOfScope.json()).toEqual([]);

      await app.close();
    });

    it("?q= filters by slug/targetUrl/title contains (case-insensitive)", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "route-search.example.com");

      await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: {
          domainId,
          targetUrl: "https://example.com/needle-target",
          slug: "haystack-one",
          title: "Nothing special",
        },
      });
      await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: {
          domainId,
          targetUrl: "https://example.com/unrelated",
          slug: "haystack-two",
          title: "Contains NEEDLE in title",
        },
      });
      await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { cookie: ownerCookie },
        payload: {
          domainId,
          targetUrl: "https://example.com/no-match-here",
          slug: "no-match-slug",
          title: "No match either",
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/links?q=needle",
        headers: { cookie: ownerCookie },
      });
      expect(res.statusCode).toBe(200);
      const results = res.json();
      const slugs = results.map((l: { slug: string }) => l.slug).sort();
      expect(slugs).toEqual(["haystack-one", "haystack-two"]);

      await app.close();
    });

    it("401s an unauthenticated list request", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({ method: "GET", url: "/api/links" });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });

  describe("GET /api/links/:id (route layer, IDOR guard — LINK-05)", () => {
    it("200s with the LinkDTO for a link in the caller's own domain", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "detail-happy.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/detail",
        slug: "detail-happy",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const res = await app.inject({
        method: "GET",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        id: created.link.id,
        domainId,
        slug: "detail-happy",
        targetUrl: "https://example.com/detail",
      });

      await app.close();
    });

    it("404s for a non-existent link id", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);

      const res = await app.inject({
        method: "GET",
        url: "/api/links/does-not-exist",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(404);

      await app.close();
    });

    it("404s (identical body to non-existent) for a link the caller cannot access — no existence leak", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "detail-forbidden.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/forbidden",
        slug: "detail-forbidden",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);

      const forbiddenRes = await app.inject({
        method: "GET",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: outsiderCookie },
      });
      const nonexistentRes = await app.inject({
        method: "GET",
        url: "/api/links/does-not-exist",
        headers: { cookie: outsiderCookie },
      });

      expect(forbiddenRes.statusCode).toBe(404);
      expect(nonexistentRes.statusCode).toBe(404);
      expect(forbiddenRes.json()).toEqual(nonexistentRes.json());

      await app.close();
    });

    it("401s with no session", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({ method: "GET", url: "/api/links/anything" });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });

  describe("DELETE /api/links/:id (route layer, IDOR guard — LINK-07)", () => {
    it("204s and removes the row for an accessible link", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "delete-happy.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/delete",
        slug: "delete-happy",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(204);
      const row = await prisma.link.findUnique({ where: { id: created.link.id } });
      expect(row).toBeNull();

      await app.close();
    });

    it("404s and writes nothing for a non-existent id", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);

      const before = await prisma.link.count();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/links/does-not-exist",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(404);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("404s and leaves the row intact for a link the caller cannot access", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "delete-forbidden.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/delete-forbidden",
        slug: "delete-forbidden",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: outsiderCookie },
      });

      expect(res.statusCode).toBe(404);
      const row = await prisma.link.findUnique({ where: { id: created.link.id } });
      expect(row).not.toBeNull();

      await app.close();
    });

    it("401s with no session", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({ method: "DELETE", url: "/api/links/anything" });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });

  describe("PATCH /api/links/:id (route layer, D-04 same-rules-as-create — LINK-06)", () => {
    it("200s a targetUrl-only edit, leaving the slug untouched", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "patch-target-only.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/before",
        slug: "patch-target-only",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
        payload: { targetUrl: "https://example.com/after" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.targetUrl).toBe("https://example.com/after");
      expect(body.slug).toBe("patch-target-only");

      const row = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(row.targetUrl).toBe("https://example.com/after");
      expect(row.slug).toBe("patch-target-only");

      await app.close();
    });

    it("200s a slug edit to a free slug; re-saving the same slug also 200s (no false SLUG_TAKEN)", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "patch-slug-free.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/slug-edit",
        slug: "patch-slug-old",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const renamed = await app.inject({
        method: "PATCH",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
        payload: { slug: "patch-slug-new" },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().slug).toBe("patch-slug-new");

      const resave = await app.inject({
        method: "PATCH",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
        payload: { slug: "patch-slug-new" },
      });
      expect(resave.statusCode).toBe(200);
      expect(resave.json().slug).toBe("patch-slug-new");

      const row = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(row.slug).toBe("patch-slug-new");

      await app.close();
    });

    it("400s a reserved-slug edit and leaves the row unchanged", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "patch-reserved.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/reserved-edit",
        slug: "patch-reserved-slug",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
        payload: { slug: "api" },
      });

      expect(res.statusCode).toBe(400);
      const row = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(row.slug).toBe("patch-reserved-slug");

      await app.close();
    });

    it("409s a cross-link slug-collision edit and leaves the row unchanged", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "patch-collision.example.com");
      const other = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/other",
        slug: "patch-taken-slug",
      });
      const target = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/target",
        slug: "patch-target-slug",
      });
      expect(other.ok).toBe(true);
      expect(target.ok).toBe(true);
      if (!other.ok || !target.ok) throw new Error("setup failed");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/links/${target.link.id}`,
        headers: { cookie: ownerCookie },
        payload: { slug: "patch-taken-slug" },
      });

      expect(res.statusCode).toBe(409);
      const row = await prisma.link.findUniqueOrThrow({ where: { id: target.link.id } });
      expect(row.slug).toBe("patch-target-slug");

      await app.close();
    });

    it("400s a javascript: targetUrl edit and leaves the row unchanged", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "patch-bad-scheme.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/scheme-edit",
        slug: "patch-bad-scheme-slug",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: ownerCookie },
        payload: { targetUrl: "javascript:alert(1)" },
      });

      expect(res.statusCode).toBe(400);
      const row = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(row.targetUrl).toBe("https://example.com/scheme-edit");

      await app.close();
    });

    it("404s an IDOR PATCH (forbidden id) and leaves the row unchanged", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const domainId = await seedOwnedDomain(ownerId, "patch-idor.example.com");
      const created = await createLink(prisma, {
        userId: ownerId,
        domainId,
        targetUrl: "https://example.com/idor-edit",
        slug: "patch-idor-slug",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("setup failed");

      const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/links/${created.link.id}`,
        headers: { cookie: outsiderCookie },
        payload: { targetUrl: "https://example.com/attacker" },
      });

      expect(res.statusCode).toBe(404);
      const row = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(row.targetUrl).toBe("https://example.com/idor-edit");

      await app.close();
    });

    it("401s with no session", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({
        method: "PATCH",
        url: "/api/links/anything",
        payload: { targetUrl: "https://example.com/x" },
      });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });
});
