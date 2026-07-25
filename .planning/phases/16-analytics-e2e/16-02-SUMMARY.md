---
phase: 16-analytics-e2e
plan: 02
subsystem: testing
tags: [playwright, e2e, analytics, click-tracking, prisma, fastify, vue]

requires:
  - phase: 12-redirect-handler-e2e-core-value
    provides: createE2eLink/BROWSER_UA fixture vocabulary, real-HTTP-click-against-redirect-handler pattern
  - phase: 06 (v1.0)
    provides: recordClickHook (trackingEnabled structural early-return guard), LinkDetailView.vue tracking-card `.toggle`
  - phase: 16-01
    provides: analytics-real-click.spec.ts precedent (whole-test retries:2, chromium-admin scoping, fresh-navigation-before-assert discipline)
provides:
  - ANALYTICS-E2E-02 e2e proof — tracking-off via real UI toggle produces a genuine DB-level zero-rows guarantee
affects: [17-team-authz-e2e]

tech-stack:
  added: []
  patterns:
    - "Real-UI toggle PATCH awaited via Promise.all([page.waitForResponse, click]) before generating the click that must observe its effect"
    - "Belt-and-suspenders fresh-Prisma-read confirms a UI-driven mutation actually committed before depending on it in a subsequent step"

key-files:
  created:
    - apps/e2e/tests/authed/analytics-tracking-off.spec.ts
  modified: []

key-decisions:
  - "Used the REAL `.tracking-card .toggle` UI (live updateLink PATCH round-trip) rather than the fixture-only trackingEnabled:false path — per 16-CONTEXT.md's locked 'genuinely settable state' decision and 16-RESEARCH.md Assumption A1's recommendation, this is the stronger proof (fixture-only is already covered by Phase 6 integration tests)"
  - "Reused analytics-real-click.spec.ts's/qr-dynamic-remap.spec.ts's whole-test test.describe.configure({ retries: 2 }) pattern instead of fetchWithFixtureRaceRetry, since the toggle->click->DB-assert sequence shares one fixture Link across multiple steps a single retryable closure cannot wrap"

patterns-established: []

requirements-completed: [ANALYTICS-E2E-02]

coverage:
  - id: D1
    description: "Tracking is turned OFF through the REAL LinkDetailView `.tracking-card .toggle` (role=switch) — a live updateLink PATCH round-trip awaited via Promise.all([page.waitForResponse, click]) — proving a genuinely settable state, not merely a fixture column value"
    requirement: ANALYTICS-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-tracking-off.spec.ts#tracking off via real toggle: redirect still 302s, zero ClickEvent rows written"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real HTTP GET against the now-tracking-off link (host + BROWSER_UA, maxRedirects:0) still returns 302 — tracking-off suppresses only the tracking write, never the redirect"
    requirement: ANALYTICS-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-tracking-off.spec.ts#tracking off via real toggle: redirect still 302s, zero ClickEvent rows written"
        status: pass
    human_judgment: false
  - id: D3
    description: "prisma.clickEvent.count for the link is EXACTLY 0 and Link.lifetimeClicks is unchanged (0) — a true DB-level zero-rows guarantee, asserted at the database"
    requirement: ANALYTICS-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-tracking-off.spec.ts#tracking off via real toggle: redirect still 302s, zero ClickEvent rows written"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-25
status: complete
---

# Phase 16 Plan 02: Analytics E2E — Tracking Off Summary

**ANALYTICS-E2E-02 proved live: turning tracking off through the real `.tracking-card .toggle` UI (an awaited `updateLink` PATCH round-trip) still lets a real redirect click 302 successfully, but writes EXACTLY ZERO `ClickEvent` rows and never increments `Link.lifetimeClicks` — asserted directly at the database.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 1 completed
- **Files modified:** 1 (new spec file)

## Accomplishments
- Authored `apps/e2e/tests/authed/analytics-tracking-off.spec.ts`, proving ANALYTICS-E2E-02 through the REAL toggle-through-UI path (per 16-CONTEXT.md's locked "genuinely settable state" decision), not the weaker fixture-only `trackingEnabled: false` path.
- Confirmed live (built compose image) that the toggle's PATCH commits `trackingEnabled: false` via a belt-and-suspenders fresh-Prisma read BEFORE the click-generating request is issued — proving the redirect handler's per-request fresh link load would otherwise have raced an un-awaited toggle.
- Confirmed live that `recordClickHook`'s structural early-return guard (`if (!link.trackingEnabled) return;`, before any Prisma call) produces a true zero-rows guarantee: `prisma.clickEvent.count === 0` and `Link.lifetimeClicks === 0`, while the redirect itself still returns 302 (tracking-off never breaks the core redirect).
- Zero `apps/api`/`apps/web` diffs — pure test-authoring against already-shipped Phase 6 logic, as 16-RESEARCH.md anticipated.

## Task Commits

1. **Task 1: ANALYTICS-E2E-02 — tracking-off via real toggle, real click, DB-asserted zero rows (chromium-admin)** - `83b960a` (test)

_No TDD RED→GREEN cycle was needed — no application bug was found; this is a pure re-proof of existing, already-correct Phase 6 behavior at the E2E layer._

## Files Created/Modified
- `apps/e2e/tests/authed/analytics-tracking-off.spec.ts` - ANALYTICS-E2E-02 spec: real-UI tracking toggle-off → real redirect click → DB-level zero-rows assertion, scoped to `chromium-admin`

## Decisions Made
- Used the real `.tracking-card .toggle` UI mechanism (awaited via `Promise.all([page.waitForResponse(...PATCH.../api/links/:id...), toggle.click()])`) rather than seeding `trackingEnabled: false` directly through `createE2eLink` — the stronger, CONTEXT.md-mandated proof.
- Added a belt-and-suspenders fresh-Prisma `findUniqueOrThrow` read of `trackingEnabled` immediately after the toggle, confirming the PATCH genuinely committed before the click is generated (the redirect handler loads the link fresh from the DB per request — an un-awaited toggle would have left the guard seeing tracking still enabled).
- Reused `test.describe.configure({ retries: 2 })` + `testInfo.retry` attribution logging (16-01/15-precedent) instead of `fetchWithFixtureRaceRetry`, since the shared fixture spans the toggle→click→DB-assert sequence that a single retryable closure cannot wrap.

## Deviations from Plan

None — plan executed exactly as written. No application code changes were needed; both acceptance criteria ("passes green against the built compose image; zero apps/api / apps/web diffs") held true on first live run.

## Issues Encountered

**Live-verification-only environment friction (not a code or spec defect):**
- Ports 3000/5433/8025/9000 were already occupied on this machine by unrelated local services — resolved with the same session-scratch, non-committed `docker-compose.e2e.portremap.yml` overlay pattern 16-01 documented (remapped to 3001/5434/8035/9001 via Compose v5's `ports: !override` merge directive — applied at the KEY level, not per-list-item, which is the syntax that actually replaces rather than appends the base files' published ports). Deleted after this session, never committed.
- Docker Desktop's VM disk was at 100% capacity (`no space left on device` during Postgres `initdb`) — resolved with `docker builder prune -f`, freeing ~18GB of reclaimable build cache (no images/volumes touched). This is a local environment condition, not a repo or spec issue.
- Running the FULL `tests/authed/` directory (not just this plan's own spec) surfaced pre-existing, unrelated flakiness in `links-crud.spec.ts`, `qr-static-customize-decode.spec.ts`, `storage-state.spec.ts`, and (on a 3rd consecutive invocation against one long-lived stack) `auth.setup.ts` itself — all page-navigation/element-not-found timeouts consistent with the exact "repeated consecutive Playwright invocations against ONE long-lived compose stack" accumulated-state flake already documented in STATE.md for Phase 13 and 16-01. `analytics-tracking-off.spec.ts` itself passed cleanly in every one of these runs, including the full-suite runs — these are out-of-scope pre-existing issues in sibling spec files, not caused by or related to this plan's spec, and were not modified (scope boundary).
- Two required verification passes (`--project=chromium-admin` and `--project=chromium-admin --project=chromium-member --workers=1`) were re-run cleanly against a freshly booted stack and both passed with zero retries, closing out this plan's verification requirement.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ANALYTICS-E2E-02 is closed. 16-03 (ANALYTICS-E2E-03, cross-link rollup) can proceed with the same fixture vocabulary — no blockers. The compose stack was fully torn down (containers, volumes, session-built images retained per Docker's normal build cache, scratch `.env`/port-remap override all removed) before handoff.

---
*Phase: 16-analytics-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/analytics-tracking-off.spec.ts
- FOUND: commit 83b960a
