---
phase: 08-utm-builder-custom-og-metadata
plan: 06
subsystem: ui
tags: [vue3, vitest, links-list, link-detail, badges, chips]

# Dependency graph
requires:
  - phase: 08-utm-builder-custom-og-metadata
    provides: "08-01 (LinkDTO/CreateLinkInput/UpdateLinkInput UTM/OG fields), 08-04 (UTM section + mapLinkFormError codes), 08-05 (Custom OG-Tags section, social-card preview)"
provides:
  - "LinksView.vue and LinkDetailView.vue thread the six UTM/OG fields through create/edit submit handlers, with correct keep-vs-clear semantics"
  - "Both edit-mode LinkFormModal instances pre-fill all six fields from the loaded LinkDTO"
  - "UTM/OG attribute badges (Surface C, LinksView.vue) and metadata chips (Surface D, LinkDetailView.vue) in the locked order, deriving live from the returned DTO"
  - "reportFormError's WR-09 fallback-toast check fixed in both views to inspect every mapped field error, not just targetUrlError/slugError"
  - "LinkFormModal.vue's ogImageUrl watch runs on mount (immediate: true), so an edit-mode pre-filled image URL renders after the same debounce without requiring a field edit first"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "hasUtm/hasOg predicates: OR across the three UTM (or OG) fields, duplicated per view (LinksView.vue takes a link param; LinkDetailView.vue is a computed against the single loaded link ref) rather than shared, since each view's data shape differs"
    - ".attr-badge: generalization of the Phase-6 .tracking-badge class, shared verbatim by the UTM/OG/Tracking-aus badges — same CSS rule, three v-if spans in a fixed order"

key-files:
  created: []
  modified:
    - apps/web/src/views/LinksView.vue
    - apps/web/src/views/LinksView.test.ts
    - apps/web/src/views/LinkDetailView.vue
    - apps/web/src/views/LinkDetailView.test.ts
    - apps/web/src/components/LinkFormModal.vue
    - apps/web/src/components/LinkFormModal.test.ts

key-decisions:
  - "CreateLinkInput has no null variant for the six fields, so handleCreateSubmit collapses null to undefined (?? undefined) at the call site; handleEditSubmit forwards null through unchanged since UpdateLinkInput's keep/clear semantics require it (T-08-CLEAR-DROP)."
  - "Fixed reportFormError's WR-09 toast-fallback check (originally `!mapped.targetUrlError && !mapped.slugError`) in both LinksView.vue and LinkDetailView.vue to `Object.values(mapped).some((v) => v !== undefined)` — the original check predates the five Phase 8 UTM/OG error codes and would fire the generic failure toast alongside a correctly-rendered inline UTM/OG error (Rule 1 bug fix, in scope since it directly affects the error path this plan's tests exercise)."
  - "Fixed LinkFormModal.vue's ogImageUrl watch to { immediate: true } (D8 gap flagged in 08-05's SUMMARY.md as a known, deliberate scope boundary) — an edit-mode link with an existing valid image URL now renders it after the same 300ms debounce on section-open, with no behavior change to the debounce/parse-gate contract for create mode or freshly typed values."

patterns-established: []

requirements-completed: [META-01, META-02]

coverage:
  - id: D1
    description: "LinksView.vue create/edit submit handlers thread all six UTM/OG fields (collapsing null to undefined only for CreateLinkInput); edit-mode modal instance pre-fills the six fields from the link's DTO"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > creating a link with UTM and OG values typed in the modal sends all six on the create request"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > editing a link opens the modal with all six fields pre-filled from the link's DTO"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > clearing all six pre-filled fields and saving forwards explicit null clears to updateLink"
        status: pass
    human_judgment: false
  - id: D2
    description: "UTM and OG attribute badges render in the locked order (UTM -> OG -> Tracking aus) inside the slug cell, sharing the generalized .attr-badge class with the unchanged Tracking-aus badge, and update immediately after a successful save with no reload"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > shows UTM before OG before the Tracking-aus badge when a link carries all three (locked order)"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > after a successful create the new row shows the UTM and OG badges immediately, without a reload"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#a tracked link renders its lifetimeClicks right-aligned in the Klicks cell"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed save whose 400 carries an OG-image-url-invalid or UTM-too-long code renders the locked message beneath the correct field inside the still-open modal, via the existing single error prop and mapLinkFormError — no second error channel"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > a failed create carrying the OG-image-url-invalid code renders the locked message beneath the image-URL input inside the still-open modal"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#UTM/OG payload threading and attribute badges (Surface C) > a failed edit carrying the UTM-value-too-long code renders the locked message beneath the UTM inputs inside the still-open modal"
        status: pass
    human_judgment: false
  - id: D4
    description: "LinkDetailView.vue edit modal instance pre-fills all six fields from the loaded link; handleEditSubmit forwards all six fields exactly as received, including explicit null clears"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > opening the edit modal pre-fills all six fields from the link"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > saving forwards the modal's payload unchanged, including explicit null clears"
        status: pass
    human_judgment: false
  - id: D5
    description: "UTM-Parameter-gesetzt and Custom-OG-Tags chips render in the locked order after the hostname/created chips, only when the link carries those values, updating in place from the returned DTO after a successful save with no reload; the destination line keeps showing the clean stored targetUrl (UI-08-07)"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > shows the UTM chip and OG chip, in order, after the hostname/created chips, only when those values are set"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > neither chip renders when the link carries no UTM or OG values"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > after a successful save the chips update in place from the returned DTO, without a reload"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > the destination line keeps showing the stored target URL without any UTM parameters appended (UI-08-07)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A failed detail-page save whose 400 carries the OG-image-url-invalid code renders the locked message beneath the image-URL input inside the still-open modal, purely through the existing error prop"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts#UTM/OG payload threading and metadata chips (Surface D) > a failed save carrying the OG-image-url-invalid code renders the locked message beneath the image-URL input inside the still-open modal"
        status: pass
    human_judgment: false
  - id: D7
    description: "LinkFormModal.vue's edit-mode OG image preview preloads on section-open (D8 gap fix from 08-05): a pre-filled valid http(s) image URL renders after the same 300ms debounce, without requiring the user to edit the field first"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — social-card preview > edit mode with a pre-filled absolute http(s) image URL renders the image on open, after the same debounce — no edit required first"
        status: pass
    human_judgment: false
  - id: D8
    description: "Visual fidelity of the two rendered badges (LinksView.vue) and two chips (LinkDetailView.vue) against 08-UI-SPEC.md's Surface C/D Layout Contracts, and the exact-unchanged appearance of the existing Tracking-aus badge/hostname/created chips"
    verification: []
    human_judgment: true
    rationale: "Tokens (.attr-badge is a straight generalization of the already-shipped .tracking-badge rule; the two new chips reuse the existing unmodified .chip class) were cross-checked against the CSS source and the Layout Contract in this session, but no browser screenshot/render was captured this plan — a human should visually confirm both surfaces against the prototype before this phase's UI is fully signed off, carrying forward the same open item as 08-04's D5 and 08-05's D7."

# Metrics
duration: 17min
completed: 2026-07-23
status: complete
---

# Phase 08 Plan 06: Links List + Link Detail — Payload Threading, Badges, Chips Summary

**Threaded the UTM/OG payload from `LinkFormModal.vue` into `createLink`/`updateLink` in both `LinksView.vue` and `LinkDetailView.vue`, added the two "UTM"/"OG" attribute badges and the two metadata chips, confirmed the existing single-error-prop path renders the five Phase 8 inline validation messages, and fixed 08-05's flagged edit-mode OG-image-preload gap.**

## Performance

- **Duration:** ~17 min (commit-to-commit)
- **Started:** 2026-07-22T23:55:27+02:00
- **Completed:** 2026-07-23T00:02:12+02:00
- **Tasks:** 2 completed (plus one small in-scope defect fix, per the plan's explicit instruction)
- **Files modified:** 6

## Accomplishments

- `LinksView.vue`'s create/edit submit handlers now thread all six UTM/OG fields into `createLink`/`updateLink` — collapsing `null` to `undefined` only at the create call site (`CreateLinkInput` has no `null` variant), forwarding `null` unchanged at the edit call site so an explicit clear reaches the API (T-08-CLEAR-DROP). The edit-mode `LinkFormModal` instance now passes the six matching `initial-*` props from the link being edited.
- Added `hasUtm`/`hasOg` predicates and rendered the "UTM"/"OG" attribute badges inside the slug cell, in the UI-SPEC's locked order (UTM → OG → Tracking aus). Generalized `.tracking-badge` to the shared neutral `.attr-badge` class per the Surface C note — one CSS rule, three conditional spans — updating every markup and test reference in the same commit.
- `LinkDetailView.vue` gained the identical payload-threading and edit-modal pre-fill treatment, plus `hasUtm`/`hasOg` computeds (against the single loaded `link` ref) driving the two new chips ("UTM-Parameter gesetzt" / "Custom OG-Tags") appended after the existing hostname/created chips — no new section, card, or panel, and the destination line above them keeps rendering the clean stored `targetUrl` (UI-08-07).
- Confirmed — rather than rebuilt — the inline-error path both views already had: a submit error still flows through the single `error` prop into the modal's internal `mapLinkFormError`, which already carried the five Phase 8 UTM/OG codes from 08-04. Added explicit failing-save test cases (OG-image-url-invalid under the image field, UTM-too-long under the UTM grid) proving this end to end in both views, with no second error channel introduced.
- Fixed the 08-05-flagged D8 gap: `LinkFormModal.vue`'s `ogImageUrl` watch now runs `{ immediate: true }`, so opening the OG section on an edit-mode link that already has a valid `http(s)` image URL renders the image after the same 300ms debounce, instead of showing the hatched placeholder until the user edits the field once.

## Task Commits

Each task was committed atomically with a RED/GREEN TDD pair:

1. **Task 1: Links list — payload threading, edit pre-fill, and the UTM/OG attribute badges (Surface C)**
   - `811e984` test(08-06): failing cases for links-list UTM/OG threading and badges
   - `e950cef` feat(08-06): thread UTM/OG through the links list and add attribute badges
2. **Task 2: Link detail — payload threading, edit pre-fill, and the two metadata chips (Surface D)**
   - `2620893` test(08-06): failing cases for link-detail UTM/OG threading and chips
   - `2af3a3c` feat(08-06): thread UTM/OG through link detail and add metadata chips
3. **In-scope defect fix (plan's explicit instruction #4): edit-mode OG image preload**
   - `7b3c5ed` test(08-06): failing case for edit-mode OG image preload
   - `2ec49b9` fix(08-06): preload the OG image preview on edit-mode open

**Plan metadata:** committed separately by this summary step (see final commit below).

## Files Created/Modified

- `apps/web/src/views/LinksView.vue` — `handleCreateSubmit`/`handleEditSubmit` payload threading, `hasUtm`/`hasOg` predicates, badge markup, `.attr-badge` CSS rename, `reportFormError` fallback-toast fix, six new `initial-*` props on the edit-mode modal instance
- `apps/web/src/views/LinksView.test.ts` — `.tracking-badge` → `.attr-badge` selector rename in two existing tests, new "UTM/OG payload threading and attribute badges (Surface C)" describe block (9 cases)
- `apps/web/src/views/LinkDetailView.vue` — `handleEditSubmit` payload threading, `hasUtm`/`hasOg` computeds, chip markup, `reportFormError` fallback-toast fix, six new `initial-*` props on the edit modal instance
- `apps/web/src/views/LinkDetailView.test.ts` — new "UTM/OG payload threading and metadata chips (Surface D)" describe block (7 cases)
- `apps/web/src/components/LinkFormModal.vue` — `ogImageUrl` watch gains `{ immediate: true }`
- `apps/web/src/components/LinkFormModal.test.ts` — one new edit-mode image-preload case in the "social-card preview" describe block

## Decisions Made

- `CreateLinkInput` has no `null` variant for the six Phase 8 fields, so `handleCreateSubmit` collapses `null` to `undefined` (`?? undefined`) at the `createLink` call site; the modal's `keepClearOrSet` never actually emits `null` in create mode anyway (there is no "initial value" to clear), so this is a defensive type-safety measure, not a behavior change.
- `handleEditSubmit` in both views forwards the six fields exactly as received from the modal — no `?? undefined` collapsing — because `UpdateLinkInput`'s keep/clear/set tri-state requires an explicit `null` to reach the API as a clear (T-08-CLEAR-DROP, tested explicitly in both views).
- Fixed `reportFormError`'s pre-existing WR-09 fallback-toast check in both views. It originally only inspected `mapped.targetUrlError`/`mapped.slugError` — a holdover from before Phase 8's five UTM/OG error codes existed — so a correctly-rendered UTM/OG inline error would ALSO still fire the generic "Speichern fehlgeschlagen" toast. Replaced with `Object.values(mapped).some((v) => v !== undefined)`. Classified as a Rule 1 bug fix: it's directly in the error path this plan's own failing-save tests exercise, not unrelated scope creep.
- Fixed `LinkFormModal.vue`'s `ogImageUrl` watch to `{ immediate: true }`, closing the D8 gap 08-05's SUMMARY.md explicitly flagged as a known, deliberate scope boundary needing a follow-up call. Per this plan's critical-execution-notes instruction #4, treated as its own small TDD pair rather than folded into Task 1/2. No change to the debounce interval, the parse-gate, or create-mode/freshly-typed-value behavior — only the mount-time trigger changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `reportFormError`'s fallback-toast check to inspect every mapped field error**
- **Found during:** Task 1 (writing the failing-save test cases)
- **Issue:** `reportFormError` in both `LinksView.vue` and `LinkDetailView.vue` only checked `mapped.targetUrlError`/`mapped.slugError` before deciding whether to show the generic fallback toast. Since Phase 8 added five more possible mapped fields (`utmError`, `ogTitleError`, `ogDescriptionError`, `ogImageUrlError`), a save rejected with e.g. `OG_IMAGE_URL_INVALID` would correctly render the inline field error AND incorrectly also show "Speichern fehlgeschlagen. Bitte erneut versuchen." — a confusing double-signal for a single well-understood error.
- **Fix:** Replaced the two-field check with `Object.values(mapped).some((v) => v !== undefined)`, which generalizes correctly to any future field `mapLinkFormError` might add.
- **Files modified:** `apps/web/src/views/LinksView.vue`, `apps/web/src/views/LinkDetailView.vue`
- **Verification:** The new failing-save test cases in both views' test files assert the inline error text and (implicitly, via not asserting a toast) the absence of the fallback toast.
- **Committed in:** `e950cef` (Task 1), `2af3a3c` (Task 2)

**2. [In-scope, plan-directed] Preload the edit-mode OG image preview**
- **Found during:** explicitly named by the plan's critical-execution-notes #4, tracing back to 08-05's SUMMARY.md D8 open item
- **Issue:** `LinkFormModal.vue`'s `ogImageUrl` watch only fired on change, so opening the "Custom OG-Tags" section on an edit-mode link with an existing valid image URL showed the hatched placeholder until the user touched the field once.
- **Fix:** Added `{ immediate: true }` to the watch — the debounce/parse-gate timing is otherwise unchanged.
- **Files modified:** `apps/web/src/components/LinkFormModal.vue`, `apps/web/src/components/LinkFormModal.test.ts`
- **Verification:** New test asserts the image is absent before the debounce elapses and present with the correct `src` after 300ms, mirroring the timing contract of every other image-binding test in the same describe block.
- **Committed in:** `2ec49b9`

---

**Total deviations:** 1 auto-fixed bug (Rule 1) + 1 plan-directed defect fix (explicitly named in the plan, not a Rule 1-4 discovery).
**Impact on plan:** Both fixes are narrowly scoped to the error/preview paths this plan's own tests exercise. No scope creep.

## Issues Encountered

None. `pnpm -r exec tsc --noEmit` stayed clean throughout; the full `@kurzly/web` suite (203 tests) and `@kurzly/api` suite (448 tests) were green after every task.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Every badge/chip predicate reads live `LinkDTO` fields; no hardcoded empty values, "coming soon" placeholders, or unwired data sources were introduced.

## Threat Flags

None beyond what the plan's own `<threat_model>` already anticipated (T-08-ERR-ECHO, T-08-CLEAR-DROP, T-08-BADGE-LEAK, T-08-DETAIL-LEAK) — all four are mitigated exactly as that register describes: the mapper still selects only from fixed local message constants (no server string reaches the DOM), both parents forward `null` untouched in edit mode (tested explicitly), the badges/chips report only presence (no value, no destination text), and the detail-page destination line was asserted to omit any `utm_` substring.

## Next Phase Readiness

- This was the final plan of Phase 8 (`depends_on: [08-01, 08-04, 08-05]`, wave 4) — META-01 and META-02 are both fully wired end to end: form → API client → persisted fields → badges/chips, with inline validation confirmed.
- One open human-verification item carried forward from 08-04/08-05: **D8** in this SUMMARY (visual fidelity of the two badges and two chips against the prototype) — same posture as 08-04's D5 and 08-05's D7, since `.attr-badge`/`.chip` are straight reuses of already-shipped, already-verified CSS rules, but no live-render screenshot was captured across any of the three plans in this phase.

---
*Phase: 08-utm-builder-custom-og-metadata*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 6 created/modified files confirmed present on disk; all 6 task commit hashes confirmed present in git history.
