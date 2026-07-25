---
phase: 14-links-csv-import-e2e
plan: 03
subsystem: testing
tags: [playwright, e2e, links, csv-import, chromium-admin]

# Dependency graph
requires:
  - phase: 14-links-csv-import-e2e
    provides: "14-01's apps/e2e/src/csv.ts buildImportCsv/IMPORT_CSV_HEADER fixture builder"
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: "storageState auth fixtures (chromium-admin/chromium-member projects, tests/authed/ testMatch), createE2ePrisma"
provides:
  - "apps/e2e/tests/authed/csv-import-happy.spec.ts — LINKS-E2E-02, the CSV bulk-import happy path (valid CSV -> preview -> commit) driven through the real hidden file input and real UI buttons, DB-asserted at commit"
affects: [14-04-csv-import-conflict]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Preview/commit consistency proof: assert BOTH the commit response's importedCount AND a direct-Prisma findMany scoped to the two per-test slugs (targetUrl + domainId match) — closes T-14-04, proving commit == preview with no silent extras, not just a status-code check"
    - "Local minimal response-body types (ImportPreviewBody/ImportCommitBody) instead of importing @kurzly/shared's ImportPreviewResult/ImportCommitResult — apps/e2e does not depend on @kurzly/shared, and only two numeric fields are asserted from the JSON body here"

key-files:
  created:
    - apps/e2e/tests/authed/csv-import-happy.spec.ts
  modified: []

key-decisions:
  - "Selected the baseline domain in the default-domain dropdown BEFORE uploading the CSV — csvText is still empty at that point, so LinksImportView.vue's watch(defaultDomainId, ...) does not fire a second, racing preview (14-RESEARCH.md Pitfall 3)."
  - "Did not extract or reference any 'preview id' from the preview response — none exists. Commit re-sends the identical built CSV string (kept in scope across both calls in the test, exactly like LinksImportView.vue's own csvText ref)."
  - "Defined local minimal response-body types instead of adding @kurzly/shared as a new apps/e2e devDependency — kept this test-authoring-only phase's dependency surface unchanged; the DB findMany (not the JSON body) is the real 'no silent extras' proof anyway."

patterns-established: []

requirements-completed: [LINKS-E2E-02]

coverage:
  - id: D1
    description: "Uploading a valid two-row CSV through the real hidden file input renders a preview of exactly 2 valid rows (2 gültig, zero skipped)"
    requirement: "LINKS-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/csv-import-happy.spec.ts — 'LINKS-E2E-02: CSV import happy path (preview -> commit, DB-asserted) > valid CSV previews two rows and commit writes exactly those rows', run live via a locally port-remapped compose boot of the built image, --project=chromium-admin"
        status: pass
    human_judgment: false
  - id: D2
    description: "Committing writes exactly the two previewed rows — commit response importedCount is 2 AND a direct-Prisma findMany scoped to the two slugs returns exactly 2 rows with matching target URLs on the baseline domain, no silent extras"
    requirement: "LINKS-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/csv-import-happy.spec.ts — same test, COMMIT + DB assertion sections, run live"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-07-25
status: complete
---

# Phase 14 Plan 03: LINKS-E2E-02 CSV Import Happy Path Summary

**A single Playwright spec proving the CSV bulk-import happy path end-to-end: a valid two-row CSV previews as exactly 2 valid rows through the real hidden file input, and committing writes exactly those two rows — asserted both by the commit response and directly against PostgreSQL via a slug-scoped Prisma findMany.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-25
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Wrote `apps/e2e/tests/authed/csv-import-happy.spec.ts`: mints two per-test random slugs/targets, builds the CSV via 14-01's `buildImportCsv` (blank `domain` column on both rows), selects the baseline domain in the dropdown BEFORE upload, uploads via `setInputFiles` on the real hidden `<input type="file">`, asserts the rendered preview (`.valid-count` = "2 gültig", exactly two `.preview-row`, none `.invalid`, no `.skipped-count`) AND the typed preview response body (`validCount: 2`, `skippedCount: 0`, `rows.length: 2`), clicks the real "Importieren (2)" button, asserts the commit response's `importedCount: 2`, then asserts directly against Postgres: a `prisma.link.findMany` scoped to the two slugs returns exactly 2 rows with matching `targetUrl`/`domainId` (baseline domain) — closing threat T-14-04 (commit writing more/fewer rows than previewed).
- Scoped to `chromium-admin` only via a `test.beforeEach` skip, matching 14-02's precedent (member/domain-scoped import authz is Phase 17's job).
- Confirmed live, three separate times against the built compose image: once for the targeted spec alone, once for the full `tests/authed/` directory at `--workers=1`, once at default parallelism on a freshly rebooted stack — all green, zero `apps/api`/`apps/web` diffs. 14-RESEARCH.md's documented selectors/response shapes matched the real rendered markup and API responses exactly on the first attempt.
- `pnpm --filter @kurzly/e2e typecheck` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: LINKS-E2E-02 — valid CSV preview + commit, DB-asserted (chromium-admin)** - `30a7320` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified
- `apps/e2e/tests/authed/csv-import-happy.spec.ts` - LINKS-E2E-02: valid CSV upload -> preview (row count/diff) -> commit, DB-asserted against the baseline domain's two newly-created Links, chromium-admin only.

## Decisions Made
- Default domain selected in the dropdown BEFORE uploading the CSV — avoids the documented double-preview race from `watch(defaultDomainId, ...)` (14-RESEARCH.md Pitfall 3).
- No "preview id" extraction/reference — confirmed none exists; the built CSV string is kept in scope and re-sent verbatim for both the preview and commit calls.
- Local minimal response-body types (`ImportPreviewBody`/`ImportCommitBody`) rather than importing `@kurzly/shared`'s `ImportPreviewResult`/`ImportCommitResult` — `apps/e2e` has no dependency on `@kurzly/shared`, and only two numeric fields from each JSON body are asserted; the real "no silent extras" proof is the DB `findMany`, not a full response-shape assertion.
- No production code changes — `LinksImportView.vue`, `api.ts`'s `previewImport`/`commitImport`, and the backend `runImport` core all behaved exactly as 14-RESEARCH.md documented; no genuine app bug was found while driving the real UI live.

## Deviations from Plan

None - plan executed exactly as written. Zero `apps/api`/`apps/web` diffs; the only file changed is the new spec file itself.

## Issues Encountered
- Same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in `11-06`/`12-01`/`12-02`/`14-01`/`14-02-SUMMARY.md` (unrelated projects: `zbr-brain-postgres-1`, `ddev-router`/`ddev-how13-web`). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p14-03`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`, plus a `BASE_URL` override on `app`), ran the targeted spec (green), the full `tests/authed/` directory at `--workers=1` (green), then hit the exact "3rd-consecutive-invocation" magic-link rate-limit flake already documented in STATE.md/`14-01`/`14-02-SUMMARY.md` on the first default-parallelism attempt against the same long-lived stack (`auth.setup.ts`'s member magic-link request got a `429`). Rebooted the stack fresh and re-ran the full `tests/authed/` suite once at default parallelism: 6 passed, 2 skipped, zero flakes — the definitive, reported result for this plan's verification gate. Tore the stack down fully (`down -v --remove-orphans`), removed this session's own scratch Docker images (`kurzly-e2e-p14-03-app`/`-oidc-mock`), and deleted the override file + generated `.env`. Confirmed via `docker ps`/`git status --short` that only this session's own stack was touched and the working tree is clean apart from this plan's own spec file.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
LINKS-E2E-02 is fully proven, live, against the built compose image. `apps/e2e/tests/authed/csv-import-happy.spec.ts` establishes the CSV-import-through-the-real-UI pattern (select-domain-before-upload, `setInputFiles` on the hidden input, `waitForResponse`-scoped preview/commit assertions, slug-scoped `findMany` DB proof) that Plan 14-04 (LINKS-E2E-03, slug-conflict) can reuse directly. No blockers.

---
*Phase: 14-links-csv-import-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/csv-import-happy.spec.ts
- FOUND: commit 30a7320
