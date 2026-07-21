---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 07
subsystem: ui
tags: [vue3, vue-router, qr-codes, api-client, optimistic-ui, tdd]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (07-04/07-05)
    provides: QrCode single-write-path core (createQrCode/updateQrCode/remapQrCode), QR CRUD routes, render.png/render.svg endpoints, remap-history endpoint
provides:
  - "apps/web/src/api.ts QR client functions (createQrCode/listQrCodes/getQrCode/updateQrCode/remapQrCode/getQrRemapHistory), render URL builders, mapQrFormError — the SOLE fetch layer for QR data"
  - "/qr-codes route resolves to QrCodesView (ComingSoonView removed from this route)"
  - "QrCodesView list surface: loading/error/empty/data states, instant dynamic create, optimistic remap, full remap-history expander"
affects: [07-08-qr-studio, 07-09-link-detail-qr-entry-point]

tech-stack:
  added: []
  patterns:
    - "QR web API client mirrors the Link client's fetch-wrapper + typed-Promise-return shape exactly (api.ts)"
    - "Remap history is fetched per-dynamic-QR via getQrRemapHistory (not embedded in QrCodeDTO), stored newest-first, extended locally with a synthetic entry after each successful remap instead of a redundant re-fetch"
    - "Optimistic mutate-in-place + revert-on-catch (mirrors LinkDetailView.vue's toggleTracking) applied to the QR target select"

key-files:
  created:
    - apps/web/src/views/QrCodesView.vue
    - apps/web/src/views/QrCodesView.test.ts
    - apps/web/src/api.qr.test.ts
  modified:
    - apps/web/src/api.ts
    - apps/web/src/router/index.ts

key-decisions:
  - "07-07: apps/web/src/api.qr.test.ts added (Rule 2, MVP+TDD gate) — Task 1's api.ts additions (fetch wrappers + mapQrFormError) are genuinely behavior-adding per the plan's tdd=\"true\" flag but had no dedicated test file in files_modified; no api.test.ts precedent existed in this codebase, so this establishes one scoped to the QR client functions"
  - "07-07: verify command for Task 1 run as `pnpm --filter @kurzly/web run typecheck` (plain tsc --noEmit) instead of the plan's literal `vue-tsc --noEmit` — vue-tsc was dropped from this repo in Phase 1 (incompatible with typescript@7.0.2, STATE.md decision), the project's actual typecheck script is tsc --noEmit against the *.vue module shim"
  - "07-07: QrCodeDTO has no embedded remapHistory field (confirmed against packages/shared/src/index.ts) — full history is fetched once per dynamic QR via getQrRemapHistory on load (reversed to newest-first) and extended with one synthetic entry after each successful remap, avoiding a redundant re-fetch of information the just-succeeded response already proves happened"
  - "07-07: '+ Dynamischer QR' guards against zero accessible Links (edge case the locked copy doesn't cover) with a toast fallback rather than calling createQrCode with an invalid default target"
  - "07-07: Studio panel (right column) intentionally left as a header-only placeholder (title + selected QR's code, both LOCKED per 07-UI-SPEC.md) — preview/controls/export are 07-08's scope"

patterns-established:
  - "QR client functions in api.ts are the single fetch layer for QR data — 07-08 (Studio) and 07-09 (Link-Detail) must import from api.ts, never fetch() directly"

requirements-completed: [QR-02, QR-03, QR-04, QR-07]

coverage:
  - id: D1
    description: "/qr-codes renders QrCodesView (not ComingSoonView) with exactly one of loading/error/empty/data states at a time"
    requirement: "QR-02"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#renders the loading skeleton before the fetch resolves"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#renders the error state when loading fails, and retry re-fetches"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#renders the empty state when there are no QR codes"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#renders the data state with one card per QR code"
        status: pass
    human_judgment: false
  - id: D2
    description: "'+ Dynamischer QR' creates a dynamic QR immediately (no dialog), prepends+selects it, toasts success"
    requirement: "QR-02"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#'+ Dynamischer QR' creates immediately (no dialog), prepends + selects the card, and toasts"
        status: pass
    human_judgment: false
  - id: D3
    description: "QR cards show name, code (/q/xxxx or /slug), DYNAMISCH/STATISCH badge, target select (disabled for static), scan count"
    requirement: "QR-07"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#renders the data state with one card per QR code"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#shows the disabled select for a static QR without a remap handler firing"
        status: pass
    human_judgment: false
  - id: D4
    description: "Changing a dynamic QR's target select remaps optimistically and reverts on failure"
    requirement: "QR-03"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#remaps a dynamic QR's target optimistically and toasts success"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#reverts the select and toasts failure when a remap fails"
        status: pass
    human_judgment: false
  - id: D5
    description: "Verlauf expander reveals the full remap history newest-first when more than one entry exists; a single entry shows only the inline line"
    requirement: "QR-04"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#shows the latest history line inline and reveals the full Verlauf on expand (newest first)"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#does not show a Verlauf expander for exactly one history entry"
        status: pass
    human_judgment: false
  - id: D6
    description: "?selected={qrId} preselects a card on load"
    requirement: "QR-07"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#preselects the card referenced by ?selected= on load"
        status: pass
    human_judgment: false
  - id: D7
    description: "api.ts QR client functions (create/list/get/update/remap/history + render URL builders + mapQrFormError) are the single fetch layer, correctly shaped requests/error mapping"
    requirement: "QR-02"
    verification:
      - kind: unit
        ref: "apps/web/src/api.qr.test.ts (all 13 tests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Full visual fidelity against 07-UI-SPEC.md (tokens, spacing, colors, typography) rendered correctly in the browser"
    human_judgment: true
    rationale: "Deferred to end-of-phase human verification per human_verify_mode=end-of-phase (07-06-PLAN.md's <verification> note); component tests assert structure/behavior, not pixel fidelity."

duration: 25min
completed: 2026-07-21
status: complete
---

# Phase 07 Plan 07: QR-Codes List Surface + Web API Client Summary

**Live `/qr-codes` screen (QrCodesView.vue) with four mutually-exclusive states, instant dynamic-QR creation, optimistic target remapping, and a full newest-first remap-history expander — backed by a centralized `api.ts` QR client that 07-08/07-09 will reuse.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-21
- **Tasks:** 3
- **Files modified:** 5 (2 new source files, 1 new component, 2 test files — one net-new beyond the plan's files_modified)

## Accomplishments
- `/qr-codes` now renders `QrCodesView` (router swap), replacing `ComingSoonView`
- `api.ts` gained the six QR client functions, two render URL builders, and `mapQrFormError` — established as the sole fetch layer for QR data across this and the two downstream frontend plans
- QrCodesView renders exactly one of loading/error/empty/data states, with cards showing name, code, DYNAMISCH/STATISCH badge, target select, and de-DE-formatted scan count
- "+ Dynamischer QR" creates immediately (no dialog), prepends + selects the new card, and toasts
- Target select remaps optimistically (mutate-then-confirm, revert-on-failure) with the locked success/failure toast copy
- Full remap history renders newest-first: an always-visible inline "Historie: ..." line plus a "Verlauf (n)" expander for QR codes with more than one remap

## Task Commits

Each task followed RED → GREEN (TDD gate, MVP_MODE+TDD_MODE):

1. **Task 1: QR web API client functions + router swap**
   - `dc0c4cc` test(07-07): failing QR web API client + mapQrFormError suite
   - `c325d8e` feat(07-07): QR web API client + route swap to QrCodesView
2. **Task 2: QrCodesView shell — header, four exclusive states, list cards**
   - `ba17b84` test(07-07): failing QrCodesView four-state + instant-create suite
   - `be68dec` feat(07-07): QrCodesView list surface with four states and instant dynamic create
3. **Task 3: Optimistic remap select + remap-history expander + scan count**
   - `b7c97f4` test(07-07): failing optimistic remap + remap-history expander suite
   - `55c265c` feat(07-07): optimistic QR remap + full remap-history expander

**Plan metadata:** (this commit) docs: complete 07-07 plan

## Files Created/Modified
- `apps/web/src/api.ts` - Added createQrCode/listQrCodes/getQrCode/updateQrCode/remapQrCode/getQrRemapHistory, qrRenderPngUrl/qrRenderSvgUrl, and mapQrFormError
- `apps/web/src/api.qr.test.ts` - New (Rule 2/TDD gate): unit tests for the QR client functions and mapQrFormError, stubbing global.fetch directly
- `apps/web/src/router/index.ts` - `/qr-codes` now resolves to `QrCodesView` instead of `ComingSoonView`
- `apps/web/src/views/QrCodesView.vue` - New: list surface with four states, instant create, optimistic remap, remap-history expander, header-only Studio placeholder
- `apps/web/src/views/QrCodesView.test.ts` - New: 13 component tests covering all must_haves.truths

## Decisions Made
- `api.qr.test.ts` added because Task 1 is genuinely behavior-adding (tdd="true", real fetch/error-mapping logic) but had no designated test file in the plan — no `api.test.ts` precedent existed in this codebase for thin API-client functions, so this establishes that pattern scoped to the new QR functions.
- Typecheck run via `pnpm --filter @kurzly/web run typecheck` (plain `tsc --noEmit`) instead of the plan's literal `vue-tsc --noEmit` — `vue-tsc` was dropped from this repo in Phase 1 (STATE.md decision, incompatible with `typescript@7.0.2`).
- `QrCodeDTO` has no embedded history array — full remap history is fetched via `getQrRemapHistory` per dynamic QR on load (reversed to newest-first) and extended locally with one synthetic entry after each successful remap, avoiding a redundant re-fetch.
- "+ Dynamischer QR" toasts "Bitte zuerst einen Link anlegen." and skips the API call when the caller has zero accessible Links — an edge case the locked copywriting contract doesn't cover but is necessary for correctness (no valid default target otherwise).
- Studio panel (right column, 360px) renders only the LOCKED header (title + selected QR's code) — the preview/controls/export UI is 07-08's scope, per the plan's explicit instruction to "leave a studio-panel slot/placeholder."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `apps/web/src/api.qr.test.ts` for Task 1's TDD gate**
- **Found during:** Task 1 (QR web API client + router swap)
- **Issue:** Task 1 is tagged `tdd="true"` with a real `<behavior>` block (fetch wrappers + `mapQrFormError`'s branching logic), but its `<files>` list contained only `api.ts`/`router/index.ts` — no test file, so the MVP+TDD gate (RED-before-GREEN) had no home for the required failing commit.
- **Fix:** Added `apps/web/src/api.qr.test.ts` (13 tests: one per QR client function's request shape/response parsing, `ApiError` mapping, render URL builders, and all `mapQrFormError` branches). Confirmed RED (all 13 failing against the pre-edit `api.ts`), committed, then confirmed GREEN after implementing.
- **Files modified:** `apps/web/src/api.qr.test.ts` (new)
- **Verification:** `pnpm --filter @kurzly/web test -- src/api.qr.test.ts` — 13/13 passing after the implementation commit
- **Committed in:** `dc0c4cc` (RED), `c325d8e` (GREEN)

**2. [Rule 3 - Blocking] Corrected Task 1's verify command**
- **Found during:** Task 1 verification
- **Issue:** Plan's `<verify>` specified `pnpm --filter @kurzly/web exec vue-tsc --noEmit` — `vue-tsc` is not installed in this repo (dropped in Phase 1 per STATE.md, incompatible with `typescript@7.0.2`); running it would fail with "command not found," blocking verification.
- **Fix:** Ran the project's actual typecheck script, `pnpm --filter @kurzly/web run typecheck` (`tsc --noEmit` against the `*.vue` module shim), matching every other frontend plan's established verification command in this codebase.
- **Files modified:** None (verification command only)
- **Verification:** `tsc --noEmit` — clean, no errors
- **Committed in:** N/A (verification step, no code change)

**3. [Rule 2 - Missing Critical] Guarded "+ Dynamischer QR" against zero accessible Links**
- **Found during:** Task 2 (QrCodesView shell)
- **Issue:** The locked copywriting contract assumes a default target link always exists ("Default-Ziel = erster zugänglicher Link") but doesn't specify behavior when the caller has zero Links — calling `createQrCode` with an empty `linkId` would either 400 confusingly or (worse) silently pass an invalid value.
- **Fix:** Added a guard: if `links.value[0]` is undefined, show a toast ("Bitte zuerst einen Link anlegen.") and skip the API call entirely.
- **Files modified:** `apps/web/src/views/QrCodesView.vue`
- **Verification:** Manual code inspection (no dedicated test — the happy path with an accessible Link is covered by the existing create-flow test; this is a defensive guard for an edge case with no locked copy to assert against)
- **Committed in:** `be68dec` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 blocking)
**Impact on plan:** All three are necessary for correctness (TDD gate compliance, working verification command, safe edge-case handling). No scope creep — no files touched beyond api.ts/router/index.ts/QrCodesView.vue/QrCodesView.test.ts plus the one new test file.

## Known Stubs

- **Studio panel body (preview/color swatches/logo toggle/rounding toggle/export buttons):** `apps/web/src/views/QrCodesView.vue`'s `.studio-panel` renders only the LOCKED header (title "QR-Studio" + selected QR's code) — no preview image, no controls, no export buttons. This is intentional per the plan's explicit instruction ("Leave a studio-panel slot/placeholder on the right column for 07-08 to fill") and is NOT a gap in this plan's own scope (QR-02/03/04/07) — 07-08 (QR Studio) is the plan responsible for filling it in.

## TDD Gate Compliance

All three tasks follow RED → GREEN with `test(07-07): ...` commits preceding their `feat(07-07): ...` counterparts:
- Task 1: `dc0c4cc` (test) → `c325d8e` (feat)
- Task 2: `ba17b84` (test) → `be68dec` (feat)
- Task 3: `b7c97f4` (test) → `55c265c` (feat)

Each RED commit was verified to fail before the corresponding GREEN commit was written (see task-by-task test output captured during execution).

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `api.ts`'s QR client functions, render URL builders, and `mapQrFormError` are ready for 07-08 (QR Studio panel) and 07-09 (Link-Detail QR entry point) to import directly — neither should ever call `fetch()` against `/api/qr-codes*` itself.
- The Studio panel's header-only placeholder (title + code) is exactly the seam 07-08 needs to extend with preview/controls/export — no restructuring required, just filling in `.studio-panel`'s body.
- `historyByQr`/`expandedHistory`/`linkSlugFor` in `QrCodesView.vue` are local to this component; if 07-09's Link-Detail deep-link (`?selected={qrId}`) needs the same history data, it will resolve through this same view (no new backend work needed — `getQrRemapHistory` already exists).
- No blockers identified for 07-08/07-09.

---
*Phase: 07-qr-codes-static-dynamic-qr-studio*
*Completed: 2026-07-21*
