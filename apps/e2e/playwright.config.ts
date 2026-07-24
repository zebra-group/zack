import { defineConfig } from "@playwright/test";

/**
 * Playwright config for @kurzly/e2e.
 *
 * `globalSetup`/`globalTeardown` (11-04-PLAN.md, INFRA-02/03) run once per
 * suite invocation: setup clears Mailpit's inbox and seeds the
 * least-privilege baseline (Domain, admin/member Users, DomainMembership)
 * directly via Prisma against the published `:5433` E2E Postgres; teardown
 * closes its own Prisma connection cleanly.
 *
 * Only the `smoke` project exists at this stage — the `setup` /
 * `chromium-admin` / `chromium-member` projects (with their storageState
 * dependency chain) are added by later plans in this phase once the
 * auth fixture exists. See RESEARCH.md "Recommended Project Structure".
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "smoke",
      testMatch: /smoke\/.*\.spec\.ts$/,
    },
  ],
});
