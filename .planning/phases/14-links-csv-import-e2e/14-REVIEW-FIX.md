---
phase: 14-links-csv-import-e2e
fixed_at: 2026-07-25T03:14:43Z
review_path: .planning/phases/14-links-csv-import-e2e/14-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-07-25T03:14:43Z
**Source review:** .planning/phases/14-links-csv-import-e2e/14-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (Warning only — no Critical/Blocker findings this round; Info findings IN-01/IN-02 excluded per `fix_scope: critical_warning`)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-02: `buildImportCsv` had no CSV escaping for commas/quotes/newlines

**Files modified:** `apps/e2e/src/csv.ts`, `apps/e2e/tests/smoke/csv-fixture.spec.ts`
**Commit:** `aa60218`
**Applied fix:** Added a private `escapeCsvField` helper implementing minimal RFC 4180 quoting — wraps a field in `"..."` (doubling any embedded `"`) whenever it contains a comma, double quote, `\n`, or `\r` — and routed all three `buildImportCsv` cell values (`zielUrl`, `slug`, `domain`) through it before joining. Current call sites (plain URLs/hyphenated slugs) are unaffected (all pass through unquoted, verified by a new "does not quote-wrap a plain field" test), closing the latent gap the review flagged for future fixture values. Per this project's TDD mandate, added four new unit tests to `csv-fixture.spec.ts` covering: comma-containing field, embedded-double-quote field (doubling proof), embedded-newline field (row-splitting proof), and the plain/no-escaping-needed case.

### WR-01: Whole-test retries gave no diagnostic signal distinguishing a known race from a regression

**Files modified:** `apps/e2e/tests/authed/links-crud.spec.ts`, `apps/e2e/tests/authed/csv-import-happy.spec.ts`, `apps/e2e/tests/authed/csv-import-conflict.spec.ts`
**Commit:** `07488c3`
**Applied fix:** The review offered two options: (a) refactor onto Phase 12's finer-grained `fetchWithFixtureRaceRetry` pattern, or (b) at minimum add a `testInfo.retry`-keyed `console.warn` so CI output distinguishes "this test retried" from "this test passed clean." Applied option (b) in each spec's existing `test.beforeEach`: when `testInfo.retry > 0`, logs the spec name, retry number, configured retry ceiling, and test title, with an explicit note that a repeatedly-firing retry across runs is worth investigating rather than assumed to be the known db-isolation truncate race. Did not attempt option (a): all three specs are multi-step UI journeys (create→edit→search→filter→delete for links-crud; multi-`waitForResponse` preview→commit flows for both CSV specs) driven through `page` interactions rather than the single HTTP-round-trip shape `fetchWithFixtureRaceRetry` was designed to wrap — retrofitting it would mean re-architecting each test into a single retryable closure returning one comparable value, a materially larger and riskier change than this fix pass's scope justifies, especially without live Playwright re-verification available. The outer `test.describe.configure({ retries: 2 })` safety net is unchanged and still in effect; this fix only adds attribution logging on top of it, closing the review's stated diagnostic-gap concern without touching test control flow or fixture-creation timing.

## Verification

- `pnpm --filter @kurzly/e2e exec tsc --noEmit` — clean, no errors in any modified file, for both fixes.
- Re-read every modified file section after each edit (Tier 1) — fix text present, surrounding code and comments intact, no corruption.
- **Not live-verified against Playwright/the docker-compose stack.** Attempted `pnpm --filter @kurzly/e2e exec playwright test tests/smoke/csv-fixture.spec.ts` — failed at `globalSetup` with `E2E_DATABASE_URL is not set`, confirming (per this project's own `db.ts` guard comment) that even the pure-unit `csv-fixture.spec.ts` file requires the full E2E harness (`scripts/e2e-compose.sh` / docker-compose stack) to execute, not just to typecheck. Given the explicit time-constrained scope of this fix pass, live re-verification was skipped in favor of the static typecheck above — flagged here for a live re-run (`docker compose -f docker-compose.e2e.yml up` + full Playwright suite) before this phase is considered fully verified end-to-end. The new WR-02 unit tests and the WR-01 logging line are both low-risk, narrowly-scoped changes (a pure string-escaping helper with new unit-test coverage, and an additive `console.warn` inside an existing conditional skip block) with no changes to control flow, fixture timing, or existing assertions.

---

_Fixed: 2026-07-25T03:14:43Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
