---
phase: 04-links-management-bulk-import
plan: 04
subsystem: api
tags: [fastify, prisma, csv-parse, zod, rate-limit, security-critical]

# Dependency graph
requires:
  - phase: 04-links-management-bulk-import
    provides: "04-02: lib/links.ts D-01 core (validateLinkInput/createLink/previewLink) + POST/GET /api/links routes"
  - phase: 04-links-management-bulk-import
    provides: "04-03: IDOR-guarded GET/PATCH/DELETE /api/links/:id (unaffected by this plan, same file extended)"
provides:
  - "runImport(prisma, userId, csvText, defaultDomainId, mutate) — the ONE CSV parse + sequential row-loop implementation in lib/links.ts"
  - "previewImport/commitImport — the two runImport callers (mutate=false/true), used by the two new routes"
  - "resolveRowDomainId, mapErrorToSkipReason, MAX_IMPORT_ROWS (500, code constant) — CSV row-resolution helpers"
  - "POST /api/links/import/preview — zero-write dry-run (ImportPreviewResult)"
  - "POST /api/links/import/commit — writes only valid rows via createLink (ImportCommitResult)"
affects: [04-05-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase bulk-import (preview/commit) sharing ONE parse+loop function, branching only on a mutate boolean, so preview can never predict a different outcome than commit actually performs"
    - "Sequential (for...of + await, never Promise.all) row loop so per-domain slug uniqueness checks and in-file duplicate detection see prior rows' committed state"
    - "Structural no-bypass enforcement: the importer's only path to persistence is the existing single createLink insert site — proven by both a positive grep (exactly one link.create( call in lib/links.ts) and a DB-state integration test"

key-files:
  created:
    - apps/api/test/links-import.integration.test.ts
  modified:
    - apps/api/src/lib/links.ts
    - apps/api/src/routes/links.ts

key-decisions:
  - "ImportRunResult (lib/links.ts's internal return shape) is a distinct type from @kurzly/shared's ImportPreviewResult/ImportCommitResult — routes/links.ts maps validCount -> importedCount for the commit response while both share validCount/skippedCount/rows internally. This keeps lib/links.ts's return contract single-sourced (no duplicate LinkSkipReason/ImportRowResult type declarations — those are imported from @kurzly/shared, which already defined them in 04-02) while still matching each endpoint's documented response shape exactly."
  - "resolveRowDomainId returns undefined for both an unknown hostname and a hostname the caller lacks membership on — validateLinkInput's requireDomainAccess is the single point that denies both as UNAUTHORIZED_DOMAIN (mapped to domain_unauthorized), so the importer never needs (and never gets) a separate 'domain not found' branch that would leak which domains exist."
  - "The MAX_IMPORT_ROWS-exceeded error is detected in the route layer by matching the Error message's row-limit substring (isImportRowLimitError) rather than a typed error code, since runImport's cap check is a fast-fail guard before any row-shaped data exists yet (no LinkErrorCode is meaningful at that point)."

patterns-established:
  - "runImport(..., mutate: boolean) — reusable shape for any future two-phase bulk-operation (e.g. bulk QR creation) that must guarantee preview cannot drift from commit."

requirements-completed: [LINK-08]

coverage:
  - id: D1
    description: "runImport parses CSV once and loops rows sequentially (await inside for...of, never Promise.all); previewImport (mutate=false) and commitImport (mutate=true) are its only two callers, differing solely by the mutate flag"
    requirement: "LINK-08"
    verification:
      - kind: other
        ref: "grep -vE '^\\s*(//|\\*|/\\*)' apps/api/src/lib/links.ts | grep -c 'link\\.create(' = 1 (no second/bulk insert site added)"
        status: pass
      - kind: integration
        ref: "apps/api/test/links-import.integration.test.ts — 'preview <-> commit parity' describe block"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/links/import/preview writes ZERO rows (dry-run); POST /api/links/import/commit writes only valid rows through createLink — proven directly against DB state, not just HTTP response shape (the D-01 no-bypass proof)"
    requirement: "LINK-08"
    verification:
      - kind: integration
        ref: "apps/api/test/links-import.integration.test.ts — 'POST /api/links/import/commit — the D-01 no-bypass proof' describe block (asserts prisma.link.count() == validCount and zero rows for each of 4 skipped rows: reserved slug, foreign domain, duplicate slug, invalid URL)"
        status: pass
      - kind: integration
        ref: "apps/api/test/links-import.integration.test.ts — 'POST /api/links/import/preview' describe block (asserts prisma.link.count() unchanged after preview)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every skipped row carries exactly one of the four LinkSkipReasons (invalid_url, slug_conflict, domain_unauthorized, duplicate_in_file); a CSV exceeding MAX_IMPORT_ROWS (500) is rejected with 400 before any row is processed, writing nothing"
    requirement: "LINK-08"
    verification:
      - kind: integration
        ref: "apps/api/test/links-import.integration.test.ts — mixed-CSV test asserting the exact 4 distinct reasons; 'MAX_IMPORT_ROWS cap' describe block"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-07-11
status: complete
---

# Phase 4 Plan 04: CSV Bulk Import (Preview + Commit) — D-01 No-Bypass Proof Summary

**Two-phase CSV import (`POST /api/links/import/preview` + `/commit`) built on a single `runImport` parse-once/loop-sequentially function whose only branching is a `mutate` flag — commit calls `createLink` row-by-row (the exact same insert site manual creation uses), and an integration test proves directly against the database that skipped rows (reserved slug, unauthorized domain, in-file duplicate, invalid URL) leave zero trace.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-11T20:12:00Z
- **Completed:** 2026-07-11T20:34:44Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- `apps/api/src/lib/links.ts` gained `MAX_IMPORT_ROWS` (500, code constant — not ENV, per RESEARCH OQ-3), `CsvRow`, `resolveRowDomainId`, `mapErrorToSkipReason`, `runImport`, `previewImport`, `commitImport` — `runImport` parses the CSV exactly once (`csv-parse/sync`, `columns: true`) and loops rows in a strictly sequential `for...of` with `await` per row (never `Promise.all`), so row N+1's slug-uniqueness check sees row N's already-committed insert
- The comment-filtered `link.create(` count in `lib/links.ts` stayed at exactly 1 — the importer adds no second write path; it calls the same `createLink`/`previewLink` functions `POST /api/links` and 04-02's preview already use
- `POST /api/links/import/preview` and `POST /api/links/import/commit` added to `routes/links.ts`, both `config: { rateLimit: LINK_IMPORT_RATE_LIMIT }` (5/15min), gated by a Zod allowlist (`{ csv, defaultDomainId? }`), 401 with no session, 400 on a malformed body or a CSV over `MAX_IMPORT_ROWS`
- The no-bypass integration test (`apps/api/test/links-import.integration.test.ts`) imports a mixed CSV (reserved slug `api`, a foreign domain the caller has no membership on, two identical custom slugs in the same domain, an invalid target URL, one fully-valid row) and asserts: `validCount` 1, `skippedCount` 4 with the four distinct `LinkSkipReason`s, `prisma.link.count()` unchanged after preview, and — critically — after commit `prisma.link.count()` equals exactly 1 with direct queries confirming zero rows for the reserved slug, the foreign domain, the duplicate slug, and the invalid URL
- Preview↔commit parity asserted: running preview then commit on the identical unmodified CSV/DB state yields identical `validCount`/`skippedCount`/reasons
- Full monorepo suite green: `pnpm --filter @kurzly/api test` 136/136, `pnpm --filter @kurzly/web test` 23/23, `pnpm --filter @kurzly/api exec tsc --noEmit` clean

## Task Commits

Each task was committed as a TDD RED/GREEN pair (Task 1 is foundational library code verified by grep+tsc per the plan's own acceptance criteria rather than a dedicated unit test; Task 2 follows the full RED->GREEN cycle):

1. **Task 1: lib/links.ts — runImport (single parse + sequential loop) shared by previewImport/commitImport** - `8dc884e` (feat — grep/tsc-verified per plan's `<verify>`, no separate test task specified for this task)
2. **Task 2: import routes + the D-01 no-bypass integration proof** - `34b9997` (test, RED) + `c30b6d6` (feat, GREEN)

**Plan metadata:** (this commit, docs: complete plan)

## TDD Gate Compliance

A `test(...)` commit (`34b9997`) precedes its corresponding `feat(...)` commit (`c30b6d6`) for Task 2. Confirmed RED before GREEN: running the new test file against the pre-route codebase produced 6 failures, all `404` (routes did not exist) — no test passed unexpectedly ahead of its implementation. Task 1 has no dedicated RED test file per the plan's own task design (its `<verify>` is a grep + `tsc --noEmit` check); its correctness is instead proven behaviorally by Task 2's integration suite, which exercises `runImport`/`previewImport`/`commitImport` end-to-end.

## Files Created/Modified
- `apps/api/src/lib/links.ts` — added the CSV bulk-import core (`MAX_IMPORT_ROWS`, `CsvRow`, `resolveRowDomainId`, `mapErrorToSkipReason`, `runImport`, `previewImport`, `commitImport`)
- `apps/api/src/routes/links.ts` — added `POST /api/links/import/preview` and `POST /api/links/import/commit` to the existing `linksRoute` factory, plus the `importCsvSchema` allowlist and `isImportRowLimitError` helper
- `apps/api/test/links-import.integration.test.ts` (new) — the D-01 no-bypass proof, preview zero-write test, preview↔commit parity, `MAX_IMPORT_ROWS` cap test, no-session 401 tests

## Decisions Made
- `ImportRunResult` (lib/links.ts's internal return shape) is distinct from `@kurzly/shared`'s `ImportPreviewResult`/`ImportCommitResult` — the route layer maps `validCount` onto `importedCount` for the commit response. `LinkSkipReason` and `ImportRowResult` themselves are imported from `@kurzly/shared` (already defined there in 04-02), not redeclared in `lib/links.ts` — an early draft of this plan's implementation duplicated those two types locally before this was corrected to reuse the shared contract, avoiding a second source of truth for the skip-reason shape.
- `resolveRowDomainId` returns `undefined` uniformly for both an unknown hostname and a hostname the caller lacks membership on; `validateLinkInput`'s `requireDomainAccess` is the single point that denies both as `UNAUTHORIZED_DOMAIN` — the importer never distinguishes "domain doesn't exist" from "domain exists but you can't use it," preventing a domain-enumeration oracle via CSV import.
- The `MAX_IMPORT_ROWS`-exceeded error is caught in the route layer via a message-substring check (`isImportRowLimitError`) rather than a typed `LinkErrorCode`, since the row-count guard fires before any row-level validation context exists.

## Deviations from Plan

**1. [Rule 1 - Bug] Removed duplicate LinkSkipReason/ImportRowResult type declarations from lib/links.ts**
- **Found during:** Task 1, immediately after drafting `runImport`
- **Issue:** The initial implementation declared local `LinkSkipReason` and `ImportRowResult` types in `lib/links.ts`, duplicating types `packages/shared/src/index.ts` already exports (added in 04-02, per this plan's own `<read_first>` pointer). Two independent declarations of the same shape risk silent drift between the backend's internal contract and the DTO the frontend (04-05) will consume.
- **Fix:** Removed the local declarations; `lib/links.ts` now imports `LinkSkipReason` and `ImportRowResult` directly from `@kurzly/shared` and uses them in `runImport`'s row-building logic and `mapErrorToSkipReason`'s return type.
- **Files modified:** `apps/api/src/lib/links.ts`
- **Commit:** Folded into `8dc884e` (caught before the first commit, no separate fix commit needed).

## Issues Encountered
None.

## User Setup Required
None — `csv-parse` and `nanoid` were already installed in 04-01/04-02; no new dependencies this plan.

## Next Phase Readiness
- 04-05 (frontend LinksImportView) can proceed against a complete, tested backend surface: `POST /api/links/import/preview` returns `{ validCount, skippedCount, rows }` for live preview rendering, `POST /api/links/import/commit` returns the same shape as `importedCount` after writing, and every skipped row's `reason` is one of the four `LinkSkipReason` values the shared DTO already documents.
- No blockers or concerns carried forward.

---
*Phase: 04-links-management-bulk-import*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: apps/api/src/lib/links.ts
- FOUND: apps/api/src/routes/links.ts
- FOUND: apps/api/test/links-import.integration.test.ts
- FOUND: .planning/phases/04-links-management-bulk-import/04-04-SUMMARY.md
- FOUND commit: 8dc884e
- FOUND commit: 34b9997
- FOUND commit: c30b6d6
