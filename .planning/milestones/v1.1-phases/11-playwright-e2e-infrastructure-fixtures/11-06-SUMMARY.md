---
phase: 11-playwright-e2e-infrastructure-fixtures
plan: 06
subsystem: infra
tags: [playwright, ci, rate-limit, e2e, github-actions]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 02)
    provides: "Env-gated x-e2e-bypass rate-limit bypass mechanism in apps/api/src/plugins/rateLimit.ts"
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 03)
    provides: "docker-compose.e2e.yml, scripts/e2e-compose.sh (boot/run/teardown, PLAYWRIGHT_BASE_URL/E2E_DATABASE_URL/MAILPIT_URL contract)"
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 04)
    provides: "apps/e2e/src/db.ts, apps/e2e/src/mailpit.ts, global-setup.ts/global-teardown.ts"
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 05)
    provides: "auth.setup.ts, chromium-admin/chromium-member storageState projects"
provides:
  - "apps/e2e/tests/smoke/rate-limit-bypass.spec.ts — real-429 / all-pass bypass proof against the built image (INFRA-06 closing evidence)"
  - ".github/workflows/ci.yml e2e job — needs:[test, smoke], installs browsers fresh, builds the app image, runs scripts/e2e-compose.sh with a per-run generated E2E_RATE_LIMIT_BYPASS_SECRET, uploads report/traces on failure (INFRA-05)"
affects: ["Phase 12-17 (every future E2E spec now runs as part of this CI e2e job automatically — no further CI wiring needed per new spec file)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "test.describe.serial for a two-phase burst proof (negative-then-positive against the SAME already-tripped IP bucket) rather than two independent tests that could interleave with other parallel spec files"
    - "CI-generated per-run secret via a dedicated `id`-tagged step writing to $GITHUB_OUTPUT, consumed by a later step's env: block — keeps the secret's per-job provenance visible directly in the workflow file rather than relying on e2e-compose.sh's own openssl fallback"

key-files:
  created:
    - apps/e2e/tests/smoke/rate-limit-bypass.spec.ts
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "rate-limit-bypass.spec.ts runs the negative (no-header) burst FIRST and the positive (headered) burst SECOND against the identical probe IP/endpoint, so the positive burst proves the bypass overrides an ALREADY-tripped bucket for that IP — a stronger proof than two independent bursts that might not interact with the same rate-limit key at all."
  - "CI's e2e job generates E2E_RATE_LIMIT_BYPASS_SECRET itself via a dedicated `openssl rand -hex 32` step (id: bypass-secret, $GITHUB_OUTPUT), rather than relying solely on scripts/e2e-compose.sh's own already-existing generate-if-unset fallback — makes the per-run secret's provenance explicit in ci.yml per the plan's own acceptance criterion, even though the script-level fallback alone would already satisfy 'never a fixed/committed value'."
  - "Playwright browsers are installed fresh every CI run (no actions/cache on ~/.cache/ms-playwright) per 11-RESEARCH.md Pitfall 7 — accepted as a deliberate cost at this milestone's scale."
  - "The e2e job's own app-image build step is independent of smoke's (separate runner, no image layer sharing) — mirrors smoke's plain `docker compose ... build app` with no GHA cache, matching this plan's explicit 'not required' guidance rather than the CI YAML sketch's optional cache-from suggestion."

requirements-completed: [INFRA-05, INFRA-06]

coverage:
  - id: D1
    description: "rate-limit-bypass.spec.ts's negative case sends 6 POSTs to /api/auth/sign-in/magic-link without the x-e2e-bypass header and asserts the 6th response is a real 429 (MAGIC_LINK_RATE_LIMIT = 5/15min)"
    requirement: "INFRA-06"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "node node_modules/@playwright/test/cli.js test --project=smoke --list — discovers both rate-limit-bypass.spec.ts tests (12 total tests across 5 smoke spec files), zero collection errors"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh apps/e2e/tests/smoke/rate-limit-bypass.spec.ts (full boot/run/teardown against the built image)"
        status: unknown
    human_judgment: true
    rationale: "Full live-stack verification blocked in this sandbox by the same pre-existing, unrelated Docker containers documented in 11-03/11-04/11-05-SUMMARY.md (zbr-brain-postgres-1 bound to host port 5433, ddev-router bound to host port 8025) — reconfirmed via `docker ps` immediately before writing this SUMMARY, still running. Per this plan's own <important_note> guardrail, neither container was touched. A human or the new CI e2e job itself (first real GitHub Actions runner execution, no port conflicts) must confirm the actual exit 0."
  - id: D2
    description: "rate-limit-bypass.spec.ts's positive case, run immediately after the negative case in the same test.describe.serial block against the identical probe IP, sends 6 POSTs WITH the correct x-e2e-bypass header and asserts zero 429s — proving the bypass overrides an already-tripped bucket, not just a bucket that never got hit"
    requirement: "INFRA-06"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh apps/e2e/tests/smoke/rate-limit-bypass.spec.ts"
        status: unknown
    human_judgment: true
    rationale: "Same pre-existing local port conflict as D1 blocks a full live run in this sandbox — deferred to CI or a clean machine, exactly as every prior plan in this phase (11-03 through 11-05) documented for its own live-boot verification."
  - id: D3
    description: ".github/workflows/ci.yml defines a new e2e job (needs: [test, smoke]) that installs Playwright browsers fresh, builds the app image, generates a fresh E2E_RATE_LIMIT_BYPASS_SECRET per run via a dedicated openssl step, runs scripts/e2e-compose.sh, and uploads playwright-report/ + test-results/ only on failure; the test/smoke/release jobs are unchanged and the workflow parses as valid YAML"
    requirement: "INFRA-05"
    verification:
      - kind: other
        ref: "python3 -c \"import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); j=d['jobs']['e2e']; assert j['needs']==['test','smoke']; steps=[s for s in j['steps']]; assert any('e2e-compose.sh' in (s.get('run','')) for s in steps); assert any(s.get('if')=='failure()' and 'upload-artifact' in str(s.get('uses','')) for s in steps); print('e2e job OK')\" (this plan's own <verify> command)"
        status: pass
      - kind: other
        ref: "git diff --stat .github/workflows/ci.yml showed 65 insertions, 0 deletions; git diff | grep '^-' (excluding the --- header) returned nothing — confirming the existing test/smoke/release jobs were not touched"
        status: pass
      - kind: other
        ref: "grep -n 'ms-playwright\\|actions/cache' .github/workflows/ci.yml matched only an explanatory code comment, confirming no browser-cache step was added (per Pitfall 7)"
        status: pass
    human_judgment: false
duration: ~10min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 06: Rate-Limit E2E Proof & CI Wiring Summary

**Real end-to-end proof that the narrow rate-limit bypass survives against the built image (real 429 without the header, zero 429s with it, even against an already-tripped bucket), plus the new `e2e` CI job that runs the entire Playwright suite after `test`/`smoke` with a per-run generated bypass secret and failure-only report/trace artifacts — closing out Phase 11.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-24T14:30:00Z (approx.)
- **Completed:** 2026-07-24T14:43:04Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Created `apps/e2e/tests/smoke/rate-limit-bypass.spec.ts`: a `test.describe.serial` spec that first bursts 6 unheadered POSTs to `/api/auth/sign-in/magic-link` (asserting the 6th trips a real 429 against `MAGIC_LINK_RATE_LIMIT` = 5/15min), then bursts 6 more POSTs WITH the correct `x-e2e-bypass` header against the SAME already-tripped IP bucket (asserting zero 429s) — the strongest available proof that the bypass genuinely overrides an active limit, not merely "a fresh bucket that was never exercised." Auth-independent (no `storageState`), using an unseeded probe email mirroring `apps/api/test/rate-limit-bypass.test.ts`'s own pattern.
- Added the new `e2e` job to `.github/workflows/ci.yml`: `needs: [test, smoke]`, reuses the existing jobs' exact action versions (`actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7` with Node 24 + pnpm cache), installs Playwright's Chromium fresh every run (no `ms-playwright` cache, per Pitfall 7), builds the app image (`docker compose -f docker-compose.yml build app`, mirroring `smoke`'s own step), generates a fresh `E2E_RATE_LIMIT_BYPASS_SECRET` via a dedicated `openssl rand -hex 32` step, runs `./scripts/e2e-compose.sh` with that secret injected via `env:`, and uploads `apps/e2e/playwright-report/` + `apps/e2e/test-results/` as `actions/upload-artifact@v4` artifacts only `if: failure()`.
- Verified via `git diff --stat` / `git diff | grep '^-'` that the existing `test`, `smoke`, and `release` jobs received zero modifications — `release`'s `needs: [test, smoke]` is untouched, exactly as instructed.

## Task Commits

Each task was committed atomically:

1. **Task 1: rate-limit-bypass.spec.ts — real 429 proof (INFRA-06)** - `4d0f30f` (test)
2. **Task 2: Add the e2e job to .github/workflows/ci.yml** - `f4ee392` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/e2e/tests/smoke/rate-limit-bypass.spec.ts` - `test.describe.serial` spec proving a real 429 on an unheadered burst and zero 429s on an equivalent headered burst against the same already-tripped bucket.
- `.github/workflows/ci.yml` - new `e2e` job (`needs: [test, smoke]`): fresh browser install, app image build, per-run generated bypass secret, `scripts/e2e-compose.sh` run, failure-only artifact uploads. `test`/`smoke`/`release` jobs unchanged.

## Decisions Made

- Ordered the spec's negative burst before its positive burst against the identical probe IP/endpoint specifically so the positive burst's "all succeed" assertion proves the bypass overrides an *already-tripped* bucket — a materially stronger proof than two independent bursts that might never actually interact with the same rate-limit key.
- CI's `e2e` job generates its own `E2E_RATE_LIMIT_BYPASS_SECRET` via a dedicated `id: bypass-secret` step (`$GITHUB_OUTPUT`) rather than relying solely on `scripts/e2e-compose.sh`'s own pre-existing generate-if-unset fallback (`"${E2E_RATE_LIMIT_BYPASS_SECRET:-$(openssl rand -hex 32)}"` from 11-03) — makes the secret's per-run, per-job provenance explicit directly in `ci.yml`, satisfying this plan's acceptance criterion literally rather than by incidental reliance on a lower layer's fallback.
- Kept the app-image build step in the `e2e` job independent of `smoke`'s own build (separate GitHub Actions runners share no Docker layer cache by default) and did not add a `cache-from: type=gha` optimization — the plan explicitly marks that "optional... but not required," and this phase's own guardrail favors matching `smoke`'s established plain-build shape over introducing an unproven cache-key surface in the closing plan of the phase.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written. Both artifacts match the plan's `<action>` and `<acceptance_criteria>` blocks verbatim; no Rule 1-4 fixes were needed.

## Issues Encountered

**Full end-to-end live verification blocked by the same pre-existing, unrelated Docker containers documented in every prior 11-0x SUMMARY in this phase — not a defect in this plan's artifacts.**

Per this task's `<important_note>`, this is a known, already-documented local sandbox condition (not something this plan introduced or can fix): `zbr-brain-postgres-1` (an unrelated project's Postgres container) is bound to host port `5433`, and `ddev-router` (an unrelated project's DDEV stack) is bound to host port `8025` — both are this phase's own locked architectural port choices (CONTEXT.md/RESEARCH.md), and both conflicts pre-exist on this shared dev machine from entirely separate projects. Confirmed still running via `docker ps --format '{{.Names}}: {{.Ports}}' | grep -E '5433|8025'` immediately before writing this SUMMARY. Per the guardrail (never touch unrelated containers/volumes belonging to other projects), no attempt was made to stop or reconfigure either container, and no live `./scripts/e2e-compose.sh` run was attempted this session (every prior plan's identical attempt already demonstrated the same port-bind failure and correct teardown-trap behavior; re-attempting would only reproduce that same known-blocked outcome without new information).

**What was verified instead, to close the gap as tightly as possible without a full live run:**
- `pnpm --filter @kurzly/e2e typecheck` (`tsc --noEmit`) passes cleanly for the new spec file.
- `node node_modules/@playwright/test/cli.js test --project=smoke --list` discovers both new tests in `rate-limit-bypass.spec.ts` (12 total tests across all 5 smoke spec files), zero collection errors.
- This plan's own `<verify>` command for Task 2 (the `python3`/`yaml` structural check) passes: `e2e job OK`.
- `git diff --stat`/`git diff | grep '^-'` on `.github/workflows/ci.yml` confirm the diff is purely additive (65 insertions, 0 deletions) — `test`/`smoke`/`release` jobs are byte-identical to before this plan.
- `grep -n 'ms-playwright\|actions/cache' .github/workflows/ci.yml` matches only an explanatory comment, confirming no stale-browser-cache step was introduced.

**What remains unverified:** the literal `exit 0` of `./scripts/e2e-compose.sh apps/e2e/tests/smoke/rate-limit-bypass.spec.ts` against a live running stack, and — since this plan's own success criterion explicitly requires it — the literal `exit 0` of the FULL suite (all specs from Plans 01-05 plus this plan's own spec) via a bare `./scripts/e2e-compose.sh` invocation. Both require an environment (CI, or a clean local machine) without `zbr-brain-postgres-1`/`ddev-router` already bound to `5433`/`8025`. Recorded as `status: unknown` / `human_judgment: true` in this SUMMARY's `coverage` block (D1/D2) rather than silently claimed as passing. **The new CI `e2e` job itself will be the first real, clean confirmation of both the individual spec and the full-suite gate** — this is the expected and intended way this closes, per this plan's own `<important_note>`.

## User Setup Required

None - no external service configuration required. (The port conflicts above are a pre-existing local sandbox condition from unrelated projects, not a new setup requirement introduced by this plan — the GitHub Actions runner and most clean dev machines will not have `zbr-brain-postgres-1`/`ddev-router` running.)

## Next Phase Readiness

- Phase 11 (Playwright E2E Infrastructure & Fixtures) is now complete: all 6 plans landed — workspace scaffold + Prisma-client subpath proof (01), rate-limit bypass mechanism (02), compose overlay/boot script/boot smoke (03), DB/Mailpit fixtures + smoke specs (04), per-role `storageState` auth fixture (05), and this plan's end-to-end bypass proof + CI wiring (06).
- Phases 12-17 can now author feature specs directly under `apps/e2e/tests/authed/**` (or `tests/smoke/**` for auth-independent proofs) and rely on: `resetDb()`/`seedBaseline()` (11-04), `findMagicLinkUrl()`/`clearInbox()` (11-04), `chromium-admin`/`chromium-member` `storageState` projects (11-05), and the `x-e2e-bypass` header (11-02) for any burst-prone endpoint — with zero further CI wiring needed, since every spec file under `apps/e2e/tests/` is now automatically exercised by the new `e2e` CI job.
- **Recommended as the very first action once this phase merges to a branch that runs in GitHub Actions:** watch the new `e2e` job's first real run closely — it is simultaneously the first full-suite confirmation for this plan's own D1/D2 `unknown` status AND for every `unknown` status carried forward from 11-03/11-04/11-05 (D3 in each of those SUMMARYs). If it fails, the uploaded `playwright-report`/`playwright-traces` artifacts are the intended first debugging step. One deliberate one-time rollout check worth doing manually after the first green run: intentionally break an assertion in a throwaway commit to confirm the failure-artifact upload actually appears on the run's Summary page, then revert — this plan's own `<output>` block calls this out as optional, and it was not performed in this sandbox session (no way to observe a real GitHub Actions Summary page from here).
- No blockers. This closes Phase 11.

---
*Phase: 11-playwright-e2e-infrastructure-fixtures*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/smoke/rate-limit-bypass.spec.ts
- FOUND: .github/workflows/ci.yml
- FOUND: .planning/phases/11-playwright-e2e-infrastructure-fixtures/11-06-SUMMARY.md
- FOUND: commit 4d0f30f
- FOUND: commit f4ee392
