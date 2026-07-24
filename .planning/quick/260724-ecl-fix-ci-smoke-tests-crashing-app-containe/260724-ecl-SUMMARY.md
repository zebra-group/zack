---
phase: quick-260724-ecl
plan: 01
subsystem: infra
tags: [docker, docker-compose, ci, smoke-test, env-validation, deployment-docs]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: apps/api/src/env.ts fail-fast BETTER_AUTH_SECRET placeholder rejection (WR-06), scripts/smoke-compose.sh, scripts/smoke-persistence.sh
provides:
  - "scripts/smoke-compose.sh and scripts/smoke-persistence.sh generate a real random BETTER_AUTH_SECRET when auto-creating .env, instead of copying .env.example's rejected placeholder"
  - "docs/DEPLOYMENT.md — build/deploy/troubleshoot guide grounded in the actual repo"
affects: [ci, deployment-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shell scripts that auto-create .env from .env.example must substitute a real BETTER_AUTH_SECRET (openssl rand -base64 32) before any docker compose up, using sed with a | delimiter (base64 output can contain / but never |, &, or \\)"

key-files:
  created:
    - docs/DEPLOYMENT.md
  modified:
    - scripts/smoke-compose.sh
    - scripts/smoke-persistence.sh

key-decisions:
  - "Fix scoped strictly to the existing ENV_FILE_CREATED=1 auto-create branch in both scripts — a real operator-supplied .env is never touched"
  - "sed uses | as delimiter (not default /) since openssl rand -base64 32 output can contain / but never |, &, or \\"
  - "docs/DEPLOYMENT.md links to docs/deployment/reverse-proxy.md for TLS instead of duplicating it, per project's documentation convention"

patterns-established: []

requirements-completed: [INFRA-01, INFRA-03]

coverage:
  - id: D1
    description: "scripts/smoke-compose.sh and scripts/smoke-persistence.sh generate a real random BETTER_AUTH_SECRET when auto-creating .env, so the app container no longer crashes at boot on the .env.example placeholder"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "docker compose -f docker-compose.yml build app && ./scripts/smoke-compose.sh (real docker daemon, no pre-existing .env) — printed 'smoke-compose.sh: ALL CHECKS PASSED (INFRA-01)', exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "docs/DEPLOYMENT.md created with infrastructure overview, build process, deploy flow, required ENV vars/secrets, and troubleshooting (including the exact placeholder-rejection failure mode)"
    requirement: "INFRA-03"
    verification:
      - kind: other
        ref: "test -f docs/DEPLOYMENT.md && grep -q BETTER_AUTH_SECRET && grep -q 'prisma migrate deploy' && grep -q reverse-proxy.md docs/DEPLOYMENT.md — all pass"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-24
status: complete
---

# Quick Task 260724-ecl: Fix CI smoke tests crashing app container Summary

**Both compose smoke scripts now generate a real `openssl rand -base64 32` secret when auto-creating `.env`, and a new `docs/DEPLOYMENT.md` documents build/deploy/troubleshoot end-to-end.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-24T08:20:00Z (approx.)
- **Completed:** 2026-07-24T08:35:19Z
- **Tasks:** 2/2 completed
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- Root-caused CI failure confirmed and fixed: both smoke scripts' `ENV_FILE_CREATED=1` auto-create branch now substitutes a fresh `openssl rand -base64 32` secret into the copied `.env` before `docker compose up --wait` runs, instead of leaving `.env.example`'s rejected placeholder in place.
- Verified the fix for real against a live Docker daemon: built the `app` image (`docker compose -f docker-compose.yml build app`) and ran `./scripts/smoke-compose.sh` from a checkout with no pre-existing `.env` — it printed `smoke-compose.sh: ALL CHECKS PASSED (INFRA-01)` and exited 0, proving the app container reaches a healthy `/health` instead of dying at ENV validation.
- Created `docs/DEPLOYMENT.md`, grounded entirely in the actual repo (docker-compose.yml, docker-compose.dev.yml, Dockerfile, entrypoint.sh, .env.example, env.ts, ci.yml), covering infrastructure overview, build process, deploy flow, required ENV vars/secrets, and troubleshooting — leading with the exact `BETTER_AUTH_SECRET` placeholder-rejection failure mode this task fixed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Generate a real BETTER_AUTH_SECRET when smoke scripts auto-create .env** - `205327a` (fix)
2. **Task 2: Create docs/DEPLOYMENT.md grounded in the actual repo** - `ee9fca4` (docs)

_No TDD tasks in this plan — both are infra/shell-script and documentation changes with no existing shell-unit test harness in the repo (per plan's `<verification>` section, the real docker-compose smoke run is this project's established equivalent of a test for these infra scripts)._

## Files Created/Modified
- `scripts/smoke-compose.sh` - Added openssl availability guard + generates a real `BETTER_AUTH_SECRET` in the auto-create `.env` branch via `sed` (`|` delimiter)
- `scripts/smoke-persistence.sh` - Same fix, mirrored identically
- `docs/DEPLOYMENT.md` - New: infrastructure overview, build process, deploy flow, ENV vars/secrets, troubleshooting

## Decisions Made
- Kept the fix minimal and localized to the existing `ENV_FILE_CREATED=1` branch in both scripts, per the plan's explicit constraint — a real operator-supplied `.env` is never mutated.
- Used `|` as the `sed` delimiter (not the default `/`) since `openssl rand -base64 32` output can contain `/` but never `|`, `&`, or `\` — avoids any need for replacement-side escaping.
- Did not modify `.env.example` — its placeholder-rejection behavior is intentional security design (WR-06); confirmed via `git diff -- .env.example` being empty after the change.
- `docs/DEPLOYMENT.md` links to `docs/deployment/reverse-proxy.md` for TLS/reverse-proxy specifics instead of duplicating that content, per the project's CLAUDE.md documentation convention (defer to existing docs, don't duplicate).

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` and `<done>` criteria without requiring auto-fixes, architectural changes, or scope adjustments.

## Issues Encountered

None. The plan's diagnosis (root cause: `.env.example`'s `BETTER_AUTH_SECRET` placeholder rejected by `apps/api/src/env.ts`'s `.refine()`) matched exactly; the fix worked on the first real end-to-end run against a live Docker daemon.

One environmental note (not a plan issue): a pre-existing local `.env` file was present in the working directory. It was moved aside (`mv .env .env.local-backup`) before running the verification so the auto-create branch would actually execute, and restored immediately after the smoke test completed and tore down its own containers/network/`.env`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CI's "Compose boot & persistence smoke tests" job should now pass, since the auto-created `.env` carries a valid generated secret instead of the rejected placeholder. (`scripts/smoke-persistence.sh` shares the identical fix and was not independently re-run against Docker in this task per the plan's verification scope, which specified `smoke-compose.sh` as the definitive proof — its logic is byte-identical to `smoke-compose.sh`'s newly-verified auto-create branch.)
- `docs/DEPLOYMENT.md` is available for any developer or operator to build/deploy/troubleshoot the stack without asking DevOps.
- No blockers.

---
*Phase: quick-260724-ecl*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: docs/DEPLOYMENT.md
- FOUND: scripts/smoke-compose.sh
- FOUND: scripts/smoke-persistence.sh
- FOUND: 205327a (Task 1 commit)
- FOUND: ee9fca4 (Task 2 commit)
