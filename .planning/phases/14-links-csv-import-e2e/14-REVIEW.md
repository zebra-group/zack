---
phase: 14-links-csv-import-e2e
reviewed: 2026-07-25T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - apps/e2e/src/csv.ts
  - apps/e2e/tests/smoke/csv-fixture.spec.ts
  - apps/e2e/tests/authed/links-crud.spec.ts
  - apps/e2e/tests/authed/csv-import-happy.spec.ts
  - apps/e2e/tests/authed/csv-import-conflict.spec.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-07-25
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the CSV fixture builder (`apps/e2e/src/csv.ts`) and its RED→GREEN
contract spec, plus the three new authenticated feature specs
(`links-crud.spec.ts`, `csv-import-happy.spec.ts`, `csv-import-conflict.spec.ts`)
covering LINKS-E2E-01/02/03. All five files are test-authoring-only, under
`apps/e2e/`, with zero `apps/api`/`apps/web` diffs — confirmed by reading every
production file these specs exercise (`LinksView.vue`, `LinkFormModal.vue`,
`LinksImportView.vue`, `routes/links.ts`, `lib/links.ts`,
`packages/shared/src/index.ts`) and cross-checking every selector, response
field name, and skip-reason string the specs assert against the real markup
and API contracts. Every one of those cross-checks came back correct: the
`ziel_url,slug,domain` header matches `EXPECTED_CSV_COLUMNS` verbatim, the
`ImportPreviewResult`/`ImportCommitResult` field names match
`packages/shared`'s actual types, `slug_conflict`'s label text matches
`SKIP_REASON_LABELS` exactly, the `.delete-dialog .delete-confirm-button`
scoping correctly disambiguates from the row-level `title="Löschen"` icon, and
the create-modal's default single-domain auto-select (`LinkFormModal.vue`'s
`domains[0]?.id` fallback) explains why the canonical journey needs no
explicit domain selection. No Critical issues found — no injection, no
hardcoded secrets, no eval-like patterns, no logic bug that would let a
broken feature pass as green.

The one substantive, recurring concern is test-isolation: this phase
introduces its OWN new race-condition mitigation (`test.describe.configure({
retries: 2 })`, a whole-test retry) instead of reusing Phase 12's established,
finer-grained `fetchWithFixtureRaceRetry` pattern for the exact same
documented `db-isolation.spec.ts` cross-file `Link`-table truncate race. All
three feature specs create real fixture rows via direct-Prisma `createE2eLink`
(or, for `links-crud.spec.ts`, via the create-UI itself) and then read them
back through the browser/API without wrapping the read in any
race-aware retry — the ONLY safety net is a full-test rerun on any assertion
failure. This is functionally adequate (each retry mints fresh random
slugs, so a rerun cannot collide with a truncated prior attempt) but is a
strictly blunter, less diagnostic instrument than the file-level pattern this
same codebase's Phase 12 review (12-REVIEW.md WR-03) already flagged the
narrow version of this exact problem for — see WR-01 below.

## Warnings

### WR-01: Whole-test retries are the only cross-file DB-truncate-race protection, and they cannot distinguish "known race" from "genuine regression"

**File:** `apps/e2e/tests/authed/links-crud.spec.ts:39`
**File:** `apps/e2e/tests/authed/csv-import-happy.spec.ts:41`
**File:** `apps/e2e/tests/authed/csv-import-conflict.spec.ts:56`
**Issue:** All three new specs rely exclusively on
`test.describe.configure({ retries: 2 })` to survive the documented
cross-file race (`apps/e2e/tests/smoke/db-isolation.spec.ts`'s concurrent
`withResetDbLock` cycles `TRUNCATE ... "Link" ...` while these `authed`
specs' own fixture rows — the two decoy links in `links-crud.spec.ts`, the
imported rows in `csv-import-happy.spec.ts`, the pre-seeded conflict link in
`csv-import-conflict.spec.ts` — are being read back through the UI/API). This
differs from, and is strictly weaker than, the established
`fetchWithFixtureRaceRetry` pattern (`apps/e2e/src/links.ts`, reused by every
Phase 12 `smoke` spec) in two ways:
1. It retries the **entire journey** (every click, fill, and assertion in the
   whole test) on ANY failure, not just the one HTTP/DB read that actually
   raced. A genuinely new regression anywhere in the create→edit→search→
   delete flow, or the preview→commit flow, that only reproduces
   intermittently (e.g. 1-of-3 attempts) will silently "pass" after a retry
   instead of surfacing as a CI failure — the exact problem 12-REVIEW.md's
   WR-03 called out for the narrower version of this helper, reintroduced
   here at a coarser scope.
2. There is no logging (no `console.warn`, no attempt-number attribution)
   when a retry fires, unlike `fetchWithFixtureRaceRetry`'s explicit
   `console.warn` + `onDiscardedAttempt` hook (added specifically to close
   12-REVIEW.md WR-03). A retried run in this phase's specs gives no signal
   in CI output distinguishing "the known truncate race fired" from "this is
   a flaky/regressed test."

**Fix:** Either (a) scope the retry more narrowly — e.g. wrap just the
UI action + its `waitForResponse` in a `fetchWithFixtureRaceRetry`-style
helper that logs on each discarded attempt, keeping the outer
`test.describe.configure({ retries })` only as a last-resort safety net, or
(b) at minimum add a `testInfo.retry`-keyed `console.warn` in a shared
`beforeEach`/`afterEach` so a CI log line always distinguishes "this test
retried" from "this test passed clean," preserving the diagnostic value the
Phase 12 fix was written to restore.

### WR-02: `buildImportCsv` has no CSV escaping — any future fixture value containing a comma silently misaligns columns instead of failing loudly

**File:** `apps/e2e/src/csv.ts:52-58`
**Issue:** `buildImportCsv` joins each row with a plain
`[row.zielUrl, row.slug ?? "", row.domain ?? ""].join(",")` — no quoting or
escaping for a value that itself contains a comma, a double quote, or a
newline. Every current call site (`csv-import-happy.spec.ts`,
`csv-import-conflict.spec.ts`) only passes plain `https://example.com/...`
URLs and hyphenated slugs, so this doesn't misfire today, but the module's
own doc comment explicitly positions it as the shared, ONE fixture builder
"both CSV-import feature specs consume" for constructing "runtime CSVs with
per-test slugs" — an entirely plausible future test (e.g. a target URL with
a query string containing a comma-separated value, or a slug containing a
character requiring escaping) would silently produce a CSV with shifted
columns rather than an obvious parse error, since the server's own
`csv-parse` correctly follows RFC 4180 quoting rules that this builder does
not honor on the way in.
**Fix:** Add minimal RFC 4180 quoting — wrap a cell in `"..."` (doubling any
embedded `"`) whenever it contains a comma, quote, or newline — or, at
minimum, add a runtime assertion (`if (value.includes(","))  throw ...`) so
a future caller gets an immediate, loud failure instead of a silently
misaligned CSV.

## Info

### IN-01: Near-identical boilerplate duplicated verbatim across all three new spec files

**File:** `apps/e2e/tests/authed/links-crud.spec.ts:39-46`
**File:** `apps/e2e/tests/authed/csv-import-happy.spec.ts:41-48,75-77`
**File:** `apps/e2e/tests/authed/csv-import-conflict.spec.ts:56-63,96-98`
**Issue:** The `test.describe.configure({ retries: 2 })` line, the
`test.beforeEach` project-name skip block, the `waitForResponse` URL-object
predicate style, and (for the two CSV specs specifically) the identical
"select the baseline domain in `.default-domain-row select` before
uploading" step are copy-pasted verbatim rather than factored into a shared
`apps/e2e/src` helper. This is a maintainability/DRY concern, not a
correctness bug — but if the admin-only skip reason or the retry count ever
needs to change, it now requires three synchronized edits instead of one.
**Fix:** Extract a small shared helper (e.g. `adminOnlyAuthedTest(name, fn)`
or a `selectDefaultDomain(page, hostname)` function) into
`apps/e2e/src/links.ts` or a new `apps/e2e/src/csv-import-ui.ts`, mirroring
how `apps/e2e/src/links.ts` already centralizes `createE2eLink`.

### IN-02: Unvalidated type assertions on JSON response bodies

**File:** `apps/e2e/tests/authed/csv-import-happy.spec.ts:92,113`
**File:** `apps/e2e/tests/authed/csv-import-conflict.spec.ts:113,148`
**Issue:** `(await previewResponse.json()) as ImportPreviewBody` and the
equivalent commit-body cast are unchecked `as` assertions on data crossing a
real network boundary, using locally-defined minimal types rather than the
real `@kurzly/shared` `ImportPreviewResult`/`ImportCommitResult` types (a
deliberate, documented tradeoff per the plan summaries, to avoid adding
`@kurzly/shared` as an `apps/e2e` dependency). If the backend response shape
ever changes (e.g. a field rename), these tests would fail with a confusing
`undefined`-vs-expected-value mismatch rather than a clear compile-time type
error, since TypeScript cannot verify an `as` cast against the actual runtime
JSON.
**Fix:** No action required given the documented dependency-surface
tradeoff; if `apps/e2e` ever gains a `@kurzly/shared` dependency for another
reason, switch these two casts to the real imported types for compile-time
drift detection.

---

_Reviewed: 2026-07-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
