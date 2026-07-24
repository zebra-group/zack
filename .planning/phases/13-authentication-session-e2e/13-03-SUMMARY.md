---
phase: 13-authentication-session-e2e
plan: 03
subsystem: testing
tags: [playwright, e2e, better-auth, magic-link, session]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "02"
    provides: "apps/e2e/src/users.ts's createAllowlistedUser, the standalone `auth` Playwright project (no setup dependency, no storageState)"
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: "apps/e2e/src/db.ts (createE2ePrisma), apps/e2e/src/mailpit.ts (findMagicLinkUrl), auth.setup.ts's real-HTTP magic-link round-trip mechanics"
provides:
  - "apps/e2e/tests/auth/magic-link-round-trip.spec.ts: AUTH-E2E-01 — request/Mailpit/open-link/session round trip with an explicit, independent GET /api/auth/get-session assertion"
  - "apps/e2e/tests/auth/magic-link-token-rejection.spec.ts: AUTH-E2E-02 — consumed/DB-expired/malformed magic-link tokens all rejected with zero session created"
affects: ["13-04", "13-05", "13-06", "13-07", "13-08"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fresh, cookie-less BrowserContext (browser.newContext({ baseURL })) for every negative-path navigation, rather than reusing the test's own page/context — proves 'no session' from a genuinely cold client"
    - "Direct Prisma manipulation of better-auth's own `verification.expiresAt` column to deterministically exercise a 15-minute token-expiry rejection with no real wait"
    - "Every negative-path assertion pairs a UI/redirect check with an explicit GET /api/auth/get-session confirmation of an unauthenticated response (13-RESEARCH.md Pitfall 3)"

key-files:
  created:
    - apps/e2e/tests/auth/magic-link-round-trip.spec.ts
    - apps/e2e/tests/auth/magic-link-token-rejection.spec.ts
  modified: []

key-decisions:
  - "Confirmed against the installed better-auth@1.6.23 source (dist/db/internal-adapter.mjs's consumeVerificationValue, dist/db/verification-token-storage.mjs's processIdentifier) that the `verification` table's `identifier` column stores the RAW, unhashed magic-link token — this app configures no magicLink({storeToken}) or verification.storeIdentifier option, so processIdentifier is a no-op passthrough. This is what makes the expired-token case's `prisma.verification.updateMany({ where: { identifier: token }, ... })` target the exact right row with certainty, not a guess."
  - "Also confirmed live in the source that consumeVerificationValue unconditionally DELETES the matching verification row on first use (before checking expiresAt) — so a consumed-token-reuse attempt and a genuinely-expired token both fail via the identical INVALID_TOKEN -> errorCallbackURL redirect path; the malformed-token case fails even earlier since no row is ever found by identifier."
  - "Wrapped the three AUTH-E2E-02 cases in test.describe.serial (not fullyParallel's default) since all three share one seeded email and one top-level Prisma client created in beforeAll/torn down in afterAll — safer than relying on per-worker beforeAll semantics for a small, cheap-to-run file."
  - "browser.newContext() does NOT inherit playwright.config.ts's use.baseURL the way the built-in page/context fixtures do — every fresh negative-path context in the rejection spec explicitly passes { baseURL: baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? \"http://localhost:3000\" } (mirroring smoke/boot.spec.ts's existing fallback-chain convention) so relative navigation and the malformed-token URL both resolve correctly regardless of which host port this run is bound to."

requirements-completed: [AUTH-E2E-01, AUTH-E2E-02]

coverage:
  - id: D1
    description: "Magic-link round trip (request -> Mailpit -> open link) reaches an active session, verified both by the rendered Dashboard nav and independently by GET /api/auth/get-session returning the same user"
    requirement: "AUTH-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/magic-link-round-trip.spec.ts#magic-link round trip: request -> Mailpit -> open link -> active, server-verified session (AUTH-E2E-01) — live compose (kurzly-e2e-p13-03), default parallelism and --workers=1, both green"
        status: pass
    human_judgment: false
  - id: D2
    description: "A consumed (reused) magic-link token is rejected on its second verify attempt, with no session created"
    requirement: "AUTH-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/magic-link-token-rejection.spec.ts#consumed-token reuse is rejected — a second verify attempt creates no session — live compose (kurzly-e2e-p13-03), pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "A DB-expired magic-link token (verification.expiresAt manipulated directly, no real 15-minute wait) is rejected with no session created"
    requirement: "AUTH-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/magic-link-token-rejection.spec.ts#DB-expired token is rejected — no session created (no real 15-minute wait) — live compose (kurzly-e2e-p13-03), pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "A malformed/tampered magic-link token is rejected with no session created"
    requirement: "AUTH-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/magic-link-token-rejection.spec.ts#malformed/tampered token is rejected — no session created — live compose (kurzly-e2e-p13-03), pass"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 03: Magic-Link Round Trip + Token Rejection Summary

**Two new `apps/e2e/tests/auth/` specs prove the full magic-link token lifecycle against the built compose image: the happy round trip reaches a session independently confirmed by `GET /api/auth/get-session`, and consumed/DB-expired/malformed tokens are each rejected with zero session created — every negative case re-verifying session absence server-side, never trusting "an error page appeared" alone.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-25
- **Tasks:** 2/2
- **Files modified:** 2 (both created)

## Accomplishments

- `apps/e2e/tests/auth/magic-link-round-trip.spec.ts` (AUTH-E2E-01) — requests a magic link over real HTTP with the INFRA-06 `x-e2e-bypass` header for a dedicated, never-reused allowlisted email; retrieves it from Mailpit (recipient-scoped `findMagicLinkUrl`); opens it in a real browser; asserts the "Dashboard" nav renders AND `GET /api/auth/get-session` (via `page.request`, sharing the same cookie jar) independently returns `{user: {email}}` for the same address.
- `apps/e2e/tests/auth/magic-link-token-rejection.spec.ts` (AUTH-E2E-02) — three cases, each ending with an explicit `GET /api/auth/get-session` assertion of an unauthenticated (`null`) response from a fresh, cookie-less `BrowserContext`:
  - Consumed-token reuse: the token is consumed once via the test's own page (real session established, verified), then the identical link is rejected on a second, fresh-context attempt.
  - DB-expired token: a fresh link's `verification.expiresAt` row is set to the past directly via Prisma (no real 15-minute wait), then rejected.
  - Malformed/tampered token: a hand-built, never-issued token string is rejected.
- Confirmed empirically against the installed `better-auth@1.6.23` source that the `verification.identifier` column stores the raw token (no hashing configured), and that `consumeVerificationValue` deletes the matching row unconditionally before checking `expiresAt` — grounding exactly why the expiry-manipulation approach works and why consumed/expired both surface the same `INVALID_TOKEN` redirect.

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-E2E-01 — magic-link round trip reaches an active session** - `60f7c93` (feat)
2. **Task 2: AUTH-E2E-02 — consumed / expired / malformed token each rejected, no session** - `e791665` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/auth/magic-link-round-trip.spec.ts` — AUTH-E2E-01, one test, standalone `auth` Playwright project
- `apps/e2e/tests/auth/magic-link-token-rejection.spec.ts` — AUTH-E2E-02, `test.describe.serial` with three tests sharing one seeded email + one top-level Prisma client

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- Read `better-auth@1.6.23`'s installed source directly (not assumed from RESEARCH) to confirm the `verification.identifier` column is the raw, unhashed token — this made the expired-token DB manipulation a certainty rather than a best guess.
- Used `test.describe.serial` for the rejection spec (shared seeded email + Prisma client across all three cases) rather than relying on `fullyParallel`'s per-worker semantics for a small file where sequential execution costs almost nothing.
- Explicitly passed `baseURL` to every `browser.newContext()` call in the rejection spec, since manually created contexts do not inherit `playwright.config.ts`'s `use.baseURL` the way the built-in `page`/`context` fixtures do.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, or blockers required a code fix; both spec files matched their task's action text and acceptance criteria directly.

## Issues Encountered

- **Docker Desktop's build cache was full** (`initdb: error: could not create directory ... No space left on device` when booting the `db` container), unrelated to any code in this plan. Resolved via `docker builder prune -f` (freed ~18GB of build cache — no volumes or running containers touched), then a clean `up -d --wait` succeeded.
- **This dev machine's canonical E2E ports (3000, 5433, 8025) were already bound by unrelated projects** (a `product-catalog` Node dev server on 3000, `zbr-brain-postgres-1` on 5433, `ddev-router` on 8025), same as Phase 12/13-01. Resolved via the established pattern: alternate compose project name (`kurzly-e2e-p13-03`) + an uncommitted `docker-compose.e2e.local-ports.override.yml` remapping `db`->15433, `mailpit`->18025/1025, `app`->13000 (with a matching `BASE_URL` override) via Compose's `!override` merge tag. Port 9000 (`oidc-mock`, required as an `app` health dependency even though this plan doesn't exercise SSO) was free and needed no remap.

## Live Verification (per the plan's `<important_note>`)

1. Built and booted the full 4-service stack (`db`, `mailpit`, `oidc-mock`, `app`) under `kurzly-e2e-p13-03` with the override file above — all four reported healthy.
2. Ran `pnpm --filter @kurzly/e2e exec playwright test tests/auth/magic-link-round-trip.spec.ts tests/auth/magic-link-token-rejection.spec.ts --project=auth` at **default parallelism (2 workers)**: 4/4 tests passed.
3. Re-ran the identical command at **`--workers=1`**: 4/4 tests passed — no DB-isolation/rate-limit collision this pair introduces, per the plan's `<verification>` requirement.
4. Confirmed `pnpm --filter @kurzly/e2e run typecheck` (`tsc --noEmit`) passes clean, and `playwright test --list --project=auth` shows exactly the 4 new tests correctly registered under the standalone `auth` project (no unknown-project errors, no cross-registration into `smoke`/`authed`).
5. Tore the stack down fully (`down -v --remove-orphans`), deleted the two built images, deleted the override file and the scratch `.env`, and confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's 2 new spec files.

**Result: PROVEN LIVE**, both at default parallelism and `--workers=1`, against the built compose image — not just statically reasoned about.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

AUTH-E2E-01 and AUTH-E2E-02 are closed. `apps/e2e/tests/auth/` now has 2 of the phase's 7 spec files; the remaining five (AUTH-E2E-03 through AUTH-E2E-07) can proceed independently — none of them depend on this plan's two files beyond the shared `oidc-mock.ts`/`users.ts`/`db.ts`/`mailpit.ts` vocabulary 13-01/13-02 already established. The carried-forward blocker from 13-01/13-02 (apps/api/src/lib/auth.ts's `genericOAuth` config needs a `scopes: ["openid", "email", "profile"]` fix before AUTH-E2E-04/05's real round trip can pass) remains unresolved and is not this plan's scope.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/auth/magic-link-round-trip.spec.ts
- FOUND: apps/e2e/tests/auth/magic-link-token-rejection.spec.ts
- FOUND: commit 60f7c93 (Task 1)
- FOUND: commit e791665 (Task 2)
- FOUND: .planning/phases/13-authentication-session-e2e/13-03-SUMMARY.md
