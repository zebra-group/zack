/**
 * Analytics read-side suite (TRACK-04/05, D-10) — real-Postgres, run against
 * `setupFileEach.ts`'s transaction-wrapped Prisma client (D-09), same
 * discipline as `links.integration.test.ts`.
 *
 * Task 1 covers `lib/analytics.ts`'s pure aggregation functions directly
 * against seeded `ClickEvent`/`Link`/`Domain` rows. Task 2 extends this file
 * with `routes/analytics.ts` endpoint-level assertions (auth/IDOR/scoping)
 * reusing `links.integration.test.ts`'s magic-link -> verify -> cookie flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { getGlobalAnalytics, getLinkAnalytics } from "../src/lib/analytics.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const OWNER_EMAIL = "analytics-owner@kurzly.test";
const OUTSIDER_EMAIL = "analytics-outsider@kurzly.test";

// Invite-only allowlist (D-01, lib/allowlist.ts): sendMagicLink only fires
// for a User row that already exists — mirrors links.integration.test.ts's
// beforeEach exactly, otherwise every signInAs() call for these two fixture
// emails silently no-ops (D-01's neutral non-allowlisted response).
beforeEach(async () => {
  vi.mocked(sendMagicLinkEmail).mockClear();
  // Deliberately a plain `prisma.user.upsert` (not `seedInitialAdmin`, which
  // since Phase 9/D-09-01 always sets `accountRole: "admin"`) — this
  // fixture tests per-domain scoping (TRACK-05's "scoped to the caller's
  // own domains" proof), not the D-09-02 account-admin bypass, and must
  // default to `accountRole: "member"` (schema default) so scopedDomainIds
  // never returns the whole instance for it.
  await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { emailVerified: true },
    create: {
      id: "u_analytics_owner",
      name: "Analytics Owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    },
  });
  await prisma.user.upsert({
    where: { email: OUTSIDER_EMAIL },
    update: { emailVerified: true },
    create: {
      id: "u_analytics_outsider",
      name: "Analytics Outsider",
      email: OUTSIDER_EMAIL,
      emailVerified: true,
    },
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

/** Creates a Domain (no membership) for direct `lib/analytics.ts` seeding. */
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

/** Creates a Domain + owner DomainMembership for `userId` (route-layer IDOR tests). */
async function seedOwnedDomain(userId: string, hostname: string): Promise<string> {
  const domainId = await seedDomain(hostname);
  await prisma.domainMembership.create({
    data: { userId, domainId, role: "owner" },
  });
  return domainId;
}

async function seedLink(domainId: string, slug: string, lifetimeClicks = 0): Promise<string> {
  const link = await prisma.link.create({
    data: { domainId, slug, targetUrl: "https://example.com", lifetimeClicks },
  });
  return link.id;
}

async function seedClick(
  linkId: string,
  opts: {
    daysAgo?: number;
    referrerHost?: string | null;
    country?: string | null;
    visitorHash?: string;
    source?: "link" | "qr";
  } = {},
): Promise<void> {
  const createdAt = new Date();
  createdAt.setUTCDate(createdAt.getUTCDate() - (opts.daysAgo ?? 0));
  await prisma.clickEvent.create({
    data: {
      linkId,
      createdAt,
      referrerHost: opts.referrerHost ?? null,
      country: opts.country ?? null,
      visitorHash: opts.visitorHash ?? `visitor-${Math.random().toString(36).slice(2)}`,
      source: opts.source ?? "link",
    },
  });
}

describe("lib/analytics.ts — getLinkAnalytics (TRACK-04)", () => {
  it("returns exactly 30 zero-filled daily buckets, ordered ascending", async () => {
    const domainId = await seedDomain("analytics-link-30.example.com");
    const linkId = await seedLink(domainId, "thirty-buckets");

    const result = await getLinkAnalytics(prisma, linkId);

    expect(result.dailySeries).toHaveLength(30);
    expect(result.dailySeries.every((bucket) => bucket.count === 0)).toBe(true);
    const days = result.dailySeries.map((bucket) => bucket.day);
    expect([...days].sort()).toEqual(days);
  });

  it("totalClicks reads Link.lifetimeClicks, not a live COUNT over ClickEvent", async () => {
    const domainId = await seedDomain("analytics-link-lifetime.example.com");
    const linkId = await seedLink(domainId, "lifetime-clicks", 42);
    // Zero ClickEvent rows inserted — lifetimeClicks alone must drive totalClicks.

    const result = await getLinkAnalytics(prisma, linkId);

    expect(result.totalClicks).toBe(42);
  });

  it("last7Days sums the trailing 7 buckets, excluding older clicks", async () => {
    const domainId = await seedDomain("analytics-link-7d.example.com");
    const linkId = await seedLink(domainId, "seven-days");
    await seedClick(linkId, { daysAgo: 0 });
    await seedClick(linkId, { daysAgo: 6 });
    await seedClick(linkId, { daysAgo: 10 });

    const result = await getLinkAnalytics(prisma, linkId);

    expect(result.last7Days).toBe(2);
    expect(result.dailySeries.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
  });

  it("topReferrers/topCountries are count-desc lists; a null host/country surfaces as null", async () => {
    const domainId = await seedDomain("analytics-link-referrers.example.com");
    const linkId = await seedLink(domainId, "referrers");
    await seedClick(linkId, { referrerHost: "google.com", country: "DE" });
    await seedClick(linkId, { referrerHost: "google.com", country: "DE" });
    await seedClick(linkId, { referrerHost: null, country: null });

    const result = await getLinkAnalytics(prisma, linkId);

    expect(result.topReferrers[0]).toEqual({ host: "google.com", count: 2 });
    expect(result.topReferrers.some((row) => row.host === null)).toBe(true);
    expect(result.topCountries[0]).toEqual({ country: "DE", count: 2 });
    expect(result.topCountries.some((row) => row.country === null)).toBe(true);
    expect(result.topReferrer).toBe("google.com");
  });

  it("returns zero/empty results for a link with no clicks (never throws)", async () => {
    const domainId = await seedDomain("analytics-link-empty.example.com");
    const linkId = await seedLink(domainId, "no-clicks");

    const result = await getLinkAnalytics(prisma, linkId);

    expect(result.totalClicks).toBe(0);
    expect(result.last7Days).toBe(0);
    expect(result.topReferrer).toBeNull();
    expect(result.topReferrers).toEqual([]);
    expect(result.topCountries).toEqual([]);
  });
});

describe("lib/analytics.ts — getGlobalAnalytics (TRACK-05)", () => {
  it("uniqueVisitors === COUNT(DISTINCT visitorHash) scoped to domainIds", async () => {
    const domainId = await seedDomain("analytics-global-unique.example.com");
    const linkId = await seedLink(domainId, "unique-visitors");
    await seedClick(linkId, { visitorHash: "v1" });
    await seedClick(linkId, { visitorHash: "v1" });
    await seedClick(linkId, { visitorHash: "v2" });

    const result = await getGlobalAnalytics(prisma, [domainId]);

    expect(result.uniqueVisitors).toBe(2);
    expect(result.clicks30Days).toBe(3);
  });

  it("activeLinks counts Links in scope independent of any clicks", async () => {
    const domainId = await seedDomain("analytics-global-active.example.com");
    await seedLink(domainId, "no-clicks-link-1");
    await seedLink(domainId, "no-clicks-link-2");

    const result = await getGlobalAnalytics(prisma, [domainId]);

    expect(result.activeLinks).toBe(2);
  });

  it("qrScans reads COUNT(source='qr') — always 0 this phase (D-14 seam)", async () => {
    const domainId = await seedDomain("analytics-global-qr.example.com");
    const linkId = await seedLink(domainId, "qr-scope");
    await seedClick(linkId, { source: "link" });

    const result = await getGlobalAnalytics(prisma, [domainId]);

    expect(result.qrScans).toBe(0);
  });

  it("empty domainIds yields all-zero/empty results — no cross-tenant leak, no invalid SQL", async () => {
    const domainId = await seedDomain("analytics-global-leak.example.com");
    const linkId = await seedLink(domainId, "leak-check");
    await seedClick(linkId, { visitorHash: "v1" });

    const result = await getGlobalAnalytics(prisma, []);

    expect(result.clicks30Days).toBe(0);
    expect(result.uniqueVisitors).toBe(0);
    expect(result.activeLinks).toBe(0);
    expect(result.qrScans).toBe(0);
    expect(result.topLinks).toEqual([]);
    expect(result.topReferrers).toEqual([]);
    expect(result.dailySeries).toHaveLength(30);
    expect(result.dailySeries.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("topLinks ranks per-link click counts desc, scoped to domainIds", async () => {
    const domainId = await seedDomain("analytics-global-toplinks.example.com");
    const linkA = await seedLink(domainId, "top-a");
    const linkB = await seedLink(domainId, "top-b");
    await seedClick(linkA);
    await seedClick(linkA);
    await seedClick(linkB);

    const result = await getGlobalAnalytics(prisma, [domainId]);

    expect(result.topLinks[0]).toMatchObject({ slug: "top-a", domainId, clicks: 2 });
  });

  it("never leaks a bigint COUNT result into the DTO", async () => {
    const domainId = await seedDomain("analytics-global-bigint.example.com");
    const linkId = await seedLink(domainId, "bigint-check");
    await seedClick(linkId);

    const result = await getGlobalAnalytics(prisma, [domainId]);

    expect(typeof result.uniqueVisitors).toBe("number");
    expect(typeof result.activeLinks).toBe("number");
    expect(typeof result.qrScans).toBe("number");
    expect(typeof result.clicks30Days).toBe("number");
    expect(result.dailySeries.every((bucket) => typeof bucket.count === "number")).toBe(true);
  });
});

describe("GET /api/links/:id/analytics (route layer, IDOR guard — TRACK-04)", () => {
  it("401s with no session", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: "/api/links/anything/analytics" });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("404s for a link the caller cannot access (no existence oracle)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomain(ownerId, "analytics-idor.example.com");
    const linkId = await seedLink(domainId, "idor-check", 5);

    const outsiderCookie = await signInAs(app, OUTSIDER_EMAIL);

    const forbiddenRes = await app.inject({
      method: "GET",
      url: `/api/links/${linkId}/analytics`,
      headers: { cookie: outsiderCookie },
    });
    const nonexistentRes = await app.inject({
      method: "GET",
      url: "/api/links/does-not-exist/analytics",
      headers: { cookie: outsiderCookie },
    });

    expect(forbiddenRes.statusCode).toBe(404);
    expect(nonexistentRes.statusCode).toBe(404);
    expect(forbiddenRes.json()).toEqual(nonexistentRes.json());

    await app.close();
  });

  it("200s with the LinkAnalyticsDTO for an owned link", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomain(ownerId, "analytics-owned.example.com");
    const linkId = await seedLink(domainId, "owned-analytics", 7);

    const res = await app.inject({
      method: "GET",
      url: `/api/links/${linkId}/analytics`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalClicks).toBe(7);
    expect(body.dailySeries).toHaveLength(30);

    await app.close();
  });
});

describe("GET /api/analytics (route layer, session-gated + domain-scoped — TRACK-05)", () => {
  it("401s with no session", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: "/api/analytics" });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("200s scoped to the caller's own domains — never the whole instance", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const ownDomainId = await seedOwnedDomain(ownerId, "analytics-global-own.example.com");
    const ownLinkId = await seedLink(ownDomainId, "own-link");
    await seedClick(ownLinkId);

    // A domain the caller has no membership on — must never leak into the response.
    const otherDomainId = await seedDomain("analytics-global-other.example.com");
    const otherLinkId = await seedLink(otherDomainId, "other-link");
    await seedClick(otherLinkId);
    await seedClick(otherLinkId);

    const res = await app.inject({
      method: "GET",
      url: "/api/analytics",
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activeLinks).toBe(1);
    expect(body.clicks30Days).toBe(1);

    await app.close();
  });
});
