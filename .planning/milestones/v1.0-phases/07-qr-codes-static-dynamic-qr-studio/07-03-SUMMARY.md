---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 03
subsystem: api
tags: [qrcode, sharp, jsqr, tdd, qr-rendering, svg, png, image-compositing]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (07-02)
    provides: qrcode/sharp/jsqr dependencies installed, QrCode/QrRemapHistory Prisma models, sharp SVG/raw pixel pipeline smoke-tested
provides:
  - "apps/api/src/lib/qr.ts: the single shared QR rendering core (buildModuleSvg, renderQrSvg, renderQrPng, resolveErrorCorrectionLevel, normalizeLogo, InvalidLogoError)"
  - "A decode-verified module-matrix renderer usable by every downstream QR surface (thumbnail, Studio preview, PNG export, SVG export)"
  - "Centered logo compositing (PNG via sharp.composite, SVG via injected <image> data-URI) at a fixed, decode-safe tile fraction"
  - "Server-forced errorCorrectionLevel: 'H' whenever a logo is present (resolveErrorCorrectionLevel)"
affects: [07-qr-codes-routes, 07-qr-studio-ui, 07-qr-static-dynamic-model]

tech-stack:
  added: []
  patterns:
    - "Module-matrix-first QR rendering: QRCode.create()'s raw BitMatrix -> one hand-written buildModuleSvg -> renderQrPng rasterizes that EXACT SVG via sharp (never a second, independently-computed renderer)"
    - "Logo normalization at ingest, not at render time: normalizeLogo magic-byte-sniffs (never trusts declaredMime) and rasterizes any SVG logo to PNG once, so later renders never re-parse untrusted SVG markup"
    - "Server-owned security-relevant fields: resolveErrorCorrectionLevel is never client-settable, mirrors lib/links.ts's passwordHash/lifetimeClicks discipline"

key-files:
  created:
    - apps/api/src/lib/qr.ts
    - apps/api/test/qrDecode.test.ts
    - apps/api/test/fixtures/qr-logo.png
    - apps/api/test/fixtures/qr-logo.svg
  modified: []

key-decisions:
  - "Added an explicit white background rect + ISO/IEC 18004 4-module quiet zone to buildModuleSvg — the plan's <behavior> spec didn't call this out, but omitting it left 'light' modules fully transparent (jsQR ignores alpha, reading them as near-black), which only barely survived the no-logo case and broke decode entirely once a logo was composited"
  - "Logo tile fixed at a 46/196 linear fraction (~5.5% area) of the FULL rendered dimension (module area + quiet zone), computed once via qrDimensionPx and reused identically by both the PNG composite and SVG <image> injection paths"
  - "normalizeLogo throws InvalidLogoError (typed) for anything that isn't a PNG-signature or SVG/XML-root buffer — never trusts a caller-declared declaredMime"

requirements-completed: [QR-01, QR-05, QR-06]

coverage:
  - id: D1
    description: "A generated PNG export decodes back (via jsQR) to the exact encoded target URL, with and without a centered logo"
    requirement: "QR-01"
    verification:
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#QR decode round-trip, no logo (QR-01) > decodes a PNG export back to the exact target URL"
        status: pass
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#QR decode round-trip, WITH centered logo [BLOCKING] (QR-05) > renders a PNG export whose centered PNG logo still round-trips to the exact target URL [BLOCKING]"
        status: pass
    human_judgment: false
  - id: D2
    description: "A generated SVG export, rasterized through sharp, decodes back to the exact encoded target URL, with and without a centered logo"
    requirement: "QR-01"
    verification:
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#QR decode round-trip, no logo (QR-01) > decodes an SVG export, rasterized via sharp, back to the exact target URL"
        status: pass
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#QR decode round-trip, WITH centered logo [BLOCKING] (QR-05) > renders an SVG export whose centered SVG-sourced logo, rasterized via sharp, still round-trips to the exact target URL [BLOCKING]"
        status: pass
    human_judgment: false
  - id: D3
    description: "When a logo is present, error-correction level is forced to H server-side regardless of any requested level"
    requirement: "QR-05"
    verification:
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#resolveErrorCorrectionLevel (QR-05, server-forced EC level) > forces 'H' whenever a logo is present"
        status: pass
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#resolveErrorCorrectionLevel (QR-05, server-forced EC level) > defaults to 'M' when no logo is present"
        status: pass
    human_judgment: false
  - id: D4
    description: "PNG and SVG outputs are the SAME styled module geometry (one shared module-matrix renderer), never two diverging renderers"
    verification:
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#single-geometry guarantee (PNG rasterizes the exact SVG geometry, never a second renderer) > renderQrSvg's no-logo output is byte-identical to buildModuleSvg's output for the same inputs"
        status: pass
      - kind: other
        ref: "grep -c toString apps/api/src/lib/qr.ts — confirms no QRCode.toString/toFile/toBuffer/toDataURL call (the qrcode package's built-in combined-path SVG renderer is never used)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Foreground color and rounded-module toggle visibly change the rendered module rects (fill color; rx/ry present when rounded)"
    requirement: "QR-06"
    verification:
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#buildModuleSvg geometry (QR-06, color + rounded-module toggle) > includes the chosen fill color on module rects"
        status: pass
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#buildModuleSvg geometry (QR-06, color + rounded-module toggle) > sets a positive rx/ry corner radius on module rects when rounded is true"
        status: pass
      - kind: unit
        ref: "apps/api/test/qrDecode.test.ts#buildModuleSvg geometry (QR-06, color + rounded-module toggle) > has no positive corner radius on module rects when rounded is false"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-07-20
status: complete
---

# Phase 7 Plan 03: Shared QR Rendering Core (buildModuleSvg/renderQrSvg/renderQrPng) Summary

**A single hand-written module-matrix renderer (`buildModuleSvg`) drives both PNG and SVG QR export, decode-verified via jsQR with a centered logo present at forced error-correction level H.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-20T15:12Z (approx, first RED commit)
- **Completed:** 2026-07-20T15:33Z (last GREEN commit)
- **Tasks:** 3 (RED, GREEN part 1, GREEN part 2)
- **Files modified:** 4 created (0 modified)

## Accomplishments
- `lib/qr.ts`'s `buildModuleSvg` walks `QRCode.create()`'s raw BitMatrix (`.get(row, col)`, confirmed directly against the installed `qrcode` package's source) and emits one `<rect>` per dark module — never `qrcode`'s built-in combined-path SVG renderer, which has no per-module node to round
- `renderQrPng` rasterizes the EXACT SVG string `renderQrSvg` returns via sharp — PNG and SVG geometry structurally cannot diverge, proven by a byte-identical-string test
- `resolveErrorCorrectionLevel` forces `'H'` whenever a logo is present, never a client-settable field
- `normalizeLogo` validates uploaded logo bytes by magic-byte sniffing (PNG signature or SVG/XML root) — never a caller-declared MIME type — and rasterizes any SVG logo to PNG immediately so no later render step re-parses untrusted SVG markup
- Centered logo compositing implemented identically for both formats (PNG via `sharp.composite()`, SVG via an injected `<image>` data-URI) at a fixed, decode-safe tile fraction
- Full `qrDecode.test.ts` suite green (11/11), including both BLOCKING logo decode-round-trip tests (PNG and SVG-via-sharp)

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): Decode-round-trip + geometry test suite** - `210c7f5` (test)
   - Fixup: `f2f69ab` (test) — renamed the two BLOCKING logo test titles so they don't collide with Task 2's partial `-t` verify filter
2. **Task 2 (GREEN): Module-matrix renderer + SVG/PNG output + forced EC-H** - `d213bc6` (feat)
3. **Task 3 (GREEN): Centered logo compositing + logo normalization** - `052d5c5` (feat) — also contains the two Rule 1/Rule 2 auto-fixes below (same file, same commit, discovered while making the BLOCKING tests pass)

_TDD gate sequence confirmed in `git log`: `test(07-03)` commits precede all `feat(07-03)` commits — RED before GREEN._

## Files Created/Modified
- `apps/api/src/lib/qr.ts` - the shared QR rendering core: `buildModuleSvg`, `renderQrSvg`, `renderQrPng`, `resolveErrorCorrectionLevel`, `normalizeLogo`, `InvalidLogoError`, plus internal `ModuleStyle`/`RenderStyle`/`LogoInput`/`NormalizedLogo` types
- `apps/api/test/qrDecode.test.ts` - 11-test decode-round-trip + geometry suite (no-logo PNG/SVG, BLOCKING logo PNG/SVG, EC-level, color/rounding geometry, single-geometry guarantee, normalizeLogo rejection)
- `apps/api/test/fixtures/qr-logo.png` - 64x64 solid PNG logo fixture (generated via sharp during Task 1)
- `apps/api/test/fixtures/qr-logo.svg` - small valid SVG logo fixture (rect + circle)

## Decisions Made
- Logo tile fixed at `46/196` linear fraction of the FULL rendered dimension (module area + quiet zone) — computed once via an internal `qrDimensionPx` helper reused identically by both the PNG `sharp.composite()` path and the SVG `<image>` injection path, so the two formats can never size/position the logo differently
- `normalizeLogo` throws a typed `InvalidLogoError` (not a generic `Error`) so callers (a future `routes/qrCodes.ts` upload handler) can distinguish validation failures from unexpected renderer errors
- Background/"light module" fill color is hardcoded `#ffffff`, not user-configurable — only the dark-module `color` is styled per QR-06's scope (color picker + rounded toggle, not a background-color picker)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `buildModuleSvg` rendered "light" modules as fully transparent, giving near-zero contrast**
- **Found during:** Task 3, while debugging why both BLOCKING logo decode-round-trip tests failed (jsQR returned `null` even at a small 5-10% linear logo coverage)
- **Issue:** The original `buildModuleSvg` (Task 2) never painted a background — "light" modules were left as unpainted SVG canvas, which sharp rasterizes as fully-transparent `RGB(0,0,0)` pixels. `jsQR`'s binarizer computes greyscale purely from `0.2126*r + 0.7152*g + 0.0722*b`, ignoring the alpha channel entirely — so those transparent pixels read as pure black, nearly indistinguishable from the test's dark foreground color (`#17170f`, itself `RGB(23,23,15)`). This gave only ~9% effective luminance contrast, which was just barely enough for jsQR's adaptive per-region binarizer to decode a clean no-logo render but broke completely once any additional visual noise (the composited logo) was introduced
- **Fix:** Added an explicit white (`#ffffff`) background `<rect>` covering the full symbol dimension, painted before the module rects
- **Files modified:** `apps/api/src/lib/qr.ts` (`buildModuleSvg`)
- **Verification:** Empirically confirmed root cause (dumped raw RGBA pixel values, traced jsQR's `binarize()` source) before fixing; re-tested logo-fraction sweep (0.05 through 0.30 linear) post-fix, all decoded successfully; full `qrDecode.test.ts` suite green (11/11)
- **Committed in:** `052d5c5` (Task 3 commit)

**2. [Rule 2 - Missing critical functionality] No ISO/IEC 18004 quiet zone around the QR symbol**
- **Found during:** Task 3, same debugging session as #1
- **Issue:** `buildModuleSvg` rendered the QR symbol with zero light-colored margin around it. The synthetic jsQR-based decode test tolerated this (jsQR is a permissive, non-camera-optics decoder), but a real-world phone-camera QR scanner reliably needs an adequate quiet zone (>= 4 modules) around the finder patterns to lock onto the code at all — omitting it would ship a QR-generation feature that passes automated tests but may fail real-world printed-code scanning, undermining the phase's actual goal ("print scannable codes")
- **Fix:** Added a 4-module quiet zone on all sides (matches `qrcode`'s own default `margin` option), extending the SVG's overall pixel dimension and offsetting all module rects/background accordingly; the logo-tile fraction math (`qrDimensionPx`) was updated to include the margin in its dimension calculation so logo positioning stays centered on the FULL rendered symbol, not just the code area
- **Files modified:** `apps/api/src/lib/qr.ts` (`buildModuleSvg`, `qrDimensionPx`)
- **Verification:** `qrDecode.test.ts` suite still green (11/11) with the added margin; logo positioning re-verified via the same decode-round-trip tests
- **Committed in:** `052d5c5` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical functionality)
**Impact on plan:** Both fixes were necessary for the plan's own BLOCKING success criterion (decode-round-trip with a logo present) to actually pass, and for the rendered QR codes to be genuinely scannable in the real world, not just by the permissive test decoder. No scope creep — both fixes are contained entirely within `buildModuleSvg`/`qrDimensionPx`, the exact function the plan assigned to this task.

## Issues Encountered
None beyond the two deviations documented above (which were root-caused and fixed within the planned task boundary).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `apps/api/src/lib/qr.ts` is ready to be consumed by the next-wave `lib/qrCodes.ts` (single-write-path QR persistence) and `routes/qrCodes.ts` (create/style-update/render endpoints) — `renderQrPng`/`renderQrSvg` are the only rendering entry points those layers should ever call
- `normalizeLogo`'s `InvalidLogoError` is ready to be caught by a future upload-validation route handler and mapped to a 4xx response
- No blockers for downstream QR Studio/routing waves

## Self-Check: PASSED
- FOUND: apps/api/src/lib/qr.ts
- FOUND: apps/api/test/qrDecode.test.ts
- FOUND: apps/api/test/fixtures/qr-logo.png
- FOUND: apps/api/test/fixtures/qr-logo.svg
- FOUND: .planning/phases/07-qr-codes-static-dynamic-qr-studio/07-03-SUMMARY.md
- Commit 210c7f5: FOUND
- Commit f2f69ab: FOUND
- Commit d213bc6: FOUND
- Commit 052d5c5: FOUND
