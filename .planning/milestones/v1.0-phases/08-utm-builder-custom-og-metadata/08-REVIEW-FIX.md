---
phase: 08-utm-builder-custom-og-metadata
fixed_at: 2026-07-23T00:00:00Z
review_path: .planning/phases/08-utm-builder-custom-og-metadata/08-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 2
skipped: 1
status: partial
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-07-23T00:00:00Z
**Source review:** .planning/phases/08-utm-builder-custom-og-metadata/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 2
- Skipped: 1 (IN-01 — out of phase scope, per fix-pass instruction)

Both fixes followed the project's mandatory TDD flow: a failing test was
committed first (`test(08-13): …`), then the implementation fix
(`fix(08-13): …`). Repo-wide `pnpm -r exec tsc --noEmit` passes clean.

## Fixed Issues

### CR-01: UTM parameters are dropped on the password-unlock redirect

**Files modified:** `apps/api/src/routes/redirect.ts`, `apps/api/src/routes/qrRedirect.ts`
**Test commit:** 4868ba6 (`test(08-13): CR-01 …`)
**Fix commit:** eebdb69 (`fix(08-13): CR-01 …`)
**Applied fix:** Both `POST /:slug/verify` and `POST /q/:code/verify` success
branches now redirect to `applyUtmParams(link.targetUrl, link)` instead of the
bare `link.targetUrl`, so a password-protected link with UTM configured carries
its owner attribution through the post-unlock 302 — identical treatment in both
handlers to avoid `/:slug` vs `/q` drift. The `forwardQuery`/visitor-query merge
is deliberately left out of the verify path (the existing comment's reasoning is
correct and preserved); only the owner's UTM application was added.
**Verification:** Added an integration test to each suite seeding a
password-protected + UTM link, POSTing the correct password, and asserting the
302 `Location` carries `utm_source`/`utm_medium`/`utm_campaign` in canonical
`?utm_source=…&utm_medium=…&utm_campaign=…` order. Both went red pre-fix and
green post-fix. Full `redirect.integration.test.ts` + `qrRedirect.integration.test.ts`
(48 tests) pass.

### WR-01: `applyUtmParams` erased target-embedded UTM keys the builder did not set

**Files modified:** `apps/api/src/lib/redirectEngine.ts`, `apps/web/src/lib/utm.ts`
**Test commit:** 15e4424 (`test(08-13): WR-01 …`)
**Fix commit:** 94aacfa (`fix(08-13): WR-01 …`)
**Applied fix:** Narrowed the mutation so only the canonical keys the builder
actually sets are delete-then-set (each still delete-before-set to re-append in
the locked source→medium→campaign order). A builder field left empty no longer
deletes a matching key the owner manually embedded in the target URL — e.g.
`targetUrl=https://shop.com/?utm_campaign=fall` with only `utm_source` filled now
keeps `utm_campaign=fall`. The client preview `buildUtmPreview` in
`apps/web/src/lib/utm.ts` was updated to mirror the server exactly, and the stale
"delete all three first" comment/cross-check in both test files was corrected.
**Verification:** Added matched WR-01 tests on both sides (API
`redirectEngine.test.ts`, web `utm.test.ts`) asserting an unset builder field
leaves the embedded key intact while the set key is applied. Red pre-fix, green
post-fix. All-three-set canonical-order tests still pass unchanged (outcome
identical when every key is present). Full suites: web `utm.test.ts` 13 pass,
API `redirectEngine.test.ts` 37 pass.

## Skipped Issues

### IN-01: `LinkDetailView` edit modal silently ignores the modal's tracking toggle

**File:** `apps/web/src/views/LinkDetailView.vue:324-336`
**Reason:** skipped — explicitly out of scope for this fix pass. The reviewer
classified it as pre-existing (not introduced by Phase 8's UTM/OG threading), and
the orchestrating instruction directed it be recorded for later rather than fixed
here to avoid expanding this phase's blast radius. It is tracked separately.
**Original issue:** `handleEditSubmit` forwards every Phase 8 field to
`updateLink` but omits `trackingEnabled`, which `LinkFormModal` still renders and
emits; a change made via the modal's toggle is discarded on save (a separate
optimistic detail-view toggle owns that field).

---

_Fixed: 2026-07-23T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
</content>
</invoke>
