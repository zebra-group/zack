---
phase: 12-redirect-handler-e2e-core-value
plan: 01
subsystem: testing
tags: [playwright, fastify, e2e, host-header, redirect]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: apps/e2e harness (Prisma client subpath, baseline seed, compose stack, smoke Playwright project)
provides:
  - Empirical proof that Playwright's APIRequestContext delivers a caller-supplied Host header unmodified to Fastify's request.hostname
  - Unblocks Wave 1 feature specs (12-03/12-04/12-05) to target the real registered redirect Domain (e2e.kurzly.local) over HTTP instead of the CR-07 app-own-host SPA-fallback branch
affects: [12-03-redirect-happy-path, 12-04-bot-og-branching, 12-05-utm-merge, 12-02-password-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Throwaway empirical spike (mirrors tests/smoke/prisma-import.spike.spec.ts) to close a RESEARCH Open Question before downstream specs depend on the mechanism it proves"
    - "Positive/control assertion pair (registered Host vs. default localhost Host) to prove a delta is genuinely driven by the mechanism under test, not incidental"

key-files:
  created:
    - apps/e2e/tests/smoke/host-header.spike.spec.ts
  modified: []

key-decisions:
  - "RESEARCH OQ-1/A1 CONFIRMED: Playwright APIRequestContext (request.get) delivers a caller-supplied Host header unmodified to Fastify's request.hostname — no raw http.request fallback needed for this phase's feature specs."
  - "Live-verified against the built compose image under an alternate docker-compose project name (kurzly-e2e-p12) with host ports remapped (13000/15433/18025) via an uncommitted override compose file with !override merge tags, because this dev machine already had unrelated projects bound to the canonical 3000/5433/8025 ports — docker-compose.e2e.yml itself was never edited, and the override file was deleted after verification."

patterns-established:
  - "Wave 0 spike pattern: prove a load-bearing test-infrastructure assumption with a minimal throwaway spec before any feature spec depends on it, rather than discovering the assumption is false mid-phase."

requirements-completed: [REDIRECT-E2E-01, REDIRECT-E2E-02, REDIRECT-E2E-03, REDIRECT-E2E-04, REDIRECT-E2E-05]

coverage:
  - id: D1
    description: "host-header.spike.spec.ts empirically proves Playwright APIRequestContext delivers a caller-supplied Host header unmodified to Fastify, unblocking every Host-header-dependent feature spec in this phase"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/host-header.spike.spec.ts — both tests, run live via ./scripts/e2e-compose.sh-equivalent (pnpm --filter @kurzly/e2e test) against the built compose image"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-24
status: complete
---

# Phase 12 Plan 01: Host-Header Spike (RESEARCH OQ-1/A1) Summary

**Empirically proved live against the built compose image that Playwright's APIRequestContext delivers a caller-supplied `Host: e2e.kurzly.local` header unmodified to Fastify, resolving the real registered redirect Domain instead of the CR-07 SPA-fallback branch.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-24T20:15:04Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Wrote `apps/e2e/tests/smoke/host-header.spike.spec.ts`, a throwaway spike mirroring `tests/smoke/prisma-import.spike.spec.ts`'s shape and header-comment convention.
- Positive case: a request to a guaranteed-missing slug with `Host: e2e.kurzly.local` and a real Chrome UA returns HTTP 404 with a body containing both `Dieser Kurzlink existiert nicht` (the branded 404 marker from `renderNotFoundPage`) and the echoed host `e2e.kurzly.local` — proof the Host header reached `resolveActiveDomainByHost` and resolved the real registered Domain.
- Control case: the same request without a `host` override (defaulting to `localhost`, the app's own `BASE_URL` host per CR-07) never shows the branded-404 marker — proof the delta above is genuinely Host-header-driven, not incidental.
- **Ran both tests live** against the actual built compose image (not just statically reasoned about) — see "Live Verification" below.
- Confirmed via `tsc --noEmit` that the new spec typechecks cleanly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write host-header spike proving APIRequestContext delivers a caller-supplied Host header to Fastify** - `2b4eb51` (test)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified
- `apps/e2e/tests/smoke/host-header.spike.spec.ts` - Throwaway empirical proof of RESEARCH OQ-1/A1; no application code touched.

## Live Verification (per the plan's `<important_note>`)

This dev machine has unrelated Docker projects already bound to the canonical E2E ports (`3000` — an unrelated `product-catalog` tsx dev server, `5433` — `zbr-brain-postgres-1`, `8025` — `ddev-router`'s published range), so `./scripts/e2e-compose.sh` itself could not be run unmodified without colliding with other projects' running containers.

Proved this live rather than settling for static reasoning:

1. Created an **uncommitted** `docker-compose.e2e.local-ports.override.yml` at the repo root (never touching `docker-compose.e2e.yml`), remapping only the three conflicting host ports using Compose's `!override` merge tag (Docker Compose v5.1.4 supports this; a naive `ports:` override without the tag additively merges list entries rather than replacing them, which was confirmed empirically — the first boot attempt failed with `port 5433 already allocated` before the `!override` tag was added):
   - `db`: `15433:5432` (was `5433:5432`)
   - `app`: `13000:3000` (was `3000:3000`), plus `BASE_URL: http://localhost:13000` so magic-link URLs stay host-followable
   - `mailpit`: `18025:8025` (web UI), `1025:1025` (SMTP, unchanged — already free)
2. Booted under an alternate project name: `docker compose -p kurzly-e2e-p12 -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml -f docker-compose.e2e.local-ports.override.yml up -d --wait`.
   - First boot attempt hit `initdb: error: could not create directory ... No space left on device` — Docker Desktop's own VM disk was at 100% (78.4G/74.5G used, 0 available), unrelated to any other project's containers/volumes. Freed space safely via `docker builder prune -f` (reclaimed ~15.9GB of build cache only — no other project's images, volumes, or running containers were touched), then retried successfully; all three containers (`db`, `mailpit`, `app`) reported healthy.
3. Ran the spec against the live stack: `E2E_RATE_LIMIT_BYPASS_SECRET=... E2E_DATABASE_URL=postgresql://kurzly:changeme@localhost:15433/kurzly MAILPIT_URL=http://localhost:18025 PLAYWRIGHT_BASE_URL=http://localhost:13000 pnpm --filter @kurzly/e2e test tests/smoke/host-header.spike.spec.ts` — **4 passed** (2 `setup` project auth round-trips + both spike assertions), 3.2s.
4. Tore the stack down fully: `docker compose ... down -v --remove-orphans` (containers, network, and volume removed).
5. Deleted the uncommitted override file and the auto-generated `.env` (neither existed before this run).
6. Confirmed via `docker ps` and `git status --short` that the working tree and every other project's running containers were left exactly as found — only the new spec file is staged for commit.

**Result: PROVEN LIVE**, not just statically reasoned about. RESEARCH OQ-1/A1 is closed green with real empirical evidence from the built image.

## Decisions Made
- RESEARCH OQ-1/A1 is CONFIRMED: no raw `http.request` fallback is needed anywhere in this phase — every downstream feature spec (12-02 through 12-05) can safely use `request.get(..., { headers: { host: BASELINE_DOMAIN_HOSTNAME } })` to target the real registered redirect Domain.
- Docker Compose's `!override` merge tag is required (not optional) whenever an override compose file needs to fully replace a `ports:` (or other list-typed) key already defined in an earlier `-f` file — a bare re-declaration merges additively and can reintroduce a conflicting host port binding.

## Deviations from Plan

None affecting the plan's scope or acceptance criteria. One environmental blocker encountered and resolved during live verification (documented above): Docker Desktop's VM disk was full; resolved via `docker builder prune -f` (safe — build cache only, no other project's data touched). This is not a Rule 1/2/3 code deviation, just an environment prerequisite for the live-verification the plan's `<important_note>` requested.

## Issues Encountered
- Docker Desktop's underlying VM disk was at 100% capacity (unrelated to this project or any of the other running projects' data) — resolved by pruning reclaimable build cache (`docker builder prune -f`, ~15.9GB freed), which does not touch any project's images, volumes, or running containers.
- A first override-compose attempt without the `!override` merge tag additively merged `ports:` entries rather than replacing them, causing a `port 5433 already allocated` failure even though the override specified `15433:5432` — fixed by adding `!override` to each remapped `ports:` key.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 0 gate is closed: 12-03/12-04/12-05 (and 12-02) can proceed using Host-header-driven `request.get`/`page.goto` calls against `BASELINE_DOMAIN_HOSTNAME` with full confidence the mechanism works, proven against the real built image, not just the RESEARCH document's assumption. No blockers for Wave 1.

---
*Phase: 12-redirect-handler-e2e-core-value*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/smoke/host-header.spike.spec.ts
- FOUND: commit 2b4eb51
- FOUND: .planning/phases/12-redirect-handler-e2e-core-value/12-01-SUMMARY.md
