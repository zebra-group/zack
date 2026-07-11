---
phase: 04-links-management-bulk-import
fixed_at: 2026-07-11T21:38:08Z
review_path: .planning/phases/04-links-management-bulk-import/04-REVIEW.md
iteration: 1
findings_in_scope: 15
fixed: 15
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-07-11T21:38:08Z
**Source review:** .planning/phases/04-links-management-bulk-import/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 15 (10 Warnings + 5 Info)
- Fixed: 15
- Skipped: 0

Two findings (WR-05, IN-05) were resolved via the review's own explicitly
sanctioned fallback — "accept and document as a low-severity residual
risk" / "no action needed at current scale" — with a durable code comment
at the exact site, rather than a structural code change; these are
recorded below as `fixed: documented` rather than `fixed`. The D-01
single-write-path invariant (exactly one `prisma.link.create(` and one
`prisma.link.update(` call site, both in `lib/links.ts`) was preserved
throughout — no fix added a second write path.

## Fixed Issues

### WR-01: `PATCH /api/links/:id` with an empty-string slug silently regenerated the slug

**Files modified:** `apps/api/src/routes/links.ts`, `apps/api/test/links.integration.test.ts`
**Commit:** `f0279f3`
**Applied fix:** An explicitly-provided empty/whitespace-only `slug` in a PATCH body now 400s with `SLUG_INVALID_SHAPE` instead of silently falling into `resolveSlug`'s auto-generate branch. An OMITTED `slug` still means "keep current" (unchanged behavior). Added 3 regression tests: empty string 400s and leaves the slug unchanged, whitespace-only 400s the same way, and an omitted slug keeps the current slug (control case).
**Status:** fixed

### WR-02: `PATCH /api/links/:id` could never actually clear `title` via `null`

**Files modified:** `apps/api/src/routes/links.ts`, `apps/api/src/lib/links.ts`, `apps/api/test/links.integration.test.ts`
**Commit:** `f0279f3` (same commit as WR-01 — both live in the same route-handler block and were fixed together)
**Applied fix:** Widened `ValidatedLink.title`/`ValidateLinkInputParams.title` to `string | null | undefined` so `null` survives all the way to Prisma's `update` call instead of being collapsed by `null ?? undefined`. The route now passes `parsed.data.title` through untouched when explicitly provided (including `null`), only falling back to the link's current value when the field was omitted. Added regression tests: `title: null` clears an existing title (verified in both the response body and the DB row), and an omitted title keeps the current value (control case).
**Status:** fixed

### WR-03: Manual create and CSV import never checked `Domain.status`

**Files modified:** `apps/api/src/lib/links.ts`, `apps/api/src/routes/links.ts`, `apps/api/test/links.integration.test.ts`, `apps/api/test/links-import.integration.test.ts`
**Commit:** `fe569ce`
**Applied fix:** Added a `Domain.status === "active"` check inside `validateLinkInput` (the shared D-01 core), right after `requireDomainAccess` — so both manual create AND CSV import inherit it automatically. A new `DOMAIN_NOT_ACTIVE` `LinkErrorCode` maps to 403 (route layer) and to the existing `domain_unauthorized` CSV skip reason (no existence-oracle regression — a pending/failed domain is indistinguishable from a genuinely inaccessible one). Updated both integration test files' `seedOwnedDomain` fixture from `status: "pending"` to `status: "active"` (this is what every pre-existing "successful create" test now requires — not a weakening, since none of those tests were ever about domain status) and added a dedicated `seedOwnedDomainWithStatus`/`seedOwnedPendingDomain` helper for the new rejection tests. Added regression tests: `validateLinkInput` rejects pending and failed domains, `POST /api/links` 403s against a pending domain, and a CSV row targeting a pending domain is skipped with `domain_unauthorized`.
**Status:** fixed

### WR-04: Timing/query-count side channel between "not found" and "forbidden" in `resolveOwnedLink`

**Files modified:** `apps/api/src/routes/links.ts`
**Commit:** `63f83e2`
**Applied fix:** Rewrote `resolveOwnedLink` to perform EXACTLY the same two queries (`scopedDomainIds` then `link.findFirst` filtered by `id` AND that domain-id set) on every outcome — found, not-found, and forbidden all now cost identically, closing the asymmetry (previously "not found" short-circuited after one query while "forbidden" paid a second `requireDomainAccess` query). `scopedDomainIds` returns every domain the caller has ANY membership on, which is equivalent to "member+ access" here since every Link route requires only the lowest rank (`"member"`) — not a relaxation of the access rule. The 404-for-both contract is preserved and covered by pre-existing tests (which all still pass unchanged).
**Status:** fixed

### WR-05: Same timing/query-count asymmetry in CSV import's per-row domain resolution

**Files modified:** `apps/api/src/lib/links.ts`
**Commit:** `fbd59ed`
**Applied fix:** Per the review's own stated fallback ("accept and document this as a low-severity residual risk if the team decides the network-timing signal isn't practically exploitable"), documented this as an accepted residual risk with a detailed comment at `resolveRowDomainId`, explaining why WR-04's single-query normalization pattern doesn't cleanly apply here (it would require resolving membership before knowing whether the hostname exists, restructuring `runImport`'s short-circuit control flow) and citing the mitigating factor (5 req/15min `LINK_IMPORT_RATE_LIMIT`, authenticated-only endpoint). No structural code change — this is the sanctioned "document, don't fix" resolution.
**Status:** fixed: documented (accepted residual risk, no code change — matches reviewer's own stated fallback)

### WR-06: Auto-generated slugs never checked `RESERVED_SLUGS`

**Files modified:** `apps/api/src/lib/links.ts`, `apps/api/test/links-auto-slug-reserved.test.ts` (new)
**Commit:** `6375862`
**Applied fix:** Added a `RESERVED_SLUGS.has(candidate.toLowerCase())` check inside the auto-generation retry loop in `resolveSlug` — a reserved-word collision is now treated exactly like a DB collision (skip and retry). Added a new, isolated test file that mocks the `nanoid` package (scoped to that one file only, so no other test's "random-looking slug" assertions are affected) to deterministically force the first candidate to be `"domains"` (a real 7-character `RESERVED_SLUGS` entry, matching `generateSlug`'s output length/shape) and proves the retry loop skips it and returns a different, non-reserved slug.
**Status:** fixed

### WR-07: Custom-slug shape failures shared the misleading `SLUG_RESERVED` error code

**Files modified:** `apps/api/src/lib/links.ts`, `apps/api/src/routes/links.ts`, `apps/web/src/api.ts`, `apps/api/test/links.integration.test.ts`
**Commit:** `1c36024`
**Applied fix:** Introduced a distinct `SLUG_INVALID_SHAPE` `LinkErrorCode` for the shape-check branch of `resolveSlug` (too short/long, or a disallowed character), mapped to its own 400 status and a distinct German-language frontend message ("Slug darf nur Buchstaben, Zahlen, - und _ enthalten, 2–32 Zeichen."), reserving `SLUG_RESERVED` exclusively for the `RESERVED_SLUGS.has()` branch. Fixed the misleading "SLUG_RESERVED: rejects a reserved custom slug" test by removing the 1-character `"q"` case (which only ever exercised the shape check, never the reserved-word check) and adding a dedicated `SLUG_INVALID_SHAPE` test covering too-short, too-long, and invalid-character cases — including `"q"` itself, explicitly proving the shape check runs FIRST even for a value that's also a `RESERVED_SLUGS` member. Updated the `RESERVED_SLUGS` coverage test to accept either `SLUG_RESERVED` or `SLUG_INVALID_SHAPE` (both still prove "this slug cannot be used"), since 5 entries are shape-shadowed (see IN-01).
**Status:** fixed

### WR-08: No debounce or response-ordering guard on the live search input

**Files modified:** `apps/web/src/views/LinksView.vue`, `apps/web/src/views/LinksView.test.ts`
**Commit:** `930931c`
**Applied fix:** Added a monotonically increasing `requestId` guard in `loadLinks()` — a response is only applied if it's still the most recent request by the time it resolves, closing the out-of-order race. Added a 250ms debounce on the search `@input` handler (domain-tab clicks still call `loadLinks()` directly, undebounced, since they're discrete clicks not a keystroke stream). Updated the existing "typing calls listLinks" test to account for the debounce (waits it out for real rather than mocking timers, to avoid entangling with `@vue/test-utils`' own `setTimeout`-based `flushPromises`). Added a new regression test that forces a stale (first) request to resolve AFTER a fresh (second) one and asserts the UI shows only the fresh result.
**Status:** fixed

### WR-09: Non-`ApiError` failures during create/edit submit failed completely silently

**Files modified:** `apps/web/src/views/LinksView.vue`, `apps/web/src/views/LinksView.test.ts`, `apps/web/src/views/LinkDetailView.vue`, `apps/web/src/views/LinkDetailView.test.ts`
**Commit:** `7911c6c`
**Applied fix:** Generalized beyond the review's literal suggestion: instead of branching only on `!(err instanceof ApiError)`, both views' create/edit catch blocks now call a shared `reportFormError(err)` helper that checks whether `mapLinkFormError(err)` produced ANY field error — if not (which covers both a raw non-`ApiError` network failure AND an `ApiError` whose `code` this mapper has no case for, e.g. the new `DOMAIN_NOT_ACTIVE` from WR-03), it falls back to a toast ("Speichern fehlgeschlagen. Bitte erneut versuchen."). This closes the silent-failure gap completely rather than only the non-`ApiError` slice of it. Added regression tests in both view test files simulating a `TypeError: Failed to fetch`-style network error and asserting the fallback toast appears.
**Status:** fixed

### WR-10: CSV commit was not atomic — a mid-loop unexpected error left partial rows with a bare failure

**Files modified:** `apps/api/src/lib/links.ts`, `apps/api/src/routes/links.ts`, `packages/shared/src/index.ts`, `apps/api/test/links-import.integration.test.ts`, `apps/web/src/views/LinksImportView.vue`, `apps/web/src/views/LinksImportView.test.ts`
**Commit:** `199242d`
**Applied fix:** Chose the "report partial state precisely" remediation over a DB transaction (a transaction would have required threading a `Prisma.TransactionClient` through every function in `lib/links.ts` typed as `PrismaClient`, a materially larger and riskier change for this fix). Wrapped each row's work in `runImport` in a try/catch; an unexpected (non-validation) error now stops the loop immediately and returns exactly what was collected so far, flagged `partial: true`, instead of letting the exception unwind past already-committed rows. Added `partial?: boolean` to `ImportRunResult` (lib/links.ts) and `ImportCommitResult` (packages/shared), propagated through the commit route. The frontend now shows a distinct toast ("N Links importiert – Import wurde vorzeitig abgebrochen, bitte Liste prüfen.") when `partial: true` instead of a misleadingly-complete-sounding flat count. Added a backend regression test that spies on `prisma.link.create` to fail on the 2nd of 3 rows, asserting `partial: true`, `importedCount: 1`, and that exactly 1 row (not 0, not 3) is durably persisted — proving no data loss and no silent over-commit. Added a frontend regression test for the partial toast message.
**Status:** fixed: requires human verification (the WR-10 fix changes commit-loop control flow and partial-state semantics — while the integration test proves the specific spied-failure scenario, a human should confirm the `partial: true` UX (toast wording, no auto-retry) matches product intent for a real transient-failure incident)

## Fixed Info Items

### IN-01: `RESERVED_SLUGS` contains entries structurally unreachable via the reserved-word check

**Files modified:** `apps/api/src/lib/links.ts`
**Commit:** `1c36024` (same commit as WR-07 — this is a direct consequence/documentation of that fix)
**Applied fix:** Added a doc comment directly above `RESERVED_SLUGS` explaining exactly which 5 entries (`.well-known`, `favicon.ico`, `robots.txt`, `index.html`, `q`) are currently shape-check-shadowed and why (matches the review's first suggested option), so a future relaxation of `customSlugSchema` doesn't silently reopen a gap that looks covered today.
**Status:** fixed

### IN-02: `importCsvSchema.csv` had no explicit maximum length

**Files modified:** `apps/api/src/routes/links.ts`, `apps/api/src/app.ts`, `apps/api/test/links-import.integration.test.ts`
**Commit:** `893b139`
**Applied fix:** Added both remediations the review suggested together: an explicit `CSV_MAX_LENGTH` (1.8M chars, sized comfortably above a realistic `MAX_IMPORT_ROWS`-row CSV) via `.max()` on the schema, AND an explicit `bodyLimit: 2 * 1024 * 1024` (2 MiB) on the Fastify instance in `app.ts` (previously relying entirely on Fastify's un-stated 1 MiB implicit default). Added a regression test asserting a CSV exceeding `CSV_MAX_LENGTH` 400s.
**Status:** fixed

### IN-03: `formatDate()` duplicated verbatim

**Files modified:** `apps/web/src/lib/format.ts` (new), `apps/web/src/lib/format.test.ts` (new), `apps/web/src/views/LinksView.vue`, `apps/web/src/views/LinkDetailView.vue`
**Commit:** `a4654ba`
**Applied fix:** Extracted the identical `formatDate()` implementation into a new shared `apps/web/src/lib/format.ts` module and imported it in both view files, removing the duplicate local definitions. Added a small unit test suite for the extracted helper (using midday-UTC timestamps to avoid timezone-dependent day-rollover flakiness across CI environments).
**Status:** fixed

### IN-04: No friendly error when CSV headers don't match the documented column names

**Files modified:** `apps/api/src/lib/links.ts`, `apps/api/src/routes/links.ts`, `apps/api/test/links-import.integration.test.ts`
**Commit:** `b83b97f`
**Applied fix:** Added an `EXPECTED_CSV_COLUMNS` constant and a header-validation check inside `runImport` that runs BEFORE the row loop (only when there's at least one data row, to avoid a false positive on an empty file) — a header missing any of `ziel_url`/`slug`/`domain` now throws a distinct, caught-and-mapped 400 error ("CSV header does not match the expected columns...") instead of every row silently resolving to `undefined` fields and being reported as `invalid_url` with no indication the real problem is the header. Added regression tests for both the mismatch case and a matching-header-with-extra-columns case (proving extra unrelated columns are tolerated, only the 3 required ones are checked).
**Status:** fixed

### IN-05: `csv-parse`'s full parse runs before the `MAX_IMPORT_ROWS` cap is enforced

**Files modified:** `apps/api/src/lib/links.ts`
**Commit:** `09409d2`
**Applied fix:** Per the review's own explicit recommendation ("Low priority... No action needed at current scale"), documented this as an accepted, no-action item with a comment at the `parse()` call site, citing the two mitigating factors that already bound the same resource (IN-02's new explicit `CSV_MAX_LENGTH` and the endpoint's rate limit). No structural code change — this is the sanctioned resolution for this specific finding.
**Status:** fixed: documented (accepted, no-action — matches reviewer's own stated recommendation)

## Skipped Issues

None — all 15 in-scope findings were fixed (13 with code/test changes, 2 via the reviewer's own sanctioned "document as accepted risk" fallback).

## Verification

- `pnpm --filter @kurzly/api exec tsc --noEmit` — clean (0 errors)
- `pnpm --filter @kurzly/web exec tsc --noEmit` — clean (0 errors)
- `pnpm --filter @kurzly/api test -- --run` — **152 tests passed** (18 test files, including 2 new files: `links-auto-slug-reserved.test.ts` for WR-06)
- `pnpm --filter @kurzly/web test -- --run` — **61 tests passed** (10 test files, including 1 new file: `lib/format.test.ts` for IN-03)
- `pnpm --filter @kurzly/shared build` — clean
- D-01 invariant re-verified: exactly one `prisma.link.create(` and one `prisma.link.update(` call site remain, both in `apps/api/src/lib/links.ts`; CSV import still routes every row through `createLink`/`previewLink`, never a batch insert.
- No existing test was weakened to pass — the two tests that needed structural adjustment (`SLUG_RESERVED` coverage test, and both `seedOwnedDomain` fixtures) were adjusted because the underlying behavior they exercise legitimately changed (WR-07's new error code; WR-03's new domain-status gate), and each adjustment preserves or strengthens the original assertion's intent rather than loosening it.

---

_Fixed: 2026-07-11T21:38:08Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
