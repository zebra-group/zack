---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 06
subsystem: api
tags: [fastify, fastify-static, fastify-cors, prisma, testcontainers, fastify-inject]

# Dependency graph
requires:
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-03)
    provides: Prisma client singleton (db.ts) with PersistenceCanary model
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-04)
    provides: fail-fast ENV validation (env.ts — parseEnv/loadEnv)
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-05)
    provides: real-Postgres testcontainers TDD harness (globalSetup.ts, setupFileEach.ts)
provides:
  - Bootable Fastify app (buildApp() factory) with correct API-before-static route ordering
  - GET /health liveness route
  - Redirect-handler stub GET /:slug (Phase 5 replaces with the real engine)
  - Dev-only CORS, single-origin production (D-01)
  - @fastify/static SPA fallback via setNotFoundHandler (Pattern 6)
  - PersistenceCanary POST/GET /api/canary — real DB write+read round-trip
  - server.ts fail-fast boot entrypoint
affects: [phase-2-auth, phase-3-domain-tls, phase-5-redirect-engine, docker-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fastify app factory (buildApp()) separate from server.ts's .listen() call, so tests exercise the app via fastify.inject without binding a socket"
    - "Route registration order: API routes -> health -> redirect stub -> @fastify/static (wildcard:false) -> setNotFoundHandler SPA fallback (Pattern 6)"
    - "Route factories accept an injectable PrismaClient (canaryRoute(prisma)) so buildApp({ prisma }) lets tests wire the SAME transaction-wrapped client setupFileEach.ts uses"

key-files:
  created:
    - apps/api/src/app.ts
    - apps/api/src/routes/health.ts
    - apps/api/src/routes/redirect.ts
    - apps/api/src/routes/canary.ts
    - apps/api/src/plugins/static.ts
    - apps/api/src/plugins/cors.ts
    - apps/api/public/index.html
    - apps/api/test/server.integration.test.ts
    - apps/api/test/canary.integration.test.ts
  modified:
    - apps/api/src/server.ts

key-decisions:
  - "buildApp(options) accepts an optional `prisma` override (defaults to db.ts's singleton) instead of every route hard-importing db.ts directly — this is what lets integration tests pass the SAME transaction-wrapped Prisma client test/setupFileEach.ts uses, so GET /api/canary can observe rows written by an earlier POST in the same rolled-back test transaction (D-09)."
  - "server.ts dynamically imports app.ts (`await import('./app.js')`) AFTER loadEnv() runs, so db.ts's module-level PrismaClient construction never executes ahead of fail-fast ENV validation (D-06)."
  - "apps/api/public/index.html is a placeholder SPA-shell fixture (not in the plan's files_modified list) so @fastify/static has a real file to glob/serve; the production Dockerfile is expected to copy the built apps/web dist/ over this directory later."

patterns-established:
  - "Route modules that touch Prisma are factories taking a PrismaClient parameter (canaryRoute(prisma)), not top-level imports of db.ts's singleton — keeps routes test-injectable."

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "GET /health returns 200 { status: 'ok' }; unknown /api/* returns 404 JSON; unknown non-API path serves the SPA shell (index.html); redirect stub GET /:slug returns its documented placeholder, not a real redirect"
    requirement: "INFRA-01"
    verification:
      - kind: integration
        ref: "apps/api/test/server.integration.test.ts#Fastify app route ordering (health, SPA fallback, 404, redirect stub)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/canary writes a PersistenceCanary row and GET /api/canary reads the count/latest token back, against real Postgres via Prisma"
    requirement: "INFRA-01"
    verification:
      - kind: integration
        ref: "apps/api/test/canary.integration.test.ts#POST /api/canary + GET /api/canary (real DB round-trip)"
        status: pass
    human_judgment: false

# Metrics
duration: 16min
completed: 2026-07-10
status: complete
---

# Phase 1 Plan 06: Fastify App, Health, Redirect Stub, Static SPA Fallback, DB Canary Route Summary

**Bootable single-image Fastify app (buildApp() factory) with correct API-before-static route ordering, a real Postgres read/write PersistenceCanary route, and a Phase-5-deferred redirect stub — all proven by fastify.inject integration tests against the real-Postgres testcontainers harness.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-10T23:18:00Z
- **Completed:** 2026-07-10T23:34:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- `buildApp()` factory builds a Fastify instance (pino logger, pino-pretty outside production) and registers routes in the Pattern-6-mandated order: `/api` scope -> `/health` -> redirect stub `/:slug` -> `@fastify/static` (`wildcard:false`) -> `setNotFoundHandler` SPA fallback — verified empirically via a manual `fastify.inject` smoke run before committing.
- `PersistenceCanary` route (`POST`/`GET /api/canary`) is the walking skeleton's real DB write+read round-trip against real Postgres, typed with the shared `CanaryResult` DTO from `@kurzly/shared`, built via full RED -> GREEN TDD.
- Route order correctness (health, unknown-`/api/*`-is-404-JSON, unknown-non-API-is-SPA-shell, redirect-stub-is-inert-404) locked in by `server.integration.test.ts`.
- `server.ts` runs the fail-fast ENV boot (`loadEnv()`) before dynamically importing `app.ts`, so a misconfigured operator environment never reaches Prisma/SMTP-touching module code.
- Full monorepo typecheck (`pnpm run typecheck`, `pnpm -r exec tsc --noEmit`) and the full `@kurzly/api` test suite (7 files, 22 tests) pass together.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fastify app factory, health + redirect-stub routes, static SPA fallback, dev CORS** - `a5073f3` (feat)
2. **Task 2: PersistenceCanary read/write route** - `a4be1bc` (test — RED), `06561a1` (feat — GREEN)
3. **Task 3: Server behavior integration tests** - `b7dab35` (test)

**Plan metadata:** _pending final docs commit_

_Note: Task 2 is TDD with a distinct RED then GREEN commit._

## Files Created/Modified
- `apps/api/src/app.ts` - `buildApp()` factory; registers API scope, health, redirect stub, static, SPA-fallback not-found handler, accepts optional `prisma` override
- `apps/api/src/server.ts` - fail-fast ENV boot then dynamic `app.js` import + `.listen()`
- `apps/api/src/routes/health.ts` - `GET /health` -> `{ status: 'ok' }`
- `apps/api/src/routes/redirect.ts` - `GET /:slug` inert 404 placeholder stub (Phase 5 replaces)
- `apps/api/src/routes/canary.ts` - `canaryRoute(prisma)` factory: `POST`/`GET /api/canary`
- `apps/api/src/plugins/static.ts` - `@fastify/static` registration (`wildcard:false`)
- `apps/api/src/plugins/cors.ts` - `@fastify/cors`, dev-only (`NODE_ENV !== 'production'`)
- `apps/api/public/index.html` - placeholder SPA-shell fixture for the static plugin/tests
- `apps/api/test/server.integration.test.ts` - route-order/health/404/SPA-fallback/redirect-stub assertions
- `apps/api/test/canary.integration.test.ts` - PersistenceCanary write+read round-trip assertions

## Decisions Made
- **Injectable Prisma client on `buildApp()`:** rather than every route statically importing `db.ts`'s singleton, `canaryRoute(prisma)` is a factory and `buildApp({ prisma })` accepts an override. Production defaults to `db.ts`'s singleton; tests pass the exact same transaction-wrapped client `test/setupFileEach.ts` already uses, so `GET /api/canary` correctly observes rows written by an earlier `POST` in the SAME per-test rolled-back transaction (D-09) — without this, the route's writes would go through a separate, un-rolled-back connection and leak across tests.
- **Dynamic import of `app.js` in `server.ts`:** keeps `db.ts`'s module-level `PrismaClient`/`PrismaPg` construction strictly after `loadEnv()` has validated the environment, honoring D-06's "fail loudly before touching DB/SMTP" intent even though `PrismaPg`'s construction with an empty connection string is itself lazy/harmless.
- **`apps/api/public/index.html` fixture:** created ahead of Task 3 (in Task 1's commit) because `@fastify/static` (`wildcard:false`) globs the `root` directory at registration time — `buildApp()` cannot register successfully without a real file/directory present, and Task 1's own app already registers static. The production Dockerfile is expected to copy `apps/web`'s built `dist/` over this directory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Deferred `/api` route registration wiring from Task 1 to Task 2**
- **Found during:** Task 1
- **Issue:** The plan's Task 1 action asks `app.ts` to register "API routes under prefix `/api`" as part of the initial skeleton, but the only current API route (`PersistenceCanary`) is explicitly built via TDD in Task 2 (`routes/canary.ts` doesn't exist until then). Building `app.ts` in Task 1 with a static import of a not-yet-existing `canary.ts` would either block Task 1's compile or force pre-building the canary route ahead of its own RED/GREEN cycle.
- **Fix:** Task 1's `app.ts` registers an empty `/api`-prefixed scope (structurally correct, ordering-correct, but with zero routes). Task 2 then edits `app.ts` to add the `canaryRoute(prisma)` registration inside that scope as part of its GREEN commit — `app.ts` was implicitly touched by Task 2 even though the plan's Task 2 `<files>` list didn't name it.
- **Files modified:** `apps/api/src/app.ts` (Task 1: skeleton scope; Task 2: canary registration + `prisma` option added)
- **Verification:** `tsc --noEmit` passes at every commit; RED test genuinely failed with 404 (feature absent) before Task 2's implementation, not a compile error.
- **Committed in:** `a5073f3` (Task 1), `06561a1` (Task 2 GREEN)

**2. [Rule 3 - Blocking] Task 1 verify command adjusted (`server.integration.test.ts` doesn't exist until Task 3)**
- **Found during:** Task 1
- **Issue:** The plan's Task 1 `<verify>` runs `pnpm --filter @kurzly/api exec vitest run test/server.integration.test.ts`, but that file is created in Task 3, not Task 1 — running it at Task 1 time would fail with "no test files found."
- **Fix:** Verified Task 1 with `tsc --noEmit` plus a full `pnpm --filter @kurzly/api exec vitest run` (whole existing suite, to confirm no regressions) and a manual `fastify.inject` smoke script exercising `/health`, unknown `/api/*`, the SPA fallback, and the redirect stub directly, since the assertions that would live in `server.integration.test.ts` didn't exist as a committable file yet. Task 3 later adds the actual test file and runs the plan's literal verify command against it.
- **Files modified:** none (verification-only adjustment)
- **Committed in:** n/a (documented here only)

**3. [Task-level TDD note, not a fix] Task 3's RED phase passed immediately**
- **Found during:** Task 3
- **Issue:** Task 3 is `tdd="true"` and its `<tdd_execution>` process expects the initial test run to fail (RED) before implementation (GREEN). Because Task 1 (a plain `auto` task, not `tdd`) already fully implemented health/redirect-stub/static-fallback/not-found-handler behavior as prerequisite scaffolding for Task 2, `server.integration.test.ts`'s four assertions all passed on first run.
- **Fix:** No code change was needed or made. This is expected given the task decomposition (Task 1 necessarily builds the underlying app structure Task 2 depends on), not a violation of the plan-level TDD gate — this plan's frontmatter `type` is `execute`, not `tdd`, so the stricter plan-level "RED must fail" gate from `references/execute-mvp-tdd.md` does not apply here; only the per-task `tdd="true"` attribute does, and its RED/GREEN framing is best-effort given inter-task dependencies.
- **Files modified:** none
- **Committed in:** `b7dab35` (single `test(...)` commit — no `feat(...)` GREEN commit followed since there was no implementation delta)

---

**Total deviations:** 3 (2 auto-fixed blocking/Rule 3, 1 documented TDD-sequencing note)
**Impact on plan:** No scope creep. All adjustments were sequencing/wiring artifacts of the plan's own task decomposition (Task 1 building shared scaffolding that Tasks 2 and 3 depend on and test), not functional deviations. Final behavior matches every acceptance criterion in the plan.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The API half of the D-01 single-image walking skeleton is complete: `docker compose up` (once Dockerfile/compose plans land later in this phase) can boot a Fastify process that serves `/health`, the SPA shell, and a real DB round-trip via `/api/canary`.
- `apps/api/public/index.html` is a placeholder — a later plan in this phase (or the Dockerfile) must copy `apps/web`'s built `dist/` over `apps/api/public/` for the real SPA to be served in production.
- Phase 5 (Redirect Engine) has a clean, documented seam to replace: `apps/api/src/routes/redirect.ts`'s `GET /:slug` stub.
- Phase 2 (Auth) can register additional routes into the same `/api` scope pattern established here (`app.register(async (apiScope) => { ... }, { prefix: '/api' })`), and can reuse the `injectable prisma client` pattern from `canaryRoute(prisma)` for its own testable routes.

---
*Phase: 01-test-infrastructure-monorepo-deployment-scaffolding*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 10 created/modified files and all 4 task commit hashes (a5073f3, a4be1bc, 06561a1, b7dab35) verified present on disk / in git log.
