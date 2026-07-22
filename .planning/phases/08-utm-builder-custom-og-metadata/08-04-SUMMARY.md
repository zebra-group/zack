---
phase: 08-utm-builder-custom-og-metadata
plan: 04
subsystem: ui
tags: [vue3, vitest, accordion, url-searchparams, form-validation]

# Dependency graph
requires:
  - phase: 08-utm-builder-custom-og-metadata
    provides: "08-01 (LinkErrorCode UTM/OG codes, UpdateLinkInput fields), 08-02 (applyUtmParams in redirectEngine.ts)"
provides:
  - "Exclusive three-section accordion shell (openSection ref) shared by Passwort & Ablauf + the new UTM/OG sections"
  - "buildUtmPreview pure client-side mirror of applyUtmParams for the live preview"
  - "LinkFormFieldErrors extended with utmError/ogTitleError/ogDescriptionError/ogImageUrlError"
  - "UTM-Parameter accordion section (Surface A) with live preview, set-count summary, and keep-vs-clear payload threading"
affects: ["08-05 (Custom OG-Tags section, Surface B, slots into the same openSection shell + accordion-body--og modifier)", "08-06 (badges/chips reading utmSource/utmMedium/utmCampaign)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Accordion shell: shared .accordion-section/-header/-summary/-chevron/-body classes plus per-section --sec/--utm/--og modifier classes, driven by one openSection: ref<'utm'|'og'|'sec'|null>"
    - "Pure preview-mirror helper module (apps/web/src/lib/utm.ts) that duplicates a server algorithm's branches exactly, kept as a plain .ts file (not inside the SFC) per the repo's named-export-vs-vue-shim constraint"
    - "keepClearOrSet(current, initial) helper for UI-08-05's two-state (typed value vs explicit null-clear vs omitted-keep) submit semantics, distinct from the three-state password KEEPCLEAR pattern"

key-files:
  created:
    - apps/web/src/lib/utm.ts
    - apps/web/src/lib/utm.test.ts
    - apps/web/src/api.link.test.ts
  modified:
    - apps/web/src/components/LinkFormModal.vue
    - apps/web/src/components/LinkFormModal.test.ts
    - apps/web/src/views/LinksView.test.ts
    - apps/web/src/api.ts

key-decisions:
  - "openSection ref is typed as the full utm|og|sec|null union now (Task 1), even though the OG section doesn't exist until the next plan — avoids a second accordion-state refactor when Surface B lands"
  - "utmError/ogTitleError/ogDescriptionError/ogImageUrlError were added to api.ts's LinkFormFieldErrors in THIS plan's Task 2, ahead of the OG section itself, because both this plan's UTM section and the next plan's OG section read off the same modal fieldErrors computed"
  - "buildUtmPreview's fallback path (target doesn't parse as a URL) is a deliberate, documented addition over the server's applyUtmParams — the server never sees a mid-typed value, but the preview recomputes on every keystroke"

patterns-established:
  - "Accordion shell pattern: one shared shell + per-section modifier classes, not three duplicated section trees"
  - "keepClearOrSet helper factored once and reused for all three UTM fields (and, per the plan, the OG trio's future analogue)"

requirements-completed: [META-01]

coverage:
  - id: D1
    description: "Accordion generalized to an exclusive multi-section shell (openSection ref); retired .security-* classes renamed to shared .accordion-*/--modifier classes; keyboard a11y (role=button, tabindex=0, aria-expanded, Enter/Space) added to the header"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#accordion shell (Phase 8, UI-08-01/02/04)"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#editing a protected/expiring link prefills expiry + forwardQuery, but never a password value"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildUtmPreview pure helper mirroring the server's applyUtmParams branch-for-branch, including the guard-first no-op, canonical delete-then-set ordering, owner-wins override, percent-encoding, and a non-throwing fallback for a mid-typed target"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/lib/utm.test.ts#buildUtmPreview"
        status: pass
    human_judgment: false
  - id: D3
    description: "LinkFormFieldErrors/mapLinkFormError extended with the five Phase 8 UTM/OG error codes and their locked German messages, existing target-url/slug mappings unchanged"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/api.link.test.ts#mapLinkFormError — Phase 8 UTM/OG codes"
        status: pass
    human_judgment: false
  - id: D4
    description: "UTM-Parameter accordion section (Surface A): three inputs, live destination preview updating per keystroke (including while closed then reopened), header set-count summary, edit-mode pre-fill, and keep-vs-clear submit payload threading"
    requirement: META-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#UTM-Parameter section (Surface A)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual fidelity of the rendered UTM section (spacing/typography/color tokens) against 08-UI-SPEC.md's Surface A Layout Contract"
    verification: []
    human_judgment: true
    rationale: "Tokens were cross-checked line-by-line against the CSS source in this session, but no browser screenshot/render was captured this plan — a human should visually confirm the rendered accordion section against the prototype before sign-off."

duration: 12min
completed: 2026-07-22
status: complete
---

# Phase 08 Plan 04: UTM Builder Accordion + Live Preview Summary

**Exclusive three-section link-form accordion plus a "UTM-Parameter" section whose live destination preview mirrors the server's `applyUtmParams` percent-encoding exactly, with keep-vs-clear payload semantics for the three new fields.**

## Performance

- **Duration:** ~12 min (commit-to-commit)
- **Started:** 2026-07-22T23:24:09+02:00
- **Completed:** 2026-07-22T23:35:39+02:00
- **Tasks:** 3 completed
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- Generalized the Phase-5 single-boolean `secOpen` accordion into an exclusive `openSection: ref<"utm"|"og"|"sec"|null>` shell shared by all three sections, with the retired `.security-*` classes renamed to `.accordion-*` (plus per-section `--sec`/`--utm`/`--og` modifiers) and keyboard accessibility (role/tabindex/aria-expanded/Enter/Space) added to every header.
- Built `buildUtmPreview` (`apps/web/src/lib/utm.ts`), a pure client-side mirror of the server's `applyUtmParams` — same guard-first no-op, same delete-then-set canonical ordering, same `URLSearchParams`-only encoding — plus a documented fallback shape for targets that don't parse as a URL yet (mid-typing).
- Extended `LinkFormFieldErrors`/`mapLinkFormError` in `api.ts` with the five Phase 8 UTM/OG error codes and their locked German messages, without touching the existing target-url/slug mappings.
- Shipped the "UTM-Parameter" accordion section (Surface A): three mono-font inputs, a live `?`/`&`-aware preview box that updates on every keystroke (including while the section is closed and reopened), a `· N gesetzt` header summary, edit-mode pre-fill, and keep-vs-clear submit payload threading via a new shared `keepClearOrSet` helper.

## Task Commits

Each task was committed atomically with a RED/GREEN TDD pair:

1. **Task 1: Exclusive three-section accordion + shared class names + selector sweep**
   - `028eaad` test(08-04): failing cases for exclusive accordion behaviour
   - `ee3282b` refactor(08-04): generalize link-form accordion to exclusive multi-section shell
2. **Task 2: Pure client helpers — buildUtmPreview + the six inline error mappings**
   - `b041d73` test(08-04): failing cases for the UTM preview builder and metadata error mapping
   - `711d13c` feat(08-04): buildUtmPreview mirroring the server plus UTM/OG inline error mapping
3. **Task 3: The „UTM-Parameter" section (Surface A) with live preview and payload threading**
   - `eb1b39d` test(08-04): failing cases for the UTM section and its live preview
   - `ddf5bf2` feat(08-04): UTM builder section with live destination preview

**Plan metadata:** committed separately by this summary step (see final commit below).

## Files Created/Modified

- `apps/web/src/lib/utm.ts` — pure `buildUtmPreview(targetUrl, utm)` helper mirroring `applyUtmParams`
- `apps/web/src/lib/utm.test.ts` — 11 cases covering the guard, ordering, encoding, override, and fallback branches
- `apps/web/src/api.link.test.ts` — 6 cases for the five new `mapLinkFormError` codes
- `apps/web/src/api.ts` — `LinkFormFieldErrors` gains `utmError`/`ogTitleError`/`ogDescriptionError`/`ogImageUrlError`; `mapLinkFormError` gains five `case` branches and five locked message constants
- `apps/web/src/components/LinkFormModal.vue` — accordion generalization (Task 1) + the UTM-Parameter section, refs, computeds, and submit-payload threading (Task 3)
- `apps/web/src/components/LinkFormModal.test.ts` — selector sweep to `.accordion-*` classes, new accordion a11y/exclusivity cases, and the full UTM section behavior suite
- `apps/web/src/views/LinksView.test.ts` — one selector re-point (`.security-header` → `.accordion-header--sec`)

## Decisions Made

- Declared the full three-member `openSection` union type in Task 1, before the OG section exists, so the next plan (08-05) slots Surface B in without a second accordion-state refactor.
- Landed the four new `LinkFormFieldErrors` fields in this plan's Task 2 rather than deferring to the OG-specific plan, since both this plan's UTM section and the next plan's OG section render off the same modal `fieldErrors` computed — deferring would have broken this plan's own type-check.
- `buildUtmPreview`'s try/catch fallback path is a deliberate, documented divergence from `applyUtmParams`: the server only ever validates a fully-typed target, but the preview recomputes on every keystroke of a form the user may still be mid-typing into (e.g. `"htt"`).

## Deviations from Plan

None — plan executed exactly as written. The Task 1 "exclusivity" behavior tests were scoped to what could actually render at that point in the sweep (only the "sec" section exists until Task 3 adds "utm"); the plan's `<behavior>` block itself acknowledges this staging by describing the eventual architecture, and full cross-section exclusivity is exercised naturally by Task 3's tests once a second real section exists on the same `openSection` ref.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 08-05 (Custom OG-Tags, Surface B) can slot its section directly between the UTM section and the Passwort & Ablauf section, reusing `openSection`/`toggleSection`, the `.accordion-body--og` placeholder modifier already declared, and the `ogTitleError`/`ogDescriptionError`/`ogImageUrlError` fields already on `LinkFormFieldErrors`.
- No blockers. The one open item is D5 (visual fidelity) — a human should compare the rendered UTM section against the prototype screenshot before this phase's UI is considered fully signed off, since this plan only verified tokens against the CSS source, not a live render.

---
*Phase: 08-utm-builder-custom-og-metadata*
*Completed: 2026-07-22*

## Self-Check: PASSED

All 8 created/modified files confirmed present on disk; all 6 task commit hashes confirmed present in git history.
