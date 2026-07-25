---
phase: 11-playwright-e2e-infrastructure-fixtures
plan: 05
subsystem: testing
tags: [playwright, better-auth, magic-link, storageState, e2e, fixtures]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 04)
    provides: "apps/e2e/src/db.ts (ADMIN_EMAIL/MEMBER_EMAIL seeded baseline constants), apps/e2e/src/mailpit.ts (findMagicLinkUrl, recipient-scoped), global-setup.ts/global-teardown.ts wiring"
provides:
  - "apps/e2e/tests/auth.setup.ts — Playwright setup project performing one real magic-link round trip per role (admin, member), writing playwright/.auth/<role>.json"
  - "apps/e2e/playwright.config.ts — setup/chromium-admin/chromium-member projects, the latter two dependencies:['setup'] + use.storageState, scoped to tests/authed/**"
  - "apps/e2e/tests/authed/storage-state.spec.ts — fresh-context reuse proof for both roles, with role-specific UI assertion (Team nav)"
affects: ["Phase 12-17 (every authenticated E2E suite consumes chromium-admin/chromium-member instead of re-authenticating per spec file)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Setup-project + dependencies:['setup'] + use.storageState is the sole auth mechanism for authenticated Playwright projects in this repo — no per-spec login round trip anywhere downstream"
    - "Role detection inside a shared spec file via testInfo.project.name (not separate spec files per role) — keeps one assertion body honest about both roles instead of duplicating it"

key-files:
  created:
    - apps/e2e/tests/auth.setup.ts
    - apps/e2e/tests/authed/storage-state.spec.ts
  modified:
    - apps/e2e/playwright.config.ts

key-decisions:
  - "auth.setup.ts requests the magic link via a direct request.post('/api/auth/sign-in/magic-link') call (mirroring 11-04's mailpit-wiring.spec.ts pattern) rather than driving the LoginView UI form — the UI form itself is Phase 13's dedicated login-UI spec's job; this fixture only needs the round trip to actually establish an authenticated session."
  - "The wait-before-snapshot signal is the 'Dashboard' nav link (present for every role in AppShell.vue's visibleNavItems), not a URL check alone — this rules out a race where storageState gets written before the session cookie/session-fetch has actually completed."
  - "storage-state.spec.ts detects the active role via testInfo.project.name rather than duplicating the spec into two files — a single assertion body proves BOTH 'reaches an authenticated route' and 'the correct role's session was loaded' (T-11-08) for both chromium-admin and chromium-member."

requirements-completed: [INFRA-04]

coverage:
  - id: D1
    description: "auth.setup.ts performs one real magic-link round trip per role (admin, member) via real HTTP + x-e2e-bypass header + findMagicLinkUrl, and writes playwright/.auth/<role>.json only after the authenticated App Shell actually renders"
    requirement: "INFRA-04"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "node node_modules/@playwright/test/cli.js test --project=setup --list — discovers exactly 2 tests (authenticate as admin, authenticate as member) in tests/auth.setup.ts, zero collection errors"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh --project=setup"
        status: unknown
    human_judgment: true
    rationale: "Full live-stack verification blocked in this sandbox by the same pre-existing, unrelated Docker containers documented in 11-03/11-04-SUMMARY.md (zbr-brain-postgres-1 bound to host port 5433, ddev-router bound to host port 8025) — confirmed still running via `docker ps` before attempting a live run. A human or CI runner without those two specific conflicting containers must confirm the actual `exit 0` end-to-end."
  - id: D2
    description: "playwright.config.ts adds setup, chromium-admin (dependencies:['setup'], storageState admin.json), and chromium-member (dependencies:['setup'], storageState member.json) projects, all scoped to tests/authed/**, leaving the existing smoke project and globalSetup/globalTeardown untouched"
    requirement: "INFRA-04"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "node node_modules/@playwright/test/cli.js test --project=chromium-admin --project=chromium-member --list tests/authed/storage-state.spec.ts — discovers the setup project (auto-included as a declared dependency) plus one test per chromium-admin/chromium-member project, zero collection errors"
        status: pass
    human_judgment: false
  - id: D3
    description: "storage-state.spec.ts runs in both chromium-admin and chromium-member (inheriting each project's storageState with zero login round trip inside the spec), asserts the final URL after navigating to / is not /login, then asserts a role-specific signal: Team nav present + /team reachable for admin, Team nav absent + /team redirected away for member"
    requirement: "INFRA-04"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "node node_modules/@playwright/test/cli.js test --project=chromium-admin --project=chromium-member --list tests/authed/storage-state.spec.ts — Total: 4 tests in 2 files (2 setup + 1 per authenticated project)"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh --project=chromium-admin --project=chromium-member apps/e2e/tests/authed/storage-state.spec.ts"
        status: unknown
    human_judgment: true
    rationale: "Same pre-existing local port conflict as D1 blocks a full live run in this sandbox (compose failed at mailpit's port bind: 'Bind for 127.0.0.1:8025 failed: port is already allocated') — one live attempt was made this session, confirmed the trap-based teardown correctly fired (zero leftover kurzly-e2e containers afterward), and no unrelated container/volume was touched per this plan's guardrail. Deferred to CI or a clean machine, exactly as 11-03/11-04-SUMMARY.md documented for their own live-boot verification."

duration: 15min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 05: Auth Fixture (storageState) Summary

**Per-role `storageState` auth fixture (INFRA-04) — a real magic-link login round trip per role in a dedicated `setup` project, reused via `chromium-admin`/`chromium-member` so every downstream authenticated suite (Phases 13-17) skips re-authenticating, proven by a fresh-context reuse spec asserting role-correct UI for both Admin and Member.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-24T14:20:00Z (approx.)
- **Completed:** 2026-07-24T14:35:54Z
- **Tasks:** 2/2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Built `apps/e2e/tests/auth.setup.ts`: a Playwright setup project that, for each of the two seeded baseline roles (admin, member), requests a real magic link over HTTP (`POST /api/auth/sign-in/magic-link` with the `x-e2e-bypass` header so it's never rate-limited), retrieves it via `findMagicLinkUrl`'s recipient-scoped Mailpit lookup, navigates to the real verify URL, waits for the authenticated App Shell's "Dashboard" nav link to actually render (ruling out a session-cookie race), and snapshots `storageState` to `playwright/.auth/<role>.json`.
- Extended `apps/e2e/playwright.config.ts` with `setup` (matches `auth.setup.ts`), `chromium-admin`, and `chromium-member` projects — the latter two declare `dependencies: ['setup']`, load their own role's saved `storageState`, and are scoped to `tests/authed/**/*.spec.ts` so they never collide with the unauthenticated `smoke` project's specs. The existing `smoke` project and `globalSetup`/`globalTeardown` wiring from 11-01/11-04 were left untouched.
- Built `apps/e2e/tests/authed/storage-state.spec.ts`: a single spec that runs in both `chromium-admin` and `chromium-member`, inheriting each project's saved `storageState` with zero login round trip inside the spec itself. It asserts the final URL after navigating to `/` is not `/login` (proving the saved session cookie was actually accepted by a genuinely fresh browser context), then asserts a role-specific signal via `testInfo.project.name`: the admin-only "Team" nav entry is present and `/team` is reachable for the admin project; it is absent and `/team` redirects back to `/` for the member project — proving the CORRECT role's session was captured, not merely "a session" (T-11-08).

## Task Commits

Each task was committed atomically:

1. **Task 1: auth.setup.ts — one real magic-link round trip per role, saved to storageState** - `5e61451` (feat)
2. **Task 2: storage-state.spec.ts — fresh-context reuse reaches an authed route per role** - `f220271` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `apps/e2e/tests/auth.setup.ts` - Setup project: per-role magic-link round trip, writes `playwright/.auth/<role>.json`.
- `apps/e2e/tests/authed/storage-state.spec.ts` - Fresh-context reuse proof for admin + member, role-specific UI assertion.
- `apps/e2e/playwright.config.ts` - Adds `setup`, `chromium-admin`, `chromium-member` projects.

## Decisions Made

- Requested the magic link via a direct `request.post` call (matching 11-04's `mailpit-wiring.spec.ts` pattern) rather than driving the `LoginView` UI form — keeps this fixture focused on establishing a real session, leaving the login-UI flow itself to Phase 13.
- Used the "Dashboard" nav link's presence (not a bare URL check) as the readiness signal before snapshotting `storageState`, ruling out a race between the verify redirect landing and the client's own session-fetch completing.
- `storage-state.spec.ts` is a single file detecting role via `testInfo.project.name` rather than two near-duplicate files — keeps the "reaches an authed route" and "correct role" assertions in one place for both projects.

## Deviations from Plan

None - plan executed exactly as written. All artifacts match the plan's `<action>` and `<acceptance_criteria>` blocks; no Rule 1-4 fixes were needed.

## Issues Encountered

**Full end-to-end live verification blocked by the same pre-existing, unrelated Docker containers documented in 11-03/11-04-SUMMARY.md — not a defect in this plan's artifacts.**

Confirmed via `docker ps` before attempting a live run that both `zbr-brain-postgres-1` (host port `5433`) and `ddev-router` (host port `8025`) — pre-existing, unrelated containers from other projects on this shared dev machine — were still bound. One live attempt of `./scripts/e2e-compose.sh --project=chromium-admin --project=chromium-member apps/e2e/tests/authed/storage-state.spec.ts` was made: the compose stack's network/volumes were created, but `mailpit`'s container failed at its port bind (`Bind for 127.0.0.1:8025 failed: port is already allocated`) before the `app` container could start. The teardown trap correctly fired (`down -v --remove-orphans`), confirmed via `docker ps -a --filter name=kurzly-e2e` showing zero leftover containers. Per this plan's `<important_note>` guardrail, no attempt was made to stop or reconfigure the unrelated containers.

**What was verified instead, to close the gap as tightly as possible without a full live run:**
- `pnpm --filter @kurzly/e2e typecheck` (`tsc --noEmit`) passes cleanly for both new files and the modified config.
- `node node_modules/@playwright/test/cli.js test --project=setup --list` discovers exactly 2 tests (`authenticate as admin`, `authenticate as member`) in `tests/auth.setup.ts`, zero collection errors.
- `node node_modules/@playwright/test/cli.js test --project=chromium-admin --project=chromium-member --list tests/authed/storage-state.spec.ts` discovers 4 tests total (the 2 `setup` tests, auto-included since both authenticated projects declare `dependencies: ['setup']`, plus 1 test per authenticated project) — confirming the dependency chain, `testMatch` scoping, and module resolution are all sound.
- `git check-ignore -v apps/e2e/playwright/.auth/admin.json apps/e2e/playwright/.auth/member.json` confirms both paths are ignored by the existing `.gitignore` rule from 11-01 (T-11-02).

**What remains unverified:** the literal `exit 0` of `./scripts/e2e-compose.sh --project=setup` and `./scripts/e2e-compose.sh --project=chromium-admin --project=chromium-member apps/e2e/tests/authed/storage-state.spec.ts` against a live running stack. This requires an environment (CI, or a clean local machine) without `zbr-brain-postgres-1`/`ddev-router` already bound to `5433`/`8025`. Recorded as `status: unknown` / `human_judgment: true` in this SUMMARY's `coverage` block (D1/D3) rather than silently claimed as passing.

## User Setup Required

None - no external service configuration required. (The port conflicts above are a pre-existing local sandbox condition from unrelated projects, not a new setup requirement introduced by this plan — CI and most clean dev machines will not have `zbr-brain-postgres-1`/`ddev-router` running.)

## Next Phase Readiness

- `apps/e2e/tests/auth.setup.ts`, the `setup`/`chromium-admin`/`chromium-member` projects, and `apps/e2e/tests/authed/storage-state.spec.ts` are all in place, typecheck cleanly, and are structurally verified via Playwright's own test collection.
- Phases 13-17's authenticated specs can build directly on `chromium-admin`/`chromium-member` — declare no dependency of their own, just author specs under `tests/authed/**` and they inherit the saved `storageState` automatically.
- **Recommended before this phase's final CI-wiring plan ships:** re-run `./scripts/e2e-compose.sh --project=setup` and `./scripts/e2e-compose.sh --project=chromium-admin --project=chromium-member apps/e2e/tests/authed/storage-state.spec.ts` once in a clean environment (or let the new CI `e2e` job itself be the first real confirmation) to close out D1/D3's `unknown` status.
- No blockers for proceeding to the next plan in this phase (11-06, CI wiring).

---
*Phase: 11-playwright-e2e-infrastructure-fixtures*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/auth.setup.ts
- FOUND: apps/e2e/tests/authed/storage-state.spec.ts
- FOUND: apps/e2e/playwright.config.ts
- FOUND: .planning/phases/11-playwright-e2e-infrastructure-fixtures/11-05-SUMMARY.md
- FOUND: commit 5e61451
- FOUND: commit f220271
