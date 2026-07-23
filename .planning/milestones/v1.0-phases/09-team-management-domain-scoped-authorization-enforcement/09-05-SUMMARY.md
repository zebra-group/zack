---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 05
subsystem: testing
tags: [vitest, fastify-inject, prisma, testcontainers, authorization, idor]

# Dependency graph
requires:
  - phase: 09-team-management-domain-scoped-authorization-enforcement
    provides: "requireDomainAccess/scopedDomainIds admin-bypass branches (D-09-02) — the admin half of TEAM-06, 09-02"
provides:
  - "One exhaustive, real-Postgres integration suite proving TEAM-06 by exhaustion (D-09-08): every real Link/QR/Analytics endpoint denies a Member with no membership on the target domain, even with a genuine correctly-guessed resource id, with zero foreign rows ever leaked (list/create/import/global-analytics), while an account-admin reaches the same resources"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One it() building a real foreign-resource scenario, then iterating a typed { method, url, payload, expectedStatus, note } table with app.inject in a for-loop, asserting each response with the note as the assertion message — an exhaustive endpoint x expectation matrix in a single readable block, alongside separate zero-rows-leaked/list-absence/import-skip/analytics-scope tests for the assertions a status-code-only table cannot express"

key-files:
  created:
    - apps/api/test/team-domain-denial.integration.test.ts
  modified: []

key-decisions:
  - "The exhaustive status-code table lives in ONE it() (13 endpoint x expectation rows covering every real by-id/create Link, QR, and Analytics-by-link endpoint) rather than it.each, because each row's resource id is only known after seeding a fresh scenario inside the test — setupFileEach.ts truncates all tables between tests, so no fixture can be shared via beforeAll/module scope across it.each cases"
  - "Zero-rows-leak assertions that the table format cannot express (list-absence, create-writes-nothing, import-skip-writes-nothing, analytics-silent-scope) are split into 4 additional focused it() blocks rather than crammed into the main table test, each seeding both a foreign domain (owner-created, Member has no membership) and the Member's OWN domain — proving scoping actually narrows the result set rather than merely returning an empty account"
  - "The admin-bypass positive-half test uses THREE separate Links for read/patch/delete (rather than reusing one link across all three admin actions) specifically because DELETE is destructive for the admin and would otherwise invalidate later assertions in the same test if sequenced after them"
  - "The import-skip test's zero-rows assertion checks for the specific foreign slug (`foreign-import-slug`) and asserts the foreign domain's link COUNT stays at exactly 1 (the pre-existing seedForeignFixtures fixture link), not 0 — an initial draft asserted domain-wide count == 0 and failed, because seedForeignFixtures itself legitimately creates one Link on that domain before the import attempt even runs"

patterns-established:
  - "Real-route enumeration discipline: before writing a denial suite, read the actual route file(s) end-to-end and list every registered path/method — the plan's own PLAN.md had already been corrected once (a prior draft included a nonexistent DELETE /api/qr-codes/:id and a nonexistent standalone remap route) — trusting route-file grep over assumed REST conventions prevents asserting on endpoints that don't exist and would 404 trivially, proving nothing"

requirements-completed: [TEAM-06]

coverage:
  - id: D1
    description: "Exhaustive status-code table: a Member with no membership on the target domain is rejected on every real Link/QR/Analytics-by-id/create endpoint (13 rows) with a genuine, correctly-guessed foreign resource id"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/team-domain-denial.integration.test.ts#Member: every Link/QR/Analytics-by-id endpoint rejects a genuine foreign resource id (exhaustive endpoint x expectation table)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/qr-codes with a foreign linkId is denied AND writes zero QrCode rows (the create path's different guard shape — resolveLinkDomainAccess, not scopedDomainIds — verified explicitly per plan WARNING 1)"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/team-domain-denial.integration.test.ts#Member: POST /api/qr-codes with a foreign linkId writes ZERO QrCode rows (WARNING 1)"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/links and GET /api/qr-codes omit the foreign resource from their arrays entirely while still returning the Member's own resources — a real scoping proof, not an artifact of an empty account"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/team-domain-denial.integration.test.ts#Member: GET /api/links and GET /api/qr-codes omit the foreign resources entirely — own resources still appear"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /api/links/import/{preview,commit} skip a foreign-domain CSV row as domain_unauthorized, writing zero rows for that row while the Member's own-domain row still imports"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/team-domain-denial.integration.test.ts#Member: POST /api/links/import/{preview,commit} skip a foreign-domain row as domain_unauthorized, writing ZERO rows"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /api/analytics scopes silently — the foreign domain's clicks/links contribute zero to totals and top-lists, while the Member's own domain's data still surfaces correctly"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/team-domain-denial.integration.test.ts#Member: GET /api/analytics scopes silently — the foreign domain contributes ZERO clicks/links to totals and top-lists"
        status: pass
    human_judgment: false
  - id: D6
    description: "An account-admin reaches the SAME foreign resources the Member was denied — GET/PATCH/DELETE/POST /api/links, GET/PATCH/render.png/render.svg/remap-history/POST /api/qr-codes, GET /api/links/:id/analytics, GET /api/analytics — proving the D-09-02 bypass end to end (the positive half of TEAM-06)"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/team-domain-denial.integration.test.ts#Account-admin reaches the SAME foreign resources the Member is denied (D-09-02 admin-bypass, positive half)"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 5: TEAM-06 Exhaustive Domain-Scoped Denial Suite Summary

**One real-Postgres integration test file (`team-domain-denial.integration.test.ts`, 6 tests) proving TEAM-06 by exhaustion: a Member with no membership on a domain is denied on every real Link/QR/Analytics endpoint with a genuine resource id and zero foreign rows leak anywhere, while an account-admin reaches the same resources**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-23T09:40:00+02:00
- **Completed:** 2026-07-23T10:00:00+02:00
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments
- Enumerated every real Link/QR/Analytics endpoint directly from `routes/links.ts`, `routes/qrCodes.ts`, `routes/analytics.ts` and built a single 13-row `{method, url, payload, expectedStatus, note}` table, asserted in one `it()` with `app.inject` — status-code proof that a Member with a genuine foreign resource id is rejected everywhere (Link routes 403/404, QR routes 404 uniformly, per D-09-08's documented shapes).
- Added an explicit create-path zero-rows test for `POST /api/qr-codes` with a foreign `linkId` — the plan's flagged WARNING 1 case, since that path guards via `resolveLinkDomainAccess`/`requireDomainAccess` rather than `scopedDomainIds` and could plausibly diverge from the read-path guard.
- Proved list-scoping (not just an empty-account artifact) by giving the Member their own domain/link/QR alongside the foreign fixtures, then asserting `GET /api/links`/`GET /api/qr-codes` contain the Member's own resource and omit the foreign one.
- Proved the CSV import path (`POST /api/links/import/{preview,commit}`) skips a foreign-domain row as `domain_unauthorized`, writing zero rows for it while the Member's own-domain row still imports.
- Proved `GET /api/analytics` scopes silently: the foreign domain's 2 clicks never surface in `activeLinks`/`clicks30Days`/`topLinks`, while the Member's own domain's 1 click does.
- Proved the D-09-02 admin-bypass positive half end to end: an account-admin reaches every one of the same foreign resources (GET/PATCH/DELETE/POST Links, GET/PATCH/render/remap-history/POST QR codes, both analytics endpoints) that the Member was denied.
- Discovered and fixed the PLAN.md's own real route list was correct as delivered (no gaps found beyond the plan's already-corrected matrix) — confirmed by reading all three route files directly before writing any assertion, per the plan's explicit read-first instruction.

## Task Commits

Each task was committed atomically:

1. **Task 1: Exhaustive TEAM-06 domain-scoped denial suite (member denied, admin allowed)** - `32bdc73` (test)

**Plan metadata:** (this commit, made after this SUMMARY)

_Note: this is a test-only, verification plan — per the plan's own instructions, there is no production code to write RED-first (the enforcement already shipped in 09-02/03/04), so there is a single `test(...)` commit rather than a RED/GREEN pair._

## Files Created/Modified
- `apps/api/test/team-domain-denial.integration.test.ts` - New: the phase's headline TEAM-06 evidence. 6 tests: (1) exhaustive 13-row status-code table for every real Link/QR/Analytics-by-id/create endpoint, (2) QR-create zero-rows-written proof (WARNING 1), (3) list-absence proof for GET /api/links and GET /api/qr-codes, (4) CSV import domain_unauthorized-skip zero-rows proof, (5) GET /api/analytics silent-scope zero-foreign-contribution proof, (6) account-admin positive-bypass proof across every endpoint.

## Decisions Made
- Structured the status-code-only assertions as one exhaustive table inside a single `it()` (not `it.each`) because resource ids only exist after per-test seeding — `setupFileEach.ts` truncates all tables between tests, so no scenario can be shared via module-level or `beforeAll` fixtures the way a static `it.each` table would require.
- Split the "zero rows leak" / "list omits the foreign resource" / "import skip" / "analytics silent scope" assertions into 4 dedicated tests rather than folding them into the main table, since these need response-body/DB-row inspection the table's status-code-only shape can't express — and each gives the Member their own domain alongside the foreign one, so the assertion proves real scoping rather than trivially passing because the Member's account is otherwise empty.
- Used three separate Links in the admin-positive test (read/patch/delete) specifically so the destructive DELETE assertion doesn't invalidate the GET/PATCH/analytics assertions that would otherwise run against the same row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Import-test zero-rows assertion initially counted the whole foreign domain instead of the specific attempted row**
- **Found during:** Task 1's first test run (`npx vitest run test/team-domain-denial.integration.test.ts`)
- **Issue:** The first draft asserted `prisma.link.count({ where: { domainId: foreignDomainId } })` equals `0` after the preview call. This is wrong: `seedForeignFixtures` (the shared scenario helper used by every test in this file, including the import test) legitimately creates one real Link on that same foreign domain as part of setting up the domain/link/static-QR/dynamic-QR/click fixtures the plan's behavior block requires — so the domain already has exactly 1 row before the import even runs. The assertion failed with `expected 1 to be +0`.
- **Fix:** Replaced the domain-wide count check with (a) a total-row-count assertion after preview (dry-run: total stays at 1, the pre-existing fixture link, proving preview writes nothing at all) and (b) after commit, a specific `findFirst({ where: { slug: "foreign-import-slug" } })` returning `null`, plus an explicit `foreignRows` count of exactly 1 (the fixture link, unchanged) — a more precise proof than the original blanket domain count, and one that would have caught a real leak (an actual new row for the attempted slug) that the buggy assertion's coincidental "any 1 row" pass could have masked.
- **Files modified:** `apps/api/test/team-domain-denial.integration.test.ts`
- **Verification:** Full suite re-run green (6/6 in this file); full `apps/api` suite green (506/506, 40 files).
- **Committed in:** `32bdc73` (single commit, fixed before commit — this is a test-authoring correction, not a production-code deviation)

---

**Total deviations:** 1 auto-fixed (test-assertion bug found and fixed during the same task's own RED/GREEN cycle, before commit)
**Impact on plan:** No production code touched. No security gap found — this was a test-authoring mistake in the very suite being written, caught by the plan's own mandated verification step, and fixed to be a stricter, more precise proof than the original.

## Issues Encountered
None beyond the deviation documented above. No authorization gap was found anywhere in the 09-02/03/04-shipped enforcement — every denial assertion passed on first correct attempt; the only failure was the test's own initial assertion being imprecise about pre-existing fixture data.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TEAM-06 is now proven by exhaustion, not inspection, exactly as D-09-08 required: a single, obviously-complete integration suite is the headline evidence a reviewer or auditor can point to for "every Link/QR/Analytics endpoint enforces domain scoping, even against a genuinely correct id."
- No blockers or concerns for subsequent plans in this phase (09-06/07 — team UI/routes, if not already complete) or for a future phase touching Link/QR/Analytics authorization: this suite will regress loudly (real Postgres, real routes, real IDOR ids) if any future change reopens the boundary it proves closed.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

Created test file verified present on disk; task commit hash (`32bdc73`) verified present in git history.
