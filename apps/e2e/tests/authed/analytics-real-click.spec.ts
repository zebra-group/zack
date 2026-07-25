import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { BROWSER_UA, createE2eLink } from "../../src/links.js";

/**
 * ANALYTICS-E2E-01 (16-01-PLAN.md) — a REAL redirect-handler click,
 * generated via a real HTTP `GET /:slug` against the built compose image
 * (never a direct `ClickEvent` insert), surfaces as the incremented
 * "Klicks gesamt" count in the real per-link analytics view
 * (`LinkDetailView.vue`), cross-checked at the database.
 *
 * 16-RESEARCH.md's Summary: `routes/redirect.ts`'s `GET /:slug` handler
 * fully `await`s `recordClickHook` — a `$transaction([clickEvent.create,
 * link.update{lifetimeClicks:{increment:1}}])` — BEFORE sending the `302`.
 * By the time Playwright's response promise resolves, both rows are
 * already committed; no polling/wait helper is needed for the write. The
 * ONLY genuine timing discipline is on the frontend READ side:
 * `LinkDetailView.vue`'s `loadAnalytics()` fires exactly once, on mount —
 * so the click MUST be generated before `page.goto`, never after
 * (Pitfall 1).
 */
test.describe("ANALYTICS-E2E-01: real redirect click increments lifetimeClicks and surfaces in the per-link view", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates ClickEvent/Link
  // concurrently during the full-suite phase gate. The fixture Link here is
  // created OUTSIDE withResetDbLock and shared across the
  // click -> navigate -> DB-assert steps, so a whole-test retry with a
  // fresh per-test random slug is the collision-free equivalent —
  // fetchWithFixtureRaceRetry's single closure cannot wrap this multi-step
  // shared fixture, the same WR-01 tradeoff qr-dynamic-remap.spec.ts
  // documents.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "ANALYTICS-E2E-01 is admin-scoped; member/domain-scoped analytics authz is Phase 17 (AUTHZ-E2E-01), per 16-CONTEXT.md Deferred Ideas",
    );

    // Mirrors qr-dynamic-remap.spec.ts's fix: makes every retry visible in
    // CI output, so "this test retried" is never silently indistinguishable
    // from "this test passed clean".
    if (testInfo.retry > 0) {
      console.warn(
        `[analytics-real-click.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file ClickEvent/Link-table truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("real redirect click increments lifetimeClicks and surfaces in the per-link view", async ({
    page,
    request,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const slug = `e2e-analytics-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // Fixture: no password, no expiry, trackingEnabled OMITTED (Prisma
      // column default true) — a gated/expired link never reaches
      // recordClickHook (Pitfalls 2/3), and tracking-off makes
      // loadAnalytics early-return.
      const link = await createE2eLink(prisma, {
        slug,
        targetUrl: `https://example.com/analytics-target-${hex}`,
      });

      // --- Generate the click FIRST (before any navigation) ---
      // An explicit BROWSER_UA is REQUIRED (Pitfall 3): Playwright's
      // default User-Agent is bot-classified by isbot, which routes to the
      // bot/OG 200 branch, BEFORE recordClickHook is ever reached.
      const response = await request.get(`/${slug}`, {
        headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
        maxRedirects: 0,
      });
      // A 200/OG or 410 here would mean the fixture accidentally hit the
      // bot/expired/password branch (Pitfalls 2/3), not a tracking
      // regression. recordClickHook is fully awaited server-side before
      // this 302 is sent — the ClickEvent row + lifetimeClicks increment
      // are ALREADY committed the moment this line runs. No wait/poll.
      expect(response.status()).toBe(302);

      // --- FRESH navigation (Pattern 2 / Pitfall 1) — AFTER the click ---
      // loadAnalytics() fires exactly once, on mount; asserting against an
      // already-mounted page would read stale pre-click data.
      await page.goto(`/links/${link.id}`);

      // --- UI assertion, scoped via .stat-card + hasText (Pitfall 4) ---
      // Never a bare `.stat-value` positional locator — three identical
      // `.stat-value` cards render side by side.
      await expect(
        page.locator(".stat-card", { hasText: "Klicks gesamt" }).locator(".stat-value"),
      ).toHaveText("1");

      // --- DB cross-check (deterministic, scoped to this link's id) ---
      const clickCount = await prisma.clickEvent.count({ where: { linkId: link.id } });
      expect(clickCount).toBe(1);
      const reloaded = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
      expect(reloaded.lifetimeClicks).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
