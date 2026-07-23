---
phase: 06-internal-tracking-analytics
plan: 06
subsystem: ui
tags: [vue3, vitest, vue-test-utils, tracking-toggle, links-table]

# Dependency graph
requires:
  - phase: 06-internal-tracking-analytics
    provides: "06-02 added trackingEnabled/lifetimeClicks to LinkDTO and threaded trackingEnabled through createLink/updateLink's D-01 sole write path"
provides:
  - "LinkFormModal.vue footer 'Internes Tracking' toggle (default ON, edit-mode pre-fill via withDefaults)"
  - "LinksView.vue Klicks column (lifetimeClicks) + 'Tracking aus' badge, new 6-column grid"
  - "trackingEnabled wired through handleCreateSubmit/handleEditSubmit to the api client"
affects: [06-07, 06-08, ui-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "withDefaults(defineProps<...>(), {...}) for optional boolean props that need a true default — plain `props.x ?? true` silently breaks because Vue casts an absent single-Boolean-type prop to false, not undefined"

key-files:
  created: []
  modified:
    - apps/web/src/components/LinkFormModal.vue
    - apps/web/src/components/LinkFormModal.test.ts
    - apps/web/src/views/LinksView.vue
    - apps/web/src/views/LinksView.test.ts

key-decisions:
  - "initialTrackingEnabled prop uses withDefaults(..., { initialTrackingEnabled: true }) instead of a `props.initialTrackingEnabled ?? true` computed default — Vue's Boolean-prop casting resolves an absent single-Boolean-type prop to false at the reactive-props layer itself, before any `??` in setup() ever sees it, so the `??` pattern used elsewhere in this file for non-Boolean-default props (forwardQuery, passwordProtected) does NOT generalize to a true-by-default Boolean prop"
  - "Reused the existing .toggle/.toggle-knob CSS verbatim for the footer tracking toggle (identical 38x21/16x16 shape/tokens to forwardQuery's toggle) — only added a scoped .tracking-toggle-group .toggle-label color override (--mut vs forwardQuery's --text) and the .tracking-toggle-group/.footer-buttons layout wrappers"
  - "Klicks cell renders link.lifetimeClicks.toLocaleString('de-DE') gated on link.trackingEnabled, never a client-side event count — matches the plan's explicit prohibition and 06-UI-SPEC.md § C2"

patterns-established:
  - "Boolean prop true-default via withDefaults(defineProps<T>(), {...}) — apply this pattern for any future optional Vue prop that must default to true when absent"

requirements-completed: [TRACK-01]

coverage:
  - id: D1
    description: "LinkFormModal footer 'Internes Tracking' toggle defaults ON in create mode and pre-fills from initialTrackingEnabled in edit mode; clicking flips it and submit emits the current value"
    requirement: "TRACK-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#create mode: the footer tracking toggle defaults ON and shows the 'Internes Tracking' label with no helper text"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#edit mode: the footer tracking toggle is pre-filled from initialTrackingEnabled=false"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#clicking the footer tracking toggle flips it, and submit emits the current value"
        status: pass
    human_judgment: false
  - id: D2
    description: "LinksView table shows a right-aligned Klicks column reading lifetimeClicks and a 'Tracking aus' badge for links with tracking disabled; the Klicks cell shows '—' (never a number) when tracking is off"
    requirement: "TRACK-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#a tracked link renders its lifetimeClicks right-aligned in the Klicks cell"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#a link with tracking disabled shows the 'Tracking aus' badge and '—' in the Klicks cell (never lifetimeClicks)"
        status: pass
    human_judgment: false
  - id: D3
    description: "trackingEnabled forwards from LinkFormModal's submit payload through both createLink and updateLink; the edit modal receives initialTrackingEnabled from editTarget"
    requirement: "TRACK-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#creating a link forwards trackingEnabled=false to createLink when the form toggle was switched off"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#editing a link with tracking disabled pre-fills the form's tracking toggle as inactive"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pixel-fidelity to 06-UI-SPEC.md § C1/C2 (toggle shape/tokens, footer space-between layout, badge/typography tokens, grid columns) — visual verification"
    verification: []
    human_judgment: true
    rationale: "Automated component tests assert class names, text content, and DOM structure but cannot verify rendered pixel geometry, color tokens applied via CSS custom properties, or Light/Dark theme rendering — needs a UI review pass (gsd-ui-review) against 06-UI-SPEC.md § C1/C2."

# Metrics
duration: 10min
completed: 2026-07-13
status: complete
---

# Phase 06 Plan 06: LinkFormModal Tracking Toggle + LinksView Klicks Column Summary

**Footer "Internes Tracking" toggle in LinkFormModal.vue (default ON, `withDefaults`-backed) plus a right-aligned Klicks column and "Tracking aus" badge in LinksView.vue's links table, wired end-to-end through the existing create/edit submit flow.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-13T09:29:00Z (approx.)
- **Completed:** 2026-07-13T09:38:19Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added the footer "Internes Tracking" toggle to `LinkFormModal.vue` (Surface C1, D-15) — default ON in create mode, pre-filled from `initialTrackingEnabled` in edit mode, emitted as part of the existing `submit` payload
- Restructured `.modal-footer` from `justify-content: flex-end` to `space-between`, with the toggle group left and the Abbrechen/primary buttons grouped right (`.footer-buttons`)
- Extended `LinksView.vue`'s table grid to `140px 140px 1fr 90px 100px 132px`, adding a right-aligned "Klicks" header/column reading `link.lifetimeClicks` (D-13 counter, never a live aggregation) and a neutral "Tracking aus" badge that wraps within the Kurzlink cell for tracking-disabled links
- Wired `trackingEnabled` through both `handleCreateSubmit` and `handleEditSubmit` to `createLink`/`updateLink`, and passed `:initial-tracking-enabled="editTarget.trackingEnabled"` to the edit-mode modal instance

## Task Commits

Each task was committed atomically:

1. **Task 1: LinkFormModal footer tracking toggle (Surface C1, D-15)** - `c04b32f` (feat)
2. **Task 2: LinksView Klicks column + Tracking-aus badge + submit wiring (Surface C2)** - `30f4f2d` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `apps/web/src/components/LinkFormModal.vue` - footer tracking toggle, `initialTrackingEnabled` prop via `withDefaults`, `trackingEnabled` in the submit emit
- `apps/web/src/components/LinkFormModal.test.ts` - new toggle tests + `trackingEnabled: true` added to existing exact submit-payload assertions
- `apps/web/src/views/LinksView.vue` - Klicks column, Tracking-aus badge, `trackingEnabled` submit wiring, new grid template
- `apps/web/src/views/LinksView.test.ts` - new Klicks/badge/wiring tests + `trackingEnabled: true` added to existing exact `createLink`/`updateLink` assertions

## Decisions Made
- `initialTrackingEnabled` uses `withDefaults(defineProps<...>(), { initialTrackingEnabled: true })` rather than a `props.initialTrackingEnabled ?? true` computed ref default. Discovered via failing tests: Vue's single-Boolean-type prop casting resolves an *absent* prop to `false` at the reactive-props layer itself (not `undefined`), so `false ?? true` evaluates to `false` — the `??` pattern that works fine for `forwardQuery`/`initialPasswordProtected` (which both want a `false`/falsy default anyway) does not generalize to a prop that must default `true`. `withDefaults` is the correct fix since it participates in Vue's own prop-resolution step, before the cast-to-false path would otherwise apply.
- Reused the exact `.toggle`/`.toggle-knob` CSS from the existing `forwardQuery` toggle for the new footer toggle (identical shape/tokens per 06-UI-SPEC.md § C1) rather than duplicating styles; only added a scoped `.tracking-toggle-group .toggle-label` color override since the tracking label uses `--mut` where `forwardQuery`'s label uses `--text`.
- Split `.cell-slug` into an outer flex-wrap container plus an inner `.cell-slug-text` span so the slug itself keeps its Mono/ellipsis truncation while the `.tracking-badge` can wrap onto a second line within the cell, per 06-UI-SPEC.md § C2's explicit "wraps at Platzmangel auf eine zweite Zeile ... kein Abschneiden" instruction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `initialTrackingEnabled ?? true` silently produced `false` in create mode due to Vue Boolean-prop casting**
- **Found during:** Task 1 (LinkFormModal footer tracking toggle) — automated test run
- **Issue:** The plan's stated implementation (`ref(props.initialTrackingEnabled ?? true)`) does not work as intended: `initialTrackingEnabled?: boolean` is a single-Boolean-type prop, and Vue's runtime prop resolution casts an absent Boolean prop to `false` before user code ever runs — `false ?? true` evaluates to `false`, not `true`. Confirmed empirically: 5 tests failed with the toggle defaulting inactive and submit emitting `trackingEnabled: false` in create mode.
- **Fix:** Switched the prop declaration to `withDefaults(defineProps<LinkFormModalProps>(), { initialTrackingEnabled: true })`, which participates in Vue's own default-resolution step ahead of the Boolean-cast-to-false behavior, then simplified the ref to `ref(props.initialTrackingEnabled)`.
- **Files modified:** `apps/web/src/components/LinkFormModal.vue`
- **Verification:** All 71 LinkFormModal tests + 75 LinksView tests pass; `pnpm --filter @kurzly/web exec tsc --noEmit` green.
- **Committed in:** `c04b32f` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix — without it the create-mode default-ON requirement (must_haves truth #1) would silently fail. No scope creep; only touches the prop-declaration mechanism, not the plan's intended behavior.

## Issues Encountered
None beyond the Rule 1 fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TRACK-01's dashboard surface is fully wired: link owners can toggle internal tracking on create/edit and see per-link tracking state + lifetime clicks in the table.
- `06-07`/`06-08` (per-link and global Analytics views) can now rely on `LinkDTO.trackingEnabled`/`lifetimeClicks` being both API-complete (06-02) and UI-surfaced (this plan) — no blockers.
- Pixel-fidelity to 06-UI-SPEC.md § C1/C2 (exact toggle geometry, badge tokens, Light/Dark rendering) has not been visually verified in a browser — flagged as coverage item D4 (`human_judgment: true`) for a future `gsd-ui-review` pass.

---
*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

- FOUND: apps/web/src/components/LinkFormModal.vue
- FOUND: apps/web/src/views/LinksView.vue
- FOUND: .planning/phases/06-internal-tracking-analytics/06-06-SUMMARY.md
- FOUND commit: c04b32f
- FOUND commit: 30f4f2d
