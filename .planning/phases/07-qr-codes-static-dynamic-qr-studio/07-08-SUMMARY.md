---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 08
subsystem: ui
tags: [vue3, qr-codes, live-preview, debounce, file-upload, api-client]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (07-05/07-07)
    provides: QR render.png/render.svg server endpoints, updateQrCode PATCH route, QrCodesView.vue's header-only Studio placeholder, api.ts QR client
provides:
  - "QrStudioPanel.vue — self-contained 360px Studio column: live server-rendered preview, color/rounded/logo controls, validated logo dropzone, real PNG/SVG export downloads"
  - "api.ts's fetchQrRenderBlob — the sole fetch() call for QR render bytes-as-Blob (export downloads)"
  - "packages/shared's UpdateQrCodeInput.logoEnabled field (previously missing despite the backend already accepting it)"
affects: [07-09-link-detail-qr-entry-point]

tech-stack:
  added: []
  patterns:
    - "Debounced server re-render via a preloaded throwaway Image() — swap the visible <img>'s src only once the preload's onload fires, so the previous frame stays visible (opacity .6) instead of flashing blank"
    - "Cache-busting via a `?v=<counter>` query param on server render URLs — a same-string <img src> reassignment never forces a re-fetch, even with Cache-Control: no-store"
    - "Session-local upload-state tracking (hasCustomLogo) for a DTO field (logoEnabled) that cannot by itself distinguish 'toggle on, no upload' from 'toggle on, real upload from a past session' — T-07-DTO-LEAK deliberately never exposes logoData/existence to the client"

key-files:
  created:
    - apps/web/src/components/QrStudioPanel.vue
    - apps/web/src/components/QrStudioPanel.test.ts
  modified:
    - apps/web/src/views/QrCodesView.vue
    - apps/web/src/api.ts
    - packages/shared/src/index.ts

key-decisions:
  - "07-08: BRAND_NAME (backend-only ENV var, never exposed to the frontend) is not plumbed to the client for the logo placeholder's initial — hardcoded 'K', mirroring the SPA's existing convention of hardcoding the literal 'Kurzly' brand text everywhere (AppShell.vue/LoginView.vue/AuthErrorView.vue) rather than adding a new public config endpoint"
  - "07-08: The decorative logo-placeholder overlay (accent tile + brand initial) is drawn client-side ONLY while logoEnabled is on AND no logo has been uploaded this session — QrCodeDTO.logoEnabled cannot distinguish 'toggle on, no upload' from 'toggle on, real logo from a prior session' (logoData never crosses the JSON boundary, T-07-DTO-LEAK), so a real uploaded logo relies entirely on the server-composited <img> bytes, never a duplicate client-drawn tile on top"
  - "07-08: packages/shared's UpdateQrCodeInput gained a logoEnabled field (Rule 3) — the backend's updateQrCodeSchema (routes/qrCodes.ts) already accepted and documented it, the shared type was simply incomplete; rebuilt via `pnpm --filter @kurzly/shared build` per CLAUDE.md"
  - "07-08: api.ts gained fetchQrRenderBlob (Rule 3) — a real file download needs actual bytes (a plain <img src> cannot trigger save-as), so this is the one exception where a QR render URL is fetch()'d directly, but it stays inside api.ts (the sole fetch layer), never called from QrStudioPanel.vue itself"
  - "07-08: Tasks 1 and 2 (preview/controls, then logo-upload/export) were implemented as one cohesive feat commit rather than two — the component is small and naturally indivisible; the RED test commit already covered both tasks' behavior together upfront (mirrors 07-06's precedent of one RED commit spanning multiple GREEN commits), satisfying the MVP+TDD gate's RED-before-GREEN requirement without a second, artificially-split implementation commit"
  - "07-08: Debounce tests wait out the real 300ms timer (setTimeout + flushPromises) rather than vi.useFakeTimers(), matching LinksView.test.ts's WR-08 documented rationale — fake timers fight @vue/test-utils' internal real setTimeout(0) usage"

requirements-completed: [QR-01, QR-05, QR-06]

coverage:
  - id: D1
    description: "Studio panel shows a live server-rendered preview on a white card, refreshing 300ms-debounced after every control change; previous image stays visible at opacity .6 while loading (no skeleton)"
    requirement: "QR-06"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#renders a preview <img> pointing at the server render.png endpoint"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#clicking a color swatch persists via updateQrCode and refreshes the preview after the debounce"
        status: pass
    human_judgment: false
  - id: D2
    description: "Color swatches (4 locked product colors) and rounded-module toggle persist via updateQrCode and trigger a debounced re-render"
    requirement: "QR-06"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#clicking a color swatch persists via updateQrCode and refreshes the preview after the debounce"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#toggling 'Runde Module' persists roundedModules via updateQrCode"
        status: pass
    human_judgment: false
  - id: D3
    description: "Logo toggle persists via updateQrCode, reverts + toasts on failure, and shows the BRAND-initial placeholder overlay when on with no upload"
    requirement: "QR-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#toggling 'Logo in der Mitte' persists logoEnabled via updateQrCode"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#reverts the toggle and does not crash when updateQrCode fails"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#shows the BRAND_NAME-initial placeholder overlay once the logo toggle is on with no upload"
        status: pass
    human_judgment: false
  - id: D4
    description: "Logo dropzone rejects non-PNG/SVG and >2MB files inline; valid uploads send base64 via updateQrCode, auto-enable the toggle, and show a filename chip with a remove link"
    requirement: "QR-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#rejects an oversized logo file inline and never calls updateQrCode"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#rejects a non-PNG/SVG logo file inline and never calls updateQrCode"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#uploads a valid PNG logo as base64, auto-enables the toggle, and shows the filename chip"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#'Logo entfernen' clears the stored logo via updateQrCode(null)"
        status: pass
    human_judgment: false
  - id: D5
    description: "PNG/SVG export buttons fetch the real render bytes and trigger a browser file download; a failed export toasts the locked failure copy"
    requirement: "QR-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#clicking 'PNG ⬇' fetches the PNG blob and triggers a browser download"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#clicking 'SVG ⬇' fetches the SVG blob and triggers a browser download"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#toasts 'Export fehlgeschlagen. Bitte erneut versuchen.' when the export fetch fails"
        status: pass
    human_judgment: false
  - id: D6
    description: "QrCodesView mounts QrStudioPanel in the Studio slot; a style change syncs the qrCodes list and busts the matching list thumbnail's cache"
    requirement: "QR-06"
    verification:
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts (existing suite, unaffected by the studio-panel swap)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Full visual fidelity against 07-UI-SPEC.md (tokens, spacing, colors, typography) rendered correctly in the browser"
    human_judgment: true
    rationale: "Deferred to end-of-phase human verification per human_verify_mode=end-of-phase; component tests assert structure/behavior, not pixel fidelity."

duration: 20min
completed: 2026-07-21
status: complete
---

# Phase 07 Plan 08: QR Studio Preview, Style Controls, Logo Upload, Export Summary

**QrStudioPanel.vue fills the QR Studio's right column — a live server-rendered PNG preview that debounce-refreshes 300ms after any color/rounding/logo change, a validated PNG/SVG logo dropzone, and real file downloads — completing QR-01/05/06.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-21
- **Tasks:** 3 (Tasks 1+2 combined into one implementation commit, see Decisions; Task 3's test-authoring folded into the upfront RED commit)
- **Files modified:** 5 (2 new, 3 modified)

## Accomplishments
- `QrStudioPanel.vue` renders a live `<img>` preview from the server `render.png` endpoint, debounce-refreshing 300ms after any persisted style change, preloading the next frame so the previous one stays visible at opacity .6 (no skeleton/blank flash)
- Four locked product-color swatches + rounded-module toggle + logo toggle all persist via `updateQrCode`, reverting and toasting on failure
- Validated logo dropzone (PNG/SVG, max 2MB, inline errors matching the locked copy) sends base64 via `updateQrCode`, auto-enabling the toggle and showing a filename chip + "Logo entfernen"
- Real "PNG ⬇"/"SVG ⬇" downloads via a new `fetchQrRenderBlob` in `api.ts`, with a locked-copy toast on failure
- `QrCodesView.vue` now mounts `QrStudioPanel` in place of the 07-07 header-only placeholder, syncing style changes back into the list and cache-busting the matching card's thumbnail

## Task Commits

Each task followed RED → GREEN (TDD gate, MVP_MODE+TDD_MODE):

1. **Tasks 1+2 combined: Studio preview/controls + logo upload/export**
   - `0147942` test(07-08): QR Studio panel control/upload/export tests
   - `0a6c188` feat(07-08): QR Studio panel — preview, style controls, logo upload, export
2. **Task 3: QrStudioPanel component tests** — folded into the RED commit above (see Deviations)

**Plan metadata:** (this commit) docs: complete 07-08 plan

## Files Created/Modified
- `apps/web/src/components/QrStudioPanel.vue` - New: self-contained 360px Studio panel (preview, controls, dropzone, export)
- `apps/web/src/components/QrStudioPanel.test.ts` - New: 13 component tests covering all must_haves.truths
- `apps/web/src/views/QrCodesView.vue` - Mounts `QrStudioPanel`, adds `handleStyled`/`thumbnailSrc` for list sync + cache-busting
- `apps/web/src/api.ts` - Added `fetchQrRenderBlob` (Rule 3, sole fetch-layer discipline for export downloads)
- `packages/shared/src/index.ts` - `UpdateQrCodeInput` gained `logoEnabled?: boolean` (Rule 3, backend already accepted it)

## Decisions Made
- BRAND_NAME initial hardcoded as "K" — the frontend has no runtime access to the backend-only `BRAND_NAME` ENV var, and the rest of the SPA already hardcodes "Kurzly" literally rather than reading it dynamically; matched that existing convention instead of adding a new public config endpoint.
- The logo-placeholder overlay is session-local: `QrCodeDTO.logoEnabled` can't distinguish "toggle on, no upload" from "toggle on, real upload from an earlier session" (logo bytes never cross the JSON boundary). The placeholder tile is drawn only when the toggle is on AND no logo was uploaded in the CURRENT session — a real uploaded logo is trusted entirely to the server-composited preview image, never duplicated as a client-drawn tile on top.
- `packages/shared`'s `UpdateQrCodeInput` was missing `logoEnabled` despite the backend's Zod schema and its own header comment already documenting it as accepted — added and rebuilt (`pnpm --filter @kurzly/shared build`).
- `api.ts` gained `fetchQrRenderBlob` so the export buttons' `fetch()` call stays inside the sole QR fetch layer (the notes explicitly forbid fetch calls outside `api.ts`) rather than calling `fetch()` directly inside `QrStudioPanel.vue`.
- Tasks 1 and 2 landed as a single feat commit — the component is naturally cohesive/small, and the RED test commit already exercised both tasks' behavior together up front (same pattern 07-06 used: one RED commit ahead of multiple GREEN commits).
- Debounce tests use real timers (`setTimeout` + `flushPromises`), not `vi.useFakeTimers()`, per `LinksView.test.ts`'s documented WR-08 rationale (fake timers conflict with `@vue/test-utils`' own internal real-timer usage).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `logoEnabled` to `packages/shared`'s `UpdateQrCodeInput`**
- **Found during:** Task 1 (wiring the logo toggle's persist call)
- **Issue:** `updateQrCode(id, { logoEnabled })` would not type-check — the backend's Zod schema (`routes/qrCodes.ts`) already accepts and documents `logoEnabled` in its PATCH allowlist, but the shared TypeScript type omitted the field entirely.
- **Fix:** Added `logoEnabled?: boolean` to `UpdateQrCodeInput` with a doc comment explaining the gap; rebuilt via `pnpm --filter @kurzly/shared build`.
- **Files modified:** `packages/shared/src/index.ts`
- **Verification:** `pnpm -r exec tsc --noEmit` clean across the whole workspace
- **Committed in:** `0147942` (RED commit, alongside the test file)

**2. [Rule 3 - Blocking] Added `fetchQrRenderBlob` to `api.ts`**
- **Found during:** Task 2 (export button implementation)
- **Issue:** The export buttons need actual file bytes as a `Blob` to trigger a real browser download — a plain `<img src>`/`qrRenderPngUrl` string cannot do this — but the plan's `files_modified` only lists `QrStudioPanel.vue`/`QrCodesView.vue`/the test file, and the notes explicitly forbid `fetch()` calls outside `api.ts`.
- **Fix:** Added `fetchQrRenderBlob(id, format)` to `api.ts` (the sole fetch-layer exception for render bytes-as-Blob); `QrStudioPanel.vue` calls this instead of `fetch()` directly.
- **Files modified:** `apps/web/src/api.ts`
- **Verification:** `apps/web/src/components/QrStudioPanel.test.ts`'s export tests (mocking `fetchQrRenderBlob`) pass
- **Committed in:** `0147942` (RED commit)/`0a6c188` (GREEN commit)

**3. [Rule 3 - Blocking] Combined Tasks 1 and 2 into a single implementation commit**
- **Found during:** Task 1 execution
- **Issue:** The plan sequences Task 3 ("write QrStudioPanel.test.ts") AFTER Tasks 1 and 2's implementations, but the MVP+TDD gate requires a RED test commit BEFORE each behavior-adding task's GREEN commit. Writing the test file only after both implementations would violate RED-before-GREEN for both tasks.
- **Fix:** Authored the full `QrStudioPanel.test.ts` (covering both tasks' behaviors) as one upfront RED commit, then implemented the entire component (both tasks' scope, since it's one small cohesive file) as one GREEN commit — mirroring 07-06's precedent of a single RED commit preceding multiple GREEN commits.
- **Files modified:** None beyond the plan's own file list
- **Verification:** `git log` shows `test(07-08)` before `feat(07-08)`
- **Committed in:** `0147942` (RED), `0a6c188` (GREEN)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking)
**Impact on plan:** All three were necessary for correctness (type-check passing, fetch-layer discipline, and TDD gate compliance). No scope creep — no files touched beyond what the deviations required, and no backend files were modified.

## Known Stubs

None. The Studio panel is fully wired: preview, controls, upload, and export all call through to the real server endpoints (07-05); no hardcoded/placeholder data renders in the UI.

## Threat Flags

None — all three of this plan's `<threat_model>` entries (T-07-LOGO-MIME, T-07-DOS-RENDER, T-07-EXPORT-XSS) are mitigated exactly as prescribed: client-side logo validation is UX-only (server re-validates via magic-byte sniffing), the 300ms debounce is in place (server-side `QR_RENDER_RATE_LIMIT` already existed from 07-05), and export bytes come straight from the server's own renderer (no client-side SVG markup echoing).

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- QR Studio is now fully functional end-to-end: create → style → upload logo → export, all server-rendered.
- `apps/web/src/api.ts`'s `fetchQrRenderBlob` is available for 07-09 (Link-Detail QR entry point) if it ever needs a real download rather than just an `<img>`/navigation link.
- Full visual fidelity against 07-UI-SPEC.md is still deferred to end-of-phase human verification (`human_verify_mode=end-of-phase`) — no blocker, just not yet exercised in a real browser.
- No blockers identified for 07-09.

---
*Phase: 07-qr-codes-static-dynamic-qr-studio*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created files confirmed present on disk; all task/RED/GREEN commit hashes confirmed present in `git log`.
