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
 * `setup` (11-05-PLAN.md, INFRA-04) performs one real magic-link round trip
 * per role and snapshots `storageState` to `playwright/.auth/<role>.json`.
 * `chromium-admin`/`chromium-member` each declare `dependencies: ["setup"]`
 * and reuse the saved state via `use.storageState` — every downstream
 * authenticated suite (Phase 13 onward) consumes these two projects instead
 * of repeating the login round trip per spec file (RESEARCH Pattern 2).
 * Both are scoped to `tests/authed/**` via `testMatch` so they never run the
 * unauthenticated `smoke` project's specs (and vice versa).
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
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: "chromium-admin",
      testMatch: /authed\/.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/admin.json",
      },
    },
    {
      name: "chromium-member",
      testMatch: /authed\/.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/member.json",
      },
    },
  ],
});
