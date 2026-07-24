---
phase: 11-playwright-e2e-infrastructure-fixtures
plan: 01
subsystem: testing
tags: [playwright, e2e, prisma, pnpm-workspace, monorepo]

# Dependency graph
requires:
  - phase: 01-project-foundation-scaffolding (v1.0)
    provides: pnpm workspace layout (apps/*, packages/*), Prisma 7 generated client at apps/api/src/generated/prisma
provides:
  - "@kurzly/e2e pnpm workspace package (Playwright test runner, Chromium installed)"
  - "apps/api/package.json exports map with a resolvable ./prisma-client subpath"
  - "Empirically proven module-resolution path for apps/e2e to import the Prisma client without duplicating schema.prisma"
affects: [11-02-PLAN, 11-03-PLAN, 11-04-PLAN, 11-05-PLAN, 11-06-PLAN, phase-12, phase-13, phase-14]

# Tech tracking
tech-stack:
  added: ["@playwright/test@1.61.1 (devDependency of apps/e2e)"]
  patterns:
    - "Cross-package raw-.ts subpath export (apps/api/package.json exports['./prisma-client']) — diverges from packages/shared's compiled dist/index.js+.d.ts precedent, because Prisma 7's prisma-client provider emits no separately-compilable artifact"
    - "apps/e2e is a black-box HTTP+Prisma consumer of apps/api: exactly one subpath exported, no route/business-logic import surface"

key-files:
  created:
    - apps/e2e/package.json
    - apps/e2e/tsconfig.json
    - apps/e2e/playwright.config.ts
    - apps/e2e/tests/smoke/prisma-import.spike.spec.ts
  modified:
    - apps/api/package.json
    - .gitignore

key-decisions:
  - "Raw-.ts Prisma-client subpath export resolves directly under Playwright's runtime — no compiled-artifact (tsc --emitDeclarationOnly / esbuild) fallback needed. RESEARCH Open Question 1 / Assumption A1 closed green on first attempt."
  - "playwright.config.ts ships only the smoke project in this plan; setup/chromium-admin/chromium-member (storageState dependency chain) are deferred to the plan that builds the auth fixture, per plan scope."

patterns-established:
  - "Pattern: cross-package Prisma client reuse via a single narrowly-scoped package.json exports subpath, never a duplicated schema.prisma or a wildcard export."

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "@kurzly/e2e resolves as an installable pnpm workspace member with @playwright/test and Chromium installed"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "pnpm --filter @kurzly/e2e list @playwright/test (prints 1.61.1); pnpm --filter @kurzly/e2e exec playwright --version (prints Version 1.61.1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "apps/api/package.json exposes exactly one new subpath (./prisma-client -> src/generated/prisma/client.ts), leaving '.' -> dist/server.js unchanged"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "node -e assertion on apps/api/package.json exports map (task 1 verify script)"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/api typecheck (tsc --noEmit, no regression)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The raw-.ts Prisma-client subpath import resolves and instantiates as a constructor under Playwright's own runtime (RESEARCH OQ-1 / Assumption A1 closed)"
    requirement: "INFRA-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/prisma-import.spike.spec.ts#the @kurzly/api/prisma-client subpath resolves to a constructor"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 01: Playwright E2E Workspace Scaffold & Prisma-Subpath Spike Summary

**Scaffolded the `@kurzly/e2e` pnpm workspace package with a Playwright config and proved the phase's one genuinely-unverified mechanical risk — the raw-`.ts` Prisma-client subpath export resolves directly under Playwright's runtime, no compiled fallback needed.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-24T13:51:15Z
- **Completed:** 2026-07-24T13:54:29Z (spike proven and verified)
- **Tasks:** 3/3 completed
- **Files modified:** 6 (2 modified, 4 created)

## Accomplishments
- Added `apps/api/package.json`'s `exports` map from scratch (the file previously had none): `.` preserved at `./dist/server.js`, plus a new narrowly-scoped `./prisma-client` subpath pointing at the generated Prisma client's raw TypeScript source.
- Scaffolded `apps/e2e` (`@kurzly/e2e`) as a pnpm workspace member: `package.json`, `tsconfig.json` (extends `tsconfig.base.json`, mirrors `apps/api`'s pattern), and `playwright.config.ts` with a single `smoke` project.
- Installed `@playwright/test@1.61.1` and its Chromium browser build (`playwright install --with-deps chromium`).
- Wrote and ran a spike spec (`apps/e2e/tests/smoke/prisma-import.spike.spec.ts`) that imports `PrismaClient` from the bare specifier `@kurzly/api/prisma-client` and asserts it resolved to a constructor — **passed on the first run**, closing RESEARCH's Open Question 1 / Assumption A1 with certainty rather than assumption.
- Added the three E2E-artifact `.gitignore` entries (`apps/e2e/playwright/.auth/`, `apps/e2e/playwright-report/`, `apps/e2e/test-results/`) ahead of any fixture code that will produce them.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the ./prisma-client subpath export to apps/api/package.json** - `0205621` (feat)
2. **Task 2: Scaffold the apps/e2e package, Playwright config, tsconfig, and .gitignore entries** - `59f6cbd` (feat)
3. **Task 3: Prove the Prisma-client subpath resolves under Playwright's runtime (RESEARCH OQ-1 spike)** - `437e05f` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified
- `apps/api/package.json` - added `exports` map (`.` -> `dist/server.js`, `./prisma-client` -> `src/generated/prisma/client.ts`); `main` field left unchanged
- `apps/e2e/package.json` - new `@kurzly/e2e` package: `test`/`typecheck` scripts, `@playwright/test@^1.61.1` devDep, `@kurzly/api: workspace:*` dep
- `apps/e2e/tsconfig.json` - extends `../../tsconfig.base.json`, `types: ["node"]`
- `apps/e2e/playwright.config.ts` - `testDir: './tests'`, `fullyParallel: true`, `baseURL` from `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`), `trace: 'on-first-retry'`, list+html reporters, single `smoke` project matching `tests/smoke/*.spec.ts`
- `apps/e2e/tests/smoke/prisma-import.spike.spec.ts` - spike spec proving the Prisma-client subpath import resolves as a constructor under Playwright, without opening a DB connection
- `.gitignore` - added `apps/e2e/playwright/.auth/`, `apps/e2e/playwright-report/`, `apps/e2e/test-results/`
- `pnpm-lock.yaml` - updated by `pnpm install` for the new `@playwright/test` devDependency and `@kurzly/api` workspace dependency

## Decisions Made
- The raw-`.ts` subpath export (`./src/generated/prisma/client.ts`) resolved and typechecked under Playwright's runtime on the first attempt — no need for the documented fallback (a dedicated `tsc --emitDeclarationOnly`/esbuild compiled-artifact step). This is recorded as fact for downstream plans (11-02 onward, all of which import the Prisma client through this same subpath).
- Kept `playwright.config.ts` scoped to only the `smoke` project per this plan's explicit boundary — the `setup`/`chromium-admin`/`chromium-member` projects and their `storageState` dependency chain belong to the plan that builds `auth.setup.ts` (later in this phase), not this scaffolding plan.

## Deviations from Plan

None - plan executed exactly as written. The one open technical question the plan was explicitly built around (RESEARCH OQ-1 / Assumption A1: does the raw-`.ts` subpath resolve under Playwright) resolved in the expected/hoped-for direction on the first attempt, so no fallback branch was needed.

## Issues Encountered

None. `pnpm --filter @kurzly/api typecheck` showed no regression from the `exports` map addition; `pnpm --filter @kurzly/e2e typecheck` passed cleanly; the spike spec passed on its first execution (`1 passed`).

## User Setup Required

None - no external service configuration required. (Chromium was installed automatically as part of Task 2's automated action; no host-machine manual step was needed in this sandbox.)

## Next Phase Readiness

- `@kurzly/e2e` exists as an installable workspace package with Playwright + Chromium ready, and the `@kurzly/api/prisma-client` subpath is proven to resolve — the foundation every downstream plan in this phase (compose boot, DB reset/seed via `apps/e2e/src/db.ts`, Mailpit wiring, auth fixture) needs is now in place and verified, not assumed.
- No blockers. The next plan(s) in this phase can proceed directly to building `docker-compose.e2e.yml`/`scripts/e2e-compose.sh`, `apps/e2e/src/db.ts` (truncate/reseed), `apps/e2e/src/mailpit.ts`, and the `auth.setup.ts` fixture, all of which depend on the scaffold and subpath export this plan delivered.

---
*Phase: 11-playwright-e2e-infrastructure-fixtures*
*Completed: 2026-07-24*

## Self-Check: PASSED

All created files verified present on disk; all three task commit hashes (`0205621`, `59f6cbd`, `437e05f`) verified present in `git log`.
