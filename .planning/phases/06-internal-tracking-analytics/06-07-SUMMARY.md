---
phase: 06-internal-tracking-analytics
plan: 07
subsystem: ui
tags: [vue3, vitest, vue-test-utils, analytics, optimistic-ui]

# Dependency graph
requires:
  - phase: 06-internal-tracking-analytics
    provides: "06-02 threaded trackingEnabled/lifetimeClicks through the D-01 sole write path; 06-05 built GET /api/links/:id/analytics and the LinkAnalyticsDTO shape"
provides:
  - "getLinkAnalytics(id) typed API client (apps/web/src/api.ts)"
  - "LinkDetailView.vue Surface A: always-visible 'Internes Tracking' card with optimistic toggle + 4-state per-link analytics section (replaces the Phase-4 static placeholder)"
affects: [06-08, ui-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optimistic toggle: mutate the reactive DTO ref in place, PATCH through the existing single-write-path client, revert-in-place + toast on failure, no success toast (state change is the confirmation) — mirrors LinkFormModal's forwardQuery/tracking toggle shape but applied inline (no modal/save step)"
    - "4-state data section (tracking-off / loading-skeleton / zero-data / data) as a single v-if/v-else-if chain gated on trackingEnabled/analyticsLoading/totalClicks, guaranteeing mutual exclusivity by construction"

key-files:
  created: []
  modified:
    - apps/web/src/api.ts
    - apps/web/src/views/LinkDetailView.vue
    - apps/web/src/views/LinkDetailView.test.ts

key-decisions:
  - "toggleTracking mutates the current LinkDTO ref's trackingEnabled in place for the optimistic flip (not a separate local boolean ref), then replaces link.value with the PATCH response on success or reverts the same in-place mutation on failure — keeps a single source of truth for the toggle's visual state without introducing a second ref to keep in sync"
  - "row-pct (referrer/country list rows) renders as a rounded percentage ('42%'), matching the field name and the existing Geist-Mono/right-aligned token from the UI-SPEC — the DTO/prototype didn't lock an exact format, so this follows the most literal reading of '.row-pct'"
  - "chart bar height computed as a true proportional pct (0% for a zero-count day); the UI-SPEC's own CSS min-height:3px is what provides the visual floor, so no floor logic was duplicated in the computed"

requirements-completed: [TRACK-01, TRACK-04]

coverage:
  - id: D1
    description: "The 'Internes Tracking' card renders with the correct ON/OFF hint copy and toggle visual state, and clicking it optimistically flips trackingEnabled, PATCHes via updateLink, and shows NO success toast"
    requirement: "TRACK-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#tracking card shows the ON hint copy and an active toggle when tracking is enabled"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#tracking card shows the OFF hint copy and an inactive toggle when tracking is disabled"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#toggle: clicking optimistically flips state, PATCHes via updateLink, and shows NO success toast"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed toggle PATCH reverts the optimistic flip and toasts 'Tracking konnte nicht geändert werden.'"
    requirement: "TRACK-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#toggle: a failed PATCH reverts the optimistic flip and toasts the failure copy"
        status: pass
    human_judgment: false
  - id: D3
    description: "With tracking off, only the dashed empty state renders (no stat cards, no analytics API call)"
    requirement: "TRACK-01"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#tracking-off: only the dashed empty state renders, no stat cards, no analytics call"
        status: pass
    human_judgment: false
  - id: D4
    description: "getLinkAnalytics client hits GET /api/links/:id/analytics and feeds the data state: 3 stat cards, exactly 30 chart bars, referrer + country lists with null host/country mapped to 'Direkt'/'Unbekannt'"
    requirement: "TRACK-04"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#data state: 3 stat cards, exactly 30 chart bars, referrer/country rows with Direkt/Unbekannt for nulls"
        status: pass
    human_judgment: false
  - id: D5
    description: "Zero-data state renders card shells with 0/'–' values, a chart-area hint, and 'Keine Daten' list rows; loading state renders skeleton blocks (no spinner) and is never co-rendered with the data or zero-data state"
    requirement: "TRACK-04"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#zero-data state: card shells with 0/–, chart hint, and 'Keine Daten' list rows"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#loading state: shows skeleton blocks (no spinner) while analytics fetches, never alongside data/zero-data"
        status: pass
    human_judgment: false
  - id: D6
    description: "Pixel-fidelity to 06-UI-SPEC.md § Surface A (tracking-card/toggle shape, stat-grid/chart-card/two-col tokens, skeleton sizes, Light+Dark) — visual verification"
    verification: []
    human_judgment: true
    rationale: "Automated component tests assert class names, text content, and DOM structure but cannot verify rendered pixel geometry, CSS custom-property color tokens, or Light/Dark theme rendering — needs a UI review pass (gsd-ui-review) against 06-UI-SPEC.md § Surface A."

# Metrics
duration: 12min
completed: 2026-07-13
status: complete
---

# Phase 06 Plan 07: Per-Link Analytics (Surface A) Summary

**Ersetzt den statischen Phase-4-Platzhalter in `LinkDetailView.vue` durch eine echte Per-Link-Analytics-Ansicht: eine immer sichtbare Tracking-Karte mit optimistischem Toggle und eine 4-Zustands-Datensektion (Tracking aus / Laden / Zero-Data / Daten), die von einem neuen `getLinkAnalytics`-Client gespeist wird.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-13T10:09:00Z (approx.)
- **Completed:** 2026-07-13T10:21:00Z (approx.)
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `getLinkAnalytics(id)` als typisierter API-Client in `apps/web/src/api.ts` hinzugefügt — `GET /api/links/:id/analytics`, spiegelt exakt das `parseJsonOrThrow`/`ApiError`-Muster von `getLink`.
- Die statische „Statistiken — bald verfügbar"-Karte in `LinkDetailView.vue` durch die immer sichtbare `.tracking-card` ersetzt: Titel „Internes Tracking", ON/OFF-Hinweistext, 38×21-Toggle (identische Form/Tokens wie der bestehende `LinkFormModal`-Toggle, hier als eigene gescopte CSS-Kopie).
- Klick auf den Toggle flippt `link.trackingEnabled` sofort optimistisch, sendet ein `updateLink`-PATCH über den bestehenden, einzigen Schreibpfad (D-15) — Erfolg: kein Toast (der Statewechsel selbst ist die Bestätigung); Fehlschlag: Rückgängig-Machen des Flips + Toast „Tracking konnte nicht geändert werden."
- Darunter genau EINER von vier sich gegenseitig ausschließenden Zuständen: gestrichelte Tracking-aus-Leerkarte, Loading-Skeleton (Platzhalterblöcke, kein Spinner), Zero-Data (Karten-Gerüste mit „0"/„–", Chart-Hinweis, „Keine Daten"-Zeilen) oder die volle Datenansicht (3 Stat-Karten, 30-Balken-Chart mit Pro-Balken-Tooltip, Referrer-/Länder-Listen).
- Fehlender Referrer-Host bzw. nicht auflösbares Land werden erst an der View-Grenze zu „Direkt"/„Unbekannt" übersetzt (D-07/D-04) — die DTO selbst bleibt `null`.

## Task Commits

Each task was committed atomically:

1. **Task 1: getLinkAnalytics client + Tracking card with optimistic toggle** - `2a1499f` (feat, api client) + `2891049` (feat, view — see Deviations for why Task 1's view portion is combined with Task 2's commit)
2. **Task 2: Per-link data / zero-data / loading states** - `2891049` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `apps/web/src/api.ts` - `getLinkAnalytics(id)` typed client method
- `apps/web/src/views/LinkDetailView.vue` - tracking card + optimistic toggle + 4-state analytics section, replacing the static placeholder; new computed helpers (`totalClicks`, `chartBars`, `referrerRows`, `countryRows`, `trackingHint`)
- `apps/web/src/views/LinkDetailView.test.ts` - new tests for the tracking card, toggle (success/failure), and all four data-section states; `getLinkAnalytics` mocked

## Decisions Made
- The optimistic toggle mutates the existing `link` ref's `trackingEnabled` property directly (not a separate boolean ref) — on PATCH success `link.value` is replaced with the server response; on failure the same property is flipped back. This keeps a single reactive source of truth for the card's visual state.
- `row-pct` in the Referrer/Länder lists renders as a rounded percentage string (e.g. `"42%"`) — the UI-SPEC/prototype only labels the field `.row-pct` without locking an exact format; the percentage reading is the most literal interpretation and stays consistent with the field name and the `.row-bar-fill`'s own percentage-based width.
- Chart-bar height is computed as a true proportional percentage of the day's count against the series max (0% for a zero-count day); the UI-SPEC's own `min-height:3px` CSS rule (not duplicated app-side logic) provides the visual floor for near-zero/zero days.

## Deviations from Plan

### Auto-fixed Issues

None — no Rule 1/2/3 bug fixes or missing-functionality additions were required; the existing `getLink`/`updateLink`/toast/try-catch conventions from Phase 4/5 covered every case needed here.

### Process Deviation (not a Rule 1-4 case)

**Task 1 and Task 2 commits combined for the view file.** The plan defines two tasks against the same `LinkDetailView.vue` template: Task 1 (tracking card + toggle + tracking-off empty state) and Task 2 (loading/zero-data/data states). These live in one contiguous `v-if`/`v-else-if` chain in a single `<template>` block and share computed helpers — splitting the working-tree changes into two independently-buildable, independently-testable commits at exactly the task boundary would have required either (a) shipping a state that references not-yet-defined computed properties (a broken intermediate commit), or (b) hand-splitting a single template edit into two artificial partial-file patches with no build/test value at the midpoint. Instead: `apps/web/src/api.ts` (Task 1's client method, a genuinely independent unit) was committed alone (`2a1499f`), and the full `LinkDetailView.vue` + `LinkDetailView.test.ts` change (covering both tasks) was committed together (`2891049`) — every commit in this plan is green (tests + typecheck) at HEAD.
**Impact on plan:** No scope creep or missing functionality — both tasks' acceptance criteria are fully met and independently covered by named tests (see `coverage` above); only the git-history granularity differs from the plan's literal 1:1 task→commit mapping.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Surface A (per-link analytics) is complete and consumes the 06-05 endpoint end-to-end; ready for 06-08 (global analytics overview, Surface B) which follows the identical loading/zero-data/data-state pattern.
- Visual/pixel fidelity to 06-UI-SPEC.md § Surface A (exact spacing, Light/Dark theming, hover states) is unverified by automated tests — flagged as `human_judgment: true` (D6) for a future `gsd-ui-review` pass, consistent with prior phases' UI-fidelity coverage entries.

---
*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

All claimed files exist on disk and all referenced commit hashes (`2a1499f`, `2891049`) are present in git history.
