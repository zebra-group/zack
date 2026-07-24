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
      // WR-02 (11-REVIEW.md): `smoke`'s own `mailpit-wiring.spec.ts` and
      // `setup`'s `auth.setup.ts` both request magic-link emails for the
      // exact same ADMIN_EMAIL/MEMBER_EMAIL addresses. Without this
      // dependency, Playwright is free to run `smoke` and `setup`
      // concurrently, letting either side's `findMagicLinkUrl` call
      // non-deterministically consume the OTHER project's in-flight
      // message (both requests target the same seeded, allowlisted
      // addresses — unlike other smoke specs' dedicated/unseeded probe
      // emails, these two genuinely must reuse the seeded baseline users
      // to get a real email sent at all, per `lib/allowlist.ts`'s
      // User-row-existence gate). Depending on `setup` here forces `smoke`
      // to run only once `setup`'s magic-link round trips have fully
      // resolved, removing the race without inventing a second seeded
      // recipient pair.
      dependencies: ["setup"],
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
