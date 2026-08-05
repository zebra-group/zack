import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";

/**
 * Licence compliance, not a feature test.
 *
 * The GeoIP country database baked into the image is DB-IP Country Lite (see
 * `Dockerfile`), which is CC-BY 4.0 licensed. That licence requires a *visible*
 * credit linking back to db-ip.com wherever its results are displayed. The
 * per-link analytics view (`LinkDetailView.vue`) is the only surface that
 * renders country data, so the credit must be reachable and visible there.
 *
 * This asserts against the real built compose image rather than a mounted
 * component, because the failure mode this guards against is a CSS or build
 * regression that hides the credit (`display:none`, a collapsed container, an
 * overzealous sr-only utility) — exactly the class of breakage a component test
 * with stubbed styles cannot see. Playwright's `toBeVisible` is the right
 * assertion here for that reason.
 */
test.describe("GeoIP attribution: DB-IP credit is visible on the per-link analytics view", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "the per-link analytics view is admin-scoped in this suite, mirroring analytics-real-click.spec.ts",
    );
  });

  test("renders a visible DB-IP credit linking to db-ip.com", async ({ page }) => {
    const hex = randomUUID().slice(0, 8);
    const prisma = createE2ePrisma();
    try {
      const link = await createE2eLink(prisma, {
        slug: `e2e-geoip-attr-${hex}`,
        targetUrl: `https://example.com/geoip-attr-target-${hex}`,
      });

      await page.goto(`/links/${link.id}`);

      const credit = page.locator(".geoip-attribution a");

      // Visible, not merely present in the DOM — a hidden credit does not
      // satisfy CC-BY 4.0.
      await expect(credit).toBeVisible();
      await expect(credit).toHaveText("IP Geolocation by DB-IP");
      await expect(credit).toHaveAttribute("href", "https://db-ip.com");
    } finally {
      await prisma.$disconnect();
    }
  });
});
