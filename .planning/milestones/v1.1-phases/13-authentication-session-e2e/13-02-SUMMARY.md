---
phase: 13-authentication-session-e2e
plan: 02
subsystem: infra
tags: [e2e, playwright, prisma-fixtures, oidc, mock-idp, harness]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "01"
    provides: "apps/e2e/oidc-mock's PUT/DELETE /__test__/profile control routes, docker-compose.e2e.yml wiring, OIDC_MOCK_CONTROL_URL export"
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: "apps/e2e harness conventions (mailpit.ts's thin-wrapper shape, db.ts's raw-Prisma-consumer convention, playwright.config.ts's project/testMatch scoping)"
  - phase: 9-team-management
    provides: "apps/api/src/lib/team.ts's inviteMember new-invitee write shape (emailVerified:false, name=email-local-part, no Account row)"
provides:
  - "apps/e2e/src/oidc-mock.ts: setOidcProfile/resetOidcProfile typed client for apps/e2e/oidc-mock's test-control routes"
  - "apps/e2e/src/users.ts: createAllowlistedUser/createInvitedUnverifiedUser typed Prisma fixture helpers"
  - "apps/e2e/playwright.config.ts: standalone `auth` project (testMatch tests/auth/**, no setup dependency, no storageState)"
affects: ["13-03", "13-04", "13-05", "13-06", "13-07", "13-08"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mock-IdP test-control client mirrors mailpit.ts's shape: env-configured base URL, native fetch, throw on unexpected status, no ad hoc scattered fetches in spec files"
    - "User fixture helpers accept E2ePrismaLike (PrismaClient | Prisma.TransactionClient), mirroring links.ts's createE2eLink argument shape, so they compose inside withResetDbLock's transaction when a spec needs that"
    - "Standalone Playwright project with neither `dependencies` nor `use.storageState` for specs that must prove login from a cold, unauthenticated state"

key-files:
  created:
    - apps/e2e/src/oidc-mock.ts
    - apps/e2e/src/users.ts
  modified:
    - apps/e2e/playwright.config.ts

key-decisions:
  - "createInvitedUnverifiedUser uses prisma.user.create (not .upsert like createAllowlistedUser) -- a caller invoking this fixture twice for the same email is a test bug (colliding email), not a legitimate resend; inviteMember's own resend semantics are a higher-level app concern this raw fixture does not reproduce."
  - "Both users.ts helpers derive `name` from the email's local part (opts.email.split('@')[0] ?? opts.email), matching admin-seed.ts/inviteMember's exact convention rather than inventing a new naming scheme."
  - "The plan's literal automated verify command for Task 3 (`playwright test --list --project=auth >/dev/null`, expecting exit 0) does not hold against the installed Playwright 1.61.1: a --project filter matching ZERO total spec files throws `Error: No tests found` (exit 1) by design (confirmed by reading node_modules/playwright/lib/runner/index.js:6030-6035) -- this is expected right now since tests/auth/ is deliberately empty until Wave 1/2 plans add specs. Verified the plan's actual acceptance criterion instead ('resolves the project, no unknown-project error') by confirming `auth` appears in Playwright's own 'Available projects' list and diffing against a genuinely-unknown project name's distinct 'Project(s) ... not found' error. Documented here rather than silently declaring the exact specified command green."

requirements-completed: []

duration: ~15min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 02: E2E Auth Harness (Mock-IdP Client, User Fixtures, `auth` Project) Summary

Built the three reusable E2E harness pieces every AUTH-E2E spec in Wave 1/2 will consume: a thin typed mock-IdP control client (`oidc-mock.ts`), typed Prisma fixture helpers for allowlisted and invited-unverified `User` rows (`users.ts`), and a standalone `auth` Playwright project that proves login from a cold, unauthenticated state.

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-25
- **Tasks:** 3/3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `apps/e2e/src/oidc-mock.ts` — `setOidcProfile(profile)`/`resetOidcProfile()`, a thin `fetch` wrapper over `apps/e2e/oidc-mock/server.mjs`'s (13-01) `PUT`/`DELETE /__test__/profile` routes, mirroring `mailpit.ts`'s style exactly (env-configured base URL via `OIDC_MOCK_CONTROL_URL`, default `http://localhost:9000`, descriptive throw on any non-204 response).
- `apps/e2e/src/users.ts` — `createAllowlistedUser` (upsert, `emailVerified: true`, passes `lib/allowlist.ts`'s User-table-existence check) and `createInvitedUnverifiedUser` (create, `emailVerified: false`, `accountRole` default `"member"`, name = email local part, NO `Account` row — byte-for-byte matching `lib/team.ts`'s `inviteMember` new-invitee write). Both accept a `PrismaClient | Prisma.TransactionClient` argument like `createE2eLink`.
- `apps/e2e/playwright.config.ts` — registered a new `auth` project (`testMatch: /auth\/.*\.spec\.ts$/`), deliberately with no `dependencies: ["setup"]` and no `use.storageState`. Confirmed the regex does not also match `tests/authed/**` or `tests/smoke/**` (both live-tested). Left a comment noting the SSO specs' future `test.describe.serial` requirement per the plan's action text. Existing `smoke`/`setup`/`chromium-admin`/`chromium-member` projects are byte-for-byte unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: apps/e2e/src/oidc-mock.ts** — `de96d79` (feat)
2. **Task 2: apps/e2e/src/users.ts** — `79ee765` (feat)
3. **Task 3: Register standalone `auth` Playwright project** — `8101b79` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/src/oidc-mock.ts` — `OidcProfile` interface, `setOidcProfile`/`resetOidcProfile`
- `apps/e2e/src/users.ts` — `CreateUserOptions`, `createAllowlistedUser`, `createInvitedUnverifiedUser`
- `apps/e2e/playwright.config.ts` (modified) — new `auth` project block inserted between `setup` and `chromium-admin`

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- `createInvitedUnverifiedUser` is a plain `.create` (not `.upsert`) — a duplicate-email call is a caller bug, not a resend; `inviteMember`'s own resend semantics live at the app layer, not in this raw fixture helper.
- Both fixture helpers reuse the exact `email.split("@")[0] ?? email` name-derivation convention already established by `admin-seed.ts`/`inviteMember`.
- The plan's literal Task 3 automated verify command assumes `playwright test --list --project=auth` exits 0 even with zero matching spec files. Live-testing against the installed Playwright 1.61.1 shows this throws `Error: No tests found` (exit 1) whenever a `--project` filter's total test count is zero — confirmed by reading the installed package's own runner source, not assumed. This is expected right now (Wave 1/2 hasn't added `tests/auth/**` specs yet) and is NOT a defect in the project registration itself: `auth` correctly appears in Playwright's "Available projects" list, and a genuinely-unknown project name produces a distinct, different error (`Project(s) "X" not found. Available projects: ...`). Verified the plan's real acceptance criterion (project resolves, no unknown-project error) directly instead of the literal command-and-exit-code as specified.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blockers required a code fix. The one adjustment made was to the verification METHOD for Task 3 (see "Decisions Made" above and the frontmatter `key-decisions` entry), not to any implementation: the `auth` project block itself matches the plan's action text and acceptance criteria exactly (no `dependencies`, no `storageState`, correctly scoped `testMatch`, existing projects untouched).

## Issues Encountered

None. No live compose/Docker verification was needed for this plan (Task 1/2 are pure TypeScript modules verified via `tsc --noEmit` + static grep checks; Task 3 is verified via Playwright's own `--list` project-resolution behavior, run directly against the local Node/pnpm toolchain — no port conflicts with this machine's other running projects, since nothing here binds a network port).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 0 of Phase 13 is now fully closed: `apps/e2e/oidc-mock` (13-01) is live-verified end-to-end, and this plan's `oidc-mock.ts` client, `users.ts` fixtures, and standalone `auth` project give Wave 1/2's seven spec plans a stable, typed vocabulary to write against — no spec needs to hand-roll raw `fetch`/SQL for mock-IdP control or invited-user fixtures.

**Carried-forward blocker (unchanged from 13-01, still relevant to whichever plan writes `sso-login.spec.ts`):** `apps/api/src/lib/auth.ts`'s `genericOAuth` config sets no `scopes` (`scope=` empty at authorization time, confirmed live against the running app+mock in 13-01) — will need its own TDD RED→GREEN fix (`scopes: ["openid", "email", "profile"]`) before AUTH-E2E-04/05's real round trip can pass. Already recorded in STATE.md's Blockers/Concerns; not this plan's scope (`apps/api/src/lib/auth.ts` is not in `files_modified`).

Once `tests/auth/**` specs exist (Wave 1/2), `playwright test --list --project=auth` will resolve real tests and the plan's originally-specified verify command will pass as literally written.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/src/oidc-mock.ts
- FOUND: apps/e2e/src/users.ts
- FOUND: apps/e2e/playwright.config.ts
- FOUND: commit de96d79 (Task 1)
- FOUND: commit 79ee765 (Task 2)
- FOUND: commit 8101b79 (Task 3)
- FOUND: .planning/phases/13-authentication-session-e2e/13-02-SUMMARY.md
