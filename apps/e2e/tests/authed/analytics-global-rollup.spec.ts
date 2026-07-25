import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { BROWSER_UA, createE2eLink } from "../../src/links.js";

/**
 * ANALYTICS-E2E-03 (16-03-PLAN.md) — real HTTP clicks distributed across TWO
 * distinct Links on the baseline domain (3 clicks on link A, 2 on link B),
 * generated via the real redirect handler (never a seeded `ClickEvent` row),
 * then a FRESH navigation to the global `/analytics` overview correctly
 * rolls up the numbers: per-link "Top Links" rows (scoped by each link's
 * unique slug) show the exact counts, and the server-side cross-link
 * `GROUP BY` rollup in `getGlobalAnalytics` — never a client-side sum — is
 * cross-checked against direct-Prisma per-link counts.
 *
 * 16-RESEARCH.md Summary point 3: `getGlobalAnalytics`'s `topLinks` is a raw
 * SQL `GROUP BY`/`COUNT`/`JOIN` scoped to `domainId IN (...)`, and
 * `AnalyticsView.vue` renders the DTO verbatim — zero client-side
 * summation. Proving the rollup therefore requires real clicks across >=2
 * real Links, not a client-side reduce.
 *
 * 16-RESEARCH.md Open Question 2 (resolved): `getGlobalAnalytics` sums
 * ClickEvents across ALL Links on the shared baseline domain, so the global
 * "Klicks (30 Tage)" tile is inherently non-deterministic under concurrent
 * specs / db-isolation truncate churn. The deterministic anchors are (a)
 * per-link DB counts scoped to our own linkIds and (b) the per-link "Top
 * Links" rows scoped by our unique random slugs; the global tile is checked
 * only with `toBeGreaterThanOrEqual` (monotonic contribution), NEVER exact
 * equality.
 */
test.describe("ANALYTICS-E2E-03: global overview rolls up per-link click counts across multiple links", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates ClickEvent/Link
  // concurrently during the full-suite phase gate. Both fixture Links here
  // are created OUTSIDE withResetDbLock and shared across the
  // generate -> navigate -> assert steps, so a whole-test retry with fresh
  // per-test random slugs is the collision-free equivalent —
  // fetchWithFixtureRaceRetry's single closure cannot wrap this multi-step,
  // multi-fixture shared state (same WR-01 tradeoff qr-dynamic-remap.spec.ts
  // documents).
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "ANALYTICS-E2E-03 is admin-scoped; member/domain-scoped analytics authz is Phase 17 (AUTHZ-E2E-01), per 16-CONTEXT.md Deferred Ideas",
    );

    // Mirrors analytics-real-click.spec.ts's/analytics-tracking-off.spec.ts's
    // fix: makes every retry visible in CI output, so "this test retried" is
    // never silently indistinguishable from "this test passed clean".
    if (testInfo.retry > 0) {
      console.warn(
        `[analytics-global-rollup.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file ClickEvent/Link-table truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("global overview rolls up per-link click counts across multiple links", async ({ page, request }) => {
    const hexA = randomUUID().slice(0, 8);
    const hexB = randomUUID().slice(0, 8);
    const slugA = `e2e-rollup-a-${hexA}`;
    const slugB = `e2e-rollup-b-${hexB}`;

    const nA = 3;
    const nB = 2;

    const prisma = createE2ePrisma();
    try {
      // Fixtures: no password/expiry/UTM on either link, tracking left at
      // its default (on) — a gated/expired link never reaches
      // recordClickHook (Pitfalls 2/3 of 16-RESEARCH.md).
      const linkA = await createE2eLink(prisma, {
        slug: slugA,
        targetUrl: `https://example.com/rollup-a-${hexA}`,
      });
      const linkB = await createE2eLink(prisma, {
        slug: slugB,
        targetUrl: `https://example.com/rollup-b-${hexB}`,
      });

      // --- Generate the clicks FIRST (before any navigation) ---
      // An explicit BROWSER_UA is REQUIRED (Pitfall 3): Playwright's default
      // User-Agent is bot-classified by isbot, which routes to the bot/OG
      // 200 branch, BEFORE recordClickHook is ever reached.
      const hit = async (slug: string) => {
        const response = await request.get(`/${slug}`, {
          headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
          maxRedirects: 0,
        });
        expect(response.status()).toBe(302);
      };

      // Sequential — the visitorHash derivation is irrelevant here;
      // sequential keeps counts unambiguous. recordClickHook is fully
      // awaited server-side before each 302 is sent, so all rows are
      // committed once the last hit resolves.
      for (let i = 0; i < nA; i++) {
        await hit(slugA);
      }
      for (let i = 0; i < nB; i++) {
        await hit(slugB);
      }

      // --- DB cross-check (deterministic, scoped to our own linkIds) ---
      const clickCountA = await prisma.clickEvent.count({ where: { linkId: linkA.id } });
      expect(clickCountA).toBe(nA);
      const clickCountB = await prisma.clickEvent.count({ where: { linkId: linkB.id } });
      expect(clickCountB).toBe(nB);

      // --- FRESH navigation (Pattern 2 / Pitfall 1) — AFTER the clicks ---
      // AnalyticsView.vue's load() fires exactly once, on mount; asserting
      // against an already-mounted page would read stale pre-click data.
      await page.goto("/analytics");

      // --- UI rollup assertion: per-link rows scoped by unique slug ---
      // Proves the server-side per-link GROUP BY rollup surfaced each
      // link's exact count in the cross-link overview.
      await expect(
        page.locator(".top-links-row", { hasText: `/${slugA}` }).locator(".row-count"),
      ).toHaveText(String(nA));
      await expect(
        page.locator(".top-links-row", { hasText: `/${slugB}` }).locator(".row-count"),
      ).toHaveText(String(nB));

      // --- Global-total sanity (monotonic, concurrency-robust) ---
      // NEVER exact equality here — getGlobalAnalytics sums ClickEvents
      // across ALL links on the shared baseline domain, and concurrent
      // specs contribute too (16-RESEARCH.md Open Question 2).
      const totalText = await page
        .locator(".stat-card", { hasText: "Klicks (30 Tage)" })
        .locator(".stat-value")
        .textContent();
      const total = Number(totalText?.trim());
      expect(total).toBeGreaterThanOrEqual(nA + nB);
    } finally {
      await prisma.$disconnect();
    }
  });
});
