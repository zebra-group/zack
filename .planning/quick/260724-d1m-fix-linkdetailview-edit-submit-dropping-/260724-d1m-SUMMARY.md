---
phase: quick-260724-d1m
plan: 01
subsystem: ui
tags: [vue, tdd, links, tracking]

requires:
  - phase: 06-internal-tracking-analytics
    provides: "trackingEnabled field on LinkDTO/UpdateLinkInput and the LinksView.vue reference implementation of the toggle-threading pattern"
provides:
  - "LinkDetailView.vue's edit-modal submit path now preserves and applies trackingEnabled"
affects: [links-management, ui]

tech-stack:
  added: []
  patterns:
    - "Edit-submit payload threading: view-level handleEditSubmit types every optional field it forwards to updateLink and passes it straight through (undefined = keep), matching LinksView.vue's convention"

key-files:
  created: []
  modified:
    - apps/web/src/views/LinkDetailView.vue
    - apps/web/src/views/LinkDetailView.test.ts

key-decisions:
  - "Mirrored LinksView.vue's exact pattern (initial-tracking-enabled prop binding + payload type + updateLink forwarding) rather than inventing a new approach, since LinksView.vue is the in-repo reference already proven correct."

patterns-established: []

requirements-completed: [IN-01]

coverage:
  - id: D1
    description: "Editing a tracking-OFF link via the detail-screen edit modal and saving preserves trackingEnabled: false through the updateLink PATCH (previously the key was silently dropped)."
    requirement: "IN-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#edit preserves a tracking-OFF link's trackingEnabled through the PATCH"
        status: pass
    human_judgment: false
  - id: D2
    description: "Flipping the modal's tracking toggle during an edit and saving forwards the newly-chosen trackingEnabled value to updateLink."
    requirement: "IN-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#flipping the modal's tracking toggle is applied on save"
        status: pass
    human_judgment: false
  - id: D3
    description: "No regression: full LinkDetailView test suite (25 tests) and apps/web typecheck both pass after the fix."
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts (25 tests)"
        status: pass
      - kind: other
        ref: "cd apps/web && pnpm exec tsc --noEmit"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-24
status: complete
---

# Quick Task 260724-d1m: Fix LinkDetailView Edit-Submit Dropping trackingEnabled Summary

**Fixed LinkDetailView.vue's edit-modal submit path so it no longer silently drops `trackingEnabled`, closing carried tech-debt IN-01.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2 completed (RED + GREEN)
- **Files modified:** 2

## Accomplishments
- `<LinkFormModal>` in the edit-modal binding now passes `:initial-tracking-enabled="link.trackingEnabled"`, so the modal's footer toggle opens reflecting the link's real state instead of always defaulting to ON.
- `handleEditSubmit`'s payload type gained an optional `trackingEnabled?: boolean` field, and the `updateLink(...)` call now forwards `trackingEnabled: payload.trackingEnabled` — mirroring LinksView.vue's already-correct pattern exactly.
- Two new component tests prove the fix: preserving a tracking-OFF link through a no-op save, and applying an in-modal toggle flip on save.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing component tests reproducing the dropped trackingEnabled** - `c48ab0e` (test)
2. **Task 2 (GREEN): Thread trackingEnabled through LinkDetailView's edit flow and fix the exact-match assertion** - `7f15d45` (fix)

_TDD gate confirmed: `c48ab0e` (test, RED) precedes `7f15d45` (fix, GREEN) in git log; the two RED tests failed with the exact `trackingEnabled`-missing assertion error before the fix, and all 25 tests (including the two new ones and the updated pre-existing exact-match test) pass after it._

## Files Created/Modified
- `apps/web/src/views/LinkDetailView.vue` - Added `:initial-tracking-enabled` binding on the edit `<LinkFormModal>`, added `trackingEnabled?: boolean` to `handleEditSubmit`'s payload type, and forwarded it to `updateLink`.
- `apps/web/src/views/LinkDetailView.test.ts` - Added two new tests (tracking-OFF preservation, toggle-flip-and-save) and updated the pre-existing "edit opens the modal ... and calls updateLink" test's exact-match assertion to include `trackingEnabled: true`.

## Decisions Made
- Mirrored LinksView.vue's exact pattern (prop binding, payload type placement next to `forwardQuery`, forwarding order) rather than any alternative implementation, since it's the in-repo reference already proven correct and keeps the two views consistent.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

`pnpm exec tsc --noEmit` initially failed across the whole `apps/web` workspace with `Cannot find module '@kurzly/shared'` errors (16 pre-existing files, none touched by this plan) because `packages/shared/dist` hadn't been built in this session. Ran `pnpm run build` in `packages/shared` (a gitignored build artifact, no commit needed) to regenerate `dist/`, after which `tsc --noEmit` passed cleanly with zero errors. This was a pre-existing environment state issue, not a regression from this plan's changes, and required no code changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- IN-01 (Phase 6 carried tech-debt) is closed. The link detail screen's edit-modal tracking toggle is now functional and non-destructive, matching LinksView.vue's behavior.
- No blockers for future work.

---
*Phase: quick-260724-d1m*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/web/src/views/LinkDetailView.vue
- FOUND: apps/web/src/views/LinkDetailView.test.ts
- FOUND: c48ab0e (test commit)
- FOUND: 7f15d45 (fix commit)
