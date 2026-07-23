---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 08
subsystem: infra
tags: [docker, docker-compose, postgres, prisma, deployment]
status: complete

# Dependency graph
requires:
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-02)
    provides: pnpm monorepo scaffold (apps/web, apps/api, packages/shared)
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-03)
    provides: Prisma schema, explicit generator output path, prisma.config.ts (DATABASE_URL via env())
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-04)
    provides: Fail-fast Zod ENV validation (env.ts) and .env.example convention
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (01-06)
    provides: "buildApp()/server.ts boot sequence, GET /health, POST+GET /api/canary routes"
provides:
  - "Dockerfile: multi-stage (base -> build -> runtime) image serving /api/* + the built Vue SPA from one container (D-01)"
  - "apps/api/entrypoint.sh: prisma migrate deploy then exec node dist/server.js on every container start (D-05)"
  - "docker-compose.yml: two-service production stack (app+db), db-data named volume, service_healthy-gated startup (D-02/D-08)"
  - "docker-compose.dev.yml: Mailpit-only dev/CI overlay (D-10)"
  - "scripts/smoke-compose.sh: automated INFRA-01 boot proof"
  - "scripts/smoke-persistence.sh: automated INFRA-03 persistence proof"
affects: [phase-2-auth, phase-3-domain-tls-routing, ci-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pnpm deploy --filter=@kurzly/api --prod --legacy is required (not the pnpm 10+ default injected/symlinked deploy mode) to produce a standalone, Docker-COPY-safe production directory"
    - "prisma generate needs a syntactically-valid (but not reachable) DATABASE_URL at build time because prisma.config.ts resolves it eagerly via env(), even though `generate` never opens a DB connection"
    - "postgres:18-alpine's named volume must mount at /var/lib/postgresql (the parent dir), not /var/lib/postgresql/data - the image now manages its own major-version-specific subdirectory underneath"

key-files:
  created:
    - Dockerfile
    - .dockerignore
    - apps/api/entrypoint.sh
    - docker-compose.yml
    - docker-compose.dev.yml
    - scripts/smoke-compose.sh
    - scripts/smoke-persistence.sh
  modified:
    - .env.example

key-decisions:
  - "pnpm deploy needs --legacy: pnpm 10+ defaults to an injected/symlinked workspace-package deploy mode that errors outright (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE) unless inject-workspace-packages=true is set; --legacy performs a real content copy, which is what a Docker COPY --from=build step needs - confirmed by testing pnpm deploy locally before wiring it into the Dockerfile."
  - "prisma generate in the Dockerfile build stage is run with an inline placeholder DATABASE_URL (postgresql://placeholder:placeholder@localhost:5432/placeholder) - prisma.config.ts's env('DATABASE_URL') throws PrismaConfigEnvError during config loading if the var is entirely absent, even for `generate`, which never actually connects to a database."
  - "docker-compose.yml's db-data volume mounts at /var/lib/postgresql, not the /var/lib/postgresql/data path from 01-RESEARCH.md's own code example - postgres:18-alpine's image refuses to start with a volume mounted directly at .../data (pg_ctlcluster-compatible major-version-subdirectory layout, docker-library/postgres#1259/#37). Discovered and fixed empirically by actually booting the stack during this plan's execution, not from research alone."
  - "Added POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB to .env.example (not explicitly listed in this plan's files_modified) - the db service cannot derive its own init credentials from the app's DATABASE_URL string; Postgres never parses that URL itself. Documented as keeping the three vars in sync with DATABASE_URL's embedded credentials (Rule 2: required for the stack to actually boot)."

patterns-established:
  - "Smoke scripts are the only sanctioned CI/manual verification path for compose behavior - never document `docker compose down -v` as a routine restart instruction anywhere else in the repo."

requirements-completed: [INFRA-01, INFRA-02, INFRA-03]

coverage:
  - id: D1
    description: "docker compose up boots app + db with zero manual steps beyond supplying .env, migrations apply automatically at entrypoint, and /health returns 200"
    requirement: INFRA-01
    verification:
      - kind: script
        ref: "scripts/smoke-compose.sh"
        status: pass
      - kind: manual
        ref: "Executed live against real Docker during this plan: docker compose up -d --wait -> both containers Healthy -> GET /health 200 -> POST /api/canary 200 (proves migrate deploy ran automatically)"
        status: pass
    human_judgment: false
  - id: D2
    description: "PostgreSQL data survives a full down (volume-preserving) then up cycle via the named volume"
    requirement: INFRA-03
    verification:
      - kind: script
        ref: "scripts/smoke-persistence.sh"
        status: pass
      - kind: manual
        ref: "Executed live: wrote canary token, `docker compose down` (no -v), `docker compose up -d --wait`, GET /api/canary returned the same token and count"
        status: pass
    human_judgment: false
  - id: D3
    description: "The instance is configured entirely via environment variables (nothing hardcoded in the image)"
    requirement: INFRA-02
    verification:
      - kind: manual
        ref: "docker-compose.yml's app service uses env_file: .env exclusively; db service credentials come from POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB (also .env-sourced); Dockerfile has no hardcoded secrets or connection strings"
        status: pass
    human_judgment: false

metrics:
  duration: ~35 min
  completed: 2026-07-11
  tasks_completed: 3
  files_touched: 8
---

# Phase 1 Plan 08: Docker Image + Compose Stack + Boot/Persistence Smoke Tests Summary

Multi-stage Dockerfile packaging the API+SPA into one image with migration-on-start, a two-service production Compose stack with a durable named volume and readiness-gated startup, a dev-only Mailpit overlay, and executable smoke scripts proving zero-manual-step boot (INFRA-01) and cross-restart persistence (INFRA-03) — all verified live against real Docker, not just statically.

## What Was Built

**Task 1 - Multi-stage Dockerfile + migration-on-start entrypoint.** `Dockerfile` has three stages: `base` (node:24-alpine + corepack/pnpm), `build` (installs the full workspace, runs an explicit `prisma generate` with a placeholder `DATABASE_URL` so `prisma.config.ts`'s eager `env()` resolution doesn't throw at build time, runs `pnpm run -r build` for topological `packages/shared -> apps/*` ordering, then `pnpm deploy --filter=@kurzly/api --prod --legacy /prod/api` to produce a standalone production directory), and `runtime` (copies the pruned API dir, copies the built Vue `dist/` into the API's `public/` dir for single-origin serving, copies `entrypoint.sh`, sets a `HEALTHCHECK` against `/health`). `apps/api/entrypoint.sh` runs `prisma migrate deploy` then `exec node dist/server.js` — this is the *only* place migrations ever run, never in a Dockerfile `RUN` step.

**Task 2 - Production compose + dev Mailpit overlay.** `docker-compose.yml` declares `db` (postgres:18-alpine, `db-data` named volume, `pg_isready` healthcheck with a 30s `start_period`) and `app` (`build: .`, `env_file: .env`, `depends_on: db: condition: service_healthy`, only port 3000 published). `docker-compose.dev.yml` adds Mailpit only, never referenced by production. `.env.example` gained `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` so the `db` service's own init credentials can be kept in sync with `DATABASE_URL`.

**Task 3 - Smoke scripts.** `scripts/smoke-compose.sh` boots the stack, asserts `/health` is 200 and `POST /api/canary` succeeds (proving auto-migration), then tears down completely (`down -v`) since it's a throwaway boot check. `scripts/smoke-persistence.sh` writes a canary row, performs a **volume-preserving** `down`/`up` cycle, asserts the row survived, then does a final `down -v` cleanup. Both scripts require `jq`, use `set -euo pipefail`, and exit non-zero on any failure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pnpm deploy` requires `--legacy` under pnpm 11's default injected-workspace mode**
- **Found during:** Task 1, first local `pnpm deploy` trial (before wiring into the Dockerfile)
- **Issue:** `pnpm deploy --filter=@kurzly/api --prod <dir>` fails outright with `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` — pnpm 10+ defaults to requiring `inject-workspace-packages=true` for non-legacy deploy.
- **Fix:** Added `--legacy` to the `pnpm deploy` invocation, which performs a real content copy (not symlinks) — exactly what a Docker `COPY --from=build` step needs.
- **Files modified:** Dockerfile
- **Commit:** f32d81f

**2. [Rule 3 - Blocking] `prisma generate` fails without a resolvable `DATABASE_URL` at build time**
- **Found during:** Task 1, first `docker build` attempt
- **Issue:** `prisma.config.ts` calls `env('DATABASE_URL')` eagerly during config loading; `prisma generate` doesn't connect to a DB but still fails with `PrismaConfigEnvError` if the var is entirely unset.
- **Fix:** Inline placeholder `DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder` on the `prisma generate` RUN line only (build-stage-scoped, never shipped to runtime).
- **Files modified:** Dockerfile
- **Commit:** f32d81f

**3. [Rule 1 - Bug] `postgres:18-alpine` refuses to start with the named volume mounted at `.../data`**
- **Found during:** Task 2, first live `docker compose up` boot test
- **Issue:** The image errors and exits (container becomes unhealthy, `app` never starts) when a volume is mounted directly at `/var/lib/postgresql/data` — postgres 18+ Docker images manage their own major-version-specific subdirectory under `/var/lib/postgresql` (pg_ctlcluster-compatible layout). 01-RESEARCH.md's own code example used the old `.../data` mount path, predating this image behavior change.
- **Fix:** Changed the `db-data` volume mount to `/var/lib/postgresql` (parent directory).
- **Files modified:** docker-compose.yml
- **Commit:** eceb036

**4. [Rule 2 - Missing critical functionality] `db` service had no way to derive matching init credentials**
- **Found during:** Task 2
- **Issue:** `DATABASE_URL` (consumed by the app) embeds the Postgres username/password/db name, but Postgres's own container never parses that URL — the `db` service needs `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` set independently, and `.env.example` didn't define them, which would silently produce credential mismatches (app can't connect) on first boot.
- **Fix:** Added the three vars to `.env.example` with a comment documenting they must stay in sync with `DATABASE_URL`'s embedded credentials.
- **Files modified:** .env.example
- **Commit:** eceb036

None of the above required an architectural decision (Rule 4) — all were straightforward bug/blocker fixes discovered by actually building and booting the stack, as the environment note for this plan directed.

## Live Verification Performed

Beyond the plan's own `<automated>` verify commands, the full boot and persistence loop was executed against real Docker (Docker 29.6.1, Compose v5.3.0) during this plan's execution:

1. `docker build -t kurzly:test .` — succeeded.
2. `docker compose -f docker-compose.yml config` — validated.
3. `docker compose up -d --wait` — both `db` and `app` reached `Healthy`.
4. `GET /health` → `200 {"status":"ok"}`.
5. `POST /api/canary` → `200 {"token":"...","total":1}` (proves `prisma migrate deploy` ran automatically — the `PersistenceCanary` table didn't pre-exist).
6. `docker compose down` (no `-v`) → `docker compose up -d --wait` → `GET /api/canary` returned the same token and count (INFRA-03 persistence proof).
7. `bash scripts/smoke-compose.sh` — full pass, exit 0.
8. `bash scripts/smoke-persistence.sh` — full pass, exit 0.
9. Host cleaned up afterward: no leftover `zack-*` containers, volumes, or images; no `.env` left in the working tree (all created `.env` files were smoke-test scratch copies, removed at teardown).

## Self-Check

- Dockerfile: FOUND
- .dockerignore: FOUND
- apps/api/entrypoint.sh: FOUND (executable)
- docker-compose.yml: FOUND
- docker-compose.dev.yml: FOUND
- scripts/smoke-compose.sh: FOUND (executable)
- scripts/smoke-persistence.sh: FOUND (executable)
- Commit f32d81f: FOUND in git log
- Commit eceb036: FOUND in git log
- Commit 2020b14: FOUND in git log

## Self-Check: PASSED
