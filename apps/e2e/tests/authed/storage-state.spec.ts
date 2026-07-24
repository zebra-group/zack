import { expect, test } from "@playwright/test";

/**
 * storageState reuse proof (INFRA-04, T-11-08) — runs in BOTH the
 * `chromium-admin` and `chromium-member` projects (playwright.config.ts),
 * each already carrying its own project-scoped `use.storageState`. Every
 * test in this file gets a brand-new `page`/`BrowserContext` created FROM
 * that saved state (Playwright's default per-test fixture behavior) — this
 * spec never touches or reuses any context/page created inside
 * `auth.setup.ts` itself, which already tore its own context down right
 * after writing the storageState file.
 *
 * Detects the active role via `testInfo.project.name` so a single spec file
 * asserts the correct, role-specific expectation per project — this is what
 * proves the CORRECT role's session was captured, not merely "a session"
 * (T-11-08's mitigation for a mis-captured/mismatched storageState).
 */
test.describe("storageState reuse reaches an authenticated route (INFRA-04)", () => {
  test("fresh context loaded from saved storageState reaches the dashboard without re-login", async ({
    page,
  }, testInfo) => {
    // No login round trip happens anywhere in this spec — it relies solely
    // on the storageState the `setup` project already wrote.
    await page.goto("/");

    // The router's beforeEach guard (router/index.ts) redirects any
    // unauthenticated visitor to /login — asserting the final URL path
    // (not merely "no error") proves the saved session cookie was actually
    // accepted by the app, for a genuinely fresh browser context.
    await expect(page).toHaveURL("/");

    const isAdmin = testInfo.project.name === "chromium-admin";
    const teamNavLink = page.getByRole("link", { name: "Team" });

    if (isAdmin) {
      // "Team" is an admin-only nav entry (AppShell.vue's visibleNavItems
      // filter) — its presence proves the ADMIN storageState was loaded,
      // not just any authenticated session.
      await expect(teamNavLink).toBeVisible();

      await page.goto("/team");
      await expect(page).toHaveURL("/team");
    } else {
      // The member sees no Team nav entry, and a direct /team visit is
      // bounced back to the dashboard by the router's requiresAdmin guard
      // (router/index.ts) — proving the MEMBER storageState was loaded,
      // not the admin's.
      await expect(teamNavLink).toHaveCount(0);

      await page.goto("/team");
      await expect(page).toHaveURL("/");
    }
  });
});
