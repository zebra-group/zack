import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { buildImportCsv } from "../../src/csv.js";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";

/**
 * LINKS-E2E-03 (14-04-PLAN.md) — the CSV bulk-import SLUG-CONFLICT path: a
 * CSV row whose slug already exists is surfaced in the preview as INVALID
 * (reason `slug_conflict`), while a second, new-slug row previews valid, and
 * commit SKIPS the conflict row entirely.
 *
 * 14-RESEARCH.md closed this with certainty: conflict resolution is SKIP
 * ONLY — `mapErrorToSkipReason` (apps/api/src/lib/links.ts) maps a
 * SLUG_TAKEN failure to `"slug_conflict"`, and the row is never written, on
 * BOTH preview and commit. There is no overwrite path anywhere in
 * `routes/links.ts`, `lib/links.ts`, or `LinksImportView.vue` — this spec
 * therefore asserts skip behaviour exclusively. The definitive proof is a
 * direct-DB assertion that the PRE-EXISTING link's target is UNCHANGED after
 * commit (an import can never silently re-point an existing short link,
 * T-14-06).
 *
 * The pre-existing conflicting link is seeded via `createE2eLink` (direct
 * Prisma) rather than the create-UI — this spec's own subject is the import
 * flow, not link creation (14-RESEARCH.md Pattern 2 explicitly permits this).
 *
 * Selectors are role/placeholder/CSS-class based — zero `data-testid`
 * anywhere in apps/web/src (14-RESEARCH.md).
 *
 * Scoped to chromium-admin only — member/domain-scoped import authz is
 * Phase 17's job (14-CONTEXT.md Deferred Ideas), not this conflict spec's
 * concern.
 */

/**
 * Minimal shape of the two import response bodies this spec inspects,
 * defined locally rather than importing `@zack/shared`'s
 * `ImportPreviewResult`/`ImportCommitResult` — `apps/e2e` does not depend on
 * `@zack/shared` (see csv-import-happy.spec.ts's identical rationale).
 */
type ImportPreviewRow = {
  valid: boolean;
  reason: string | null;
  slug: string | null;
  zielUrl: string | null;
};
type ImportPreviewBody = { validCount: number; skippedCount: number; rows: ImportPreviewRow[] };
type ImportCommitBody = { importedCount: number; skippedCount: number };

test.describe("LINKS-E2E-03: CSV import slug conflict (preview surfaces it, commit skips it)", () => {
  // Same whole-flow retry discipline as 14-02/14-03 — the documented
  // cross-file db-isolation.spec.ts Link-table truncate race. The
  // pre-existing conflict fixture is (re-)created INSIDE the test body, so a
  // full-suite truncate between seed and preview is recovered by the whole
  // retry, with a fresh random slug/target on every attempt.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "LINKS-E2E-03 CSV conflict path is admin-scoped; member/domain-scoped import authz is Phase 17 (AUTHZ-E2E-01), per CONTEXT.md Deferred Ideas",
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
        `[csv-import-conflict.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file Link-table truncate race (see this file's " +
          "header comment), or a genuine intermittent regression. If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("CSV slug conflict is surfaced in preview and skipped on commit (never overwritten)", async ({
    page,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const conflictSlug = `e2e-conflict-${hex}`;
    const newSlug = `e2e-new-${hex}`;
    const preExistingTarget = `https://example.com/pre-existing-${hex}`;
    const csvAttemptTarget = `https://example.com/csv-attempt-${hex}`;
    const newTarget = `https://example.com/new-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // --- Seed the pre-existing conflicting Link (direct Prisma, inside
      // the test body so a retry re-seeds cleanly with a fresh random slug).
      await createE2eLink(prisma, { slug: conflictSlug, targetUrl: preExistingTarget });

      // Two-row CSV: row 1 collides with the just-seeded conflict slug (a
      // DIFFERENT target than the pre-existing one, so overwrite-vs-skip is
      // detectable); row 2 is a brand-new slug. Blank `domain` column on
      // both — both fall back to the default-domain dropdown selection.
      const csv = buildImportCsv([
        { zielUrl: csvAttemptTarget, slug: conflictSlug },
        { zielUrl: newTarget, slug: newSlug },
      ]);

      await page.goto("/links/import");
      await expect(page).toHaveURL("/links/import");

      // --- Select the default domain FIRST, before any upload (Pitfall 3:
      // csvText is still empty here, so `watch(defaultDomainId, ...)` does
      // not fire a second preview).
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
          name: "links-import-conflict.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv, "utf-8"),
        }),
      ]);
      expect(previewResponse.ok()).toBe(true);
      const previewBody = (await previewResponse.json()) as ImportPreviewBody;
      expect(previewBody.validCount).toBe(1);
      expect(previewBody.skippedCount).toBe(1);
      expect(previewBody.rows).toHaveLength(2);

      const conflictRow = previewBody.rows.find((r) => r.slug === conflictSlug);
      const newRow = previewBody.rows.find((r) => r.slug === newSlug);
      expect(conflictRow?.valid).toBe(false);
      expect(conflictRow?.reason).toBe("slug_conflict");
      expect(newRow?.valid).toBe(true);

      // --- PREVIEW assertions (rendered UI, driven by the backend result
      // only — LinksImportView.vue does no client-side re-validation) ---
      await expect(page.locator(".valid-count")).toHaveText("1 gültig");
      await expect(page.locator(".skipped-count")).toHaveText("1 übersprungen");

      const conflictPreviewRow = page.locator(".preview-row", { hasText: conflictSlug });
      await expect(conflictPreviewRow).toHaveClass(/invalid/);
      await expect(conflictPreviewRow.locator(".preview-reason")).toHaveText(
        "Slug bereits vergeben oder reserviert",
      );

      const newPreviewRow = page.locator(".preview-row", { hasText: newSlug });
      await expect(newPreviewRow).not.toHaveClass(/invalid/);
      await expect(newPreviewRow.locator(".preview-reason")).toHaveText("");

      // --- COMMIT (real button, re-sends the SAME csv text) ---
      const [commitResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "POST" && url.pathname === "/api/links/import/commit";
        }),
        page.getByRole("button", { name: "Importieren (1)" }).click(),
      ]);
      expect(commitResponse.ok()).toBe(true);
      const commitBody = (await commitResponse.json()) as ImportCommitBody;
      expect(commitBody.importedCount).toBe(1);
      expect(commitBody.skippedCount).toBe(1);

      // --- DB assertion: skip-not-overwrite, the crux of LINKS-E2E-03
      // (T-14-06). The conflict slug still resolves to EXACTLY ONE row,
      // whose target is the UNCHANGED pre-existing value — never the
      // CSV-attempt target. ---
      const conflictLinks = await prisma.link.findMany({ where: { slug: conflictSlug } });
      expect(conflictLinks).toHaveLength(1);
      expect(conflictLinks[0]?.targetUrl).toBe(preExistingTarget);
      expect(conflictLinks[0]?.targetUrl).not.toBe(csvAttemptTarget);

      // The one valid row WAS imported.
      const newLink = await prisma.link.findFirst({ where: { slug: newSlug } });
      expect(newLink?.targetUrl).toBe(newTarget);
    } finally {
      await prisma.$disconnect();
    }
  });
});
