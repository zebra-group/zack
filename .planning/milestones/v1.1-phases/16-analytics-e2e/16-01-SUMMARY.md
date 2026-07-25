---
phase: 16-analytics-e2e
plan: 01
subsystem: testing
tags: [playwright, e2e, analytics, click-tracking, prisma, fastify, vue]

requires:
  - phase: 12-redirect-handler-e2e-core-value
    provides: createE2eLink/BROWSER_UA fixture vocabulary, real-HTTP-click-against-redirect-handler pattern
  - phase: 06 (v1.0)
    provides: recordClickHook (ClickEvent + lifetimeClicks transaction), getLinkAnalytics, LinkDetailView.vue analytics surface
provides:
  - ANALYTICS-E2E-01 e2e proof — real redirect click surfaces in the per-link analytics view
affects: [17-team-authz-e2e]

tech-stack:
  added: []
  patterns:
    - "Real-HTTP click generation strictly before page.goto (never assert against an already-mounted one-shot-mount-fetch view)"
    - ".stat-card + hasText label scoping for identical-class stat tiles"

key-files:
  created:
    - apps/e2e/tests/authed/analytics-real-click.spec.ts
  modified: []

key-decisions:
  - "Reused createE2eLink/BROWSER_UA verbatim; no new apps/e2e/src/*.ts fixture helper needed for this plan"
  - "Whole-test test.describe.configure({ retries: 2 }) adopted (qr-dynamic-remap.spec.ts precedent) instead of fetchWithFixtureRaceRetry, since the click->navigate->DB-assert sequence shares one fixture across multiple steps that a single retryable closure cannot wrap"

patterns-established: []

requirements-completed: [ANALYTICS-E2E-01]

coverage:
  - id: D1
    description: "A real HTTP GET against the public /:slug redirect endpoint (host + BROWSER_UA headers, maxRedirects:0) on an ungated, tracking-enabled fixture Link returns 302 and synchronously commits a ClickEvent row + Link.lifetimeClicks increment via the fully-awaited recordClickHook transaction"
    requirement: ANALYTICS-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-real-click.spec.ts#real redirect click increments lifetimeClicks and surfaces in the per-link view"
        status: pass
    human_judgment: false
  - id: D2
    description: "A fresh authenticated navigation to /links/:id performed after the click renders the .stat-card 'Klicks gesamt' .stat-value as the incremented count (1), scoped via hasText (never a bare positional .stat-value locator)"
    requirement: ANALYTICS-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-real-click.spec.ts#real redirect click increments lifetimeClicks and surfaces in the per-link view"
        status: pass
    human_judgment: false
  - id: D3
    description: "Direct-Prisma cross-check confirms exactly 1 ClickEvent for the fixture link and Link.lifetimeClicks === 1 — the real tracked write, not a seeded row"
    requirement: ANALYTICS-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/analytics-real-click.spec.ts#real redirect click increments lifetimeClicks and surfaces in the per-link view"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-25
status: complete
---

# Phase 16 Plan 01: Analytics E2E — Real Click Summary

**ANALYTICS-E2E-01 proved live: a real HTTP GET against the public `/:slug` redirect endpoint synchronously commits a ClickEvent + lifetimeClicks increment, surfacing as the "Klicks gesamt" stat on a freshly-navigated `/links/:id` view — zero application code changes.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-25T06:45:00Z
- **Completed:** 2026-07-25T07:31:36Z
- **Tasks:** 1 completed
- **Files modified:** 1 (new spec file)

## Accomplishments
- Authored `apps/e2e/tests/authed/analytics-real-click.spec.ts`, proving ANALYTICS-E2E-01 through the real network stack: a genuine `request.get('/${slug}', { headers: { host, 'user-agent': BROWSER_UA }, maxRedirects: 0 })` against the built compose image's redirect handler, never a seeded `ClickEvent` row.
- Confirmed live (built compose image, real Chromium browser) that `recordClickHook`'s fully-awaited `$transaction` makes the write synchronous relative to the HTTP response — no polling/wait helper was needed, exactly as 16-RESEARCH.md predicted.
- Confirmed live that `LinkDetailView.vue`'s `loadAnalytics()` one-shot mount fetch requires the click to be generated strictly before `page.goto` — the spec follows this discipline and passed clean.
- Cross-checked the UI assertion (`.stat-card[hasText="Klicks gesamt"] .stat-value === "1"`) against a direct-Prisma read (`clickEvent.count === 1`, `lifetimeClicks === 1`) — both independently confirm the same real write.
- Zero `apps/api`/`apps/web` diffs — this plan is pure test-authoring against already-shipped Phase 6 logic, as 16-RESEARCH.md anticipated.

## Task Commits

Each task was committed atomically:

1. **Task 1: ANALYTICS-E2E-01 — real HTTP click surfaces in the per-link analytics view (chromium-admin)** - `9ac336e` (test)

_No TDD RED→GREEN cycle was needed — no application bug was found; this is a pure re-proof of existing, already-correct Phase 6 behavior at the E2E layer, per 16-RESEARCH.md's Summary._

## Files Created/Modified
- `apps/e2e/tests/authed/analytics-real-click.spec.ts` - ANALYTICS-E2E-01 spec: real redirect click → per-link analytics view → DB cross-check, scoped to `chromium-admin`

## Decisions Made
- Reused `createE2eLink`/`BROWSER_UA`/`createE2ePrisma`/`BASELINE_DOMAIN_HOSTNAME` verbatim from `apps/e2e/src/links.ts`/`db.ts` — no new fixture helper file was needed, confirming 16-RESEARCH.md's Wave 0 assessment ("zero new `apps/e2e/src/*.ts` helper files anticipated").
- Adopted `qr-dynamic-remap.spec.ts`'s whole-test `test.describe.configure({ retries: 2 })` pattern (rather than `fetchWithFixtureRaceRetry`) because this spec's fixture Link is shared across the click→navigate→DB-assert sequence, which a single retryable closure cannot wrap (same WR-01 tradeoff that spec documents).
- Scoped the test to `chromium-admin` only via a `test.beforeEach` skip — member/domain-scoped analytics authorization is explicitly Phase 17's job (AUTHZ-E2E-01), per 16-CONTEXT.md's Deferred Ideas.

## Deviations from Plan

None — plan executed exactly as written. No application code changes were needed; the plan's own acceptance criterion ("passes green against the built compose image; zero apps/api / apps/web diffs") held true on first live run.

## Issues Encountered

**Live-verification-only environment friction (not a code or spec defect):**
- Ports 3000 (app), 5433 (db), and 8025 (mailpit) were already occupied on this machine by unrelated local services (other Docker projects, `ddev`). Resolved with a session-scratch, non-committed `docker-compose.e2e.portremap.yml` overlay using Compose v5's `!override` YAML merge directive on the `ports:` key (remapping to 3001/5434/8035/9001) plus matching `BASE_URL`/`OIDC_MOCK_PUBLIC_URL`/`OIDC_MOCK_REDIRECT_URI` env overrides — deleted after this session, never committed, `scripts/e2e-compose.sh` itself untouched.
- Repeated consecutive Playwright invocations against ONE long-lived compose stack (while iterating on live verification and a broader `tests/authed/` sanity run) exhausted the global 100-req/15-min rate-limit bucket for browser-navigated requests (the `x-e2e-bypass` header only covers API-request-context calls in `auth.setup.ts`, not the real `page.goto` navigation to the magic-link verify URL) — an accumulated-state flake, not a defect, matching the identical precedent already logged in STATE.md for Phase 13 ("3rd-consecutive-invocation stack-reuse flake ... resolved by re-running against a freshly booted stack"). Resolved by tearing down and booting one fresh stack, then re-running the two required verification passes (`--project=chromium-admin` and `--workers=1`) cleanly against it — both passed with zero retries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ANALYTICS-E2E-01 is closed. The E2E harness's `createE2eLink`/`BROWSER_UA`/`createE2ePrisma` fixture vocabulary is confirmed sufficient for 16-02 (ANALYTICS-E2E-02, tracking-off zero-rows) and 16-03 (ANALYTICS-E2E-03, cross-link rollup) — no blockers. The compose stack was fully torn down (containers, volumes, session-built images, scratch `.env`/port-remap override all removed) before handoff; 16-02 boots its own fresh stack.

---
*Phase: 16-analytics-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/analytics-real-click.spec.ts
- FOUND: commit 9ac336e
