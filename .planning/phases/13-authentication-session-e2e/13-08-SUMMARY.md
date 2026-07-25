---
phase: 13-authentication-session-e2e
plan: 08
subsystem: e2e
tags: [oidc, sso, account-linking, better-auth, playwright, vitest, tdd]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "01"
    provides: "apps/e2e/oidc-mock's live mock IdP (discovery rewrite, auto-approve login+consent, PUT/DELETE /__test__/profile), docker-compose.e2e.yml wiring"
  - phase: 13-authentication-session-e2e
    plan: "02"
    provides: "apps/e2e/src/oidc-mock.ts client, apps/e2e/src/users.ts fixtures (createInvitedUnverifiedUser), standalone `auth` Playwright project"
  - phase: 13-authentication-session-e2e
    plan: "07"
    provides: "apps/e2e/tests/auth/sso.spec.ts's test.describe.serial block + afterEach(resetOidcProfile), apps/api/src/lib/auth.ts's genericOAuth scopes fix"
provides:
  - "apps/api/src/lib/auth.ts's createAuth() now sets account.accountLinking { enabled: true, requireLocalEmailVerified: false } (D-13-01), closing the last known blocker for AUTH-E2E-05"
  - "apps/api/test/sso-auth.integration.test.ts's \"invited SSO merge\" test — server-side proof that an admin-invited unverified User merges into one account + one oidc Account row on first SSO login"
  - "apps/e2e/tests/auth/sso.spec.ts's AUTH-E2E-05 test, appended to the existing test.describe.serial block — real-browser proof of the same merge"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED->GREEN landed as two commits within a single plan: failing E2E + integration merge tests first (confirmed RED live — real error=account_not_linked redirect, no oidc Account row), then the minimal account.accountLinking config fix that turns both GREEN — mirrors 13-07's identical shape for the OTHER known blocker in this phase (the scopes gap)"

key-files:
  created: []
  modified:
    - apps/e2e/tests/auth/sso.spec.ts
    - apps/api/test/sso-auth.integration.test.ts
    - apps/api/src/lib/auth.ts

key-decisions:
  - "Added the new integration test to the SAME 'OIDC/SSO configured' describe block the existing AUTH-06/AUTH-07 tests live in, reusing buildAppWithOidc/ssoSignInAndCallback verbatim (no new stub-IdP scaffolding) — the merge scenario only differs in its precondition (a pre-seeded, invited-unverified User row via a direct prisma.user.create mirroring lib/team.ts's inviteMember shape)."
  - "Appended the AUTH-E2E-05 test directly inside 13-07's existing test.describe.serial block in sso.spec.ts (not a new file) — the two SSO tests share the mock IdP's single global profile state, and 13-07 explicitly built its afterEach(resetOidcProfile) and describe.serial structure expecting this appendage."
  - "Used a unique per-run sub/email for the E2E test (never a fixed literal) so its Account(providerId, accountId) row can never collide with AUTH-E2E-04's own subject/email in the same describe.serial block."
  - "Landed the account.accountLinking fix as a header-comment-documented decision (D-13-01), matching auth.ts's existing D-10-xx convention exactly, including the explicit security tradeoff (an admin-invited-but-unverified row becomes SSO-linkable by anyone who can authenticate to the operator-trusted IdP with that email) and an open question flagged for any future non-invite user-creation path — per 13-RESEARCH.md Pitfall 1's explicit instruction not to leave this implicit."
  - "Confirmed RED, then GREEN, LIVE at both levels: the integration test's automated RED-check command (real vitest run, real testcontainers Postgres) before the fix, then a full apps/api vitest suite run (no regressions) plus a full live compose-image run of all 9 apps/e2e/tests/auth/ specs together after the fix — not simulated or reasoned about."
  - "Diagnosed and resolved a transient stack-reuse flake identical to the one documented in STATE.md's Phase 13 decisions: re-running tests/auth/ multiple times against the same long-lived compose stack (once without the correct E2E_RATE_LIMIT_BYPASS_SECRET propagated into the same shell, once with accumulated Mailpit/DB state) produced spurious rate-limit and Dashboard-nav-timeout failures unrelated to this plan's code change. Resolved exactly as documented: tore the stack down and re-ran the full directory ONCE against a freshly booted stack — 9/9 passed."

requirements-completed: [AUTH-E2E-05]

coverage:
  - id: D1
    description: "An admin-invited, not-yet-activated magic-link account (emailVerified false, no Account row) that first signs in via SSO with the SAME email is merged into ONE account — no duplicate User, and an Account row for provider 'oidc' is created against the existing User"
    requirement: "AUTH-E2E-05"
    verification:
      - kind: unit
        ref: "apps/api/test/sso-auth.integration.test.ts's \"invited SSO merge\" test: pnpm vitest run test/sso-auth.integration.test.ts -t \"invited SSO merge\" -- passed after the fix (single User row, oidc Account row present)"
        status: pass
      - kind: e2e
        ref: "Live compose boot (kurzly-e2e-p1308, alt project name + port remap): pnpm --filter @kurzly/e2e test tests/auth/sso.spec.ts --project=auth -- 2 passed (AUTH-E2E-04 + AUTH-E2E-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Against the current (unconfigured) auth.ts, this merge is REJECTED (account_not_linked) — the E2E and integration tests RED before the fix and GREEN after"
    requirement: "AUTH-E2E-05"
    verification:
      - kind: unit
        ref: "Confirmed RED live: callback location was literally '/auth/error?error=account_not_linked' before the fix — the automated verify command (if...then UNEXPECTED GREEN...else RED confirmed) correctly reported RED"
        status: pass
    human_judgment: false
  - id: D3
    description: "The fix is a documented, reviewed account.accountLinking config change in auth.ts, not a test-only change"
    requirement: "AUTH-E2E-05"
    verification:
      - kind: unit
        ref: "apps/api/src/lib/auth.ts diff: account.accountLinking { enabled: true, requireLocalEmailVerified: false } plus a D-13-01 header-comment rationale and explicit security tradeoff, matching the file's existing D-10-xx convention"
        status: pass
    human_judgment: false
  - id: D4
    description: "The scopes/accountLinking fixes cause zero regression in the existing Vitest OIDC suite and the full tests/auth/ E2E directory"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec vitest run (full suite) -- all tests passed"
        status: pass
      - kind: e2e
        ref: "Live compose boot: pnpm --filter @kurzly/e2e test tests/auth/ --project=auth (fresh stack) -- 9 passed"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 08: AUTH-E2E-05 SSO-After-Invite Account Merge Summary

**Closed the last known blocker in Phase 13: added a documented `account.accountLinking` fix to `apps/api/src/lib/auth.ts` (decision D-13-01) so an admin-invited, not-yet-activated User merges into ONE account on first SSO login instead of being rejected with `account_not_linked` — proven via a genuine RED→GREEN TDD pair at both the Vitest integration level and the real-browser Playwright E2E level.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-25
- **Tasks:** 2/2 (RED, then GREEN)
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

- Added a new **"invited SSO merge"** integration test to `apps/api/test/sso-auth.integration.test.ts`'s existing "OIDC/SSO configured" describe block: seeds an invite-shaped unverified `User` row (mirroring `lib/team.ts`'s `inviteMember` exactly), drives the real `genericOAuth` sign-in→callback round trip via the existing `ssoSignInAndCallback` helper, and asserts a 302 with no `error=` in the redirect location, exactly ONE `User` row for the email, and an `Account` row for provider `"oidc"` against that same user.
- Appended the **AUTH-E2E-05** test to the existing `test.describe.serial("SSO login (AUTH-E2E-04/05)", ...)` block in `apps/e2e/tests/auth/sso.spec.ts` (13-07's block): uses `createInvitedUnverifiedUser` for the precondition, drives the real browser "Mit SSO anmelden" flow, and asserts the dashboard is reached, a server-verified session exists, exactly one `User` row exists for the email, and an `oidc` `Account` row is attached to it. A unique per-run `sub`/`email` keeps this test's `Account(providerId, accountId)` row distinct from AUTH-E2E-04's.
- **Confirmed RED for the documented reason**: before the fix, the integration test's callback redirected to `/auth/error?error=account_not_linked` (better-auth's default `requireLocalEmailVerified: true` rejecting the unverified invited row) — verified live against real testcontainers Postgres, not assumed.
- Added `account: { accountLinking: { enabled: true, requireLocalEmailVerified: false } }` to `createAuth()`'s `betterAuth({...})` config in `apps/api/src/lib/auth.ts`, with a full **D-13-01** header-comment rationale (matching the file's existing D-10-xx documentation convention) covering: the invite-only scoping argument, the explicit security tradeoff (any admin-invited-unverified row becomes SSO-linkable by anyone who can authenticate to the operator-trusted IdP with that email), and an open question for any future non-invite user-creation path.
- **Confirmed GREEN live** at both levels: the integration test suite (`sso-auth.integration.test.ts` + `sso-config.test.ts`) and the full `apps/api` Vitest suite pass with zero regression; a full compose-image live run of all 9 `apps/e2e/tests/auth/` specs (including both SSO tests) passes together.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing merge tests** — `6fa5704` (test)
2. **Task 2 (GREEN): account.accountLinking fix** — `37855bc` (fix)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/api/test/sso-auth.integration.test.ts` (modified) — new "invited SSO merge" test + `randomUUID` import
- `apps/e2e/tests/auth/sso.spec.ts` (modified) — AUTH-E2E-05 test appended to the existing `test.describe.serial` block + `createInvitedUnverifiedUser` import
- `apps/api/src/lib/auth.ts` (modified) — `account.accountLinking` config + D-13-01 header-comment rationale

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- Reused the existing "OIDC/SSO configured" describe block and `buildAppWithOidc`/`ssoSignInAndCallback` helpers verbatim for the integration test — no new stub-IdP scaffolding needed, only a new precondition (an invite-shaped `User` row).
- Appended (not a new file) into 13-07's `test.describe.serial` block in `sso.spec.ts`, exactly as that plan's own `afterEach(resetOidcProfile)`/serial structure anticipated.
- The `account.accountLinking` fix is documented as decision D-13-01, matching this file's existing D-10-xx convention — including an explicit, non-implicit security tradeoff statement per 13-RESEARCH.md Pitfall 1's instruction.

## Deviations from Plan

### Auto-fixed Issues

None — the plan's own two tasks (RED test-writing, GREEN config fix) were executed exactly as written; no bugs, missing functionality, or blockers required an out-of-plan code fix.

### Environment-Only Issues (not code deviations)

- **[Rule 3 - blocking issue] Docker Desktop VM disk exhaustion**: `db` failed to start on the first `up -d --wait` attempt with `initdb: error: could not create directory ... No space left on device`, despite the host filesystem having 189GiB free — Docker Desktop's own VM disk was full from accumulated build cache (18.9GB reclaimed via `docker builder prune -f`) and a stray leftover `kurzly-e2e-app:latest` image from a prior incomplete teardown (207MB reclaimed via `docker rmi`, confirmed zero containers referenced it first). Not a code or plan defect — purely local Docker Desktop housekeeping, resolved before any test ran.
- **Rate-limit-bypass-secret propagation across separate shell invocations**: the Bash tool's per-call shell reset (documented in this agent's own operating constraints) meant an `export E2E_RATE_LIMIT_BYPASS_SECRET=...` set during `docker compose up` was not automatically available to a later, separate test-run invocation — the test run sent no bypass header, got rate-limited, and two magic-link-dependent specs failed. Resolved by reading the ACTUAL secret baked into the running `app` container via `docker inspect ... | grep E2E_RATE_LIMIT_BYPASS_SECRET` and re-exporting that exact value for the test run, rather than guessing or regenerating (which would not have matched the already-booted container).
- **Transient stack-reuse flake** (STATE.md-documented pattern, not new): running the full `tests/auth/` directory twice in a row against the SAME long-lived compose stack (once with the wrong bypass secret, once immediately after) accumulated Mailpit/DB state and produced spurious rate-limit/Dashboard-nav-timeout failures across 5 specs unrelated to this plan's `auth.ts` change. Resolved exactly as STATE.md's existing decision log prescribes: tore the stack down fully (`down -v --remove-orphans`) and re-ran the full directory ONCE against a freshly booted stack — all 9 specs passed together.

**Total deviations:** 0 code deviations. 3 environment/tooling issues encountered and resolved during live verification, none requiring any change to the plan's declared `files_modified`.
**Impact on plan:** No scope creep — the final committed diff matches the plan's `artifacts_produced` exactly (3 files, all declared in `files_modified`).

## Issues Encountered

See "Environment-Only Issues" above for the full detail. Same recurring port-conflict pattern as 12-01/13-01/13-07 (this dev machine's canonical E2E ports 3000/5433/8025 bound by unrelated projects: `product-catalog`'s dev server, `zbr-brain-postgres-1`, `ddev-router`) — resolved via the established alternate-project-name (`kurzly-e2e-p1308`) + uncommitted `docker-compose.e2e.local-ports.override.yml` (`db`→15433, `mailpit`→18025/11025, `app`→13000, matching `BASE_URL`/`OIDC_MOCK_REDIRECT_URI` overrides) via Compose's `!override` merge tag. Port 9000 (`oidc-mock`) was free, same as every prior plan in this phase, and needed no remap.

## Live Verification (per the plan's `<important_note>`)

1. **RED**: `cd apps/api && pnpm vitest run test/sso-auth.integration.test.ts -t "invited SSO merge"` — failed with the callback's redirect `location` literally equal to `/auth/error?error=account_not_linked`, exactly the documented current-behavior failure mode. The plan's automated verify command (`if ... then UNEXPECTED GREEN ... else RED confirmed`) correctly reported "RED confirmed — merge rejected by current auth.ts".
2. Applied the `account.accountLinking` fix, confirmed `pnpm --filter @kurzly/api exec tsc --noEmit` clean.
3. **GREEN (integration)**: `pnpm vitest run test/sso-auth.integration.test.ts test/sso-config.test.ts` — all passed, zero regression against the existing stub-IdP OIDC suite.
4. **GREEN (full API suite)**: `pnpm --filter @kurzly/api exec vitest run` — full suite passed (exit 0), confirming the `accountLinking` change causes no regression anywhere else in the API.
5. Freed Docker Desktop VM disk space (`docker builder prune -f`, removed a stray leftover `kurzly-e2e-app:latest` image with zero referencing containers) after the first `docker compose up` attempt failed with `No space left on device` on the `db` service.
6. Built and booted the full 4-service stack under `kurzly-e2e-p1308` with the override file above — all services (`db`, `mailpit`, `app`, `oidc-mock`) reported healthy.
7. **GREEN (E2E, single spec)**: `pnpm --filter @kurzly/e2e test tests/auth/sso.spec.ts --project=auth` — 2 passed (AUTH-E2E-04 and AUTH-E2E-05 together).
8. Diagnosed and resolved the STATE.md-documented stack-reuse flake (see "Environment-Only Issues") by tearing the stack down and rebooting fresh.
9. **GREEN (full phase-gate directory)**: `pnpm --filter @kurzly/e2e test tests/auth/ --project=auth` against the freshly booted stack — **9 passed** (resend-rate-limit, both SSO tests, magic-link-round-trip, both logout/route-guard + magic-link-token-rejection ×3, invite-only-denial).
10. Tore the stack down fully (`down -v --remove-orphans`), deleted the override file and the generated `.env`, deleted the two built images (`kurzly-e2e-p1308-app`, `kurzly-e2e-p1308-oidc-mock`), and confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's 1 remaining uncommitted file (which was then committed as Task 2).

**Result: PROVEN LIVE**, both the RED and the GREEN state, at BOTH the Vitest-integration and real-browser-E2E levels, against the real built compose image and the real mock IdP — not simulated or reasoned about.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 13 (Authentication & Session E2E) is now fully closed: all 7 requirements (AUTH-E2E-01 through AUTH-E2E-07) have passing E2E coverage, and both of the phase's discovered code blockers (13-07's `genericOAuth` empty-scopes gap and this plan's `account.accountLinking` gap) are fixed and documented as first-class, reviewed decisions (matching this file's existing D-10-xx convention) rather than silent workarounds. The full `apps/e2e/tests/auth/` directory (9 specs across 6 files) passes together against the built compose image, and the full `apps/api` Vitest suite passes with zero regression from either fix.

No blockers carried forward to Phase 14.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/api/test/sso-auth.integration.test.ts (modified)
- FOUND: apps/e2e/tests/auth/sso.spec.ts (modified)
- FOUND: apps/api/src/lib/auth.ts (modified)
- FOUND: commit 6fa5704 (test, RED)
- FOUND: commit 37855bc (fix, GREEN)
- FOUND: .planning/phases/13-authentication-session-e2e/13-08-SUMMARY.md
