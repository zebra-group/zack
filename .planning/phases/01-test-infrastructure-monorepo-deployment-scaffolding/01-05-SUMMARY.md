---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 05
subsystem: testing
tags: [vitest, testcontainers, postgres, prisma, prisma-adapter-pg, tdd-harness]

# Dependency graph
requires:
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (plan 02)
    provides: pnpm monorepo scaffold + apps/api Vitest config skeleton
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (plan 03)
    provides: Prisma 7 schema, generated client (src/generated/prisma), PrismaPg driver-adapter wiring
provides:
  - Real-Postgres Vitest globalSetup (one shared testcontainers postgres:18-alpine container, migrated once)
  - provide/inject wiring exposing the container's connection URI to every test file
  - Per-test transaction rollback (BEGIN/ROLLBACK) isolation layer, pinned to a single pooled connection
  - Two green canary tests resolving RESEARCH Assumptions A3 (shared-container semantics) and A4 (rollback isolation under connection pooling)
affects: [02-user-model-auth-magic-link, 03-domain-management-tls-routing, all-later-phases-with-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vitest globalSetup starts ONE shared testcontainers Postgres per `vitest run` invocation (not per worker, not per file) — confirmed empirically via process.pid logs across two different worker processes both hitting the same, once-migrated container."
    - "Per-test isolation via raw BEGIN/ROLLBACK requires pinning the PrismaPg adapter's underlying pg.Pool to `max: 1` — without it, @prisma/adapter-pg's `pool.query()`-per-statement call pattern can route BEGIN and ROLLBACK to different physical connections, silently breaking isolation."

key-files:
  created:
    - apps/api/test/globalSetup.ts
    - apps/api/test/setupFileEach.ts
    - apps/api/test/db.diagnostic.test.ts
    - apps/api/test/tx-isolation.test.ts
  modified:
    - apps/api/vitest.config.ts

key-decisions:
  - "Deviated from RESEARCH Pattern 5's literal code sample (which used `new PrismaClient({ datasourceUrl })`) because this codebase's Prisma 7.8.0 PrismaClientOptions requires an explicit driver `adapter` (see apps/api/src/db.ts) — used `new PrismaPg({ connectionString: inject('dbUrl'), max: 1 })` instead, matching the project's existing adapter-pg pattern."
  - "Proactively pinned the adapter's pg.Pool to max: 1 in setupFileEach.ts rather than building the naive multi-connection version first and waiting for it to fail — inspected @prisma/adapter-pg's type definitions ahead of time, confirmed its PrismaPgAdapter calls pool.query() per statement (acquire+release each call), which is exactly the connection-routing hazard RESEARCH Assumption A4 flagged. The tx-isolation canary (Task 3) still empirically proves this mitigation works rather than assuming it."
  - "Confirmed A3 (RESEARCH Pitfall 5 / Open Question 1): a single globalSetup invocation starts exactly one container for the whole `vitest run`, shared across however many worker processes Vitest spawns for parallel test files — verified by cross-referencing process.pid logs (two different pids, one shared migrated container, only one 'Applying migration' log line across every run)."

patterns-established:
  - "Real-Postgres TDD harness: import `prisma` from apps/api/test/setupFileEach.ts in any integration test needing a real, migrated, per-test-isolated database — no Prisma mocking (D-09)."

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "A real Postgres testcontainer starts under Vitest globalSetup and a raw Prisma query round-trips against it"
    requirement: "INFRA-01"
    verification:
      - kind: integration
        ref: "apps/api/test/db.diagnostic.test.ts#round-trips a raw SELECT 1 against the testcontainers Postgres"
        status: pass
      - kind: integration
        ref: "apps/api/test/db.diagnostic.test.ts#writes and reads back a PersistenceCanary row (confirms migrate deploy ran)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Per-test transaction rollback (BEGIN/ROLLBACK) isolates data between tests"
    requirement: "INFRA-01"
    verification:
      - kind: integration
        ref: "apps/api/test/tx-isolation.test.ts#does not see the previous test's row — proves the rollback isolated it"
        status: pass
    human_judgment: false
  - id: D3
    description: "globalSetup's shared-container semantics (A3) empirically confirmed across multiple Vitest worker processes"
    verification:
      - kind: integration
        ref: "apps/api/test/db.diagnostic.test.ts#logs process.pid once (diagnostic only — empirically confirms A3, single shared container)"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-07-10
status: complete
---

# Phase 1 Plan 5: Real-Postgres TDD Harness Summary

**Vitest globalSetup boots one shared testcontainers `postgres:18-alpine` container, migrates it once, and hands its connection URI to every test via provide/inject; per-test BEGIN/ROLLBACK isolation is pinned to a single pooled connection to survive `@prisma/adapter-pg`'s per-statement pool.query() routing.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3/3 completed
- **Files modified:** 5 (4 created, 1 edited)

## Accomplishments

- Stood up the D-09 real-Postgres TDD harness: `apps/api/test/globalSetup.ts` starts one shared `postgres:18-alpine` testcontainer, runs `prisma migrate deploy` against it, and exposes the connection URI via `project.provide('dbUrl', ...)`.
- `apps/api/test/setupFileEach.ts` wraps every test in a `BEGIN`/`ROLLBACK` transaction, using a `PrismaPg` adapter pinned to `max: 1` pool size so raw transaction statements always share one physical connection.
- Resolved RESEARCH Assumption A3 (shared vs. per-worker container semantics): a single `globalSetup` invocation serves one container to every worker process for the whole `vitest run` — confirmed by `process.pid` logs showing two different worker pids both hitting the same, once-migrated container.
- Resolved RESEARCH Assumption A4 (rollback isolation under connection pooling): the `tx-isolation.test.ts` canary proves a row written in one test is invisible in the next, with the `max: 1` pool-pinning mitigation in place.
- `pnpm --filter @kurzly/api test` runs the full suite (5 files, 15 tests) green end-to-end against a real container, including the pre-existing env/schema-drift/Prisma-generate unit tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Vitest globalSetup + testcontainers wiring + per-test rollback** - `c5660a6` (feat)
2. **Task 2: Real-Postgres diagnostic test (resolves A3)** - `d66d498` (test)
3. **Task 3: Transaction-isolation canary (resolves A4)** - `b14a03c` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/api/test/globalSetup.ts` - Starts the shared testcontainers Postgres, applies the committed migration, provides the connection URI
- `apps/api/test/setupFileEach.ts` - Per-test `PrismaClient`/`PrismaPg` adapter (pool `max: 1`) + `beforeEach`/`afterEach` BEGIN/ROLLBACK, `afterAll` disconnect
- `apps/api/test/db.diagnostic.test.ts` - SELECT 1 + PersistenceCanary round-trip + A3 pid diagnostic
- `apps/api/test/tx-isolation.test.ts` - Two-test isolation canary resolving A4
- `apps/api/vitest.config.ts` - Registers `globalSetup` and `setupFiles`

## Decisions Made

- Used `new PrismaPg({ connectionString: inject('dbUrl'), max: 1 })` instead of RESEARCH Pattern 5's literal `new PrismaClient({ datasourceUrl })` sample, because this codebase's Prisma 7.8.0 requires a driver `adapter` (established in plan 01-03's `apps/api/src/db.ts`).
- Pinned the adapter's `pg.Pool` to `max: 1` proactively (before running the canary), based on inspecting `@prisma/adapter-pg`'s type definitions and confirming its adapter issues one `pool.query()` per statement — the exact hazard RESEARCH Assumption A4 flagged for a pool with more than one connection. The canary still empirically confirms the fix works, rather than the mitigation being assumed correct.
- No `pg` package import needed in `setupFileEach.ts` — passed a structurally-typed plain object (`{ connectionString, max }`) to `PrismaPg`'s constructor rather than adding `pg`/`@types/pg` as an explicit dependency, avoiding an unnecessary phantom-dependency workaround.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug avoidance] Pinned PrismaPg's pool to `max: 1` instead of using RESEARCH Pattern 5's default-pool sample**
- **Found during:** Task 1 (Vitest globalSetup + rollback wiring)
- **Issue:** RESEARCH Pattern 5's literal code (`new PrismaClient({ datasourceUrl: inject('dbUrl') })`) does not type-check against this codebase's Prisma 7.8.0 (`PrismaClientOptions` requires a driver `adapter`, per `apps/api/src/db.ts`). Substituting `@prisma/adapter-pg`'s `PrismaPg` with its default pool would reintroduce the exact "BEGIN routed to connection A, ROLLBACK routed to connection B" hazard RESEARCH Assumption A4 explicitly flagged as unverified.
- **Fix:** Constructed `PrismaPg` with `{ connectionString: inject('dbUrl'), max: 1 }`, pinning the underlying `pg.Pool` to a single physical connection for the lifetime of each test file.
- **Files modified:** `apps/api/test/setupFileEach.ts`
- **Verification:** `apps/api/test/tx-isolation.test.ts` canary passes — a row written in test 1 is confirmed absent in test 2.
- **Committed in:** `c5660a6` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug avoidance, adapter substitution required by an already-established project constraint)
**Impact on plan:** Necessary substitution for correctness; no scope creep. The plan's own Task 3 acceptance criteria (canary must go green) is what verifies this decision, exactly as the plan intended for resolving A4.

## Issues Encountered

None beyond the adapter substitution documented above. Docker was available and running (Docker 29.6.1); container startup + migration took ~5-6s per `vitest run` invocation, well within acceptable bounds for the full-suite run (~34s wall clock for 5 files / 15 tests).

## User Setup Required

None - no external service configuration required. Docker must be running on any machine executing `pnpm --filter @kurzly/api test` (already a documented project prerequisite, RESEARCH Environment Availability).

## Next Phase Readiness

- The real-Postgres TDD harness (`apps/api/test/setupFileEach.ts`'s `prisma` export) is ready for every later phase's integration tests to import directly — no further harness work needed.
- Both Wave-0-flagged assumptions (A3, A4) are resolved with empirical evidence, not just documented as accepted risk.
- `apps/api/test/globalSetup.ts`'s `execFileSync(prismaBin, ["migrate", "deploy"], ...)` pattern is reusable as-is when Phase 2's better-auth schema additions land — the harness re-applies whatever migrations exist in `apps/api/prisma/migrations` at container-start time, no code change required.

---
*Phase: 01-test-infrastructure-monorepo-deployment-scaffolding*
*Completed: 2026-07-10*
