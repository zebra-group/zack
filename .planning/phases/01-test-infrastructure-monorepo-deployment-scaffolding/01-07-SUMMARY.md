---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 07
subsystem: ui
tags: [vue, vitest, vue-test-utils, fetch, shared-dto]

# Dependency graph
requires:
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-02)
    provides: Vue app scaffold (App.vue placeholder, Vite dev proxy for /api, @kurzly/shared workspace dependency)
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-06)
    provides: "POST/GET /api/canary Fastify routes (canaryRoute) backed by real Postgres via Prisma"
provides:
  - "apps/web/src/api.ts: typed getCanary()/createCanary() client for /api/canary"
  - "apps/web/src/App.vue: interactive dashboard reading/writing the live PersistenceCanary through the API"
  - "apps/web/test/App.test.ts: component test covering render-on-mount, write-updates-count, and error-state behaviors"
affects: [phase-1-plan-08-compose-smoke, phase-2-ui-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "apps/web/src/api.ts is the single typed fetch boundary for the SPA - components never call fetch() directly, they import from api.ts"
    - "Vitest component tests mock api.ts via vi.mock (transport-mocked), leaving the real browser->API->DB round-trip to the compose smoke test (plan 01-08)"

key-files:
  created:
    - apps/web/src/api.ts
    - apps/web/test/App.test.ts
  modified:
    - apps/web/src/App.vue
    - apps/web/tsconfig.json

key-decisions:
  - "GET /api/canary's actual response shape is { total, latest } (apps/api/src/routes/canary.ts), not the shared CanaryResult DTO ({ token, total }) - api.ts types this accurately as a local CanaryStatus type rather than mis-typing it as CanaryResult; only POST /api/canary returns the true CanaryResult shape."
  - "apps/web/tsconfig.json now includes \"DOM\" in compilerOptions.lib (previously ES2022 only) - the placeholder App.vue never used browser fetch/Response APIs, so this project needed no DOM lib types until this plan introduced the first real fetch() call."

patterns-established:
  - "Components fetch through a typed api.ts client, never inline fetch() - keeps the shared DTO contract and error-handling behavior in one testable place."

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "App.vue loads the live PersistenceCanary count from GET /api/canary on mount and renders it"
    requirement: "INFRA-01"
    verification:
      - kind: unit
        ref: "apps/web/test/App.test.ts#renders the count fetched from GET /api/canary on mount"
        status: pass
    human_judgment: false
  - id: D2
    description: "Clicking the \"Write canary\" button calls POST /api/canary and the rendered total updates to reflect the new count/token"
    requirement: "INFRA-01"
    verification:
      - kind: unit
        ref: "apps/web/test/App.test.ts#writes a new canary via the button and re-renders the incremented total"
        status: pass
    human_judgment: false
  - id: D3
    description: "A network/fetch failure renders a visible error state instead of a blank screen"
    requirement: "INFRA-01"
    verification:
      - kind: unit
        ref: "apps/web/test/App.test.ts#renders a visible error state when the fetch fails"
        status: pass
    human_judgment: false
  - id: D4
    description: "Web app builds and typechecks with the shared CanaryResult DTO consumed from @kurzly/shared"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "pnpm --filter @kurzly/web exec tsc --noEmit && pnpm --filter @kurzly/web build"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-10
status: complete
---

# Phase 1 Plan 07: Interactive Canary Dashboard (Vue -> API) Summary

**Vue dashboard reads the live PersistenceCanary count from `GET /api/canary` on mount and writes new rows via `POST /api/canary` through a typed `api.ts` client, completing the walking skeleton's browser-visible UI slice.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-10T21:37:19Z
- **Completed:** 2026-07-10T21:41:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `apps/web/src/api.ts` provides a typed fetch boundary (`getCanary()`, `createCanary()`) for the SPA — `createCanary()` returns the shared `CanaryResult` DTO from `@kurzly/shared`; `getCanary()` is typed against the route's actual `{ total, latest }` response shape.
- `App.vue` is now a `<script setup>` component that fetches the canary count on mount, exposes a "Write canary" button that POSTs and re-renders the updated `total`/`token`, and shows a visible error message (`role="alert"`) on fetch failure instead of a blank screen.
- `apps/web/test/App.test.ts` covers all three plan-mandated behaviors (render-on-mount, write-updates-count, error-state) using `@vue/test-utils` with `api.ts` mocked via `vi.mock` — fast, deterministic, no real network/DB dependency.
- Full monorepo typecheck (`pnpm run typecheck`) and `@kurzly/web`'s own `tsc --noEmit` + `vite build` + `vitest run` all pass together.

## Task Commits

Each task was committed atomically:

1. **Task 1: API client + interactive canary dashboard component** - `481ec51` (feat)
2. **Task 2: Component test for the live-data interaction** - `7f87151` (test)

**Plan metadata:** _pending final docs commit_

_Note: This plan's tasks are `tdd="true"`, but App.vue/api.ts (Task 1) necessarily preceded the component test (Task 2) since the test mounts the finished component — see Deviations for the TDD-sequencing note._

## Files Created/Modified
- `apps/web/src/api.ts` - Typed `getCanary()`/`createCanary()` fetch client for `/api/canary`
- `apps/web/src/App.vue` - Interactive canary dashboard (replaces the 01-02 placeholder)
- `apps/web/tsconfig.json` - Added `"DOM"` to `compilerOptions.lib` so `fetch`/`Response` typecheck
- `apps/web/test/App.test.ts` - Component test: render-on-mount, write-updates-count, error-state

## Decisions Made
- **`GET /api/canary` typed as a local `CanaryStatus`, not `CanaryResult`:** the plan's task text describes `api.ts` as "returning the shared `CanaryResult` DTO" for both functions, but `apps/api/src/routes/canary.ts`'s GET handler actually returns `{ total, latest }` (no `token` field), while POST returns the true `CanaryResult` (`{ token, total }`). Mistyping GET's response as `CanaryResult` would silently lie about the `token` field's presence. `api.ts` types GET accurately against the real route and only claims the shared DTO where it's actually returned (POST) — this preserves the "UI and API cannot drift" intent of the plan without redefining the API contract, which is out of this plan's scope.
- **Added `"DOM"` to `apps/web/tsconfig.json`'s `lib`:** the placeholder `App.vue` never referenced `fetch`/`Response`, so the workspace-wide `tsconfig.base.json`'s `lib: ["ES2022"]` (no DOM) was sufficient until this plan introduced the first real browser fetch call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `api.ts`'s `getCanary()` typed against the route's real response shape, not `CanaryResult` verbatim**
- **Found during:** Task 1
- **Issue:** The plan describes both `getCanary()` and `createCanary()` as "returning the shared `CanaryResult` DTO", but `GET /api/canary` (built in plan 01-06) returns `{ total, latest }`, not `{ token, total }`. Typing `getCanary()`'s return as `CanaryResult` would be inaccurate (claims a `token` field that never exists on the GET response) and would let the type system silently drift from the real API.
- **Fix:** Introduced a local `CanaryStatus` type (`{ total: number; latest: string | null }`) for `getCanary()`'s return, documented inline why it differs from `CanaryResult`, and kept `createCanary()` typed as the true `CanaryResult` since POST genuinely returns that shape.
- **Files modified:** `apps/web/src/api.ts`
- **Verification:** `tsc --noEmit` passes; component test asserts the rendered `total`/`latest` values match the mocked GET response shape.
- **Committed in:** `481ec51`

**2. [Rule 3 - Blocking] Added `"DOM"` to `apps/web/tsconfig.json`'s `lib`**
- **Found during:** Task 1
- **Issue:** `tsc --noEmit` failed with `Cannot find name 'fetch'`/`'Response'` — the workspace base tsconfig only sets `lib: ["ES2022"]` (no DOM types), which was fine for the placeholder `App.vue` but blocks any component that calls browser `fetch()`.
- **Fix:** Added `"DOM"` to `apps/web/tsconfig.json`'s `compilerOptions.lib` override (app-local, doesn't affect `apps/api` or `packages/shared`).
- **Files modified:** `apps/web/tsconfig.json`
- **Verification:** `pnpm --filter @kurzly/web exec tsc --noEmit` and the full `pnpm run typecheck` (monorepo) both pass.
- **Committed in:** `481ec51`

**3. [Task-level TDD note, not a fix] Task 2's test passed immediately (no RED phase)**
- **Found during:** Task 2
- **Issue:** Task 2 is `tdd="true"` and nominally expects a failing test before implementation, but Task 1 (also `tdd="true"`) necessarily built the full `App.vue`/`api.ts` implementation first — a component test can't meaningfully mount a component that doesn't exist yet. `App.test.ts` therefore passed on its first run.
- **Fix:** No code change needed. This mirrors the same task-decomposition-driven TDD note documented in plan 01-06's summary (Task 3): the plan's own task split (build-then-test-the-built-thing) makes strict per-task RED-before-GREEN inapplicable here; the plan's `type` is `execute`, not `tdd`, so the stricter plan-level RED gate doesn't apply.
- **Files modified:** none
- **Committed in:** `7f87151` (single `test(...)` commit)

---

**Total deviations:** 3 (2 auto-fixed Rule 1/Rule 3, 1 documented TDD-sequencing note)
**Impact on plan:** No scope creep. The `CanaryStatus` typing fix corrects an inaccuracy in the plan's own description of the GET response shape (traced directly to the already-built route in 01-06); the `lib: DOM` addition is a minimal, app-local config fix required for any real fetch call to typecheck. Final behavior matches every acceptance criterion in the plan.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The UI half of the D-01 single-image walking skeleton is complete: the dashboard reads and writes live data through `/api/canary`, consuming the shared `@kurzly/shared` DTO alongside the API (Pitfall 2 addressed).
- The real browser->API->DB round-trip (Vite dev server or the built SPA served by Fastify -> real Postgres) is still unproven end-to-end until plan 01-08's compose smoke test runs the full stack.
- Phase 2's UI dashboard work can follow the established `api.ts`-as-typed-fetch-boundary pattern for its own endpoints, and should note the `GET /api/canary` vs `CanaryResult` shape mismatch if/when `PersistenceCanary` is removed and its routes repurposed.

---
*Phase: 01-test-infrastructure-monorepo-deployment-scaffolding*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 4 created/modified files and both task commit hashes (481ec51, 7f87151) verified present on disk / in git log.
