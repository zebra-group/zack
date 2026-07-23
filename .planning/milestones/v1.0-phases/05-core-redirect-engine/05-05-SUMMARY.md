---
phase: 05-core-redirect-engine
plan: 05
subsystem: ui
tags: [vue3, vue-test-utils, vitest, forms, tdd]

requires:
  - phase: 05-core-redirect-engine
    provides: "05-02's extended createLink/updateLink DTOs and validated write-path core (password/expiresAt/forwardQuery on Link)"
provides:
  - "LinkFormModal.vue Security accordion (password + date-only expiry) and forwardQuery toggle"
  - "End-to-end dashboard write path for protected/expiring/query-forwarding links (create + edit)"
affects: [05-06, phase-6-analytics]

tech-stack:
  added: []
  patterns:
    - "Three-state (undefined=keep / null=clear / value=set) PATCH semantics mirrored client-side in a form component's submit handler"
    - "Pure string-split date formatting (no Date object) to avoid timezone off-by-one in UI-only date display"

key-files:
  created: []
  modified:
    - apps/web/src/components/LinkFormModal.vue
    - apps/web/src/components/LinkFormModal.test.ts
    - apps/web/src/views/LinksView.vue
    - apps/web/src/views/LinksView.test.ts
    - apps/web/src/views/LinkDetailView.vue
    - apps/web/src/views/LinkDetailView.test.ts

key-decisions:
  - "handleSubmit computes password/expiresAt via the same undefined=keep/null=clear/value=set ternary as 05-02's PATCH route, kept local to the modal (no shared helper needed for two call sites)"
  - "Create-mode call sites (LinksView.handleCreateSubmit) coerce a null password/expiresAt to undefined via `?? undefined` since CreateLinkInput has no null variant — the modal never emits null in create mode anyway, but the call site stays type-safe regardless"
  - "Accordion summary date format (DD.MM.YYYY) is computed via plain string-split on the YYYY-MM-DD value, not `new Date()`, avoiding the timezone off-by-one 05-03/05-04 explicitly worked around for the same reason"

patterns-established: []

requirements-completed: [REDIR-01, REDIR-03, REDIR-04]

coverage:
  - id: D1
    description: "Security accordion password field: never pre-filled in edit mode, 'gesetzt' placeholder communicates existing state, blank=keep / explicit 'Passwortschutz entfernen'=clear (null) / typed value=set"
    requirement: REDIR-04
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#edit mode with an existing password: the input renders EMPTY with the 'gesetzt' placeholder, and submitting untouched keeps it (undefined)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#edit mode: clicking 'Passwortschutz entfernen' then submitting clears the password (null)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Date-only expiry field with keep/clear/set PATCH semantics and 'expires at end of day' helper text"
    requirement: REDIR-03
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#edit mode with an existing expiry: clearing the date field emits expiresAt null; leaving it emits the existing value"
        status: pass
    human_judgment: false
  - id: D3
    description: "forwardQuery toggle + full end-to-end wiring of password/expiresAt/forwardQuery through LinksView/LinkDetailView's createLink/updateLink calls, including edit-mode prefill of expiry/forwardQuery (never the password)"
    requirement: REDIR-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#create mode: typing a password + picking a date + toggling forwardQuery on emits those values"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#editing a protected/expiring link prefills expiry + forwardQuery, but never a password value"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-12
status: complete
---

# Phase 05 Plan 05: Link Form Security UI Summary

**Security accordion (password + date-only expiry, keep/clear/set semantics) and forwardQuery toggle wired into LinkFormModal.vue and threaded end-to-end through LinksView/LinkDetailView's existing createLink/updateLink calls — no second write path.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-12T15:39:00Z
- **Completed:** 2026-07-12T15:47:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `LinkFormModal.vue` gained the Security accordion (password field + "Passwortschutz entfernen" link + date-only expiry + helper text, collapsed by default with a header summary suffix) and the forwardQuery toggle, per 05-UI-SPEC.md's Link-Formular-Erweiterung contract, reusing `.field-input` verbatim.
- The password input is never pre-filled in edit mode (T-05-PWPREFILL) — a placeholder communicates the "set" state; blank/untouched submission means KEEP, only the explicit remove action emits `null` to CLEAR (T-05-KEEPCLEAR), both proven by component tests.
- `LinksView.vue`/`LinkDetailView.vue`'s `handleCreateSubmit`/`handleEditSubmit` widened to accept and forward the new fields into the already-extended `createLink`/`updateLink` clients from 05-02; both edit modals now prefill `initial-password-protected`/`initial-expires-at`/`initial-forward-query` from the `LinkDTO` being edited.
- A user can now create/edit a real password-protected, expiring, query-forwarding link entirely from the dashboard — the redirect engine's write side is immediately end-to-end usable (D-01).

## Task Commits

Each task was committed atomically:

1. **Task 1: Security accordion + forwardQuery toggle + extended submit payload**
   - `8618d5f` (test) — RED: failing tests for the widened payload/keep/clear/toggle behavior
   - `e8fbcd6` (feat) — GREEN: Security accordion + forwardQuery toggle implementation
2. **Task 2: Thread the new fields through LinksView + LinkDetailView** - `114027e` (feat)

_TDD gate compliance: RED (`8618d5f`) precedes GREEN (`e8fbcd6`); no REFACTOR commit needed — the GREEN implementation required no follow-up cleanup._

**Plan metadata:** (recorded below, after this SUMMARY commit)

## Files Created/Modified
- `apps/web/src/components/LinkFormModal.vue` - Security accordion (password + expiry) + forwardQuery toggle, widened `submit` emit and `handleSubmit` computing the keep/clear/set payload
- `apps/web/src/components/LinkFormModal.test.ts` - payload/keep/clear/toggle behavior cases; two pre-existing submit-payload assertions widened to the new shape
- `apps/web/src/views/LinksView.vue` - `handleCreateSubmit`/`handleEditSubmit` widened + edit modal prefilled with the new initial props
- `apps/web/src/views/LinksView.test.ts` - updated `createLink`/`updateLink` call assertions; new prefill test
- `apps/web/src/views/LinkDetailView.vue` - `handleEditSubmit` widened + edit modal prefilled with the new initial props
- `apps/web/src/views/LinkDetailView.test.ts` - updated `updateLink` call assertion

## Decisions Made
- Kept the keep/clear/set ternary local to `LinkFormModal.vue`'s `handleSubmit` (mirrors 05-02's PATCH route semantics) rather than extracting a shared helper — only one call site (the modal itself) computes it; the two parent views just forward whatever the modal emits.
- `LinksView.handleCreateSubmit` normalizes a `null` password/expiresAt to `undefined` via `?? undefined` before calling `createLink`, since `CreateLinkInput` has no `null` variant (D-01) — defensive type-safety even though the modal never emits `null` in create mode.
- Accordion header summary date formatting uses a plain string split on the `YYYY-MM-DD` value (no `Date` object), avoiding the timezone off-by-one that 05-03/05-04 already worked around with UTC-safe formatting.

## Deviations from Plan

None - plan executed exactly as written. One additional test (`LinksView.test.ts`'s "editing a protected/expiring link prefills expiry + forwardQuery, but never a password value") was added beyond the plan's explicit `<behavior>` list to directly cover Task 2's acceptance criterion ("editing a protected link prefills expiry + forwardQuery but never the password") with an automated assertion rather than leaving it to manual phase-level verification only — not a deviation, just fuller automated coverage of an already-stated acceptance criterion.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The dashboard's Link create/edit form is now fully wired for password/expiry/forwardQuery, completing D-01's "fully integrated, not backend-only" requirement for this phase.
- `pnpm --filter @kurzly/web test` (67/67) and `pnpm -r typecheck` both green.
- Ready for 05-06 (remaining phase-5 plan) and for manual phase-level verification: create a protected+expiring link in the dashboard, reopen edit — expiry + forwardQuery prefilled, password blank.

---
*Phase: 05-core-redirect-engine*
*Completed: 2026-07-12*

## Self-Check: PASSED

All 6 modified files found on disk; all 3 task commit hashes (`8618d5f`, `e8fbcd6`, `114027e`) found in git log.
