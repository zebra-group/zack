---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 09
subsystem: ui
tags: [vue3, vue-router, qr-codes, api-client]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (07-05/07-07)
    provides: api.ts QR client (createQrCode/listQrCodes), QrCodesView's ?selected= deep-link handler
provides:
  - "LinkDetailView.vue's 'QR-Code' action button (first position, no icon) — the second QR entry point (Surface B)"
  - "Create-or-deep-link side effect: reuses an existing static QR for the link if one exists, otherwise creates one instantly and navigates"
affects: []

tech-stack:
  added: []
  patterns:
    - "Instant-action-then-navigate pattern (no dialog) reused verbatim from QrCodesView.vue's '+ Dynamischer QR' — client-side existence check via listQrCodes() (no by-link filter param exists on GET /api/qr-codes) before deciding create-vs-deep-link"

key-files:
  created: []
  modified:
    - apps/web/src/views/LinkDetailView.vue
    - apps/web/src/views/LinkDetailView.test.ts

key-decisions:
  - "07-09: RED/GREEN commit order swapped relative to the plan's Task 1/Task 2 listing (test file authored and committed FIRST, implementation second) to satisfy the MVP+TDD gate's RED-before-GREEN requirement — mirrors 07-07/07-08's identical precedent where the plan sequenced the test task after the implementation task"
  - "07-09: Existing-static-QR lookup uses listQrCodes() (fetches ALL accessible QR codes) + a client-side .find(variant==='static' && linkId===this link) filter, since GET /api/qr-codes has no by-link query param — no backend change was in scope for this plan (frontend-only, no api.ts changes per the plan's files_modified)"
  - "07-09: A previously-untested fallback toast ('QR-Code konnte nicht erstellt werden.') was added for the catch branch (Rule 2) — matches every other async action in this file (handleCopy, toggleTracking, confirmDelete, load) which all have a failure-toast fallback; the UI-SPEC's copywriting contract only locks the success toast, not a failure case"

requirements-completed: [QR-01]

coverage:
  - id: D1
    description: "'QR-Code' action button appears first in LinkDetailView's actions row, no icon, same style as the existing three buttons"
    requirement: "QR-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#QR-Code: deep-links to an existing static QR for this link without creating a new one"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#QR-Code: creates a static QR with the default name when none exists, then deep-links and toasts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Clicking QR-Code deep-links to an existing static QR (/qr-codes?selected={qrId}) without calling createQrCode when one already exists for this link"
    requirement: "QR-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#QR-Code: deep-links to an existing static QR for this link without creating a new one"
        status: pass
    human_judgment: false
  - id: D3
    description: "Clicking QR-Code with none existing creates a static QR (default name 'QR für /{slug}'), deep-links, and toasts 'QR-Code erstellt'"
    requirement: "QR-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#QR-Code: creates a static QR with the default name when none exists, then deep-links and toasts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full visual fidelity against 07-UI-SPEC.md Surface B (button shape/spacing/typography) rendered correctly in the browser"
    human_judgment: true
    rationale: "Deferred to end-of-phase human verification per human_verify_mode=end-of-phase; component tests assert structure/behavior, not pixel fidelity."

duration: 20min
completed: 2026-07-21
status: complete
---

# Phase 07 Plan 09: Link-Detail QR Entry Point Summary

**LinkDetailView.vue gains a first-position "QR-Code" action button that deep-links to an existing static QR or creates one on the spot (no dialog) — the second QR entry point (Surface B), closing the phase's QR-01 static-create flow.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-21
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `.actions` row in `LinkDetailView.vue` gains a "QR-Code" button at first position, no icon prefix, identical style to the existing "⧉ Kopieren"/"✎ Bearbeiten"/"🗑 Löschen" buttons
- Clicking it looks up any existing static QR bound to the current link (via `listQrCodes()` + a client-side filter) and deep-links straight to it (`/qr-codes?selected={qrId}`) if found — no `createQrCode` call, no dialog
- If none exists, creates one instantly (`createQrCode({variant:'static', linkId, name:'QR für /{slug}'})`), then deep-links and toasts "QR-Code erstellt" — mirroring `QrCodesView.vue`'s "+ Dynamischer QR" instant-action philosophy
- `LinkDetailView.test.ts` extended with two new tests covering both branches, plus three pre-existing action-button-index tests corrected for the new button's position

## Task Commits

Followed RED → GREEN (TDD gate, MVP_MODE+TDD_MODE); the plan's own Task 1/Task 2 order was swapped for this reason (see Decisions):

1. **Test authoring (plan's Task 2, moved first for the TDD gate)**
   - `2a2aa4f` test(07-09): link-detail QR entry-point branches
2. **Task 1: QR-Code action button + create/deep-link side-effect**
   - `691b159` feat(07-09): QR-Code entry point on link detail (create-or-deep-link)

**Plan metadata:** (this commit) docs: complete 07-09 plan

## Files Created/Modified
- `apps/web/src/views/LinkDetailView.vue` - Added `createQrCode`/`listQrCodes` imports, `handleQrCode()` (existence-check → deep-link, or create → deep-link + toast), and the first-position "QR-Code" button in `.actions`
- `apps/web/src/views/LinkDetailView.test.ts` - Added `createQrCode`/`listQrCodes` mocks + a `qr-codes` route to the test router + a `makeQrCode` DTO factory; added two new tests (existing-QR deep-link, create-new-QR); corrected three pre-existing tests' `.action-button` index assertions (copy/edit/delete all shifted by one position)

## Decisions Made
- RED/GREEN commit order: authored and committed the test file FIRST (`2a2aa4f`), implementation SECOND (`691b159`) — the plan's own task order (implementation Task 1, test Task 2) would otherwise leave Task 1's GREEN commit with no preceding RED commit, violating the MVP+TDD gate. This exact reordering mirrors 07-07/07-08's identical precedent and is documented as a deviation below.
- The existing-static-QR lookup has no dedicated backend filter to call — `GET /api/qr-codes` returns every QR code the caller can access — so the check is `listQrCodes()` + `.find(qr => qr.variant === "static" && qr.linkId === link.id)`. A backend `?linkId=` filter param would be a nice-to-have optimization but is out of this plan's scope (frontend-only, `api.ts` unchanged per `files_modified`); the accessible-QR list is small enough in practice for this to be a non-issue.
- Added a fallback toast for the `handleQrCode` catch branch ("QR-Code konnte nicht erstellt werden.") — every other async user action in this file (`handleCopy`, `toggleTracking`, `confirmDelete`, `load`) has an equivalent failure-toast fallback; the UI-SPEC's copywriting contract only locks the success-path toast text, leaving failure handling to the existing per-view convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Swapped Task 1/Task 2 commit order to satisfy the MVP+TDD RED-before-GREEN gate**
- **Found during:** Task 1 (button + handler implementation)
- **Issue:** The plan sequences Task 1 (implementation, `feat(07-09)`) before Task 2 (test authoring, `test(07-09)`). `tdd="true"` on Task 1 with a real `<behavior>` block requires a preceding failing test commit — writing the test only after the implementation would make it impossible to prove RED (the feature would already exist and pass).
- **Fix:** Extended `LinkDetailView.test.ts` first (new mocks, `qr-codes` test route, `makeQrCode` factory, two new tests, three corrected pre-existing index assertions), confirmed all 6 affected tests failed against the unmodified `LinkDetailView.vue` (RED), committed as `test(07-09): link-detail QR entry-point branches`, then implemented the button/handler and confirmed all 127 tests pass (GREEN), committed as `feat(07-09): QR-Code entry point on link detail (create-or-deep-link)`.
- **Files modified:** `apps/web/src/views/LinkDetailView.test.ts` (RED commit), `apps/web/src/views/LinkDetailView.vue` (GREEN commit)
- **Verification:** `pnpm --filter @kurzly/web test -- src/views/LinkDetailView.test.ts` — 6 failures confirmed before the GREEN commit, 0 failures (127/127 passing workspace-wide) after
- **Committed in:** `2a2aa4f` (RED), `691b159` (GREEN)

**2. [Rule 1 - Bug] Corrected three pre-existing tests' `.action-button` index assertions**
- **Found during:** Test authoring (RED phase)
- **Issue:** Adding the "QR-Code" button at first position (per 07-UI-SPEC.md Surface B, matching the prototype layout) shifts every subsequent `.action-button`'s index by one. Three existing tests referenced fixed indices (`wrapper.find(".action-button")` for Kopieren, `buttons[1]` for Bearbeiten, `buttons[2]` for Löschen) that would silently start clicking the wrong button once the new button existed.
- **Fix:** Updated the three tests to the new indices (Kopieren=1, Bearbeiten=2, Löschen=3), with an inline comment noting the 07-09 index shift.
- **Files modified:** `apps/web/src/views/LinkDetailView.test.ts`
- **Verification:** All three tests pass after the fix, both before and after the button was added (confirmed indices are correct against the final template order)
- **Committed in:** `2a2aa4f` (RED commit, alongside the test file)

---

**Total deviations:** 2 auto-fixed (1 blocking — TDD gate ordering; 1 bug fix — stale test indices)
**Impact on plan:** Both were necessary for correctness (TDD gate compliance and keeping the pre-existing action-button tests actually exercising the buttons they claim to). No scope creep — no files touched beyond `LinkDetailView.vue`/`LinkDetailView.test.ts`, exactly as the plan's `files_modified` specifies. No backend or `api.ts` changes.

## Known Stubs

None. The button is fully wired end-to-end: existence-check, create, and navigation all call through to the real `api.ts` QR client functions (07-07) and the real `/qr-codes` route (07-07's `?selected=` handler) — no hardcoded/placeholder data.

## Threat Flags

None — this plan's `<threat_model>` entries (T-07-IDOR, T-07-DUP) both hold as designed: `createQrCode`/`listQrCodes` independently re-check `requireDomainAccess` server-side (no new client-side authorization logic was added, per the plan's explicit instruction), and the existence-check-before-create ordering minimizes (without eliminating) the rare double-click duplicate-QR race, which is accepted per the plan's threat register.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This was the last plan (07-09) of Phase 7 (qr-codes-static-dynamic-qr-studio) — all 9 plans are now complete.
- Full end-to-end QR flow is in place: create/style/upload-logo/export from the QR Studio (07-07/07-08) plus a second static-QR entry point from any link's detail page (this plan).
- `human_verify_mode=end-of-phase` full visual fidelity check against `07-UI-SPEC.md` (both Surface A and Surface B) is still outstanding — no code blocker, just not yet exercised in a real browser.
- No blockers identified for Phase 8.

---
*Phase: 07-qr-codes-static-dynamic-qr-studio*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created/modified files confirmed present on disk (`LinkDetailView.vue`, `LinkDetailView.test.ts`, this SUMMARY); both RED (`2a2aa4f`) and GREEN (`691b159`) commit hashes confirmed present in `git log`.
