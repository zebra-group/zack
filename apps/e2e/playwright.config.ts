import { defineConfig } from "@playwright/test";

/**
 * Wave-0 Playwright config for @kurzly/e2e.
 *
 * Only the `smoke` project exists at this stage — the `setup` /
 * `chromium-admin` / `chromium-member` projects (with their storageState
 * dependency chain) are added by later plans in this phase once the
 * auth fixture exists. See RESEARCH.md "Recommended Project Structure".
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
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
