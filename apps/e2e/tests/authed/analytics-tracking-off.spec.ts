import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { BROWSER_UA, createE2eLink } from "../../src/links.js";

/**
 * ANALYTICS-E2E-02 (16-02-PLAN.md) — with tracking toggled OFF through the
 * REAL `LinkDetailView.vue` `.tracking-card .toggle` control (a live
 * `updateLink` PATCH round-trip, per 16-CONTEXT.md's locked "genuinely
 * settable state" decision), a real HTTP `GET /:slug` redirect click STILL
 * returns 302 but writes EXACTLY ZERO `ClickEvent` rows and never
 * increments `Link.lifetimeClicks` — asserted directly at the database.
 *
 * 16-RESEARCH.md: `recordClickHook`'s very first line is the structural
 * guard `if (!link.trackingEnabled) return;` — BEFORE any Prisma call. The
 * redirect handler loads the link fresh from the DB per request, so the
 * toggle's PATCH must be committed (confirmed via a fresh Prisma read)
 * BEFORE the click is generated, or the guard would still see tracking
 * enabled. The 302 itself is unaffected — tracking-off suppresses only the
 * tracking write, never the redirect.
 */
test.describe("ANALYTICS-E2E-02: tracking off via real toggle, redirect still 302s, zero ClickEvent rows", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates ClickEvent/Link
  // concurrently during the full-suite phase gate. This test's fixture Link
  // is created OUTSIDE withResetDbLock and shared across the
  // toggle -> click -> DB-assert sequence, so a whole-test retry with a
  // fresh per-test random slug is the collision-free equivalent —
  // fetchWithFixtureRaceRetry's single closure cannot wrap this multi-step
  // shared fixture (same WR-01 tradeoff qr-dynamic-remap.spec.ts documents).
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "ANALYTICS-E2E-02 is admin-scoped; member/domain-scoped analytics authz is Phase 17 (AUTHZ-E2E-01), per 16-CONTEXT.md Deferred Ideas",
    );

    // Mirrors analytics-real-click.spec.ts's/qr-dynamic-remap.spec.ts's fix:
    // makes every retry visible in CI output, so "this test retried" is
    // never silently indistinguishable from "this test passed clean".
    if (testInfo.retry > 0) {
      console.warn(
        `[analytics-tracking-off.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file ClickEvent/Link-table truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("tracking off via real toggle: redirect still 302s, zero ClickEvent rows written", async ({
    page,
    request,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const slug = `e2e-track-off-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // Fixture: no password, no expiry, trackingEnabled OMITTED (Prisma
      // column default true) — so the real toggle has something to turn
      // OFF (a gated/expired link would never reach recordClickHook at all,
      // Pitfalls 2/3, an unrelated code path).
      const link = await createE2eLink(prisma, {
        slug,
        targetUrl: `https://example.com/no-tracking-${hex}`,
      });

      // --- Navigate to the real LinkDetailView, confirm tracking starts ON ---
      await page.goto(`/links/${link.id}`);
      const toggle = page.locator(".tracking-card .toggle");
      await expect(toggle).toHaveClass(/active/);
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      // --- TURN TRACKING OFF via the REAL toggle, awaiting the PATCH round-trip ---
      const [patch] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/links/${link.id}`,
        ),
        toggle.click(),
      ]);
      expect(patch.ok()).toBe(true);

      // --- UI confirms the persisted OFF state ---
      await expect(toggle).not.toHaveClass(/active/);
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(page.locator(".dashed-empty")).toBeVisible();

      // --- Belt-and-suspenders: the PATCH genuinely committed trackingEnabled=false ---
      // before the click is generated (the redirect handler reads a fresh
      // link row per request — an un-awaited toggle would leave the guard
      // seeing tracking still enabled).
      const afterToggle = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
      expect(afterToggle.trackingEnabled).toBe(false);

      // --- GENERATE THE REAL CLICK ---
      // An explicit BROWSER_UA is REQUIRED (Pitfall 3): Playwright's default
      // User-Agent is bot-classified by isbot, which would route this
      // request to the bot/OG 200 branch, before recordClickHook (and its
      // tracking-off guard) is ever reached.
      const response = await request.get(`/${slug}`, {
        headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
        maxRedirects: 0,
      });
      // A 200/OG or 410 here would mean the fixture accidentally hit the
      // bot/expired/password branch (Pitfalls 2/3), not a tracking
      // regression — tracking-off must never break the redirect itself.
      expect(response.status()).toBe(302);

      // --- DB-LEVEL ZERO-ROWS ASSERTION — the requirement's core proof ---
      const clickCount = await prisma.clickEvent.count({ where: { linkId: link.id } });
      expect(clickCount).toBe(0);
      const reloaded = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
      expect(reloaded.lifetimeClicks).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
