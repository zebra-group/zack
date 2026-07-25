---
phase: 16-analytics-e2e
plan: 03
subsystem: testing
tags: [playwright, e2e, analytics, click-tracking, prisma, fastify, vue]

requires:
  - phase: 12-redirect-handler-e2e-core-value
    provides: createE2eLink/BROWSER_UA fixture vocabulary, real-HTTP-click-against-redirect-handler pattern
  - phase: 06 (v1.0)
    provides: recordClickHook (ClickEvent + lifetimeClicks transaction), getGlobalAnalytics (server-side SQL GROUP BY rollup), AnalyticsView.vue global overview
  - phase: 16-01
    provides: analytics-real-click.spec.ts precedent (whole-test retries:2, chromium-admin scoping, fresh-navigation-before-assert discipline)
  - phase: 16-02
    provides: analytics-tracking-off.spec.ts precedent (same fixture vocabulary, no new helpers needed)
provides:
  - ANALYTICS-E2E-03 e2e proof — the global cross-link analytics overview correctly rolls up numbers from multiple links
affects: [17-team-authz-e2e]

tech-stack:
  added: []
  patterns:
    - "Multi-link click distribution (nA=3, nB=2) generated strictly before a single fresh navigation, keeping both links deterministically inside topLinks' ORDER BY clicks DESC LIMIT 5 under concurrent baseline-domain noise"
    - "Global-tile assertion via toBeGreaterThanOrEqual (monotonic contribution), never exact equality, when the underlying query sums across a shared domain scope"

key-files:
  created:
    - apps/e2e/tests/authed/analytics-global-rollup.spec.ts
  modified: []

key-decisions:
  - "Reused createE2eLink/BROWSER_UA/createE2ePrisma/BASELINE_DOMAIN_HOSTNAME verbatim from 16-01/16-02 — no new apps/e2e/src/*.ts fixture helper needed"
  - "Adopted the same whole-test test.describe.configure({ retries: 2 }) pattern as 16-01/16-02/qr-dynamic-remap.spec.ts instead of fetchWithFixtureRaceRetry, since two fixture Links are shared across the generate->navigate->assert sequence"
  - "Per-link Top Links rows scoped by unique slug (deterministic, exact equality); the global 'Klicks (30 Tage)' tile asserted only with toBeGreaterThanOrEqual — never exact equality — per 16-RESEARCH.md Open Question 2 (getGlobalAnalytics sums ALL ClickEvents on the shared baseline domain, so concurrent specs contribute to the same tile)"

patterns-established: []

requirements-completed: [ANALYTICS-E2E-03]

coverage:
  - id: D1
    description: "Real HTTP GETs against the public /:slug redirect endpoint (host + BROWSER_UA headers, maxRedirects:0, each asserted 302) distributed 3 clicks on link A and 2 on link B — never seeded ClickEvent rows"
    requirement: ANALYTICS-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-global-rollup.spec.ts#global overview rolls up per-link click counts across multiple links"
        status: pass
    human_judgment: false
  - id: D2
    description: "Direct-Prisma per-link counts are exact (linkA===3, linkB===2), proving correct per-link attribution across multiple distinct links"
    requirement: ANALYTICS-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-global-rollup.spec.ts#global overview rolls up per-link click counts across multiple links"
        status: pass
    human_judgment: false
  - id: D3
    description: "A fresh /analytics navigation (after the clicks) renders the .top-links-row rows, scoped by each link's unique slug, with the exact per-link counts (3 and 2) — the server-side cross-link GROUP BY rollup in getGlobalAnalytics, never a client-side sum"
    requirement: ANALYTICS-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-global-rollup.spec.ts#global overview rolls up per-link click counts across multiple links"
        status: pass
    human_judgment: false
  - id: D4
    description: "The global 'Klicks (30 Tage)' .stat-value tile is asserted with toBeGreaterThanOrEqual(nA+nB), never exact equality, since getGlobalAnalytics sums across ALL links on the shared baseline domain (concurrent specs contribute too)"
    requirement: ANALYTICS-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-global-rollup.spec.ts#global overview rolls up per-link click counts across multiple links"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-07-25
status: complete
---

# Phase 16 Plan 03: Analytics E2E — Global Rollup Summary

**ANALYTICS-E2E-03 proved live: real HTTP clicks distributed 3/2 across two distinct Links surface with their exact per-link counts in the server-aggregated "Top Links" list of the global `/analytics` overview, DB-and-UI cross-checked, with the global "Klicks (30 Tage)" tile monotonically reflecting the multi-link contribution — zero application code changes.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-25T07:00:00Z
- **Completed:** 2026-07-25T07:59:35Z
- **Tasks:** 1 completed
- **Files modified:** 1 (new spec file)

## Accomplishments

- Authored `apps/e2e/tests/authed/analytics-global-rollup.spec.ts`, proving ANALYTICS-E2E-03 through the real network stack: 5 genuine `request.get('/${slug}', {...})` calls (3 on link A, 2 on link B) against the built compose image's redirect handler, never a seeded `ClickEvent` row.
- Confirmed live that `getGlobalAnalytics`'s raw-SQL `GROUP BY`/`JOIN` `topLinks` query correctly rolls up EACH link's exact click count into the "Top Links" list — a genuine server-side cross-link aggregation, not a client-side reduce (`AnalyticsView.vue` renders the DTO verbatim, as 16-RESEARCH.md documented).
- Cross-checked the per-link UI assertions (`.top-links-row[hasText="/slugA"] .row-count === "3"`, same for slugB `=== "2"`) against direct-Prisma `clickEvent.count` scoped to each linkId — both independently confirm the same real, correctly-attributed writes.
- The global "Klicks (30 Tage)" tile was asserted only with `toBeGreaterThanOrEqual(5)` — never exact equality — closing 16-RESEARCH.md's Open Question 2: `getGlobalAnalytics` sums ClickEvents across the ENTIRE shared baseline domain, so concurrent specs/db-isolation churn make an exact global total inherently non-deterministic.
- Zero `apps/api`/`apps/web` diffs — this plan is pure test-authoring against already-shipped Phase 6 logic, as 16-RESEARCH.md anticipated. This closes Phase 16 (all three plans complete).

## Task Commits

Each task was committed atomically:

1. **Task 1: ANALYTICS-E2E-03 — cross-link clicks roll up in the global overview (chromium-admin)** - `76cd7c9` (test)

_No TDD RED→GREEN cycle was needed — no application bug was found; this is a pure re-proof of existing, already-correct Phase 6 behavior (`getGlobalAnalytics`'s server-side SQL rollup) at the E2E layer, per 16-RESEARCH.md's Summary._

## Files Created/Modified

- `apps/e2e/tests/authed/analytics-global-rollup.spec.ts` - ANALYTICS-E2E-03 spec: 3+2 real redirect clicks across two distinct links → global `/analytics` overview → per-link Top Links rows exact-matched, global tile monotonic-checked, DB cross-checked, scoped to `chromium-admin`

## Decisions Made

- Reused `createE2eLink`/`BROWSER_UA`/`createE2ePrisma`/`BASELINE_DOMAIN_HOSTNAME` verbatim from `apps/e2e/src/links.ts`/`db.ts` — no new fixture helper file was needed, confirming 16-RESEARCH.md's Wave 0 assessment held true across all three of this phase's plans.
- Used distinct, comparatively high click counts (nA=3, nB=2) per the plan's guidance — keeps both fixture links deterministically inside `topLinks`' `ORDER BY clicks DESC LIMIT 5` under concurrent baseline-domain noise, and lets the two rows be told apart unambiguously.
- Generated clicks sequentially (not concurrently) — the `visitorHash` derivation is irrelevant to this proof, and sequential keeps the per-link counts unambiguous with no risk of interleaved writes complicating the assertion.
- Adopted `qr-dynamic-remap.spec.ts`'s/16-01's/16-02's whole-test `test.describe.configure({ retries: 2 })` pattern (rather than `fetchWithFixtureRaceRetry`) because this spec's TWO fixture Links are shared across the generate→navigate→assert sequence, which a single retryable closure cannot wrap (same WR-01 tradeoff those specs document).
- Scoped the test to `chromium-admin` only via a `test.beforeEach` skip — member/domain-scoped analytics authorization is explicitly Phase 17's job (AUTHZ-E2E-01), per 16-CONTEXT.md's Deferred Ideas.

## Deviations from Plan

None — plan executed exactly as written. No application code changes were needed; the plan's own acceptance criterion ("passes green against the built compose image; zero apps/api / apps/web diffs") held true on first live run, and the exact selectors documented in the plan's `read_first` (`.top-links-row`, `.row-count`, `.stat-card` + `hasText`) matched `AnalyticsView.vue`'s actual markup verbatim.

## Issues Encountered

**Live-verification-only environment friction (not a code or spec defect):**

- Ports 3000/5433/8025/9000 were already occupied on this machine by unrelated local services (other Docker projects). Resolved with the same session-scratch, non-committed `docker-compose.e2e.portremap.yml` overlay pattern 16-01/16-02 documented (Compose v5's `ports: !override` merge directive at the service-key level, remapped to 3001/5434/8035/9001 plus matching `BASE_URL` override on `app`). Deleted after this session, never committed; `scripts/e2e-compose.sh` itself untouched.
- Repeated consecutive Playwright invocations against ONE long-lived compose stack (while iterating on the required full-`tests/authed/`-directory verification passes) twice reproduced the exact "3rd/4th-consecutive-invocation stack-reuse flake" already documented in STATE.md for Phase 13/16-01/16-02 — `auth.setup.ts` itself timed out waiting for the post-login Dashboard nav link. Resolved each time by tearing down and booting a fresh stack before re-running.
- Running the FULL `tests/authed/` directory (not just this plan's own spec) surfaced the SAME pre-existing, unrelated flakiness 16-02-SUMMARY.md already logged in `links-crud.spec.ts`, `qr-static-customize-decode.spec.ts`, and `storage-state.spec.ts` (chromium-member) — all page-navigation/element-not-found timeouts in sibling spec files, out of this plan's scope boundary (not caused by, or related to, `analytics-global-rollup.spec.ts`, which passed cleanly in every single run: the isolated-spec run, the fresh-stack full-directory run at default parallelism (10 passed / 3 pre-existing failures / 9 skipped), and the fresh-stack full-directory run at `--workers=1` (12 passed / 1 pre-existing failure / 9 skipped)). Not modified — deferred, per scope-boundary discipline (see Deferred Issues below).
- Docker Desktop's build cache/volumes had ample free space this session (`docker system df` showed 3.29GB reclaimable images / 646.8MB volumes at start) — no `docker builder prune` was needed, unlike 16-02's session.

## Deferred Issues

The following pre-existing, sibling-spec flakes are out of this plan's scope (not caused by, or touched by, `analytics-global-rollup.spec.ts`) and were observed again this session, consistent with 16-02-SUMMARY.md's identical finding:

- `links-crud.spec.ts` (`chromium-admin`) — intermittent element-not-found under repeated/full-directory runs.
- `qr-static-customize-decode.spec.ts` (`chromium-admin`) — `.link-slug` not found intermittently under repeated/full-directory runs.
- `storage-state.spec.ts` (`chromium-member`) — `expect(page).toHaveURL("/")` intermittently receives `/team` instead (a member-role landing-page behavior, reproduced consistently across both the default-parallelism and `--workers=1` fresh-stack runs this session — this looks more persistent than the other two, but is still unrelated to any file this plan touched and is explicitly out of scope per the executor's scope-boundary rule).

None of these block ANALYTICS-E2E-03 or Phase 16's closure; they are logged here for Phase 17 (or a dedicated stabilization pass) to investigate.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ANALYTICS-E2E-03 is closed — Phase 16 (Analytics E2E) is now complete (16-01, 16-02, 16-03 all green). The E2E harness's `createE2eLink`/`BROWSER_UA`/`createE2ePrisma` fixture vocabulary proved sufficient across all three plans with zero new helper files. The compose stack was fully torn down (containers, volumes, session-built images, scratch `.env`/port-remap override all removed) before handoff. Phase 17 (Team Authz E2E) can proceed; the `storage-state.spec.ts` chromium-member flake noted above may be worth a first look there since it touches the same member-role navigation surface.

---

*Phase: 16-analytics-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/analytics-global-rollup.spec.ts
- FOUND: commit 76cd7c9
