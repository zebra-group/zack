---
phase: 15-qr-studio-e2e
plan: 02
subsystem: testing
tags: [playwright, qr, jsqr, sharp, e2e, studio]

# Dependency graph
requires:
  - "apps/e2e/src/qr.ts — createE2eQrCode/decodeQrImage (15-01)"
provides:
  - "apps/e2e/tests/authed/qr-static-customize-decode.spec.ts — QR-E2E-01, live-verified against the built compose image"
affects: [15-03-qr-dynamic-remap, 15-04-qr-export-formats]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-UI-driven QR create+customize (LinkDetailView.vue's QR-Code button, QrStudioPanel.vue's color/rounded/logo controls) proving QR-E2E-01 as a content round-trip through a real rasterized server render, mirroring Phase 14's 'fixture for setup, real UI for the feature under test' principle"

key-files:
  created:
    - apps/e2e/tests/authed/qr-static-customize-decode.spec.ts
  modified: []

key-decisions:
  - "No production code changes were needed — routes/qrCodes.ts, lib/qr.ts, LinkDetailView.vue, and QrStudioPanel.vue all behaved exactly as 15-RESEARCH.md documented; the spec is pure test-authoring."
  - "Decode assertion built from BASELINE_DOMAIN_HOSTNAME + per-test slug + created qrId (https://{hostname}/{slug}?qr={id}) — never link.targetUrl, per resolveQrPayload's static-QR branch and 15-RESEARCH.md Pitfall 1."
  - "Color swatch step clicks `.color-swatch:not(.selected)` first() rather than a specific swatch index — DEFAULT_QR_COLOR (#000000) is not among the four PRODUCT_COLORS, so no swatch starts selected and any first-match click is guaranteed to be a real change (never hits setColor's early-return)."
  - "Each of the three customization PATCHes (color, rounded, logo) is awaited via its own scoped page.waitForResponse before the next control is touched — required by persistStyle's mutationSeq guard (15-RESEARCH.md Pitfall 4)."

patterns-established:
  - "test.describe.configure({ retries: 2 }) + testInfo.retry console.warn + chromium-admin-only beforeEach skip, copied verbatim from links-crud.spec.ts's precedent, applied to a QR Studio journey."

requirements-completed: [QR-E2E-01]

coverage:
  - id: QR-E2E-01
    description: "A static QR created via the real LinkDetailView QR-Code button, customized (color/rounded/logo) via the real QrStudioPanel controls, has its server-rendered PNG decode to the exact constructed short URL"
    requirement: QR-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/qr-static-customize-decode.spec.ts — 'static QR: create via UI, customize color/rounded/logo, PNG decodes to its short URL', run live against the built compose image, --project=chromium-admin (also confirmed correctly skipped under chromium-member)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-25
status: complete
---

# Phase 15 Plan 02: QR-E2E-01 Static QR Create + Customize + Decode Round-Trip Summary

**A single Playwright spec drives the real LinkDetailView "QR-Code" button and QrStudioPanel color/rounded/logo controls, then decodes the authenticated server-rendered PNG via jsQR back to the exact constructed short URL — a real content round-trip, zero production code changes needed.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-25
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Read `LinkDetailView.vue`'s `handleQrCode` and `QrStudioPanel.vue` in full to confirm every real selector/behavior the plan's `read_first` list called out (`.action-button` "QR-Code" button, `.color-swatch`/`.color-swatch.selected`, `.rounded-toggle`, `input.hidden-file-input`, `persistStyle`'s `mutationSeq` guard) and `routes/qrCodes.ts`'s `resolveQrPayload`/render handlers, matching 15-RESEARCH.md's claims exactly — no drift found.
- Wrote `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts`: seeds a fixture Link via `createE2eLink` (setup only), drives the real "QR-Code" button to create a static QR (asserts the 201 + `/qr-codes?selected=` deep link), then drives the real color swatch, rounded toggle, and a tiny in-memory 64×64 `sharp`-generated logo PNG through the file input — each awaiting its own scoped `PATCH /api/qr-codes/:id` response before the next control, per the documented `mutationSeq` race.
- Fetched the authenticated server render via `page.request.get('/api/qr-codes/:id/render.png')` (asserts 200 + `image/png`), decoded the bytes via `decodeQrImage` (15-01's `sharp`+`jsQR` port), and asserted the decoded string equals `https://${BASELINE_DOMAIN_HOSTNAME}/${slug}?qr=${qrId}` — the QR's own short URL, never `link.targetUrl`.
- Scoped the spec to `chromium-admin` only (`test.beforeEach` skip on `testInfo.project.name`) with `test.describe.configure({ retries: 2 })` and a retry-visibility `console.warn`, mirroring `links-crud.spec.ts`'s established precedent for the documented `db-isolation.spec.ts` cross-file truncate race.
- `pnpm --filter @kurzly/e2e exec tsc --noEmit` confirmed clean before any live run.
- Booted the built compose image under an alternate project (`kurzly-e2e-p15-02`) with the same locally-remapped-port workaround documented in 11-06/12-01/12-02/14-01/15-01-SUMMARY.md (`13000`/`15433`/`18025` via an uncommitted `!override`-tagged compose overlay) for this dev machine's pre-existing port conflicts (3000/5433/8025).
- Confirmed GREEN live: the targeted spec passed on the first run (`--project=chromium-admin`), and again correctly skipped under `--project=chromium-member`.
- Ran the full `tests/authed/` directory as the per-wave-merge gate at default parallelism: 7 passed, 1 failed (`links-crud.spec.ts`, a pre-existing, documented cross-file `db-isolation.spec.ts` Link-table truncate race identical to the one 12-01/12-02/14-01/15-01-SUMMARY.md already logged — unrelated to this plan's spec, which passed clean in the same run), 4 skipped (chromium-member).
- Hit the also-previously-documented "accumulated Mailpit/DB state across back-to-back Playwright invocations" flake (13-SUMMARY.md/15-01-SUMMARY.md) on a 3rd/4th consecutive invocation against the same long-lived stack (`auth.setup.ts` itself timed out, unrelated to this plan's spec) — resolved identically, by tearing the stack down and rebooting fresh, then re-confirming green at both default parallelism and `--workers=1` (with `chromium-member` correctly skipped).
- Tore the alternate-project compose stack down fully (`down -v --remove-orphans`), removed its built images, deleted the uncommitted port-remap override file and the auto-generated `.env`. Confirmed via `git status`/`docker ps`/`docker images`/`docker volume ls`/`docker network ls` that the working tree and every other project's containers were left exactly as found.
- `git diff --stat` for the task commit shows changes only under `apps/e2e/tests/authed/` — zero `apps/api`/`apps/web` diffs, confirming no production code changes were needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: QR-E2E-01 — static QR create + customize + decode round-trip spec** - `995935b` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts` - QR-E2E-01: real-UI static QR create + color/rounded/logo customization + authenticated server-render decode round-trip, scoped to `chromium-admin`.

## Decisions Made

- No production code changes anticipated or needed — every file this plan's `read_first` list called out (`routes/qrCodes.ts`, `lib/qr.ts`, `LinkDetailView.vue`, `QrStudioPanel.vue`) behaved exactly as 15-RESEARCH.md documented from direct source reads; this plan is pure test-authoring.
- Decode assertion is built from fixture-known values (`BASELINE_DOMAIN_HOSTNAME`, the per-test slug, the created `qrId`) — never `link.targetUrl` — matching `resolveQrPayload`'s static-QR branch (`https://{hostname}/{slug}?qr={id}`) exactly (15-RESEARCH.md Pitfall 1).
- The color-swatch step clicks the first `.color-swatch:not(.selected)` rather than a hardcoded swatch index: `DEFAULT_QR_COLOR` (`#000000`) is not one of the four locked `PRODUCT_COLORS`, so no swatch starts `.selected` and any first-match click is guaranteed to be a genuine change (never trips `setColor`'s `local.color === color` early-return).
- Each of the three customization PATCHes is awaited via its own scoped `page.waitForResponse` before the next control is touched, never fired in immediate succession — required by `persistStyle`'s `mutationSeq` guard (15-RESEARCH.md Pitfall 4).
- The literal `qr` query-param key is hardcoded with a source comment pointing at `QR_SCAN_PARAM` (`apps/api/src/lib/redirectEngine.ts`) rather than imported, since `apps/e2e` cannot reach into `apps/api`'s internal modules (only `.`/`./prisma-client` are exported).

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the app behaved exactly as 15-RESEARCH.md's direct source reads documented.

## Issues Encountered

- This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in 11-06/12-01/12-02/14-01/15-01-SUMMARY.md (unrelated local projects). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p15-02`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`, plus a `BASE_URL` override on `app`), ran the targeted spec (GREEN, twice — default parallelism and `--workers=1` after a fresh reboot) and the full `tests/authed/` suite (per-wave-merge gate), then tore the stack down fully, removed its built images, and deleted the override file + generated `.env`. Confirmed via `git status`/`docker ps`/`docker images`/`docker volume ls`/`docker network ls` that the working tree and every other project's containers were left exactly as found.
- The full-suite per-wave-merge run surfaced 1 pre-existing, out-of-scope failure in `links-crud.spec.ts` (the documented cross-file `db-isolation.spec.ts` Link-table truncate race, identical to failures already logged in 12-01/12-02/14-01/15-01-SUMMARY.md) — not a regression from this plan; this plan's own spec passed clean in the same run. A subsequent 3rd/4th consecutive invocation against the same long-lived stack also hit the previously-documented "accumulated Mailpit/DB state across back-to-back Playwright invocations" flake in `auth.setup.ts` itself (13-SUMMARY.md/15-01-SUMMARY.md) — resolved by rebooting a fresh stack, after which the targeted spec (this plan's actual gate per 15-VALIDATION.md's Per-Task Verification Map) re-confirmed green at both default parallelism and `--workers=1`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

QR-E2E-01 is closed: a static QR created and customized (color/rounded/logo) through the real Studio UI decodes back to its exact constructed short URL via an authenticated server render — a real content round-trip, not just an image rendered. Plans 15-03 (QR-E2E-02, dynamic remap) and 15-04 (QR-E2E-03, PNG/SVG export) can proceed independently; neither depends on this plan's spec file, only on the same `apps/e2e/src/qr.ts` infrastructure from 15-01. No blockers.

---
*Phase: 15-qr-studio-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/qr-static-customize-decode.spec.ts
- FOUND: .planning/phases/15-qr-studio-e2e/15-02-SUMMARY.md
- FOUND: commit 995935b
