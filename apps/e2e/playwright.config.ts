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
      // 13-02-PLAN.md (AUTH-E2E phase) — standalone, no `dependencies:
      // ["setup"]` and no `use.storageState`: every spec under `tests/auth/`
      // establishes (or deliberately fails to establish) its OWN session,
      // because these specs ARE the proof of login itself — depending on
      // `setup`'s own magic-link round trip would make them implicitly
      // depend on the exact mechanism half of them test the failure modes
      // of (CONTEXT.md discretion note; 13-RESEARCH.md Recommended Project
      // Structure). `use.baseURL` is inherited from the top-level `use`.
      //
      // fullyParallel is true at the top level; the SSO specs
      // (tests/auth/sso*.spec.ts, added in 13-07/13-08) must serialize their
      // own mock-claim access via `test.describe.serial` so they never race
      // the mock IdP's single global profile state (`oidc-mock.ts`), while
      // the magic-link specs in this same project remain freely parallel.
      name: "auth",
      testMatch: /auth\/.*\.spec\.ts$/,
    },
    {
      name: "chromium-admin",
      testMatch: /authed\/.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/admin.json",
        // D-17-05-01 (17-VERIFICATION.md / milestone audit): running every
        // authed spec file in one process exhausts the global rate-limit
        // bucket, since only specs that manually set the header (e.g.
        // auth.setup.ts) were bypassing it — real browser navigations
        // never carried it. None of these downstream feature specs (links/
        // QR/analytics/team/authz) are testing rate-limiting itself (that's
        // the `auth`/`smoke` projects' own dedicated specs, which must NOT
        // get this bypass), so a blanket header here is safe and narrow.
        extraHTTPHeaders: process.env.E2E_RATE_LIMIT_BYPASS_SECRET
          ? { "x-e2e-bypass": process.env.E2E_RATE_LIMIT_BYPASS_SECRET }
          : {},
      },
    },
    {
      name: "chromium-member",
      testMatch: /authed\/.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/member.json",
        extraHTTPHeaders: process.env.E2E_RATE_LIMIT_BYPASS_SECRET
          ? { "x-e2e-bypass": process.env.E2E_RATE_LIMIT_BYPASS_SECRET }
          : {},
      },
    },
  ],
});
