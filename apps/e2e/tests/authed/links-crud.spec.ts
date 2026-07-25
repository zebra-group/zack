import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";

/**
 * LINKS-E2E-01 (14-02-PLAN.md) — the canonical dashboard link lifecycle,
 * driven entirely through the REAL create-link form (`LinkFormModal.vue`
 * mode=create), the real edit form (mode=edit), the real search box, the
 * real domain-filter tab, and the real delete confirm dialog — never an
 * API-only shortcut for the create/edit/delete steps.
 *
 * Every mutation is re-verified by BOTH its HTTP status (201/200/204) AND a
 * fresh server GET refetch (search re-query), so a silently-failed write
 * that only mutated the optimistic local `links` array can never pass as
 * green — this is threat T-14-02's mitigation (14-PLAN.md threat_model).
 *
 * Selectors are built exclusively from role/placeholder/title/CSS-class
 * locators (zero `data-testid` anywhere in apps/web/src, confirmed by
 * 14-RESEARCH.md's full reads of LinksView.vue/LinkFormModal.vue) — the
 * delete-confirm button is deliberately scoped to `.delete-dialog
 * .delete-confirm-button` rather than a loose accessible-name match, since
 * the row's own delete icon ALSO carries `title="Löschen"`
 * (14-RESEARCH.md Pitfall 2).
 *
 * Scoped to chromium-admin only (see the `beforeEach` skip below) —
 * member/domain-scoped link authz is Phase 17's job (AUTHZ-E2E-01,
 * 14-CONTEXT.md Deferred Ideas), not this canonical journey's concern.
 */
test.describe("LINKS-E2E-01: canonical link lifecycle through the real UI and API", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates the Link table
  // concurrently during the FULL-suite phase gate (the same cross-file race
  // apps/e2e/src/links.ts's fetchWithFixtureRaceRetry documents for
  // direct-HTTP redirect specs). A whole-journey retry with fresh per-test
  // random slugs is the UI-flow equivalent of that helper and is
  // collision-free: every retry attempt re-runs this test function from
  // scratch, minting brand-new random slugs/targets, so a retry can never
  // collide with a prior (possibly-truncated) attempt's rows.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "LINKS-E2E-01 canonical journey is admin-scoped; member/domain-scoped link authz is Phase 17 (AUTHZ-E2E-01), per CONTEXT.md Deferred Ideas",
    );
  });

  test("canonical link lifecycle through the real UI and API", async ({ page }) => {
    const hex = randomUUID().slice(0, 8);
    const decoyHexA = randomUUID().slice(0, 8);
    const decoyHexB = randomUUID().slice(0, 8);

    const targetSlug = `e2e-crud-${hex}`;
    const targetUrlA = `https://example.com/crud-a-${hex}`;
    const targetUrlB = `https://example.com/crud-b-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // Two decoy links, seeded directly via Prisma — NOT this test's own
      // subject (this test's subject is create-through-the-UI). Their
      // presence in the unfiltered list and absence from the slug-scoped
      // search result is what proves real server-side narrowing
      // (14-RESEARCH.md OQ-2: a one-item list cannot prove narrowing).
      await createE2eLink(prisma, {
        slug: `e2e-decoy-${decoyHexA}`,
        targetUrl: `https://example.com/decoy-a-${decoyHexA}`,
      });
      await createE2eLink(prisma, {
        slug: `e2e-decoy-${decoyHexB}`,
        targetUrl: `https://example.com/decoy-b-${decoyHexB}`,
      });

      await page.goto("/links");
      await expect(page).toHaveURL("/links");

      // --- CREATE (real LinkFormModal, mode=create) ---
      await page.getByRole("button", { name: "+ Neuer Link" }).click();
      const createModal = page.locator(".modal-dialog");
      await expect(createModal).toBeVisible();
      await createModal.getByPlaceholder("https://example.com/sehr/lange/url").fill(targetUrlA);
      await createModal.getByPlaceholder("leer lassen = automatisch").fill(targetSlug);

      const [createResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "POST" && url.pathname === "/api/links";
        }),
        createModal.getByRole("button", { name: "Link erstellen" }).click(),
      ]);
      expect(createResponse.status()).toBe(201);

      const targetRow = page.locator(".table-row", { hasText: targetSlug });
      await expect(targetRow).toBeVisible();
      await expect(targetRow).toContainText(targetSlug);

      // --- EDIT (real LinkFormModal, mode=edit) ---
      await targetRow.getByTitle("Bearbeiten").click();
      const editModal = page.locator(".modal-dialog");
      await expect(editModal).toBeVisible();
      await expect(editModal.getByRole("heading", { name: "Link bearbeiten" })).toBeVisible();
      await editModal.getByPlaceholder("https://example.com/sehr/lange/url").fill(targetUrlB);

      const [editResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "PATCH" && url.pathname.startsWith("/api/links/");
        }),
        editModal.getByRole("button", { name: "Speichern" }).click(),
      ]);
      expect(editResponse.ok()).toBe(true);
      // Secondary check (14-02-PLAN.md Task 1 step 5) — the toast is
      // transient (1700ms, LinksView.vue's showToast), so this is a
      // best-effort confirmation, not the persistence proof itself (that's
      // the SEARCH step below, which re-verifies against the server).
      await expect(page.getByText("Änderungen gespeichert")).toBeVisible();

      // --- SEARCH (narrowing + edit-persistence proof) ---
      const searchInput = page.getByPlaceholder("Suchen…");
      const [searchResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return (
            r.request().method() === "GET" &&
            url.pathname === "/api/links" &&
            url.searchParams.get("q") === targetSlug
          );
        }),
        searchInput.fill(targetSlug),
      ]);
      expect(searchResponse.ok()).toBe(true);

      // Exactly ONE row: the two seeded decoys are excluded (real
      // server-side narrowing), and the row's target cell shows target-B —
      // proving the edit persisted server-side, not just in the optimistic
      // local list.
      const searchRows = page.locator(".table-row");
      await expect(searchRows).toHaveCount(1);
      await expect(searchRows.first()).toContainText(targetSlug);
      await expect(searchRows.first()).toContainText(targetUrlB);

      // --- DOMAIN FILTER ---
      const [clearResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "GET" && url.pathname === "/api/links" && !url.searchParams.has("q");
        }),
        searchInput.fill(""),
      ]);
      expect(clearResponse.ok()).toBe(true);

      const [domainResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return (
            r.request().method() === "GET" && url.pathname === "/api/links" && url.searchParams.has("domainId")
          );
        }),
        page.getByRole("button", { name: BASELINE_DOMAIN_HOSTNAME }).click(),
      ]);
      expect(domainResponse.ok()).toBe(true);
      await expect(targetRow).toBeVisible();

      // --- DELETE (real confirm dialog) ---
      await targetRow.getByTitle("Löschen").click();
      const deleteDialog = page.locator(".delete-dialog");
      await expect(deleteDialog).toBeVisible();

      const [deleteResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return r.request().method() === "DELETE" && url.pathname.startsWith("/api/links/");
        }),
        deleteDialog.locator(".delete-confirm-button").click(),
      ]);
      expect(deleteResponse.status()).toBe(204);
      await expect(targetRow).toHaveCount(0);

      // --- DELETE persistence proof (fresh server refetch, not just the
      // local list mutation) ---
      const [postDeleteSearchResponse] = await Promise.all([
        page.waitForResponse((r) => {
          const url = new URL(r.url());
          return (
            r.request().method() === "GET" &&
            url.pathname === "/api/links" &&
            url.searchParams.get("q") === targetSlug
          );
        }),
        searchInput.fill(targetSlug),
      ]);
      expect(postDeleteSearchResponse.ok()).toBe(true);
      await expect(page.locator(".table-row", { hasText: targetSlug })).toHaveCount(0);
      await expect(page.locator(".no-match")).toBeVisible();
    } finally {
      await prisma.$disconnect();
    }
  });
});
