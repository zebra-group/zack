---
phase: 12-redirect-handler-e2e-core-value
plan: 04
subsystem: testing
tags: [playwright, fastify, e2e, bot-detection, utm, redirect]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: apps/e2e harness (Prisma client subpath, baseline seed, compose stack, smoke Playwright project)
  - phase: 12-redirect-handler-e2e-core-value (plan 01)
    provides: Empirical proof that Playwright's APIRequestContext delivers a caller-supplied Host header unmodified to Fastify
  - phase: 12-redirect-handler-e2e-core-value (plan 02)
    provides: "apps/e2e/src/links.ts — createE2eLink, BROWSER_UA, BOT_UA, CANARY_TARGET, assertNoLeak"
  - phase: 12-redirect-handler-e2e-core-value (plan 03)
    provides: "apps/e2e/src/links.ts's fetchWithFixtureRaceRetry — shared cross-file truncate-race retry helper"
provides:
  - "apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts — REDIRECT-E2E-04 bot/OG branching, gate-respect, no-leak, proven over real HTTP"
  - "apps/e2e/tests/smoke/redirect-utm-merge.spec.ts — REDIRECT-E2E-05 UTM + forwardQuery merge with exact canonical ordering, proven over real HTTP"
affects: [12-05-remaining-redirect-e2e-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-HTTP re-proof of an already fastify.inject-proven guarantee: mirror redirect.integration.test.ts's exact fixture/assertion vocabulary (BOT_UA/BROWSER_UA, CANARY_TARGET, assertNoLeak, the exact og:title/description/image content-attribute strings, the exact canonical UTM ordering) instead of re-deriving it"
    - "Reused fetchWithFixtureRaceRetry (12-03) for every fixture-creating test in both spec files, per this plan's own <important_note> instruction, to avoid re-discovering the same db-isolation.spec.ts cross-file Link-table-truncate race"

key-files:
  created:
    - apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts
    - apps/e2e/tests/smoke/redirect-utm-merge.spec.ts
  modified: []

key-decisions:
  - "Both specs reuse the SAME slug across the bot-hit and browser-hit assertions in the bot-vs-human test (rather than two separate Links) to prove the SAME link genuinely branches on User-Agent alone, not on any other fixture difference between the two requests."
  - "No new fixture helper additions were needed — apps/e2e/src/links.ts's existing createE2eLink, BOT_UA, BROWSER_UA, CANARY_TARGET, assertNoLeak, and fetchWithFixtureRaceRetry (all already exported by 12-02/12-03) cover every fixture and assertion this plan's two specs require verbatim."

patterns-established: []

requirements-completed: [REDIRECT-E2E-04, REDIRECT-E2E-05]

coverage:
  - id: D1
    description: "A bot UA on a link with custom OG values gets 200 with those exact og:title/description/image values, no Location header, and never leaks the real target; the same slug with a browser UA gets a real 302 to the exact target"
    requirement: "REDIRECT-E2E-04"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts — 'bot UA gets 200 custom OG (never Location, never target); browser UA gets a real 302 to the exact target', run live via pnpm --filter @kurzly/e2e test against the built compose image"
        status: pass
    human_judgment: false
  - id: D2
    description: "A bot hit on a PASSWORD-PROTECTED link with custom OG still gets 200 with those values, never the password page, never the target"
    requirement: "REDIRECT-E2E-04"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts — 'a bot hit on a PASSWORD-PROTECTED link with custom OG still gets 200 with those values, never the password page, never the target', run live"
        status: pass
    human_judgment: false
  - id: D3
    description: "A bot hit on an EXPIRED link with custom OG still gets 200 with those values, never the expiry page, never the target"
    requirement: "REDIRECT-E2E-04"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts — 'a bot hit on an EXPIRED link with custom OG still gets 200 with those values, never the expiry page, never the target', run live"
        status: pass
    human_judgment: false
  - id: D4
    description: "Owner UTM (utm_source/utm_medium/utm_campaign) and a visitor's request-time query param both appear on the final Location, in canonical order (utm_source, utm_medium, utm_campaign, then appended visitor keys)"
    requirement: "REDIRECT-E2E-05"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-utm-merge.spec.ts — 'owner UTM + visitor query merge correctly, in canonical order, on the final Location', run live"
        status: pass
    human_judgment: false
  - id: D5
    description: "The owner's UTM parameter overrides a stale same-named key already present on the stored target's own query string (D-08-02)"
    requirement: "REDIRECT-E2E-05"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-utm-merge.spec.ts — 'owner's UTM parameter overrides a stale same-named key already on the stored target (D-08-02)', run live"
        status: pass
    human_judgment: false
  - id: D6
    description: "forwardQuery off: a visitor's request-time query param is NOT forwarded to the target"
    requirement: "REDIRECT-E2E-05"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/redirect-utm-merge.spec.ts — 'forwardQuery off: a visitor's request-time query param is NOT forwarded to the target', run live"
        status: pass
    human_judgment: false
  - id: D7
    description: "Both new specs stay green alongside the full existing Phase 11/12 smoke + authed suite (per-wave-merge gate)"
    verification:
      - kind: e2e
        ref: "pnpm --filter @kurzly/e2e test (full suite) — 33/34 passed; the one failure (boot.spec.ts, a literal-port-3000 assertion) is the pre-existing local-port-remap artifact documented in 12-01/12-02/12-03-SUMMARY.md, not a regression"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-24
status: complete
---

# Phase 12 Plan 04: Bot/OG Branching + UTM/Query Merge E2E Summary

**Re-proved REDIRECT-E2E-04 (bot/OG branching, gate-respect, no-leak) and REDIRECT-E2E-05 (owner UTM + visitor query merge, exact canonical ordering) over real HTTP against the built compose image — zero application code touched.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-24T20:46:24Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- Wrote `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts`: a bot-vs-human test (same slug, custom OG values — bot UA gets 200 with the exact `og:title`/`og:description`/`og:image` content strings and no `Location`, browser UA gets a real 302 to the exact target), a bot+protected test (200 custom-OG, never the password page, never the target), and a bot+expired test (200 custom-OG, never the expiry page, never the target).
- Wrote `apps/e2e/tests/smoke/redirect-utm-merge.spec.ts`: a merge test (owner UTM `flyer`/`print`/`sommer` + visitor's `extra=1` both present in canonical `utm_source`→`utm_medium`→`utm_campaign`→`extra` order, asserted both via `URLSearchParams.get` and via `location.search.indexOf` ordering), an owner-UTM-overrides-stale-target-key test (D-08-02), and a forwardQuery-off test (visitor param not forwarded).
- Every request in both files pins `Host: e2e.kurzly.local` (never `localhost`, per CR-07) and an explicit `BOT_UA`/`BROWSER_UA` (never Playwright's own default UA, which is bot-classified by the installed `isbot@5.2.0`).
- Reused `fetchWithFixtureRaceRetry` from `apps/e2e/src/links.ts` (added in 12-03) for every fixture-creating test in both files, per this plan's own `<important_note>` — no new race-handling logic needed.
- Ran each spec file scoped in isolation first (both fully green), then ran the full existing E2E suite as the per-wave-merge gate.
- `pnpm --filter @kurzly/e2e typecheck` clean throughout.

## Task Commits

Each task was committed atomically:

1. **Task 1: REDIRECT-E2E-04 bot/OG branching, gate-respect, no-leak spec** - `21e4124` (test)
2. **Task 2: REDIRECT-E2E-05 UTM + query merge spec, exact ordering** - `4565a7c` (test)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts` - REDIRECT-E2E-04 bot/OG branching + gate-respect + no-leak, real HTTP.
- `apps/e2e/tests/smoke/redirect-utm-merge.spec.ts` - REDIRECT-E2E-05 UTM + forwardQuery merge with exact canonical ordering, real HTTP.

## Live Verification (per the plan's `<important_note>`)

This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in 12-01/12-02/12-03-SUMMARY.md (unrelated projects `product-catalog`, `zbr-brain-postgres-1`, `ddev-router`). Followed the identical pattern:

1. Created an **uncommitted** `docker-compose.e2e.local-ports.override.yml` (`!override`-tagged `db: 15433:5432`, `app: 13000:3000` + `BASE_URL: http://localhost:13000`, `mailpit: 18025:8025`/`1025:1025`).
2. Booted under `docker compose -p kurzly-e2e-p12 -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml -f docker-compose.e2e.local-ports.override.yml up -d --wait` — all three containers healthy.
3. Ran Task 1's file scoped: 5/5 passed (2 `setup` auth round-trips + all 3 spec assertions).
4. Committed Task 1.
5. Ran Task 2's file scoped: 5/5 passed.
6. Ran `pnpm --filter @kurzly/e2e typecheck` — clean.
7. Committed Task 2.
8. Ran the **full suite** as the per-wave-merge gate: 33/34 passed — only the pre-existing `boot.spec.ts` literal-port-3000 assertion failed (expected local-port-remap artifact, already documented in 12-01/12-02/12-03-SUMMARY.md, not a regression).
9. Tore the stack down fully (`down -v --remove-orphans`), deleted the override file and the auto-generated `.env`, confirmed via `git status`/`docker ps` that the working tree and every other project's containers were left exactly as found.

**Result: PROVEN LIVE** against the built image.

## Decisions Made

- Both specs mirror `apps/api/test/redirect.integration.test.ts`'s exact assertion vocabulary (`BOT_UA`/`BROWSER_UA`, `CANARY_TARGET`, `assertNoLeak`, the exact `og:title"/og:description"/og:image"` content-attribute strings, the exact canonical UTM ordering) rather than re-deriving new constants — consistent with 12-RESEARCH.md's core recommendation.
- The bot-vs-human test reuses the SAME slug/Link for both the bot-UA and browser-UA requests, proving the branch is driven purely by `User-Agent`, not by any incidental fixture difference between two separate Links.
- No changes to `apps/e2e/src/links.ts` were needed — every fixture and assertion helper this plan's two specs required (`createE2eLink`, `BOT_UA`, `BROWSER_UA`, `CANARY_TARGET`, `assertNoLeak`, `fetchWithFixtureRaceRetry`) already existed from 12-02/12-03.

## Deviations from Plan

None — plan executed exactly as written. No application code (`apps/api/src`) touched.

## Known Stubs

None — both specs assert real behavior against real HTTP responses with no placeholder/mock data paths.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Both specs exercise existing, already-threat-modeled surface (T-12-BOT-LEAK, T-12-OPENREDIR from this plan's own `<threat_model>`), which the coverage table above documents as verified.

## Issues Encountered

- Same pre-existing Docker port conflicts on `3000`/`5433`/`8025` as 12-01/12-02/12-03 (unrelated projects `product-catalog`, `zbr-brain-postgres-1`, `ddev-router`) — resolved identically via the alternate-project-name + uncommitted `!override` port-remap pattern, torn down fully afterward.
- No cross-file DB race was hit during this plan's live verification runs (the `fetchWithFixtureRaceRetry` wrapping already applied preemptively per the plan's `<important_note>` proved sufficient — no retry was actually needed in any of the observed runs, but the safety net is in place for future concurrent runs).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts` and `apps/e2e/tests/smoke/redirect-utm-merge.spec.ts` are both green, real-HTTP-proven against the built compose image. REDIRECT-E2E-04 and REDIRECT-E2E-05 are closed. 12-05 (the remaining Wave 2 sibling, per ROADMAP) can proceed with no blockers — the shared fixture vocabulary (`apps/e2e/src/links.ts`) required no changes and is fully stable across 12-02 through 12-04.

---
*Phase: 12-redirect-handler-e2e-core-value*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts
- FOUND: apps/e2e/tests/smoke/redirect-utm-merge.spec.ts
- FOUND: commit 21e4124
- FOUND: commit 4565a7c
