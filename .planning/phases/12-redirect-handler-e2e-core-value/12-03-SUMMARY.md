---
phase: 12-redirect-handler-e2e-core-value
plan: 03
subsystem: testing
tags: [playwright, fastify, e2e, redirect, expiry, xss-guard]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: apps/e2e harness (Prisma client subpath, baseline seed, compose stack, smoke Playwright project)
  - phase: 12-redirect-handler-e2e-core-value (plan 01)
    provides: Empirical proof that Playwright's APIRequestContext delivers a caller-supplied Host header unmodified to Fastify
  - phase: 12-redirect-handler-e2e-core-value (plan 02)
    provides: "apps/e2e/src/links.ts — createE2eLink, BROWSER_UA, BOT_UA, CANARY_TARGET, assertNoLeak"
provides:
  - "apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts — REDIRECT-E2E-01 happy path + reflected-XSS-guard, proven over real HTTP"
  - "apps/e2e/tests/smoke/redirect-expiry.spec.ts — REDIRECT-E2E-03 (410 vs 404, no-leak, expiry-beats-password D-14), proven over real HTTP"
  - "apps/e2e/src/links.ts's fetchWithFixtureRaceRetry — a shared cross-file-truncate-race retry helper every future Link-creating + real-HTTP feature spec in this phase can reuse"
affects: [12-04-bot-og-branching, 12-05-utm-merge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-HTTP re-proof of an already fastify.inject-proven guarantee: mirror the integration test's exact fixture/assertion vocabulary (CANARY_TARGET, assertNoLeak, BROWSER_UA) instead of re-deriving it, adapted to Playwright's APIRequestContext shape (response.headers()/.text() instead of inject's synchronous body/headers)"
    - "fetchWithFixtureRaceRetry: retry a 'create a fresh fixture + real HTTP round-trip' cycle with a BRAND-NEW slug per attempt when a sibling fullyParallel spec file's shared-table TRUNCATE races the fixture's visibility to the app server's own DB connection — a connection-agnostic fix where a transaction-scoped advisory lock cannot help (the app server can't see an uncommitted row held open in another connection's transaction)"

key-files:
  created:
    - apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts
    - apps/e2e/tests/smoke/redirect-expiry.spec.ts
  modified:
    - apps/e2e/src/links.ts

key-decisions:
  - "Every request in both specs pins Host: e2e.kurzly.local (never localhost, CR-07) and an explicit BROWSER_UA (Playwright's own default UA is bot-classified by the installed isbot@5.2.0) — mirrors 12-RESEARCH.md Pitfalls 1/2 exactly."
  - "Rule 1 bug fix: apps/e2e/tests/smoke/db-isolation.spec.ts's 6 concurrent withResetDbLock cycles TRUNCATE the shared Link table from a DIFFERENT spec file under fullyParallel — a plain createE2eLink + immediate HTTP GET can lose its just-created row to that sibling file's truncate/reseed between the two steps. Discovered empirically running the full-suite per-wave-merge gate (an isolated single-file run never hits this). Fixed by adding fetchWithFixtureRaceRetry to the shared apps/e2e/src/links.ts fixture module (reusable by 12-04/12-05) rather than a transaction-scoped advisory lock, which cannot work here: the created row must be visible to the APP SERVER's own database connection, which cannot see a row still open inside another connection's transaction (Postgres READ COMMITTED)."

patterns-established:
  - "fetchWithFixtureRaceRetry(attempt, isExpected, maxAttempts=3): every Wave 1 feature spec that creates a Link fixture and immediately makes a real HTTP request against it should wrap that cycle in this helper, since db-isolation.spec.ts's aggressive Link-table truncation is a standing, unavoidable race for any Link-creating spec running fullyParallel alongside it."

requirements-completed: [REDIRECT-E2E-01, REDIRECT-E2E-03]

coverage:
  - id: D1
    description: "A slug on e2e.kurzly.local resolves to its exact stored target with a 302 status and exact Location header, proven over real HTTP with maxRedirects:0"
    requirement: "REDIRECT-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts — 'returns 302 with the exact stored target and Cache-Control: no-store', run live via pnpm --filter @kurzly/e2e test against the built compose image"
        status: pass
    human_judgment: false
  - id: D2
    description: "A script-injection slug renders an entity-escaped branded 404 body over real HTTP (reflected-XSS guard)"
    requirement: "V5 input validation"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts — 'a script-injection slug renders an entity-escaped branded 404 body (Reflected-XSS guard, V5)', run live"
        status: pass
    human_judgment: false
  - id: D3
    description: "An expired link returns HTTP 410, no Location header, branded expiry copy, no-store, and no leak of its target"
    requirement: "REDIRECT-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-expiry.spec.ts — 'an expired link returns 410 with no Location and no leak of its target', run live"
        status: pass
    human_judgment: false
  - id: D4
    description: "A guaranteed-missing slug returns a distinct 404, proving 410 != 404 over real HTTP"
    requirement: "REDIRECT-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-expiry.spec.ts — 'a guaranteed-missing slug returns a distinct 404, never the 410 expiry page', run live"
        status: pass
    human_judgment: false
  - id: D5
    description: "An expired AND password-protected link returns 410, never the password page (D-14 expiry-beats-password precedence)"
    requirement: "REDIRECT-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-expiry.spec.ts — 'an expired AND password-protected link returns 410, never the password page (D-14 precedence)', run live"
        status: pass
    human_judgment: false
  - id: D6
    description: "A cross-file DB race (db-isolation.spec.ts's Link-table truncates vs. a fixture-creating real-HTTP spec) is closed via a retry-with-fresh-fixture helper, proven by a clean full-suite run after the fix"
    verification:
      - kind: e2e
        ref: "pnpm --filter @kurzly/e2e test (full suite) — 27/28 passed post-fix, the one remaining failure (boot.spec.ts) is a pre-existing local-port-remap artifact documented in 12-01/12-02-SUMMARY.md, not a regression"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-24
status: complete
---

# Phase 12 Plan 03: Redirect Happy-Path + Expiry E2E Summary

**Re-proved REDIRECT-E2E-01 (happy-path 302 + exact Location + no-store) and REDIRECT-E2E-03 (410 vs 404, no-leak, expiry-beats-password D-14) over real HTTP against the built compose image, plus a reflected-XSS-guard case — and fixed a genuine cross-file DB race (`db-isolation.spec.ts`'s concurrent Link-table truncates vs. a real-HTTP fixture-read) discovered running the full-suite gate.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-24T20:39:49Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Wrote `apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts`: a happy-path test (plain link -> real 302, exact `Location`, `Cache-Control: no-store`) and a reflected-XSS-guard test (`<script>alert(1)</script>` slug -> entity-escaped branded 404, mirroring `apps/api/test/redirect.integration.test.ts`'s exact assertion shapes over real HTTP).
- Wrote `apps/e2e/tests/smoke/redirect-expiry.spec.ts`: an expiry test (410, no `Location`, branded copy, `no-store`, `assertNoLeak`), a distinct-404 test (guaranteed-missing slug, proving 410 ≠ 404 over real HTTP), and the D-14 expiry-beats-password precedence test (expired+protected link -> 410, never the password page).
- Every request in both files pins `Host: e2e.kurzly.local` (never `localhost`, per CR-07) and the shared `BROWSER_UA` constant from `apps/e2e/src/links.ts` (Playwright's own default UA is itself bot-classified by the installed `isbot@5.2.0`).
- Ran each spec file scoped in isolation first (both green), then ran the full existing E2E suite as the per-wave-merge gate and discovered a genuine, reproducible cross-file DB race (see Deviations below); fixed it, then re-ran the full suite green.
- `pnpm --filter @kurzly/e2e typecheck` clean throughout.

## Task Commits

Each task was committed atomically:

1. **Task 1: REDIRECT-E2E-01 happy-path + reflected-XSS-guard spec** - `fb4a12d` (test)
2. **Task 2: REDIRECT-E2E-03 expiry spec + cross-file race fix** - `8aee460` (test)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts` - REDIRECT-E2E-01 happy path + reflected-XSS-guard case, real HTTP.
- `apps/e2e/tests/smoke/redirect-expiry.spec.ts` - REDIRECT-E2E-03 (410 vs 404, no-leak, expiry-beats-password D-14), real HTTP.
- `apps/e2e/src/links.ts` - Added `fetchWithFixtureRaceRetry`, a shared retry helper closing the cross-file Link-table-truncate race (see Deviations).

## Live Verification (per the plan's `<important_note>`)

This dev machine has unrelated Docker containers bound to the canonical E2E ports (`3000` — an unrelated `product-catalog` dev server, `5433` — `zbr-brain-postgres-1`, `8025` — `ddev-router`'s published range), matching exactly what 12-01-SUMMARY.md and 12-02-SUMMARY.md already document. Followed the identical pattern:

1. Created an **uncommitted** `docker-compose.e2e.local-ports.override.yml` (`!override`-tagged `db: 15433:5432`, `app: 13000:3000` + `BASE_URL: http://localhost:13000`, `mailpit: 18025:8025`/`1025:1025`).
2. Booted under `docker compose -p kurzly-e2e-p12 -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml -f docker-compose.e2e.local-ports.override.yml up -d --wait` — all three containers healthy.
3. Ran Task 1's file scoped: 4/4 passed (2 `setup` auth round-trips + both spec assertions).
4. Committed Task 1.
5. Ran Task 2's file scoped: 5/5 passed.
6. Ran the **full suite** as the per-wave-merge gate: 2 failures — the pre-existing `boot.spec.ts` port-literal artifact (expected, documented in 12-01/12-02) **and** `redirect-slug-redirect.spec.ts`'s happy-path test failing with `404` instead of `302` (see Deviations — a genuine, newly-discovered cross-file race).
7. Fixed the race (see Deviations), re-ran the full suite: 27/28 passed, only the pre-existing `boot.spec.ts` port-literal failure remained — confirmed clean.
8. Tore the stack down fully (`down -v --remove-orphans`), deleted the override file and the auto-generated `.env`, confirmed via `git status`/`docker ps` that the working tree and every other project's containers were left exactly as found.

**Result: PROVEN LIVE** against the built image, including the fix for a race this session discovered.

## Decisions Made

- Both specs mirror `apps/api/test/redirect.integration.test.ts`'s exact assertion vocabulary (`CANARY_TARGET`, `assertNoLeak`, `BROWSER_UA`, branded-copy string markers) rather than re-deriving new constants — consistent with 12-RESEARCH.md's core recommendation.
- The reflected-XSS-guard test and the distinct-404 test intentionally create no Link fixture (a guaranteed-missing/injected slug needs no seed row), so they are unaffected by the cross-file truncate race and needed no retry wrapping.
- `fetchWithFixtureRaceRetry` lives in the shared `apps/e2e/src/links.ts` module (not duplicated per spec file) since its own header comment already frames it as "the shared fixture helper every feature spec in this phase consumes" — 12-04/12-05 will hit the identical race for any Link-creating real-HTTP test and can reuse this helper directly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-file DB race: `db-isolation.spec.ts`'s concurrent Link-table truncates vs. a real-HTTP fixture read**
- **Found during:** Task 2's per-wave-merge full-suite verification run (the plan's own `<verification>` step: "Per-wave-merge gate: `./scripts/e2e-compose.sh` (full suite) stays green alongside 12-04, 12-05, and Phase 11's smoke specs").
- **Issue:** `apps/e2e/tests/smoke/db-isolation.spec.ts` runs 6 concurrent `withResetDbLock` cycles, each of which `TRUNCATE`s the shared `Link` table (`RESTART IDENTITY CASCADE`) as part of its own reset-before-create discipline (Phase 11, RESEARCH Pattern 3). Because Playwright's `smoke` project runs `fullyParallel`, one of these truncates can fire in the window between `redirect-slug-redirect.spec.ts`'s `createE2eLink` call and its subsequent HTTP `GET` — wiping the just-created row before the app server (a SEPARATE database connection) ever sees it. Observed empirically: `expect(response.status()).toBe(302)` received `404` instead, only when running the FULL suite (never in an isolated single-file run, since nothing else truncates `Link` concurrently in that case).
- **Fix:** A transaction-scoped advisory lock (`withResetDbLock`) cannot fix this directly for an HTTP-round-trip test — the created row must be visible to the APP SERVER's own database connection, which under Postgres's default READ COMMITTED isolation cannot see a row still held open inside a DIFFERENT connection's uncommitted transaction. Instead, added `fetchWithFixtureRaceRetry(attempt, isExpected, maxAttempts=3)` to the shared `apps/e2e/src/links.ts` fixture module: each attempt mints a BRAND-NEW random slug, creates the fixture, and issues the real HTTP request; on an unexpected status, it retries with a completely fresh fixture (so a retry can never collide with a previous attempt's possibly-truncated row). Applied it to all three fixture-creating tests across both spec files (the happy-path 302 test, the expiry 410 test, and the expiry-beats-password 410 test).
- **Files modified:** `apps/e2e/src/links.ts` (new export), `apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts`, `apps/e2e/tests/smoke/redirect-expiry.spec.ts`.
- **Verification:** Re-ran the full suite after the fix — 27/28 passed, only the unrelated pre-existing `boot.spec.ts` port-literal artifact remained (a local-port-remap environmental effect, not a regression, documented in 12-01/12-02-SUMMARY.md).
- **Committed in:** `8aee460` (Task 2 commit — bundled with the expiry spec since the fix was needed to make Task 1's already-committed spec race-free too; Task 1's commit `fb4a12d` predates the discovery, made when the isolated per-file run was the only evidence available).

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** No application code (`apps/api/src`) touched — the fix is entirely test-infrastructure, in the shared fixture module the plan's own RESEARCH already designated for this phase's reuse. No scope creep beyond `apps/e2e`.

## Known Stubs

None — both specs assert real behavior against real HTTP responses with no placeholder/mock data paths.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Both specs exercise existing, already-threat-modeled surface (T-12-LEAK-EXP, T-12-XSS-SLUG from this plan's own `<threat_model>`), which the coverage table above documents as verified.

## Issues Encountered

- Same pre-existing Docker port conflicts on `3000`/`5433`/`8025` as 12-01/12-02 (unrelated projects `product-catalog`, `zbr-brain-postgres-1`, `ddev-router`) — resolved identically via the alternate-project-name + uncommitted `!override` port-remap pattern, torn down fully afterward.
- The genuine cross-file DB race documented above under Deviations — discovered, fixed, and re-verified within this plan's own scope.
- Repeated rapid manual re-invocations of the full suite during verification (beyond what the plan required) tripped the app's own rate limiter on unrelated endpoints (`magic-link`/`get-session`/etc., "retry in 10-11 minutes") — this is the rate limiter working as designed against my own back-to-back manual reruns within a short window, not a bug in this plan's specs; the definitive post-fix full-suite run (27/28 passed) had already completed cleanly before this occurred, so no further action was needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts` and `apps/e2e/tests/smoke/redirect-expiry.spec.ts` are both green, real-HTTP-proven against the built compose image. `apps/e2e/src/links.ts`'s new `fetchWithFixtureRaceRetry` export is available for 12-04 (bot/OG branching) and 12-05 (UTM merge) — both will create Link fixtures and make real HTTP requests, so both should wrap their fixture-creating tests in this helper to avoid re-discovering the same `db-isolation.spec.ts` truncate race. No blockers.

---
*Phase: 12-redirect-handler-e2e-core-value*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts
- FOUND: apps/e2e/tests/smoke/redirect-expiry.spec.ts
- FOUND: apps/e2e/src/links.ts (modified)
- FOUND: commit fb4a12d
- FOUND: commit 8aee460
