import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { BROWSER_UA, createE2eLink } from "../../src/links.js";
import { createE2eQrCode } from "../../src/qr.js";
import { createAllowlistedUser } from "../../src/users.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * AUTHZ-E2E-01 (17-04-PLAN.md) — proves, through the real UI/API, that a
 * member with ZERO `DomainMembership` rows is denied server-side for one
 * representative case per resource type: Link, QR, and Analytics.
 *
 * This complements, not duplicates, the existing v1.0 integration
 * Denial-Suite (`fastify.inject`-based) — only representative UI-layer
 * cases here, not an exhaustive role x resource x operation matrix
 * (17-CONTEXT.md).
 *
 * 17-RESEARCH.md Pattern 3/4 (verified directly against installed source
 * this session): the Link/QR denial shape is HTTP 404 — a DELIBERATE
 * no-existence-oracle IDOR guard (`resolveOwnedLink`/`resolveOwnedQrCode`,
 * `routes/links.ts`/`routes/qrCodes.ts`), NOT 403. An out-of-scope id and a
 * genuinely nonexistent id are indistinguishable by design. The Link case
 * surfaces as `LinkDetailView.vue`'s `.not-found-card` ("Link nicht
 * gefunden"); the QR case has no standalone detail route, so it is proven
 * via a direct `page.request.get('/api/qr-codes/:id')` sharing the member's
 * real cookie jar (Pitfall 1: never substitute a list-emptiness check for
 * either).
 *
 * Analytics is DELIBERATELY a different shape (Pattern 4): `GET
 * /api/analytics` never 404s — it is session-gated only, then silently
 * scopes to `scopedDomainIds` (empty, for this member) and returns a 200
 * `GlobalAnalyticsDTO` rolled up over that empty domain set.
 * `AnalyticsView.vue` has no dedicated "denied" branch; it renders the SAME
 * zero-data state a legitimately-scoped-but-clickless member would see. The
 * representative proof is therefore INDIRECT: generate a REAL click on a
 * baseline-domain link the member does not own, then confirm the member's
 * own `/analytics` rollup is empty (200, clicks30Days 0, topLinks []) —
 * proving the click was scoped OUT silently, never leaked and never
 * error-gated. Do NOT "improve" the app with a fake 403 page here — that
 * would contradict this codebase's own "scope silently, never leak which
 * domains exist" convention (17-RESEARCH.md Pattern 4 Trade-offs).
 */
test.describe("AUTHZ-E2E-01: a zero-domain member is denied a Link (404), a QR (404), and sees an empty Analytics rollup", () => {
  // Mirrors team-role-domain-reassign.spec.ts's/qr-dynamic-remap.spec.ts's
  // precedent: fixtures (a fresh zero-domain member + a fixture Link/QR +
  // a real seeded click) straddle multiple steps outside withResetDbLock,
  // so a whole-test retry with a fresh per-test unique email/slug is the
  // collision-free equivalent of fetchWithFixtureRaceRetry for a spec this
  // shaped.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    // This spec establishes its OWN zero-domain member context inline,
    // distinct from the seeded chromium-member (which HAS a domain
    // membership) — running once under chromium-admin avoids a redundant
    // double-run of the exact same inline-session setup.
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "AUTHZ-E2E-01 establishes its own zero-domain member session inline; running once under chromium-admin avoids a redundant double-run",
    );

    if (testInfo.retry > 0) {
      console.warn(
        `[authz-domain-denial.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("a zero-domain member is denied a Link (404), a QR (404), and sees an empty Analytics rollup", async ({
    browser,
    baseURL,
    request,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const memberEmail = `authz-deny-${hex}@e2e.kurzly.local`;
    const slug = `e2e-authz-${hex}`;

    const prisma = createE2ePrisma();
    let memberCtx: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      // --- SETUP: a brand-new, ZERO-domain member (createAllowlistedUser
      // never touches DomainMembership) + a baseline-domain Link + a QR
      // bound to it. ---
      await createAllowlistedUser(prisma, { email: memberEmail });
      const link = await createE2eLink(prisma, {
        slug,
        targetUrl: `https://example.com/authz-deny-target-${hex}`,
      });
      const qr = await createE2eQrCode(prisma, {
        variant: "static",
        linkId: link.id,
        name: `authz-qr-${hex}`,
      });

      // --- A REAL click on the baseline link the member does NOT own, so
      // the Analytics case has a real click to be scoped OUT. An explicit
      // BROWSER_UA is required (Playwright's default UA is bot-classified
      // by isbot, which would route to the bot/OG branch BEFORE
      // recordClickHook is ever reached, 16-RESEARCH.md Pitfall 3).
      // recordClickHook fully awaits its $transaction before the 302 is
      // sent, so the ClickEvent row is already committed once this
      // resolves — no polling needed. ---
      const clickResponse = await request.get(`/${slug}`, {
        headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
        maxRedirects: 0,
      });
      expect(clickResponse.status()).toBe(302);

      // --- Establish the zero-domain member's OWN real session in a
      // fresh, cookie-less browser context (magic-link round trip, INFRA-06
      // bypass header). `storageState: undefined` is REQUIRED here (not
      // merely defensive) — this test runs under the chromium-admin
      // project, whose config declares `use.storageState`; without this
      // override, `browser.newContext()` silently inherits the ADMIN's
      // session cookie into what looks like a fresh context, tripping
      // better-auth's CSRF `MISSING_OR_NULL_ORIGIN` guard on the bare POST
      // below (17-02's documented fix, team-role-domain-reassign.spec.ts). ---
      const resolvedBaseUrl = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
      memberCtx = await browser.newContext({ baseURL: resolvedBaseUrl, storageState: undefined });

      const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
      const magicLinkResponse = await memberCtx.request.post("/api/auth/sign-in/magic-link", {
        data: { email: memberEmail, callbackURL: "/", errorCallbackURL: "/auth/error" },
        headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
      });
      expect(magicLinkResponse.ok()).toBeTruthy();

      const magicLinkUrl = await findMagicLinkUrl(memberEmail);
      const memberPage = await memberCtx.newPage();
      await memberPage.goto(magicLinkUrl);
      await memberPage.getByRole("link", { name: "Dashboard" }).waitFor();

      // === CASE 1: Link denial — UI 404 ===
      // A direct-by-id navigation to a KNOWN baseline-domain link — never
      // a LinksView list-emptiness check, which is ambiguous between "zero
      // domains" and "zero links on owned domains" (Pitfall 1).
      await memberPage.goto(`/links/${link.id}`);
      await expect(memberPage.locator(".not-found-card")).toBeVisible();
      await expect(memberPage.getByText("Link nicht gefunden")).toBeVisible();

      // === CASE 2: QR denial — API 404 ===
      // QR has no standalone detail route (Studio-embedded) — proven
      // directly via resolveOwnedQrCode's own IDOR guard, sharing the
      // member's real cookie jar (a legitimate real-session proof,
      // Phase 12 precedent). Also assert the Link resource's own API
      // guard independently of the UI render.
      const qrResp = await memberPage.request.get(`/api/qr-codes/${qr.id}`);
      expect(qrResp.status()).toBe(404);
      const linkApiResp = await memberPage.request.get(`/api/links/${link.id}`);
      expect(linkApiResp.status()).toBe(404);

      // === CASE 3: Analytics denial — 200 empty rollup, DELIBERATELY a
      // different shape (Pattern 4) — never a `.not-found-card` equivalent,
      // never a fake 403 page. ===
      await memberPage.goto("/analytics");
      await expect(
        memberPage.locator(".stat-card", { hasText: "Klicks (30 Tage)" }).locator(".stat-value"),
      ).toHaveText("0");
      await expect(
        memberPage.locator(".list-card", { hasText: "Top Links" }).locator(".list-empty-row"),
      ).toHaveText("Keine Daten");

      // Independently confirm the API shape: 200 (never 404), and the
      // real baseline click is absent from the rollup — proving silent
      // scoping, not a leak and not an error gate.
      const anResp = await memberPage.request.get("/api/analytics");
      expect(anResp.status()).toBe(200);
      const anBody = (await anResp.json()) as {
        clicks30Days: number;
        topLinks: { id: string; slug: string }[];
      };
      expect(anBody.clicks30Days).toBe(0);
      expect(anBody.topLinks).toEqual([]);
      expect(anBody.topLinks.some((row) => row.id === link.id || row.slug === slug)).toBe(false);
    } finally {
      if (memberCtx) await memberCtx.close();
      await prisma.$disconnect();
    }
  });
});
