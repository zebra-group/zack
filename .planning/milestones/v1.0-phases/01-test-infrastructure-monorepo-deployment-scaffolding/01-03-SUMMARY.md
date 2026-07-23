---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 03
subsystem: database
tags: [prisma, postgres, orm, migrations, driver-adapter]

# Dependency graph
requires:
  - phase: 01-02
    provides: apps/api scaffold (package.json, vitest.config.ts, tsconfig.json, pnpm-workspace.yaml allowBuilds)
provides:
  - Committed initial Prisma migration (PersistenceCanary model) applied cleanly to a real Postgres
  - Generated Prisma client resolving from the Prisma 7 explicit output path (apps/api/src/generated/prisma)
  - apps/api/src/db.ts prisma singleton, ready for better-auth's Prisma adapter in Phase 2
  - apps/api/prisma.config.ts — required by Prisma 7.8.0's removal of datasource.url from schema.prisma
  - Regression test guarding against the silent missing-generated-client failure mode
affects: [02-auth-user-management, deployment-entrypoint-migrate-deploy]

# Tech tracking
tech-stack:
  added: ["@prisma/adapter-pg (Prisma's official node-postgres driver adapter, required by Prisma 7.8.0's PrismaClientOptions)"]
  patterns:
    - "Prisma 7 explicit generator output (src/generated/prisma), imported via ./generated/prisma/client.js, never bare @prisma/client"
    - "Prisma 7.8.0 driver-adapter construction: new PrismaClient({ adapter: new PrismaPg(connectionString) }) instead of bare new PrismaClient()"
    - "Datasource connection URL lives in prisma.config.ts (datasource.url via env()), not in schema.prisma's datasource block"

key-files:
  created:
    - apps/api/prisma/schema.prisma
    - apps/api/prisma/migrations/20260710204302_init/migration.sql
    - apps/api/prisma.config.ts
    - apps/api/src/db.ts
    - apps/api/test/prisma-generate.test.ts
  modified:
    - apps/api/package.json (added @prisma/adapter-pg dependency)
    - pnpm-lock.yaml

key-decisions:
  - "Added @prisma/adapter-pg (official Prisma driver adapter, same prisma/prisma org/repo) because Prisma 7.8.0 requires an adapter or accelerateUrl on PrismaClient construction — plain new PrismaClient() no longer type-checks"
  - "Connection URL moved from schema.prisma's datasource block to prisma.config.ts, per Prisma 7.8.0's P1012 validation error (this is a point-release breaking change beyond what CLAUDE.md/RESEARCH.md documented)"
  - "Migration authored via `prisma migrate dev --name init` against a throwaway, self-cleaned postgres:18-alpine Docker container (not testcontainers, since this is a one-time authoring step, not a repeatable test run)"

patterns-established:
  - "Any code constructing PrismaClient must import PrismaPg from @prisma/adapter-pg and pass { adapter } — Phase 2's better-auth Prisma adapter must follow the same construction pattern when it imports from apps/api/src/generated/prisma"

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "Prisma schema authored with Prisma 7 explicit generator output path and PersistenceCanary model; initial migration authored and committed"
    requirement: "INFRA-01"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec prisma generate && ls apps/api/prisma/migrations/*/migration.sql"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration applies cleanly to a real Postgres instance"
    requirement: "INFRA-01"
    verification:
      - kind: integration
        ref: "prisma migrate dev --name init run and applied against a throwaway postgres:18-alpine container (manual verification during execution)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Generated Prisma client resolves from apps/api/src/generated/prisma via a fast unit test guarding against the pnpm build-script-gate Pitfall 1 regression"
    requirement: "INFRA-01"
    verification:
      - kind: unit
        ref: "apps/api/test/prisma-generate.test.ts#resolves the generated client module and exposes a PrismaClient constructor"
        status: pass
      - kind: unit
        ref: "apps/api/test/prisma-generate.test.ts#constructs PrismaClient without throwing (no DB connection attempted)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-07-10
status: complete
---

# Phase 01 Plan 03: Prisma Schema, Migration & Generated Client Summary

**Prisma 7 schema with explicit generator output path, committed initial migration (PersistenceCanary), and a driver-adapter-based Prisma client singleton — required upgrading past the plan's assumed API due to a Prisma 7.8.0 point-release breaking change.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-10T22:38:00+02:00 (approx.)
- **Completed:** 2026-07-10T22:48:33+02:00
- **Tasks:** 2
- **Files modified:** 8 (5 created, 2 modified in dependency graph, 1 test file)

## Accomplishments
- `apps/api/prisma/schema.prisma`: `generator client { provider = "prisma-client"; output = "../src/generated/prisma" }` (Prisma 7 explicit output path) and the `PersistenceCanary` model (`id`, `token`, `createdAt`) — the vehicle for the future D-08 persistence-canary proof.
- Initial migration `20260710204302_init` authored via `prisma migrate dev --name init` against a throwaway `postgres:18-alpine` Docker container, applied cleanly, and committed to `apps/api/prisma/migrations/`.
- `apps/api/src/db.ts` exports a `prisma` singleton imported from `./generated/prisma/client.js` (the explicit path), constructed via `@prisma/adapter-pg` — ready for Phase 2's better-auth Prisma adapter to import the same generated client.
- Regression test (`apps/api/test/prisma-generate.test.ts`) guarding against RESEARCH Pitfall 1 (pnpm's build-script gate silently blocking `prisma generate`'s postinstall hook) — verified RED (fails when `apps/api/src/generated` is absent) then GREEN (passes after regeneration).
- Full monorepo `pnpm build` and `pnpm typecheck` both pass with the new Prisma artifacts in place.

## Task Commits

Each task was committed atomically:

1. **Task 1: [BLOCKING] Prisma schema, initial migration, and generated client** - `25c783d` (feat)
2. **Task 2: Generated-client-resolves regression test (Pitfall 1 guard)** - `13317f5` (test)

**Plan metadata:** _(pending — see final commit below)_

## Files Created/Modified
- `apps/api/prisma/schema.prisma` - Prisma 7 generator/datasource config + `PersistenceCanary` model
- `apps/api/prisma/migrations/20260710204302_init/migration.sql` - Committed initial migration SQL
- `apps/api/prisma/migrations/migration_lock.toml` - Prisma migration lock file (postgresql provider)
- `apps/api/prisma.config.ts` - Datasource connection URL (moved out of schema.prisma per Prisma 7.8.0)
- `apps/api/src/db.ts` - Prisma client singleton, constructed via `@prisma/adapter-pg`
- `apps/api/test/prisma-generate.test.ts` - Fast unit regression test for Pitfall 1
- `apps/api/package.json` - Added `@prisma/adapter-pg` dependency
- `pnpm-lock.yaml` - Lockfile update for the new dependency

## Decisions Made
- Used a throwaway, manually-managed `postgres:18-alpine` Docker container (started, waited for `pg_isready`, then stopped/removed) to author the migration via `prisma migrate dev`, rather than testcontainers — this is a one-time schema-authoring step at plan-execution time, not a repeatable test run, so the lighter-weight approach was preferable. Testcontainers wiring for the actual test harness is deferred to plan 01-05 per the plan's own scope note.
- Added `@prisma/adapter-pg` (Prisma's own first-party node-postgres driver adapter) rather than reworking the schema/generator further, since it's the officially documented fix for the exact error Prisma 7.8.0 raises (`https://pris.ly/d/config-datasource` / `https://pris.ly/d/prisma7-client-config`) and shares its GitHub org/repo (`prisma/prisma`) with the already-approved `prisma`/`@prisma/client` packages from 01-RESEARCH.md's Package Legitimacy Audit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Prisma 7.8.0 removed `datasource.url` from schema.prisma (P1012)**
- **Found during:** Task 1, first `prisma generate` run
- **Issue:** `.claude/CLAUDE.md` and `01-RESEARCH.md` (Pattern 4) both describe a Prisma 7 schema with `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`. Against the actually-installed `prisma@7.8.0`, this fails schema validation: `Error: Prisma schema validation - (get-config wasm) ... The datasource property 'url' is no longer supported in schema files. Move connection URLs for Migrate to 'prisma.config.ts'...`. This is a point-release breaking change that postdates the research/CLAUDE.md guidance.
- **Fix:** Removed `url` from the schema's `datasource` block; added `apps/api/prisma.config.ts` using `defineConfig`/`env` from `prisma/config`, setting `datasource: { url: env("DATABASE_URL") }` and `schema: "prisma/schema.prisma"`.
- **Files modified:** `apps/api/prisma/schema.prisma`, `apps/api/prisma.config.ts` (new)
- **Verification:** `prisma generate` and `prisma migrate dev --name init` both succeeded after the fix.
- **Committed in:** `25c783d` (Task 1 commit)

**2. [Rule 3 - Blocking] Prisma 7.8.0's `PrismaClientOptions` requires an `adapter` or `accelerateUrl`**
- **Found during:** Task 1, `tsc --noEmit` verification (`Expected 1 arguments, but got 0` on `new PrismaClient()`)
- **Issue:** The plan's `db.ts` spec (`export const prisma = new PrismaClient()`, matching RESEARCH Pattern 4's code sample) no longer type-checks — Prisma 7.8.0's generated `PrismaClientOptions` type requires either a driver `adapter` (e.g. from `@prisma/adapter-pg`) or an `accelerateUrl`; there is no longer a bare no-args or `datasourceUrl`-only constructor path.
- **Fix:** Added `@prisma/adapter-pg` (npm-registry-verified `OK` via `gsd-tools query package-legitimacy check`; official `prisma/prisma`-org package, already-vetted sibling of `prisma`/`@prisma/client`). `db.ts` now constructs `new PrismaPg(process.env.DATABASE_URL ?? "")` and passes it as `{ adapter }` to `PrismaClient`. `PrismaPg`/`pg.Pool` connect lazily on first query, so no DB connection is attempted at module-import time — preserving the "constructs without throwing" requirement for both `db.ts` and the Task 2 regression test.
- **Files modified:** `apps/api/src/db.ts`, `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @kurzly/api exec tsc --noEmit` passes; `apps/api/test/prisma-generate.test.ts` (Task 2) passes, including a `new PrismaClient({ adapter })` construction test with a placeholder connection string.
- **Committed in:** `25c783d` (Task 1 commit); test coverage added in `13317f5` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues caused by a Prisma point-release breaking change beyond what CLAUDE.md/RESEARCH.md anticipated)
**Impact on plan:** Both fixes were required for the plan's stated acceptance criteria (committed migration + resolvable generated client + `tsc --noEmit` passing) to be achievable at all against the actually-installed Prisma version. No scope creep — no new features added beyond making the pinned Prisma 7.8.0 constructor API work. Phase 2's better-auth Prisma adapter will need to follow the same `{ adapter: new PrismaPg(...) }` construction pattern; flagging this explicitly in `patterns-established` above for the Phase 2 planner to pick up.

## Issues Encountered
None beyond the two deviations documented above (both resolved within the task, no unresolved blockers).

## User Setup Required
None - no external service configuration required. (Runtime application of the committed migration via the container entrypoint's `prisma migrate deploy` is wired in plan 01-08, as noted in the plan's objective.)

## Next Phase Readiness
- A real, committed initial migration and a working generated-client construction pattern (`{ adapter: new PrismaPg(...) }`) now exist for Phase 2's better-auth Prisma adapter to build on — it must use the same `@prisma/adapter-pg`-based construction, not a bare `new PrismaClient()`.
- `DATABASE_URL` is read directly from `process.env` in both `db.ts` and `prisma.config.ts` for now; plan 01-04 (fail-fast ENV validation) should wire the validated `env` object through in place of the raw `process.env.DATABASE_URL` read in `db.ts`.
- No blockers for plan 01-04 or onward.

---
*Phase: 01-test-infrastructure-monorepo-deployment-scaffolding*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created files verified to exist on disk; both task commit hashes (`25c783d`, `13317f5`) verified present in `git log`.
