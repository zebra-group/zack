/**
 * TEAM-06 exhaustive domain-scoped denial suite (D-09-08) — the phase's
 * headline evidence.
 *
 * For a plain Member with NO membership on a target domain, this suite
 * walks EVERY real Link, QR-code and Analytics endpoint (enumerated from
 * `routes/links.ts`, `routes/qrCodes.ts`, `routes/analytics.ts` — nothing
 * sampled, nothing invented) with a genuinely existing, correctly-guessed
 * resource id and asserts the rejection. It also asserts the stronger
 * "zero rows leak" guarantee for every list/create/import/aggregate
 * surface, not merely a status code. Finally it proves the D-09-02
 * admin-bypass positive half: an account-admin reaches the SAME foreign
 * resources the member is denied.
 *
 * Runs against `setupFileEach.ts`'s per-file-database, truncate-between-
 * tests harness (real testcontainers Postgres) via `buildApp({ prisma })`,
 * reusing the established magic-link -> verify -> cookie flow
 * (`links.integration.test.ts` / `qrCodes.integration.test.ts`). Every
 * `it()` seeds its own fixtures from scratch — nothing survives between
 * tests in this file (`setupFileEach.ts` truncates all tables in
 * `afterEach`).
 *
 * QR route list is CONFIRMED real (07-05, routes/qrCodes.ts): POST
 * /api/qr-codes, GET /api/qr-codes, GET /api/qr-codes/:id, GET
 * /api/qr-codes/:id/remap-history, PATCH /api/qr-codes/:id (both the
 * style-update AND the remap-via-targetLinkId body), GET
 * /api/qr-codes/:id/render.png, GET /api/qr-codes/:id/render.svg. There is
 * NO DELETE /api/qr-codes/:id and NO standalone remap route — neither is
 * tested here (hitting a nonexistent route 404s trivially and proves
 * nothing).
 *
 * Response shapes (D-09-08): Link routes -> 403 (create) / 404 (by-id,
 * IDOR, no existence oracle); QR routes -> 404 everywhere (a QrCode's
 * domain boundary is never client-visible, Phase 7's deliberate choice);
 * Analytics -> 200, silently scoped, zero foreign contribution.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createLink } from "../src/lib/links.js";
import { createQrCode } from "../src/lib/qrCodes.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const OWNER_EMAIL = "team-denial-owner@zack.test";
const ADMIN_EMAIL = "team-denial-admin@zack.test";
const MEMBER_EMAIL = "team-denial-member@zack.test";

// Invite-only allowlist (D-01, lib/allowlist.ts): sendMagicLink only fires
// for a User row that already exists — mirrors every other integration
// suite's beforeEach. ADMIN_EMAIL is seeded with accountRole: "admin"
// (D-09-01) so it exercises the D-09-02 bypass; OWNER_EMAIL/MEMBER_EMAIL
// are plain prisma.user.upsert calls (accountRole defaults to "member",
// per 09-02-SUMMARY.md's fixture-reuse lesson — never seedInitialAdmin for
// a per-domain-scoping fixture).
beforeEach(async () => {
  vi.mocked(sendMagicLinkEmail).mockClear();
  await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { emailVerified: true },
    create: {
      id: "u_team_denial_owner",
      name: "Team Denial Owner",
      email: OWNER_EMAIL,
      emailVerified: true,
    },
  });
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { emailVerified: true, accountRole: "admin" },
    create: {
      id: "u_team_denial_admin",
      name: "Team Denial Admin",
      email: ADMIN_EMAIL,
      emailVerified: true,
      accountRole: "admin",
    },
  });
  await prisma.user.upsert({
    where: { email: MEMBER_EMAIL },
    update: { emailVerified: true },
    create: {
      id: "u_team_denial_member",
      name: "Team Denial Member",
      email: MEMBER_EMAIL,
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

/** Creates a Domain + owner DomainMembership for `userId` (real, ACTIVE domain). */
async function seedOwnedDomain(userId: string, hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.zack.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

/** Creates a real Link via the D-01 single-write-path core (createLink). */
async function seedLink(userId: string, domainId: string, slug: string): Promise<string> {
  const created = await createLink(prisma, { userId, domainId, targetUrl: "https://example.com/target", slug });
  if (!created.ok) throw new Error(`setup failed: createLink returned ${created.error}`);
  return created.link.id;
}

/**
 * The full "foreign" fixture set an owner creates on a domain the Member
 * fixture is deliberately NOT assigned to: an active domain, a Link, a
 * static QR and a dynamic QR both bound to that Link (behavior block), plus
 * a ClickEvent so the analytics zero-leak assertion has real data to prove
 * doesn't leak.
 */
async function seedForeignFixtures(ownerId: string, suffix: string) {
  const domainId = await seedOwnedDomain(ownerId, `denial-${suffix}.zack.test`);
  const linkId = await seedLink(ownerId, domainId, `link-${suffix}`);

  const staticCreated = await createQrCode(prisma, {
    userId: ownerId,
    variant: "static",
    linkId,
    name: `Static QR ${suffix}`,
    color: "#000000",
  });
  if (!staticCreated.ok) throw new Error(`setup failed: static createQrCode returned ${staticCreated.error}`);

  const dynamicCreated = await createQrCode(prisma, {
    userId: ownerId,
    variant: "dynamic",
    linkId,
    name: `Dynamic QR ${suffix}`,
    color: "#000000",
  });
  if (!dynamicCreated.ok) throw new Error(`setup failed: dynamic createQrCode returned ${dynamicCreated.error}`);

  // Two ClickEvent rows on the foreign link — the analytics test asserts
  // these never surface in the Member's (or the Member's own domain's)
  // GET /api/analytics response.
  await prisma.clickEvent.create({ data: { linkId, visitorHash: `v-${suffix}-1`, source: "link" } });
  await prisma.clickEvent.create({ data: { linkId, visitorHash: `v-${suffix}-2`, source: "link" } });

  return {
    domainId,
    linkId,
    staticQrId: staticCreated.qrCode.id,
    dynamicQrId: dynamicCreated.qrCode.id,
  };
}

type DenialCase = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  payload?: Record<string, unknown>;
  expectedStatus: number;
  note: string;
};

describe("TEAM-06 exhaustive domain-scoped denial suite (D-09-08)", () => {
  it("Member: every Link/QR/Analytics-by-id endpoint rejects a genuine foreign resource id (exhaustive endpoint x expectation table)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const memberCookie = await signInAs(app, MEMBER_EMAIL);

    const { domainId, linkId, staticQrId, dynamicQrId } = await seedForeignFixtures(ownerId, "table");

    // One exhaustive table, enumerated directly from routes/links.ts,
    // routes/qrCodes.ts and routes/analytics.ts — every real by-id/create
    // endpoint, nothing sampled, nothing invented (D-09-08, WARNING 2).
    const table: DenialCase[] = [
      { method: "GET", url: `/api/links/${linkId}`, expectedStatus: 404, note: "GET /api/links/:id" },
      {
        method: "PATCH",
        url: `/api/links/${linkId}`,
        payload: { title: "Attacker rename" },
        expectedStatus: 404,
        note: "PATCH /api/links/:id",
      },
      {
        method: "PATCH",
        url: `/api/links/${linkId}`,
        payload: {
          utmSource: "attacker-source",
          utmMedium: "attacker-medium",
          utmCampaign: "attacker-campaign",
        },
        expectedStatus: 404,
        note: "PATCH /api/links/:id (UTM trio — denied identically to other Link fields, D-08-01/D-08-05 seam through TEAM-06)",
      },
      { method: "DELETE", url: `/api/links/${linkId}`, expectedStatus: 404, note: "DELETE /api/links/:id" },
      {
        method: "POST",
        url: "/api/links",
        payload: { domainId, targetUrl: "https://example.com/attacker-created" },
        expectedStatus: 403,
        note: "POST /api/links (foreign domainId -> UNAUTHORIZED_DOMAIN)",
      },
      {
        method: "GET",
        url: `/api/links/${linkId}/analytics`,
        expectedStatus: 404,
        note: "GET /api/links/:id/analytics",
      },
      {
        method: "POST",
        url: "/api/qr-codes",
        payload: { variant: "static", linkId, name: "Attacker QR" },
        expectedStatus: 404,
        note: "POST /api/qr-codes (foreign linkId, WARNING 1 — guards via resolveLinkDomainAccess, not scopedDomainIds)",
      },
      { method: "GET", url: `/api/qr-codes/${staticQrId}`, expectedStatus: 404, note: "GET /api/qr-codes/:id (static)" },
      {
        method: "GET",
        url: `/api/qr-codes/${dynamicQrId}`,
        expectedStatus: 404,
        note: "GET /api/qr-codes/:id (dynamic)",
      },
      {
        method: "GET",
        url: `/api/qr-codes/${dynamicQrId}/remap-history`,
        expectedStatus: 404,
        note: "GET /api/qr-codes/:id/remap-history",
      },
      {
        method: "PATCH",
        url: `/api/qr-codes/${staticQrId}`,
        payload: { name: "Attacker rename" },
        expectedStatus: 404,
        note: "PATCH /api/qr-codes/:id (style-update body)",
      },
      {
        method: "PATCH",
        url: `/api/qr-codes/${dynamicQrId}`,
        payload: { targetLinkId: linkId },
        expectedStatus: 404,
        note: "PATCH /api/qr-codes/:id (remap-via-targetLinkId body)",
      },
      {
        method: "GET",
        url: `/api/qr-codes/${staticQrId}/render.png`,
        expectedStatus: 404,
        note: "GET /api/qr-codes/:id/render.png",
      },
      {
        method: "GET",
        url: `/api/qr-codes/${staticQrId}/render.svg`,
        expectedStatus: 404,
        note: "GET /api/qr-codes/:id/render.svg",
      },
    ];

    for (const testCase of table) {
      const res = await app.inject({
        method: testCase.method,
        url: testCase.url,
        headers: { cookie: memberCookie },
        payload: testCase.payload,
      });
      expect(res.statusCode, testCase.note).toBe(testCase.expectedStatus);
    }

    await app.close();
  });

  it("Member: POST /api/qr-codes with a foreign linkId writes ZERO QrCode rows (WARNING 1 — create guards via resolveLinkDomainAccess, not scopedDomainIds)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const memberCookie = await signInAs(app, MEMBER_EMAIL);

    const { linkId } = await seedForeignFixtures(ownerId, "create-zero-rows");
    const before = await prisma.qrCode.count();

    const res = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie: memberCookie },
      payload: { variant: "dynamic", linkId, name: "Attacker Dynamic QR" },
    });

    expect(res.statusCode).toBe(404);
    const after = await prisma.qrCode.count();
    expect(after).toBe(before);

    await app.close();
  });

  it("Member: GET /api/links and GET /api/qr-codes omit the foreign resources entirely — own resources still appear", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const memberCookie = await signInAs(app, MEMBER_EMAIL);
    const memberId = await resolveSessionUserId(app, memberCookie);

    const { linkId: foreignLinkId, staticQrId: foreignQrId } = await seedForeignFixtures(ownerId, "list-leak");

    // The Member's OWN domain — proves the list is scoped, not just empty.
    const ownDomainId = await seedOwnedDomain(memberId, "denial-list-leak-own.zack.test");
    const ownLinkId = await seedLink(memberId, ownDomainId, "own-link-list-leak");
    const ownQrCreated = await createQrCode(prisma, {
      userId: memberId,
      variant: "static",
      linkId: ownLinkId,
      name: "Own QR",
      color: "#000000",
    });
    if (!ownQrCreated.ok) throw new Error(`setup failed: ${ownQrCreated.error}`);

    const linksRes = await app.inject({ method: "GET", url: "/api/links", headers: { cookie: memberCookie } });
    expect(linksRes.statusCode).toBe(200);
    const linkIds = (linksRes.json() as Array<{ id: string }>).map((l) => l.id);
    expect(linkIds).toContain(ownLinkId);
    expect(linkIds).not.toContain(foreignLinkId);

    const qrRes = await app.inject({ method: "GET", url: "/api/qr-codes", headers: { cookie: memberCookie } });
    expect(qrRes.statusCode).toBe(200);
    const qrIds = (qrRes.json() as Array<{ id: string }>).map((q) => q.id);
    expect(qrIds).toContain(ownQrCreated.qrCode.id);
    expect(qrIds).not.toContain(foreignQrId);

    await app.close();
  });

  it("Member: POST /api/links/import/{preview,commit} skip a foreign-domain row as domain_unauthorized, writing ZERO rows", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const memberCookie = await signInAs(app, MEMBER_EMAIL);
    const memberId = await resolveSessionUserId(app, memberCookie);

    const { domainId: foreignDomainId } = await seedForeignFixtures(ownerId, "import");
    const foreignHostname = (await prisma.domain.findUniqueOrThrow({ where: { id: foreignDomainId } })).hostname;
    const ownDomainId = await seedOwnedDomain(memberId, "denial-import-own.zack.test");

    const csv = [
      "ziel_url,slug,domain",
      `https://example.com/own-import,own-import-slug,denial-import-own.zack.test`,
      `https://example.com/foreign-import,foreign-import-slug,${foreignHostname}`,
    ].join("\n");

    const preview = await app.inject({
      method: "POST",
      url: "/api/links/import/preview",
      headers: { cookie: memberCookie },
      payload: { csv, defaultDomainId: ownDomainId },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();
    expect(previewBody.validCount).toBe(1);
    expect(previewBody.skippedCount).toBe(1);
    expect(
      (previewBody.rows as Array<{ valid: boolean; reason?: string }>).find((r) => !r.valid)?.reason,
    ).toBe("domain_unauthorized");
    // Preview is a dry-run for the ENTIRE csv, own row included — zero
    // writes anywhere, not just for the foreign row.
    const afterPreview = await prisma.link.count();
    expect(afterPreview).toBe(1); // only seedForeignFixtures's own fixture link exists so far

    const commit = await app.inject({
      method: "POST",
      url: "/api/links/import/commit",
      headers: { cookie: memberCookie },
      payload: { csv, defaultDomainId: ownDomainId },
    });
    expect(commit.statusCode).toBe(200);
    const commitBody = commit.json();
    expect(commitBody.importedCount).toBe(1);
    expect(commitBody.skippedCount).toBe(1);

    // The foreign domain must still hold ONLY seedForeignFixtures's own
    // fixture link — the import's foreign-domain row must never land.
    const foreignImportRow = await prisma.link.findFirst({ where: { slug: "foreign-import-slug" } });
    expect(foreignImportRow).toBeNull();
    const foreignRows = await prisma.link.findMany({ where: { domainId: foreignDomainId } });
    expect(foreignRows).toHaveLength(1);
    const ownRows = await prisma.link.findMany({ where: { domainId: ownDomainId } });
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]?.slug).toBe("own-import-slug");

    await app.close();
  });

  it("Member: GET /api/analytics scopes silently — the foreign domain contributes ZERO clicks/links to totals and top-lists", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const memberCookie = await signInAs(app, MEMBER_EMAIL);
    const memberId = await resolveSessionUserId(app, memberCookie);

    // Foreign domain: 2 clicks, on a domain the Member holds no membership on.
    await seedForeignFixtures(ownerId, "analytics-leak");

    // Member's OWN domain: 1 click — proves the Member's own scope still
    // works while the foreign domain contributes nothing.
    const ownDomainId = await seedOwnedDomain(memberId, "denial-analytics-own.zack.test");
    const ownLinkId = await seedLink(memberId, ownDomainId, "own-analytics-link");
    await prisma.clickEvent.create({ data: { linkId: ownLinkId, visitorHash: "v-own-1", source: "link" } });

    const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { cookie: memberCookie } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activeLinks).toBe(1);
    expect(body.clicks30Days).toBe(1);
    const topLinkSlugs = (body.topLinks as Array<{ slug: string }>).map((l) => l.slug);
    expect(topLinkSlugs).not.toContain("link-analytics-leak");

    await app.close();
  });

  it("Account-admin reaches the SAME foreign resources the Member is denied (D-09-02 admin-bypass, positive half)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const adminCookie = await signInAs(app, ADMIN_EMAIL);

    const { domainId, staticQrId, dynamicQrId } = await seedForeignFixtures(ownerId, "admin-allowed");
    // Separate Links so DELETE below does not disturb the other assertions.
    const readLinkId = await seedLink(ownerId, domainId, "admin-allowed-read-link");
    const patchLinkId = await seedLink(ownerId, domainId, "admin-allowed-patch-link");
    const deleteLinkId = await seedLink(ownerId, domainId, "admin-allowed-delete-link");
    const utmLinkId = await seedLink(ownerId, domainId, "admin-allowed-utm-link");

    const getLink = await app.inject({
      method: "GET",
      url: `/api/links/${readLinkId}`,
      headers: { cookie: adminCookie },
    });
    expect(getLink.statusCode).toBe(200);

    const patchLink = await app.inject({
      method: "PATCH",
      url: `/api/links/${patchLinkId}`,
      headers: { cookie: adminCookie },
      payload: { title: "Admin-edited title" },
    });
    expect(patchLink.statusCode).toBe(200);
    expect(patchLink.json().title).toBe("Admin-edited title");

    const patchUtm = await app.inject({
      method: "PATCH",
      url: `/api/links/${utmLinkId}`,
      headers: { cookie: adminCookie },
      payload: {
        utmSource: "admin-source",
        utmMedium: "admin-medium",
        utmCampaign: "admin-campaign",
      },
    });
    expect(patchUtm.statusCode).toBe(200);
    expect(patchUtm.json().utmSource).toBe("admin-source");

    const deleteLink = await app.inject({
      method: "DELETE",
      url: `/api/links/${deleteLinkId}`,
      headers: { cookie: adminCookie },
    });
    expect(deleteLink.statusCode).toBe(204);

    const createLinkRes = await app.inject({
      method: "POST",
      url: "/api/links",
      headers: { cookie: adminCookie },
      payload: { domainId, targetUrl: "https://example.com/admin-created" },
    });
    expect(createLinkRes.statusCode).toBe(201);

    const linkAnalytics = await app.inject({
      method: "GET",
      url: `/api/links/${readLinkId}/analytics`,
      headers: { cookie: adminCookie },
    });
    expect(linkAnalytics.statusCode).toBe(200);

    const getStaticQr = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${staticQrId}`,
      headers: { cookie: adminCookie },
    });
    expect(getStaticQr.statusCode).toBe(200);

    const remapHistory = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${dynamicQrId}/remap-history`,
      headers: { cookie: adminCookie },
    });
    expect(remapHistory.statusCode).toBe(200);

    const patchQrStyle = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${staticQrId}`,
      headers: { cookie: adminCookie },
      payload: { name: "Admin-restyled QR" },
    });
    expect(patchQrStyle.statusCode).toBe(200);
    expect(patchQrStyle.json().name).toBe("Admin-restyled QR");

    const remapQr = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${dynamicQrId}`,
      headers: { cookie: adminCookie },
      payload: { targetLinkId: readLinkId },
    });
    expect(remapQr.statusCode).toBe(200);

    const renderPng = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${staticQrId}/render.png`,
      headers: { cookie: adminCookie },
    });
    expect(renderPng.statusCode).toBe(200);

    const renderSvg = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${staticQrId}/render.svg`,
      headers: { cookie: adminCookie },
    });
    expect(renderSvg.statusCode).toBe(200);

    const createQrRes = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie: adminCookie },
      payload: { variant: "static", linkId: readLinkId, name: "Admin-created QR" },
    });
    expect(createQrRes.statusCode).toBe(201);

    const globalAnalytics = await app.inject({
      method: "GET",
      url: "/api/analytics",
      headers: { cookie: adminCookie },
    });
    expect(globalAnalytics.statusCode).toBe(200);
    expect(globalAnalytics.json().activeLinks).toBeGreaterThanOrEqual(2);

    await app.close();
  });
});
