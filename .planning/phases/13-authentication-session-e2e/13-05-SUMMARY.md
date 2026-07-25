---
phase: 13-authentication-session-e2e
plan: 05
subsystem: testing
tags: [playwright, e2e, better-auth, session, logout, router-guard]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "02"
    provides: "apps/e2e/src/users.ts's createAllowlistedUser, the standalone `auth` Playwright project (no setup dependency, no storageState)"
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: "apps/e2e/src/db.ts (createE2ePrisma), apps/e2e/src/mailpit.ts (findMagicLinkUrl), authed/storage-state.spec.ts's forward-direction proof this spec complements"
provides:
  - "apps/e2e/tests/auth/logout-route-guard.spec.ts: AUTH-E2E-06 — clicking Abmelden ends the session SERVER-SIDE (GET /api/auth/get-session returns null, not just a client redirect), and a fresh, cookie-less browser context visiting / or /links is redirected to /login by the router guard"
affects: ["13-06", "13-07", "13-08"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every negative/logout-path assertion pairs a UI/redirect check with an explicit GET /api/auth/get-session confirmation (13-RESEARCH.md Pitfall 3), extended here to the LOGOUT direction (not just token-rejection)"
    - "A second requiresAuth route (/links, alongside /) is asserted in the same spec to show the router guard is route-meta-driven, not path-specific"

key-files:
  created:
    - apps/e2e/tests/auth/logout-route-guard.spec.ts
  modified: []

key-decisions:
  - "Establishes its own session inline via a real magic-link round trip (createAllowlistedUser + POST /api/auth/sign-in/magic-link with the x-e2e-bypass header + findMagicLinkUrl), mirroring magic-link-round-trip.spec.ts exactly, rather than depending on the setup project's storageState — this spec runs under the standalone `auth` project with no dependencies:['setup']."
  - "Part 2's fresh unauthenticated context is created via browser.newContext({ baseURL }) — confirmed (13-03's finding) that manually created contexts do NOT inherit playwright.config.ts's use.baseURL, so baseURL is always explicitly passed with the same fallback chain as smoke/boot.spec.ts."
  - "An early full-tests/auth/ --workers=1 run against a THIRD consecutive reuse of the same long-lived compose stack (no fresh docker compose down/up in between) produced 3 spurious timeouts waiting for the Dashboard nav to render after page.goto(magicLinkUrl) — re-running against a freshly booted stack (single down -v + up --wait) resolved this immediately with 6/6 passing in 9.9s. Diagnosed as accumulated Mailpit/DB state across three back-to-back Playwright invocations on one stack, not a defect in this spec or any of the other three tests/auth/ files — recorded here so a future investigator doesn't re-chase this as a real bug."

requirements-completed: [AUTH-E2E-06]

coverage:
  - id: D1
    description: "Clicking the sidebar Abmelden button signs out, lands on /login, and GET /api/auth/get-session independently confirms the session is revoked server-side"
    requirement: "AUTH-E2E-06"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/logout-route-guard.spec.ts#AUTH-E2E-06: logout ends the session; unauthenticated access redirects to /login > clicking Abmelden logs out server-side, and a fresh unauthenticated context is redirected to /login — live compose (kurzly-e2e-p13-05), default parallelism and --workers=1 (fresh stack), both green"
        status: pass
    human_judgment: false
  - id: D2
    description: "A fresh, cookie-less browser context (no storageState) visiting / or /links is redirected to /login by the router guard"
    requirement: "AUTH-E2E-06"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/logout-route-guard.spec.ts#AUTH-E2E-06: logout ends the session; unauthenticated access redirects to /login > clicking Abmelden logs out server-side, and a fresh unauthenticated context is redirected to /login — same run as D1"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 05: Logout + Route Guard (AUTH-E2E-06) Summary

**One new `apps/e2e/tests/auth/logout-route-guard.spec.ts` proves the reverse half of the session lifecycle Phase 11's `storage-state.spec.ts` left unproven: logout revokes the server session (independently confirmed via `GET /api/auth/get-session`, not just a client-side redirect), and a genuinely cold, unauthenticated browser context is bounced to `/login` by the router guard for two different `requiresAuth` routes.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-25
- **Tasks:** 1/1
- **Files modified:** 1 (created)

## Accomplishments

- `apps/e2e/tests/auth/logout-route-guard.spec.ts` (AUTH-E2E-06):
  - Establishes a real session inline (dedicated `logout-<random>@e2e.kurzly.local` allowlisted user, magic-link round trip with the INFRA-06 bypass header).
  - Part 1: clicks `page.getByTitle("Abmelden")`, asserts the final URL is `/login`, then independently confirms `GET /api/auth/get-session` returns `null` — proving the httpOnly cookie was actually revoked server-side by `POST /api/auth/sign-out`, not merely hidden client-side.
  - Part 2: opens a fresh, cookie-less `browser.newContext()` (no `storageState`) and confirms both `/` and `/links` redirect to `/login`, showing the guard is driven by route `meta.requiresAuth`, not hardcoded to a single path — distinct from Phase 11's `storage-state.spec.ts`, which only proves the forward direction (an authenticated session reaching an authenticated route).

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-E2E-06 — logout ends the session; unauthenticated access redirects to /login** - `a0c0262` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/auth/logout-route-guard.spec.ts` — AUTH-E2E-06, one test, standalone `auth` Playwright project

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- Session established inline via a real magic-link round trip (never the `setup` project's `storageState`), matching this phase's established standalone-`auth`-project convention.
- `browser.newContext({ baseURL })` explicitly passes `baseURL` (13-03's confirmed finding that manually created contexts don't inherit `playwright.config.ts`'s `use.baseURL`).
- A stale-stack-reuse flake (3 spurious timeouts on a third consecutive Playwright invocation against the same long-lived compose stack) was diagnosed and resolved by re-running against a freshly booted stack — documented as a false alarm, not a spec defect.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, or blockers required a code fix; the spec file matches the plan's action text and acceptance criteria directly (establishes its own session, clicks `getByTitle("Abmelden")`, asserts `/login`, asserts `get-session` returns no user, and a fresh no-storageState context visiting `/` is redirected to `/login`).

## Issues Encountered

- **Transient stack-reuse flake (not a spec defect):** running `tests/auth/ --project=auth --workers=1` as the THIRD consecutive Playwright invocation against the same long-lived compose stack (without a fresh `down -v`/`up --wait` in between) produced 3 spurious timeouts waiting for the "Dashboard" nav to render after `page.goto(magicLinkUrl)` — affecting `logout-route-guard.spec.ts`, `magic-link-round-trip.spec.ts`, and one `magic-link-token-rejection.spec.ts` case. Re-running the identical command against a freshly booted stack (single `down -v --remove-orphans` then `up -d --wait`) immediately resolved it: 6/6 tests passed in 9.9s. Diagnosed as accumulated Mailpit/DB state across three back-to-back invocations sharing one long-lived stack, not a defect in any spec file — recorded here for future investigators.
- Canonical E2E ports (3000, 5433, 8025) were already bound by unrelated projects on this dev machine, same as prior 13-0x plans. Resolved via the established pattern: alternate compose project name (`kurzly-e2e-p13-05`) + an uncommitted `docker-compose.e2e.local-ports.override.yml` remapping `db`→15433, `mailpit`→18025/11025, `app`→13000 (with matching `BASE_URL`/`OIDC_MOCK_REDIRECT_URI` overrides) via Compose's `!override` merge tag. Port 9000 (`oidc-mock`) was free and needed no remap.

## Live Verification (per the plan's `<important_note>`)

1. Built and booted the full 4-service stack (`db`, `mailpit`, `oidc-mock`, `app`) under `kurzly-e2e-p13-05` with the override file above — all four reported healthy.
2. Ran the plan's literal verify command (`tests/auth/logout-route-guard.spec.ts --project=auth`, equivalent to `scripts/e2e-compose.sh` targeting) — 1/1 passed.
3. Ran the full `tests/auth/` directory (4 files, 6 tests) at **default parallelism**: 6/6 passed.
4. Investigated a subsequent `--workers=1` run's 3 spurious failures (see Issues Encountered), confirmed it was a stack-reuse artifact by tearing the stack down and re-upping fresh, then re-ran `tests/auth/ --project=auth --workers=1` against the freshly booted stack: **6/6 passed in 9.9s** (`invite-only-denial.spec.ts` alone took 4.4s, not the earlier run's anomalous 1.2 minutes — confirming the diagnosis).
5. Confirmed `pnpm --filter @kurzly/e2e run typecheck` (`tsc --noEmit`) passes clean.
6. Tore the stack down fully (`down -v --remove-orphans`), deleted the two built images, deleted the override file and the scratch `.env`/bypass-secret file, and confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's 1 new spec file.

**Result: PROVEN LIVE**, at both default parallelism and `--workers=1` (against a freshly booted stack), against the built compose image — not just statically reasoned about.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

AUTH-E2E-06 is closed. `apps/e2e/tests/auth/` now has 4 of the phase's 7 spec files (AUTH-E2E-01, 02, 03, 06); the remaining three (AUTH-E2E-04/05 — SSO round trip + account merge, and AUTH-E2E-07 — resend rate-limit UX) can proceed independently. The carried-forward blockers from 13-01/13-02 (apps/api/src/lib/auth.ts's `genericOAuth` config needs `scopes: ["openid", "email", "profile"]`, and `account.accountLinking` needs `{enabled: true, requireLocalEmailVerified: false}`) remain unresolved and are not this plan's scope — they belong to whichever plan writes `sso-login.spec.ts`/`sso-account-merge.spec.ts`.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/auth/logout-route-guard.spec.ts
- FOUND: commit a0c0262 (Task 1)
- FOUND: .planning/phases/13-authentication-session-e2e/13-05-SUMMARY.md
