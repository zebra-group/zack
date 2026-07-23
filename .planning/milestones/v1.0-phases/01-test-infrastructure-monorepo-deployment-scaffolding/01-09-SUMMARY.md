---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 09
subsystem: infra
tags: [github-actions, ci, testcontainers, vitest, caddy, nginx, traefik, certbot, docker-compose]

# Dependency graph
requires:
  - phase: 01-05
    provides: testcontainers Postgres + Vitest globalSetup TDD harness that CI now enforces on every push/PR
  - phase: 01-08
    provides: Dockerfile + docker-compose.yml (single app port, named db-data volume) that the reverse-proxy docs sit in front of and the CI smoke job builds/exercises
provides:
  - .github/workflows/ci.yml running install → prisma generate → topological build → typecheck → full real-Postgres Vitest suite on every push/pull_request (D-11)
  - A second CI job building the app image and running scripts/smoke-compose.sh / scripts/smoke-persistence.sh (INFRA-01/INFRA-03) once tests pass
  - docs/deployment/reverse-proxy.md with Caddy, nginx+certbot, and Traefik examples plus a durability warning (D-03/D-04)
affects: [phase-03-multi-domain-tls-routing]

# Tech tracking
tech-stack:
  added: [github-actions (actions/checkout@v4, pnpm/action-setup@v4, actions/setup-node@v4), caddy:2-alpine (documented, not installed), traefik:v3.1 (documented, not installed)]
  patterns:
    - "CI belt-and-suspenders prisma generate with placeholder DATABASE_URL, mirroring the Dockerfile build stage's pattern from 01-08"
    - "CI split into a fast `test` job (workspace-only, no Docker image build) and a slower `smoke` job (needs: test) that builds the image and runs the compose-driven boot/persistence scripts"

key-files:
  created:
    - .github/workflows/ci.yml
    - docs/deployment/reverse-proxy.md
  modified: []

key-decisions:
  - "Kept scripts/smoke-compose.sh and scripts/smoke-persistence.sh out of the primary `test` job (which only needs the pnpm workspace) and ran them in a separate `smoke` job gated on `needs: test`, since they require the built Docker image rather than raw source — matches the plan's 'separate optional job or documented follow-up' instruction."
  - "Reused the exact placeholder DATABASE_URL pattern from the Dockerfile's build stage (postgresql://placeholder:placeholder@localhost:5432/placeholder) for CI's explicit `prisma generate` step, since prisma.config.ts resolves DATABASE_URL eagerly via env() even for a connection-less `generate` call."
  - "Added a typecheck step (`pnpm run typecheck`) between build and test per the plan's acceptance criteria, using the root package.json script (`pnpm -r exec tsc --noEmit`) already established in prior plans."
  - "reverse-proxy.md explicitly documents Host-header forwarding for all three proxies now, ahead of Phase 3's multi-domain routing, since every example already needed that line/directive/label anyway."

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "CI workflow installs, builds, typechecks, and runs the full Vitest suite (real Postgres via testcontainers) on every push and pull_request"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "test -f .github/workflows/ci.yml && grep -q 'pnpm run -r test' .github/workflows/ci.yml && grep -q 'node-version: 24' .github/workflows/ci.yml"
        status: pass
    human_judgment: true
    rationale: "Static grep verifies the workflow file's shape, but only an actual GitHub Actions run (which requires pushing/opening a PR against GitHub) can prove the testcontainers Postgres job genuinely passes in that environment; not exercisable from this local execution context."
  - id: D2
    description: "Operators have documented, copy-pasteable reverse-proxy/TLS examples (Caddy, nginx, Traefik, certbot) stating only the app port is exposed and TLS is the operator's responsibility"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "test -f docs/deployment/reverse-proxy.md && grep -qi caddy docs/deployment/reverse-proxy.md && grep -qi traefik docs/deployment/reverse-proxy.md && grep -qi nginx docs/deployment/reverse-proxy.md && grep -qi certbot docs/deployment/reverse-proxy.md"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-11
status: complete
---

# Phase 1 Plan 9: CI Enforcement & Reverse-Proxy Documentation Summary

**GitHub Actions CI running the full real-Postgres Vitest suite on every push/PR (D-11), plus Caddy/nginx/Traefik reverse-proxy documentation closing out the phase (D-03/D-04)**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-10T22:11:39Z
- **Completed:** 2026-07-10T22:15:40Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- `.github/workflows/ci.yml`: a `test` job (checkout → pnpm/action-setup → setup-node@24 with pnpm cache → `pnpm install --frozen-lockfile` → explicit `prisma generate` with placeholder DATABASE_URL → `pnpm run -r build` → `pnpm run typecheck` → `pnpm run -r test`) enforcing the TDD mandate on every push and pull_request, plus a `smoke` job that builds the app image and runs the D-08/INFRA-03 compose boot/persistence scripts once tests pass.
- `docs/deployment/reverse-proxy.md`: complete, copy-pasteable Caddyfile (automatic HTTPS), nginx server block + certbot webroot issuance command, and Traefik labels/compose service — all forwarding the `Host` header to `app:3000`, all noting only the app port is published, and all closing with an explicit warning never to run `docker compose down -v` on a routine restart.

## Task Commits

Each task was committed atomically:

1. **Task 1: CI workflow running the full suite on every change (D-11)** - `2cf0219` (feat)
2. **Task 2: Reverse-proxy / TLS deployment documentation (D-03/D-04)** - `7bee153` (docs)

**Plan metadata:** (this commit, added after SUMMARY)

## Files Created/Modified
- `.github/workflows/ci.yml` - CI: install, explicit prisma generate, topological build, typecheck, full testcontainers-backed test run, plus a downstream Docker-image smoke job
- `docs/deployment/reverse-proxy.md` - Caddy/nginx+certbot/Traefik reverse-proxy + TLS guide for self-hosted operators

## Decisions Made
- Split CI into `test` (fast, workspace-only) and `smoke` (needs: test, builds the Docker image and runs `scripts/smoke-compose.sh`/`scripts/smoke-persistence.sh`) rather than folding the compose smoke scripts into the primary test job, per the plan's explicit guidance to keep them "a separate optional job or documented follow-up."
- Reused the Dockerfile's placeholder-`DATABASE_URL` trick for CI's standalone `prisma generate` step, since `prisma.config.ts` resolves `DATABASE_URL` eagerly via `env()` at config-load time even for a connection-less `generate` invocation (established in 01-08).

## Deviations from Plan

None - plan executed exactly as written. The plan's "Claude's discretion" note about the smoke scripts (separate job vs. documented follow-up) was resolved in favor of a separate `smoke` job, since the scripts already exist (from 01-08) and running them in CI provides stronger continuous enforcement of INFRA-01/INFRA-03 than a written follow-up note would.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The reverse-proxy documentation is itself the "setup guide" operators will follow when deploying, but nothing in this plan requires configuring an external service to complete the plan itself.

## Next Phase Readiness

Phase 1 (test-infrastructure-monorepo-deployment-scaffolding) is now complete: all 9 plans executed. The TDD harness (real Postgres via testcontainers, Vitest globalSetup/setupFileEach, transaction-rollback isolation) is continuously enforced by CI on every push/PR, and operators have concrete TLS guidance for the single-app-port Docker Compose deployment. Phase 3 (multi-domain TLS routing) should re-scope its planning against this plan's deferred note: since D-03/D-04 delegate TLS/proxy entirely to documented operator config, Phase 3 likely reduces to app-side domain verification + documentation rather than in-product TLS routing implementation.

---
*Phase: 01-test-infrastructure-monorepo-deployment-scaffolding*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: .github/workflows/ci.yml
- FOUND: docs/deployment/reverse-proxy.md
- FOUND: commit 2cf0219 (Task 1)
- FOUND: commit 7bee153 (Task 2)
