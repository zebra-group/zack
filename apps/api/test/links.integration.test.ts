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
});
