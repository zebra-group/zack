---
phase: 08-utm-builder-custom-og-metadata
plan: 05
subsystem: ui
tags: [vue3, vitest, accordion, social-card, debounce, fake-timers]

# Dependency graph
requires:
  - phase: 08-utm-builder-custom-og-metadata
    provides: "08-04 (exclusive openSection accordion shell, accordion-body--og placeholder, ogTitleError/ogDescriptionError/ogImageUrlError already on LinkFormFieldErrors)"
provides:
  - "Custom OG-Tags accordion section (Surface B) with input column, hint line, edit-mode pre-fill, and keep-vs-clear payload threading for ogTitle/ogDescription/ogImageUrl"
  - "210px social-card live preview with always-visible hatched fallback, locked placeholder texts, and the domain line derived strictly from the selected short-link domain (UI-08-06)"
  - "Debounced (~300ms) + WHATWG-URL-parse-gated <img src> binding — the one exception to per-keystroke sync updates (T-08-IMG-SCHEME/T-08-IMG-BEACON)"
affects: ["08-06 (badges/chips reading ogTitle/ogDescription/ogImageUrl for the 'OG' attribute signal)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-only debounce+parse-gate pattern for a browser-fetched preview image: watch(ref, ...) resets the failed flag and debounced source synchronously, then a setTimeout only commits the source if the value parses as an absolute http/https URL via `new URL()` — mirrors QrStudioPanel.vue's existing 300ms-debounce-timer shape (clearTimeout on both re-trigger and unmount)"
    - "Social-card domain line sourced from the selected DomainDTO (create mode: domains.find by domainId) or the domainHostname prop (edit mode) — never from targetUrl, continuing the product's no-target-leak posture"

key-files:
  created: []
  modified:
    - apps/web/src/components/LinkFormModal.vue
    - apps/web/src/components/LinkFormModal.test.ts

key-decisions:
  - "The image-URL watch is NOT { immediate: true } — it only fires on change, per the plan's literal 'Watch the image-URL ref and, on change...' action text. This means a pre-filled edit-mode OG image URL does not auto-render as an <img> until the user edits the field once; only the hatched placeholder shows on open. Documented here as a known, deliberate scope boundary rather than fixed proactively, since no must_have/behavior line requires an edit-mode image preload and the plan's action text is unambiguous about the 'on change' trigger."
  - "Used vi.useFakeTimers() (not the real-timer-plus-await-350ms pattern QrStudioPanel.test.ts/LinksView.test.ts use for their own debounces) because the plan's action text explicitly requests fake timers, and this component has no mocked async api.ts call in the same test file to fight the fake clock (QrStudioPanel's stated reason for avoiding fake timers) — verified clean by running the full suite after the change."
  - "Per-field OG errors render as flat siblings inside .og-input-column (input, then its own <p class=field-error>, repeated three times) rather than wrapping each input in its own .field div — matches the flex column's 8px gap token without introducing a new wrapper class, and keeps each error immediately adjacent to its own input as the behavior spec requires (image-URL error must render under only that field)."

patterns-established:
  - "og-card-* class family (og-card, og-card-image, og-card-image-label, og-card-img, og-card-text, og-card-title, og-card-desc, og-card-domain, og-card-caption) for the Surface B preview, parallel in naming shape to the utm-* family from 08-04"

requirements-completed: [META-02]

coverage:
  - id: D1
    description: "Custom OG-Tags accordion section (Surface B) input column: three inputs (title/description default font, image-URL monospace) with locked placeholders/maxlengths (200/500/2048), header set-count summary, positioned between the UTM section and Passwort & Ablauf, sharing openSection exclusivity with the UTM section"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — input column"
        status: pass
    human_judgment: false
  - id: D2
    description: "Static hint line (locked copy, UI-08-09) beneath the three inputs — no per-field character counter"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — input column > renders the static hint line beneath the three inputs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Edit-mode pre-fill and UI-08-05 keep-vs-clear payload threading for ogTitle/ogDescription/ogImageUrl via the existing keepClearOrSet helper"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — input column > pre-filled / untouched / clear cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "Four locked inline error messages (OG_IMAGE_URL_INVALID, OG_TITLE_TOO_LONG, OG_DESCRIPTION_TOO_LONG, OG_IMAGE_URL_TOO_LONG) render beneath the correct single field only"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — input column > error rendering cases"
        status: pass
    human_judgment: false
  - id: D5
    description: "210px social-card preview always visible with hatched placeholder + locked title/description/caption copy when all fields are empty; text updates live per keystroke; domain line derives only from the selected short-link domain (create: domains lookup by domainId, edit: domainHostname prop), never the target URL (UI-08-06/T-08-CARD-LEAK)"
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — social-card preview > empty-state / live-update / domain-line cases"
        status: pass
    human_judgment: false
  - id: D6
    description: "Image binding is debounced (~300ms) and parse-gated to absolute http/https URLs only (T-08-IMG-SCHEME/T-08-IMG-BEACON): a partial value, a javascript: URL, or any non-http(s) scheme never becomes an <img src>; a load failure reverts to the hatch (never a broken-image icon); the URL can be retried fresh after a failure. No server-side fetch is introduced anywhere in this plan's diff (D-08-04/T-08-SSRF-CLIENT — verified via `grep fetch` against the diff)."
    requirement: META-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#Custom OG-Tags section (Surface B) — social-card preview > debounce/parse-gate/failure cases"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual fidelity of the rendered OG section (spacing/typography/color tokens: 210px column, 76px image area, 3px card-text gap, 5px caption margin, per-field fonts) against 08-UI-SPEC.md's Surface B Layout Contract"
    verification: []
    human_judgment: true
    rationale: "Every LOCKED token was cross-checked line-by-line against the CSS source and the Layout Contract in this session (matching 08-04's D5 precedent), but no browser screenshot/render was captured — a human should visually confirm the rendered accordion section and social card against the prototype before this phase's UI is fully signed off."

duration: 6min
completed: 2026-07-22
status: complete
---

# Phase 08 Plan 05: Custom OG-Tags Section + Social-Card Preview Summary

**"Custom OG-Tags" accordion section (three inputs + static length hint) paired with an always-visible 210px social-card preview whose `<img>` binding is the sole synchronous-update exception — debounced ~300ms and gated to absolute http/https URLs so no browser request fires for a mid-typed or non-http value.**

## Performance

- **Duration:** ~6 min (commit-to-commit)
- **Started:** 2026-07-22T23:43:17+02:00
- **Completed:** 2026-07-22T23:49:02+02:00
- **Tasks:** 2 completed
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments

- Built the "Custom OG-Tags" accordion section (Surface B) between the UTM section and Passwort & Ablauf: three inputs (OG-Titel/OG-Beschreibung in the default font, Bild-URL in monospace) with locked placeholders and maxlengths (200/500/2048), a `· N gesetzt` header summary, edit-mode pre-fill, and keep-vs-clear payload threading (`ogTitle`/`ogDescription`/`ogImageUrl`) via the same `keepClearOrSet` helper 08-04 introduced for the UTM trio. A single static hint line replaces per-field counters (UI-08-09), and the section shares `openSection` exclusivity with the UTM section.
- Added four per-field inline error slots reading `ogTitleError`/`ogDescriptionError`/`ogImageUrlError` off the existing `fieldErrors` computed (no new error props), rendering each of the four locked Phase 8 OG error messages beneath exactly the correct field.
- Built the 210px social-card live preview: always visible while the section is open (never an empty-state swap), with locked placeholder texts, single-line ellipsis-truncated title/description, and a domain line derived strictly from the selected short-link domain (`domains` lookup by `domainId` in create mode, `domainHostname` prop in edit mode) — never the target URL (UI-08-06, T-08-CARD-LEAK).
- Implemented the image-URL binding as the one deliberate exception to per-keystroke synchronous updates (UI-08-10's Checker-Nachtrag): a `watch()` on `ogImageUrl` resets the failed flag and debounced source immediately, then a 300ms timer commits the source only if the value parses as an absolute `http:`/`https:` URL via `new URL()` — so partial hosts (`h`, `https:/`) and non-http schemes (`javascript:`) never trigger a browser request. A load failure (`@error`) reverts to the hatched placeholder rather than a broken-image icon, and the URL can be retried fresh after changing again.

## Task Commits

Each task was committed atomically with a RED/GREEN TDD pair:

1. **Task 1: OG input column, hint line and payload threading**
   - `46b1401` test(08-05): failing cases for the custom OG input section
   - `797e733` feat(08-05): custom OG-tag section with input column and length guidance
2. **Task 2: The 210px social-card live preview with hatched image fallback**
   - `46b3de8` test(08-05): failing cases for the social-card preview and image fallback
   - `08f0315` feat(08-05): social-card live preview with debounced image and hatched fallback

**Plan metadata:** committed separately by this summary step (see final commit below).

## Files Created/Modified

- `apps/web/src/components/LinkFormModal.vue` — three OG initial-value props, three refs, `ogSetCount`/`ogSummary`/`ogCardDomain` computeds, the debounce+parse-gate `watch` + `handleOgImageError`, submit-payload threading (Task 1), and the "Custom OG-Tags" section markup (input column Task 1, social-card preview column Task 2) with the matching `.og-*` scoped CSS
- `apps/web/src/components/LinkFormModal.test.ts` — 20 new cases across two `describe` blocks: "Custom OG-Tags section (Surface B) — input column" (Task 1) and "— social-card preview" (Task 2, using `vi.useFakeTimers()` per the plan's action text)

## Decisions Made

- The `ogImageUrl` watch is deliberately NOT `{ immediate: true }` — it only fires on a subsequent change, following the plan's literal "Watch the image-URL ref and, on change, immediately reset..." action text. Net effect: a pre-filled edit-mode OG image URL shows the hatched placeholder on section-open rather than the actual image until the user edits the field once. No `must_haves` line or `<behavior>` bullet in the plan requires an edit-mode image preload, so this is treated as an intentional, documented scope boundary rather than an auto-fixed gap — flagged here for the next plan/human review to confirm it's acceptable, since it's a plausible UX rough edge (D8 below).
- Chose `vi.useFakeTimers()` over the codebase's more common real-timer-plus-`await new Promise(setTimeout)` debounce-testing convention (documented in `QrStudioPanel.test.ts`/`LinksView.test.ts` as avoiding a fight with `flushPromises`'s internal real `setTimeout(0)`). This plan's test file mocks no async `api.ts` call and never calls `flushPromises`, so there was no such conflict — the plan's action text explicitly asked for fake timers, and the full suite (186 tests) stayed green after the switch.
- Per-field OG errors are flat siblings inside `.og-input-column` (`input`, then its own `<p class="field-error">`, repeated three times) rather than each wrapped in an extra `.field`-style container — keeps the flex column's 8px gap token intact without a new wrapper class, while still meeting the "renders beneath ONLY its own input" requirement (verified: OG_IMAGE_URL_INVALID renders exactly one `.field-error` in the section, under the image-URL field).

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<behavior>` and `<action>` blocks were followed literally, including the "driving the debounce with fake timers" instruction (a deliberate divergence from this codebase's usual real-timer debounce-test convention, but explicitly requested by the plan and confirmed safe for this file, as explained above).

## Issues Encountered

None. `pnpm -r exec tsc --noEmit` was clean after both tasks with no unused imports or stale-build issues; the full `apps/web` Vitest suite (186 tests) stayed green throughout.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Every field wired in this plan (three OG inputs, the social card's three text lines, the image binding) reads from and writes to real component state — no hardcoded empty values or "coming soon" placeholders reach the rendered UI.

## Threat Flags

None beyond what the plan's own `<threat_model>` already anticipated (T-08-IMG-SCHEME, T-08-IMG-BEACON, T-08-SSRF-CLIENT, T-08-CARD-LEAK, T-08-CARD-XSS) — all five are mitigated exactly as that register describes: the image source is parse-gated to http/https via `new URL()`, the binding is debounced, no new fetch call exists anywhere in this plan's diff (confirmed via `grep fetch` against `apps/web/src/components/LinkFormModal.vue` and `apps/web/src/api.ts`), the domain line never reads `targetUrl`, and all three card text lines render via Vue text interpolation (`{{ }}`), never `v-html`.

## Next Phase Readiness

- Plan 08-06 (badges/chips, Surface C/D) can read `link.ogTitle`/`link.ogDescription`/`link.ogImageUrl` off the `LinkDTO` (already shaped by 08-01) to derive the "OG" attribute badge/chip — no further groundwork needed from this plan.
- Two open human-verification items carried forward (not blockers):
  - **D7** (visual fidelity): tokens were cross-checked against the CSS source and the Layout Contract, but no browser screenshot was captured this plan — same posture as 08-04's D5.
  - **D8** (documented decision above): whether a pre-filled edit-mode OG image URL should auto-render on section-open, or whether the current "shows hatch until the user edits the field once" behavior is acceptable, is worth a quick human call before final sign-off — it is a UX nuance, not a spec violation, since no locked behavior line requires the preload.

---
*Phase: 08-utm-builder-custom-og-metadata*
*Completed: 2026-07-22*

## Self-Check: PASSED

All 3 created/modified files confirmed present on disk; all 4 task commit hashes confirmed present in git history.
