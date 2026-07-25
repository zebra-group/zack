import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { buildImportCsv } from "../../src/csv.js";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";

/**
 * LINKS-E2E-02 (14-03-PLAN.md) — the CSV bulk-import happy path: a valid
 * two-row CSV previews as exactly 2 valid rows (zero skipped), and commit
 * writes EXACTLY those two rows — asserted directly against PostgreSQL, not
 * just the commit response's own `importedCount` (14-RESEARCH.md's
 * "no server-side preview cache" finding: commit re-sends the identical
 * `{csv, defaultDomainId}` body and re-runs the same `runImport()` core with
 * `mutate:true`; this spec keeps the built CSV string in scope across both
 * calls, exactly like `LinksImportView.vue` itself does — there is no
 * "preview id" to extract or reference).
 *
 * Selectors are role/placeholder/CSS-class based — zero `data-testid`
 * anywhere in apps/web/src (14-RESEARCH.md).
 *
 * Scoped to chromium-admin only — member/domain-scoped import authz is
 * Phase 17's job (14-CONTEXT.md Deferred Ideas), not this happy-path spec's
 * concern.
 */

/**
 * Minimal shape of the two import response bodies this spec inspects,
 * defined locally rather than importing `@kurzly/shared`'s
 * `ImportPreviewResult`/`ImportCommitResult` — `apps/e2e` does not depend on
 * `@kurzly/shared` (unlike `apps/api`/`apps/web`), and only these numeric
 * fields are asserted here; the DB findMany below is the real proof of
 * "no silent extras", not a full response-shape assertion.
 */
type ImportPreviewBody = { validCount: number; skippedCount: number; rows: unknown[] };
type ImportCommitBody = { importedCount: number };

test.describe("LINKS-E2E-02: CSV import happy path (preview -> commit, DB-asserted)", () => {
  // Same whole-flow retry discipline as 14-02's links-crud.spec.ts — the
  // documented cross-file db-isolation.spec.ts Link-table truncate race.
  // Every retry attempt mints fresh per-test random slugs, so a retry can
  // never collide with a prior (possibly-truncated) attempt's rows.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "LINKS-E2E-02 CSV happy-path is admin-scoped; member/domain-scoped import authz is Phase 17 (AUTHZ-E2E-01), per CONTEXT.md Deferred Ideas",
    );

    // 14-REVIEW.md WR-01: the whole-test `retries: 2` above is a coarser
    // safety net than Phase 12's `fetchWithFixtureRaceRetry` (it cannot
    // distinguish the documented db-isolation.spec.ts truncate race from a
    // genuine intermittent regression). This log line is the minimum-fix
    // option the review calls out: it makes every retry visible in CI
    // output, so "this test retried" is never silently indistinguishable
    // from "this test passed clean" — a retry firing repeatedly across runs
    // is a signal worth investigating, not assuming away as the known race.
    if (testInfo.retry > 0) {
      console.warn(
        `[csv-import-happy.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file Link-table truncate race (see this file's " +
          "header comment), or a genuine intermittent regression. If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("valid CSV previews two rows and commit writes exactly those rows", async ({ page }) => {
    const hexA = randomUUID().slice(0, 8);
    const hexB = randomUUID().slice(0, 8);
    const slugA = `e2e-import-a-${hexA}`;
    const slugB = `e2e-import-b-${hexB}`;
    const targetA = `https://example.com/import-a-${hexA}`;
    const targetB = `https://example.com/import-b-${hexB}`;

    // Blank `domain` column on both rows — both fall back to whatever
    // defaultDomainId the UI's dropdown resolves to (selected below, BEFORE
    // upload, per 14-RESEARCH.md Pitfall 3).
    const csv = buildImportCsv([
      { zielUrl: targetA, slug: slugA },
      { zielUrl: targetB, slug: slugB },
    ]);

    const prisma = createE2ePrisma();
    try {
      await page.goto("/links/import");
      await expect(page).toHaveURL("/links/import");

      // --- Select the default domain FIRST, before any upload. csvText is
      // still empty at this point, so `watch(defaultDomainId, ...)` does
      // not fire a second preview (Pitfall 3: selecting AFTER upload would
      // race a second automatic preview against this test's assertions).
      await page
        .locator(".default-domain-row select")
        .selectOption({ label: BASELINE_DOMAIN_HOSTNAME });

      // --- Upload the built CSV through the real hidden file input ---
      const [previewResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "POST" && url.pathname === "/api/links/import/preview";
        }),
        page.locator('input[type="file"]').setInputFiles({
          name: "links-import-valid.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv, "utf-8"),
        }),
      ]);
      expect(previewResponse.ok()).toBe(true);
      const previewBody = (await previewResponse.json()) as ImportPreviewBody;
      expect(previewBody.validCount).toBe(2);
      expect(previewBody.skippedCount).toBe(0);
      expect(previewBody.rows).toHaveLength(2);

      // --- PREVIEW assertions (rendered UI, driven by the backend result
      // only — LinksImportView.vue does no client-side re-validation) ---
      await expect(page.locator(".valid-count")).toHaveText("2 gültig");
      await expect(page.locator(".skipped-count")).toHaveCount(0);
      await expect(page.locator(".preview-row")).toHaveCount(2);
      await expect(page.locator(".preview-row.invalid")).toHaveCount(0);

      // --- COMMIT (real button, re-sends the SAME csv text) ---
      const [commitResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "POST" && url.pathname === "/api/links/import/commit";
        }),
        page.getByRole("button", { name: "Importieren (2)" }).click(),
      ]);
      expect(commitResponse.ok()).toBe(true);
      const commitBody = (await commitResponse.json()) as ImportCommitBody;
      expect(commitBody.importedCount).toBe(2);

      // --- DB assertion: commit wrote EXACTLY the two previewed rows, no
      // silent extras (T-14-04, threat_model). ---
      const domain = await prisma.domain.findUniqueOrThrow({
        where: { hostname: BASELINE_DOMAIN_HOSTNAME },
      });
      const importedLinks = await prisma.link.findMany({
        where: { slug: { in: [slugA, slugB] } },
      });
      expect(importedLinks).toHaveLength(2);

      const bySlug = new Map(importedLinks.map((link) => [link.slug, link]));
      expect(bySlug.get(slugA)?.targetUrl).toBe(targetA);
      expect(bySlug.get(slugB)?.targetUrl).toBe(targetB);
      expect(bySlug.get(slugA)?.domainId).toBe(domain.id);
      expect(bySlug.get(slugB)?.domainId).toBe(domain.id);
    } finally {
      await prisma.$disconnect();
    }
  });
});
