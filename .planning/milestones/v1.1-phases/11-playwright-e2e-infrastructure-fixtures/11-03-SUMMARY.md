---
phase: 11-playwright-e2e-infrastructure-fixtures
plan: 03
subsystem: infra
tags: [docker-compose, playwright, e2e, ci, fastify, helmet]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 01)
    provides: "@kurzly/e2e workspace scaffold, playwright.config.ts with a smoke project"
provides:
  - "docker-compose.e2e.yml — third additive compose overlay (publishes db 5433:5432, pins deterministic app test env)"
  - "scripts/e2e-compose.sh — boot/run/always-teardown entrypoint (-p kurzly-e2e, exports host-runner env contract)"
  - "apps/e2e/tests/smoke/boot.spec.ts — built-image boot proof (CSP header + /health + :3000 origin)"
affects: [11-04, 11-05, 11-06, "CI e2e job (future plan)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Third additive docker-compose overlay pattern (docker-compose.yml + docker-compose.dev.yml + docker-compose.e2e.yml), mirroring scripts/smoke-compose.sh's boot/teardown structure under a distinct compose project name"
    - "Playwright request-fixture-only smoke spec (no navigation, no storageState) as built-image evidence via a helmet-injected CSP header"

key-files:
  created:
    - docker-compose.e2e.yml
    - scripts/e2e-compose.sh
    - apps/e2e/tests/smoke/boot.spec.ts
  modified: []

key-decisions:
  - "scripts/e2e-compose.sh derives E2E_DATABASE_URL's Postgres credentials by reading POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB from the bootstrapped .env at runtime (falling back to kurzly/changeme/kurzly, matching .env.example), rather than hardcoding the literal default string, so a customized local .env stays in sync with the exported E2E_DATABASE_URL."
  - "boot.spec.ts asserts the CSP directive via string containment (toContain(\"default-src 'self'\")) rather than an exact-match, since @fastify/helmet's registerHelmet also sets styleSrc/fontSrc/scriptSrc/imgSrc directives in the same header value."

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "docker-compose.e2e.yml is a purely additive third overlay: db publishes 5433:5432, app.environment pins SMTP_HOST=mailpit/BASE_URL/INITIAL_ADMIN_EMAIL/E2E_RATE_LIMIT_BYPASS_SECRET (env-interpolated, no literal default), zero edits to docker-compose.yml/docker-compose.dev.yml"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "docker compose -p kurzly-e2e-cfgcheck -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml config (rendered output confirms db port 5433, all pinned app.environment keys present, E2E_RATE_LIMIT_BYPASS_SECRET sourced from the invoking shell env)"
        status: pass
      - kind: other
        ref: "git status --short showed only docker-compose.e2e.yml as new; docker-compose.yml and docker-compose.dev.yml untouched"
        status: pass
    human_judgment: false
  - id: D2
    description: "scripts/e2e-compose.sh boots the 3-file stack under -p kurzly-e2e, generates E2E_RATE_LIMIT_BYPASS_SECRET if unset, exports E2E_DATABASE_URL/MAILPIT_URL/PLAYWRIGHT_BASE_URL, runs pnpm --filter @kurzly/e2e test with forwarded args, and always tears the stack down via a trap"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "bash -n scripts/e2e-compose.sh && test -x scripts/e2e-compose.sh && grep -q kurzly-e2e ... && grep -q 'down -v --remove-orphans' ... => 'script shape OK'"
        status: pass
      - kind: other
        ref: "Two live invocations of ./scripts/e2e-compose.sh in this sandbox both correctly ran the docker compose up sequence (building the app image successfully both times) and, on failure, correctly executed the teardown trap (down -v --remove-orphans) leaving zero kurzly-e2e containers behind — confirmed via docker ps -a afterward"
        status: pass
    human_judgment: false
  - id: D3
    description: "apps/e2e/tests/smoke/boot.spec.ts asserts GET /health == 200 with body {status:'ok'}, a content-security-policy header containing default-src 'self', and a :3000 effective base URL — proving the suite hits the built image, not a dev server"
    requirement: "INFRA-01"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "Direct source verification: apps/api/src/routes/health.ts returns exactly { status: \"ok\" }; apps/api/src/plugins/helmet.ts's contentSecurityPolicy.directives.defaultSrc is exactly [\"'self'\"] — both match the spec's literal assertions"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh apps/e2e/tests/smoke/boot.spec.ts (full boot/run/teardown against the built image)"
        status: unknown
    human_judgment: true
    rationale: "Could not complete a full end-to-end run of the script in this sandbox: two separate attempts each failed at container port-binding due to PRE-EXISTING, unrelated Docker containers on this shared dev machine occupying the exact host ports this phase's locked architecture requires (zbr-brain-postgres-1 already bound to 5433; ddev-router already bound to 8025) — not a defect in any artifact this plan produced. Both attempts got as far as successfully building the app image and correctly running the teardown trap on failure (zero leftover kurzly-e2e containers). A human or CI runner without those two specific conflicting containers must confirm the actual `exit 0` end-to-end, per the plan's own acceptance criterion."
---

# Phase 11 Plan 03: Compose E2E Overlay, Boot Script & Boot Smoke Spec Summary

**Third additive `docker-compose.e2e.yml` overlay (Postgres on 5433, deterministic app test env) plus `scripts/e2e-compose.sh` (boot/run/always-teardown under `-p kurzly-e2e`) and a helmet-CSP-based boot smoke spec proving the suite targets the built Docker image at :3000, never a dev server.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-24T16:20:00Z (approx.)
- **Completed:** 2026-07-24T16:45:00Z (approx.)
- **Tasks:** 3/3 completed
- **Files modified:** 3 (all created, no existing files touched)

## Accomplishments
- Added `docker-compose.e2e.yml`, a purely additive third overlay: publishes `db` on host `5433:5432` and pins `app`'s test environment (`SMTP_HOST=mailpit`, `BASE_URL=http://localhost:3000`, `INITIAL_ADMIN_EMAIL=admin@e2e.kurzly.local`, `E2E_RATE_LIMIT_BYPASS_SECRET` interpolated from the environment) — verified via `docker compose ... config` that the base `docker-compose.yml`/`docker-compose.dev.yml` files require zero edits.
- Added `scripts/e2e-compose.sh`, mirroring `scripts/smoke-compose.sh`'s trap-based cleanup and `.env`-bootstrap structure, boots the 3-file stack under project name `kurzly-e2e`, generates a fresh `E2E_RATE_LIMIT_BYPASS_SECRET` when the caller hasn't supplied one, exports the host-runner env contract (`E2E_DATABASE_URL`, `MAILPIT_URL`, `PLAYWRIGHT_BASE_URL`) for downstream plans, and always tears the stack down via a `trap ... EXIT`.
- Added `apps/e2e/tests/smoke/boot.spec.ts`, an auth-independent, request-fixture-only spec asserting `GET /health` returns `{status:"ok"}`, a `content-security-policy` header containing `default-src 'self'` (built-image-only evidence from `@fastify/helmet`), and that the effective base URL resolves to a `:3000` origin.
- Confirmed (via direct source inspection, not assumption) that `apps/api/src/routes/health.ts`'s response body and `apps/api/src/plugins/helmet.ts`'s `defaultSrc` directive exactly match the spec's literal assertions before writing them.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the additive docker-compose.e2e.yml overlay** - `2fb3692` (feat)
2. **Task 2: Create scripts/e2e-compose.sh (boot / run / always-teardown)** - `f51577d` (feat)
3. **Task 3: Boot smoke spec — proves the suite hits the built image, not a dev server** - `47e77c6` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified
- `docker-compose.e2e.yml` - new third additive compose overlay: `db` publishes `5433:5432`; `app.environment` pins the deterministic E2E test config.
- `scripts/e2e-compose.sh` - new executable boot/run/always-teardown entrypoint mirroring `scripts/smoke-compose.sh`'s structure, plus the host-runner env exports (`E2E_DATABASE_URL`, `MAILPIT_URL`, `PLAYWRIGHT_BASE_URL`) and bypass-secret generation.
- `apps/e2e/tests/smoke/boot.spec.ts` - new boot smoke spec in the `smoke` Playwright project, asserting built-image evidence via the helmet CSP header, `/health` body, and the effective base URL's port.

## Decisions Made
- `scripts/e2e-compose.sh` reads `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` out of the bootstrapped `.env` at runtime (falling back to `kurzly`/`changeme`/`kurzly` if any are absent) to build `E2E_DATABASE_URL`, rather than hardcoding the literal default connection string — keeps the exported URL correct even if an operator customized their local `.env`'s Postgres credentials, while still matching the plan's stated default.
- `boot.spec.ts` uses `toContain("default-src 'self'")` rather than an exact-string CSP match, since `registerHelmet` sets multiple directives (`styleSrc`, `fontSrc`, `scriptSrc`, `imgSrc`) in the same serialized header value — containment is the correct assertion for "the default-src directive is present and locked to 'self'", matching the plan's own acceptance criterion wording.

## Deviations from Plan

None - plan executed exactly as written. All three artifacts match the plan's `<action>` and `<acceptance_criteria>` blocks verbatim; no Rule 1-4 fixes were needed.

## Issues Encountered

**Full end-to-end script verification blocked by pre-existing, unrelated Docker containers in this sandbox — not a defect in this plan's artifacts.**

Two live attempts to run `./scripts/e2e-compose.sh apps/e2e/tests/smoke/boot.spec.ts` (the plan's own Task 3 `<verify>` command) were made:

1. First attempt: the app image built successfully (Dockerfile multi-stage build, `apps/web` Vite build, `pnpm deploy --filter=@kurzly/api --prod`), the `kurzly-e2e` network/volume were created, but `db` failed to bind host port `5433` — already bound by a pre-existing, unrelated `zbr-brain-postgres-1` container from a different project on this shared dev machine. The teardown trap correctly ran `down -v --remove-orphans` on failure.
2. Second attempt: `db` bound cleanly this time, but `mailpit` failed to bind host port `8025` — already bound by a pre-existing, unrelated `ddev-router` container (another project's DDEV stack) on the same machine. The teardown trap again correctly fired, leaving zero `kurzly-e2e` containers behind (`docker ps -a` confirmed).

Both `5433` and `8025` are locked-in architectural decisions from CONTEXT.md/RESEARCH.md (not something this plan can or should change), and both conflicts come from containers belonging to entirely separate, unrelated projects already running on this development machine — not from anything this plan created or left behind. Per this plan's own guardrails ("never touch unrelated containers/volumes"), no attempt was made to stop or reconfigure those other projects' containers.

**What was verified instead, to close the gap as tightly as possible without a full live run:**
- `docker compose ... config` (Task 1's own verify command) renders correctly, confirming `db` port 5433 and all pinned `app.environment` keys.
- `bash -n` + executable-bit + structural greps (Task 2's own verify command) all pass.
- `pnpm --filter @kurzly/e2e typecheck` passes cleanly on `boot.spec.ts`.
- Direct source inspection confirms `apps/api/src/routes/health.ts` returns exactly `{ status: "ok" }` and `apps/api/src/plugins/helmet.ts`'s `defaultSrc` directive is exactly `["'self'"]` — both match the spec's literal assertions.
- The app Docker image itself built successfully twice, proving the Dockerfile/build path this suite depends on is sound.

**What remains unverified:** the literal `exit 0` of the full `./scripts/e2e-compose.sh apps/e2e/tests/smoke/boot.spec.ts` invocation, end-to-end, against a running stack. This requires an environment (CI, or a clean local machine) without a conflicting service already bound to `5433`/`8025`. Recorded as `status: unknown` / `human_judgment: true` in this SUMMARY's `coverage` block (D3) rather than silently claimed as passing.

## User Setup Required

None - no external service configuration required. (The two port conflicts encountered above are a pre-existing local sandbox condition from unrelated projects, not a new setup requirement introduced by this plan — CI and most clean dev machines will not have `zbr-brain-postgres-1`/`ddev-router` running.)

## Next Phase Readiness

- `docker-compose.e2e.yml`, `scripts/e2e-compose.sh`, and `boot.spec.ts` are all in place and statically verified; the next plans in this phase (Mailpit wiring `apps/e2e/src/mailpit.ts`, DB seed/reset `apps/e2e/src/db.ts`, `auth.setup.ts`) can build directly on top of this boot/teardown entrypoint and its exported `E2E_DATABASE_URL`/`MAILPIT_URL`/`PLAYWRIGHT_BASE_URL` env contract.
- **Recommended before this phase's final CI-wiring plan ships:** re-run `./scripts/e2e-compose.sh apps/e2e/tests/smoke/boot.spec.ts` once in a clean environment (or let the new CI `e2e` job itself be the first real confirmation) to close out D3's `unknown` status — the GitHub Actions runner will not have this sandbox's two conflicting local containers.
- No blockers for proceeding to the next plan in this phase.

---
*Phase: 11-playwright-e2e-infrastructure-fixtures*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: docker-compose.e2e.yml
- FOUND: scripts/e2e-compose.sh
- FOUND: apps/e2e/tests/smoke/boot.spec.ts
- FOUND: .planning/phases/11-playwright-e2e-infrastructure-fixtures/11-03-SUMMARY.md
- FOUND: commit 2fb3692
- FOUND: commit f51577d
- FOUND: commit 47e77c6
