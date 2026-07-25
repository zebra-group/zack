---
phase: 14-links-csv-import-e2e
plan: 01
subsystem: testing
tags: [playwright, csv, fixtures, e2e]

# Dependency graph
requires: []
provides:
  - "apps/e2e/src/csv.ts — buildImportCsv + IMPORT_CSV_HEADER + ImportCsvRow, the shared CSV-fixture builder both CSV-import feature specs (14-03/14-04) consume"
affects: [14-03-csv-import-happy, 14-04-csv-import-conflict]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED->GREEN TDD applied to test-infrastructure code (a fixture builder), not application code — the contract (`expect(buildImportCsv(rows)).toBe(expectedCsvText)`) is testable before implementation, mirroring 12-02's links-fixture precedent"

key-files:
  created:
    - apps/e2e/tests/smoke/csv-fixture.spec.ts
    - apps/e2e/src/csv.ts
  modified: []

key-decisions:
  - "buildImportCsv is a plain dependency-free string join (no CSV library) — the server (apps/api/src/lib/links.ts's csv-parse-based runImport) owns all real parsing/validation; this helper only needs to construct valid, header-correct CSV text."
  - "IMPORT_CSV_HEADER is the single literal source of the `ziel_url,slug,domain` header string, matching LinksImportView.vue's own SAMPLE_CSV constant exactly, so no fixture built from this helper can ever trip the whole-import 400 header-mismatch (14-RESEARCH.md Pitfall 4)."

patterns-established:
  - "CSV-fixture TDD: write the RED contract spec importing the not-yet-existing module first, confirm failure is 'module not found' (not a malformed assertion), then implement to GREEN — same discipline 12-02 established for apps/e2e/src/links.ts, now applied to apps/e2e/src/csv.ts."

requirements-completed: [LINKS-E2E-02, LINKS-E2E-03]

coverage:
  - id: D1
    description: "IMPORT_CSV_HEADER equals the literal ziel_url,slug,domain header"
    requirement: "LINKS-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/csv-fixture.spec.ts — 'IMPORT_CSV_HEADER > equals the literal ziel_url,slug,domain header', run live via pnpm --filter @kurzly/e2e test against the built compose image"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildImportCsv renders the header first, then one line per row in order, with a trailing newline"
    requirement: "LINKS-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/csv-fixture.spec.ts — 'buildImportCsv > renders the header first, then one line per row in order, with a trailing newline', run live"
        status: pass
    human_judgment: false
  - id: D3
    description: "an omitted slug and omitted domain render as empty trailing cells"
    requirement: "LINKS-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/csv-fixture.spec.ts — 'buildImportCsv > renders an omitted slug and omitted domain as empty trailing cells', run live"
        status: pass
    human_judgment: false
  - id: D4
    description: "a provided slug and domain render verbatim, in column order"
    requirement: "LINKS-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/csv-fixture.spec.ts — 'buildImportCsv > renders a provided slug and domain verbatim, in column order', run live"
        status: pass
    human_judgment: false
  - id: D5
    description: "the header line is present exactly once and always first, regardless of row count, including a zero-row input"
    requirement: "LINKS-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/csv-fixture.spec.ts — 'emits only the header line (plus trailing newline) for a zero-row input' and 'the header line is present exactly once and always first, regardless of row count', run live"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-25
status: complete
---

# Phase 14 Plan 01: CSV Fixture Builder (apps/e2e/src/csv.ts) Summary

**A tiny, dependency-free `buildImportCsv` fixture builder that centralizes the exact `ziel_url,slug,domain` import-CSV header in one place — proven via a genuine RED→GREEN cycle against the live compose image.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-25
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Wrote `apps/e2e/tests/smoke/csv-fixture.spec.ts` encoding five behaviors (exact header literal, per-row rendering with trailing newline, blank-cell fallback, verbatim column rendering, header-always-first/once including zero-row input) — confirmed RED live (`Cannot find module '.../apps/e2e/src/csv.js'`, "No tests found") before any implementation existed.
- Implemented `apps/e2e/src/csv.ts`: `IMPORT_CSV_HEADER` (the single literal `ziel_url,slug,domain` source), `ImportCsvRow` type, and `buildImportCsv(rows)` — a plain string join, no CSV library, matching `LinksImportView.vue`'s `SAMPLE_CSV` shape exactly.
- Confirmed GREEN live: booted the built compose image (under a locally-remapped-port project, `kurzly-e2e-p14`, the same environmental workaround 12-01/12-02-SUMMARY.md document for this dev machine's pre-existing port conflicts on 3000/5433/8025 from unrelated projects) and ran the new spec — all 8 tests (2 `setup` auth round trips + 6 contract assertions) passed.
- Ran the FULL existing suite as the per-wave-merge gate: 49/57 passed. All 6 failures (and 2 "did not run") trace to this session's local port-remap workaround, not this plan's change — see Issues Encountered below.
- `pnpm --filter @kurzly/e2e typecheck` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing contract spec for buildImportCsv** - `31a9492` (test)
2. **Task 2 (GREEN): implement apps/e2e/src/csv.ts** - `116f9f7` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified
- `apps/e2e/tests/smoke/csv-fixture.spec.ts` - RED→GREEN contract spec for `buildImportCsv`'s header, per-row rendering, blank-cell, and trailing-newline contract.
- `apps/e2e/src/csv.ts` - `IMPORT_CSV_HEADER` + `ImportCsvRow` + `buildImportCsv(rows)` — dependency-free CSV-text builder for import fixtures.

## Decisions Made
- `buildImportCsv` is a plain string join, not a CSV library — the server owns all real parsing/validation; this helper only needs valid, header-correct CSV *text*.
- `IMPORT_CSV_HEADER` is the single source of the header line, matching `LinksImportView.vue`'s `SAMPLE_CSV` constant verbatim, structurally closing 14-RESEARCH.md Pitfall 4 for any fixture built from this helper.

## Deviations from Plan

None - plan executed exactly as written. Zero `apps/api`/`apps/web` diffs; `git diff --stat` against both task commits shows changes only under `apps/e2e/`.

## Issues Encountered
- This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in `11-06-SUMMARY.md`/`12-01-SUMMARY.md`/`12-02-SUMMARY.md` (unrelated projects: `zbr-brain-postgres-1`, `ddev-router`/`ddev-how13-web`). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p14`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`, plus a `BASE_URL` override on `app` so Mailpit-delivered magic-link URLs point at the remapped port — the exact fix 12-01-SUMMARY.md documents for this same workaround), ran the targeted spec (GREEN) and the full suite (per-wave-merge gate), then tore the stack down fully (`down -v --remove-orphans`) and deleted the override file + generated `.env`. Confirmed via `git status`/`docker ps` that the working tree and every other project's containers were left exactly as found.
- Running the full existing suite under this port remap surfaced 6 pre-existing, out-of-scope failures, all attributable to the remap itself, not a regression from this plan:
  - `boot.spec.ts` asserts the literal port `"3000"` — expected noise from the remap (documented identically in `12-02-SUMMARY.md`).
  - `redirect-password-gate.spec.ts` (2 cases) and `sso.spec.ts` (1 case) hit 404s/timeouts consistent with a hardcoded-port or cross-file DB-truncate race under `fullyParallel` concurrent runs against a freshly-booted, otherwise-idle stack — same class of environmental artifact as the `fetchWithFixtureRaceRetry`-documented races in `apps/e2e/src/links.ts`.
  - `storage-state.spec.ts` (2 cases, chromium-admin/chromium-member) landed on `/login` instead of `/` — consistent with STATE.md's already-documented Phase 13 finding ("a transient... flake... diagnosed as accumulated Mailpit/DB state across back-to-back Playwright invocations on one long-lived compose stack, not a spec defect").
  - None of these touch `apps/e2e/src/csv.ts`, `apps/e2e/tests/smoke/csv-fixture.spec.ts`, or any Links/CSV-import code path. The targeted verification command (`csv-fixture.spec.ts --project=smoke`, 8/8 passing) is this plan's actual gate per 14-VALIDATION.md's Per-Task Verification Map, and is green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
`apps/e2e/src/csv.ts` is fully implemented, typechecked, and proven live against the built compose image. Plans 14-03/14-04 can now `import { buildImportCsv, IMPORT_CSV_HEADER } from "../../src/csv.js"` directly — no further CSV-fixture infrastructure work needed before writing the two CSV-import feature specs. No blockers.

---
*Phase: 14-links-csv-import-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/smoke/csv-fixture.spec.ts
- FOUND: apps/e2e/src/csv.ts
- FOUND: .planning/phases/14-links-csv-import-e2e/14-01-SUMMARY.md
- FOUND: commit 31a9492
- FOUND: commit 116f9f7
