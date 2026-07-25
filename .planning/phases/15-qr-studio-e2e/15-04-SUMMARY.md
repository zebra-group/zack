---
phase: 15-qr-studio-e2e
plan: 04
subsystem: testing
tags: [playwright, qr, export, jsqr, sharp, download, e2e]

# Dependency graph
requires:
  - "15-01 — apps/e2e/src/qr.ts (createE2eQrCode, decodeQrImage)"
provides:
  - "apps/e2e/tests/authed/qr-export-formats.spec.ts — QR-E2E-03, PNG/SVG export download+decode+content-type proof"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real browser download capture via page.waitForEvent('download') around a click on the actual export button, then readFileSync(await download.path()) for byte-level decode — never an API-only shortcut for the export mechanism itself"

key-files:
  created:
    - apps/e2e/tests/authed/qr-export-formats.spec.ts
  modified: []

key-decisions:
  - "The QR under test is seeded once via createE2eQrCode({variant:'static'}) bound to a fixture Link — export validity is independent of customization state (15-RESEARCH.md Open Question 2), so QR creation is not re-driven through the UI here (that's QR-E2E-01's job); the export buttons are this spec's genuine subject and are driven for real."
  - "Content-type assertions use authenticated page.request.get (shares the chromium-admin storageState cookie jar the 401-gated render endpoints require); the downloaded file bytes themselves (not the render endpoint bytes) are what get decoded, proving the actual `<a download>` mechanism produces a genuinely valid file, not just that the underlying render endpoint works."

patterns-established:
  - "Whole-test retries:2 + per-test crypto-random slug/QR (mirrors qr-static-customize-decode.spec.ts/qr-dynamic-remap.spec.ts) for the same documented db-isolation.spec.ts cross-file QrCode/Link truncate race."

requirements-completed: [QR-E2E-03]

coverage:
  - id: T-15-04-VALID
    description: "Both downloaded formats (PNG directly, SVG rasterized via sharp first) independently decode via jsQR back to the exact expected short URL — not merely 'a download happened'"
    requirement: QR-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/qr-export-formats.spec.ts — 'PNG and SVG exports are both valid, independently decodable downloads', run live against the built compose image"
        status: pass
    human_judgment: false
  - id: T-15-04-CT
    description: "render.png content-type is image/png, render.svg content-type is image/svg+xml"
    requirement: QR-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/qr-export-formats.spec.ts — same test, content-type assertions via authenticated page.request"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-07-25
status: complete
---

# Phase 15 Plan 04: QR-E2E-03 — PNG/SVG Export Download + Decode + Content-Type Summary

**Drives the REAL `.export-png`/`.export-svg` Studio buttons to capture genuine browser downloads, decodes both formats (SVG rasterized via sharp first) via the proven `sharp`+`jsQR` recipe back to the exact same expected short URL, and asserts both render endpoints' content-types — closing QR-E2E-03 and completing Phase 15.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-25
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Wrote `apps/e2e/tests/authed/qr-export-formats.spec.ts`: seeds a fixture Link + a `static` `QrCode` directly via `createE2eQrCode` (export validity is independent of customization state, per 15-RESEARCH.md Open Question 2 — creation itself is QR-E2E-01's subject, not this spec's), navigates to `/qr-codes?selected={id}` to mount the real `QrStudioPanel.vue`, then:
  - Clicks the REAL `.export-png` button, captures the REAL browser download via `page.waitForEvent('download')`, asserts the suggested filename ends `.png`, reads the downloaded bytes, and asserts `decodeQrImage` decodes them to the exact expected short URL (`https://{BASELINE_DOMAIN_HOSTNAME}/{slug}?qr={qrId}` — never `link.targetUrl`, per 15-RESEARCH.md Pitfall 1).
  - Repeats identically for `.export-svg`, rasterizing the downloaded SVG bytes via `sharp(bytes).png().toBuffer()` before decoding — exactly mirroring `apps/api/test/qrDecode.test.ts`'s own SVG-decode case — and asserts the SAME expected short URL decodes from the SVG-derived PNG.
  - Separately asserts `GET /api/qr-codes/:id/render.png` returns `content-type: image/png` and `GET /api/qr-codes/:id/render.svg` returns `content-type: image/svg+xml` via authenticated `page.request` (shares the `chromium-admin` `storageState` cookie jar), plus a cheap `<svg` structural sanity check on the SVG body text.
- No production code changes were needed or made — `QrStudioPanel.vue`'s `exportFile` and `routes/qrCodes.ts`'s `render.png`/`render.svg` handlers behaved exactly as 15-RESEARCH.md documented; `tsc --noEmit` clean.
- Live-verified against the built compose image under an alternate project (`kurzly-e2e-p15`) with the same locally-remapped-port workaround documented in 11-06/12-01/12-02/14-01/15-01-SUMMARY.md for this dev machine's pre-existing port conflicts on `3000`/`5433`/`8025`/`9000` (added `9000`→`19000` and mailpit `8025`/`1025` remaps this session, using Compose's `!override` merge tag on each `ports` list — a plain override list otherwise ADDS to, rather than replaces, the base files' original published ports, which first surfaced as a port-already-allocated boot failure and was fixed before any test ran).
- Targeted spec run: **3/3 passed** (2 `setup` auth round trips + this plan's 1 test).
- Full `tests/authed/` per-wave-merge gate (this plan is Phase 15's last, sole feature wave):
  - `--workers=1` (fresh stack): **8 passed**, 1 failed (`storage-state.spec.ts` chromium-member — a transient auth-setup timeout matching the ALREADY-DOCUMENTED "accumulated Mailpit/DB state across back-to-back Playwright invocations" flake from 13-*/15-01-SUMMARY.md, confirmed by reproducing it again in isolation and resolving it identically by rebooting the stack fresh), 1 flaky-then-passed (`links-crud.spec.ts` — its own already-documented cross-file db-isolation truncate race, retried once per its own `retries:2` config and passed).
  - Default parallelism (fresh stack): **9 passed**, 1 failed after exhausting its own 2 retries (`links-crud.spec.ts` — same pre-existing, already-documented race; unrelated to this plan). ALL THREE QR specs (`qr-static-customize-decode.spec.ts`, `qr-dynamic-remap.spec.ts`, `qr-export-formats.spec.ts`) and `storage-state.spec.ts` passed cleanly in this run.
  - No NEW db-isolation truncate race was introduced by this plan's spec — every failure traces to an already-documented, pre-existing race in an unrelated file's own header comment.
- Tore the alternate-project compose stack down fully (`down -v --remove-orphans`) after each reboot, deleted the uncommitted port-remap override file and the auto-generated `.env`. Confirmed via `git status`/`docker ps`/`docker volume ls`/`docker network ls` that the working tree and every other project's containers were left exactly as found.

## Task Commits

1. **Task 1: QR-E2E-03 spec** — `d3452ae` (test)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/authed/qr-export-formats.spec.ts` — QR-E2E-03: real export-button download capture, PNG/SVG decode round-trip to the same expected short URL, render content-type assertions.

## Decisions Made

- The static QR under test is seeded once via `createE2eQrCode` rather than driven through the real "QR-Code" create button — creation is QR-E2E-01's subject, export is this spec's, and export validity is independent of customization state (15-RESEARCH.md Open Question 2).
- Content-type assertions read the render endpoints directly via `page.request`, while the "valid file" proof reads the actual downloaded file bytes (via `download.path()` + `readFileSync`) — two independent proof points, neither substituting for the other.

## Deviations from Plan

None — plan executed exactly as written; zero `apps/api`/`apps/web` diffs, as anticipated by the plan's objective.

## Issues Encountered

- Same pre-existing local Docker port conflicts documented in every prior Phase 11-15 summary (`3000`/`5433`/`8025`, plus `9000` for the mock OIDC IdP this phase's stack also boots) — resolved identically via an alternate project name (`kurzly-e2e-p15`) and an uncommitted port-remap compose override, deleted after use.
- New this session: a plain `ports:` override list under Compose v5 ADDS to (rather than replaces) the base files' original published ports, so the first boot attempt failed with "port is already allocated" on the ORIGINAL `8025`. Fixed by tagging each remapped `ports:` key with Compose's `!override` merge directive, which replaces the list instead of concatenating it.
- The Phase 13-documented "accumulated Mailpit/DB state across back-to-back Playwright invocations" flake (storage-state.spec.ts) reproduced once during this session's verification sequence and was resolved identically to its prior documented resolution — rebooting the compose stack fresh before the next invocation. Not a regression from this plan.
- `links-crud.spec.ts`'s own already-documented cross-file db-isolation truncate race (see that file's header comment) fired during both full-suite runs; unrelated to this plan's QR spec and pre-existing since at least Phase 14.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 15 (QR Studio E2E) is now complete: QR-E2E-01 (15-02), QR-E2E-02 (15-03), and QR-E2E-03 (15-04) are all proven live against the built compose image, sharing the common `apps/e2e/src/qr.ts` fixture/decode infrastructure from 15-01. No blockers carried forward.

---
*Phase: 15-qr-studio-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/qr-export-formats.spec.ts
- FOUND: .planning/phases/15-qr-studio-e2e/15-04-SUMMARY.md
- FOUND: commit d3452ae
