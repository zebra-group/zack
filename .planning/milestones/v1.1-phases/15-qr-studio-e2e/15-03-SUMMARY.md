---
phase: 15-qr-studio-e2e
plan: 03
subsystem: testing
tags: [playwright, qr, remap, e2e]

# Dependency graph
requires:
  - "apps/e2e/src/qr.ts — createE2eQrCode (15-01)"
provides:
  - "apps/e2e/tests/authed/qr-dynamic-remap.spec.ts — QR-E2E-02 proof: dynamic /q/:code remap A->B + ordered QrRemapHistory row"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct-Prisma fixture for the QR's INITIAL binding (createE2eQrCode), real-UI-only for the REMAP itself — mirrors 15-RESEARCH.md's Alternatives Considered (the real '+ Dynamischer QR' create always binds to links.value[0], non-deterministic for 'starts bound to target A')"

key-files:
  created:
    - apps/e2e/tests/authed/qr-dynamic-remap.spec.ts
  modified: []

key-decisions:
  - "Rule 1 bug fix (own test code, not app code): Playwright's `request` fixture's own default User-Agent ('Playwright/x.y.z') is bot-classified by `isbot` (apps/api/src/lib/botDetection.ts), routing a plain GET /q/:code to the bot-OG 200 branch instead of the human 302 branch — fixed by passing an explicit `headers: {'user-agent': BROWSER_UA}` on both redirect requests, reusing links.ts's already-established BROWSER_UA constant and mirroring the identical, previously-documented fix in redirect-*.spec.ts (12-02/12-03)."
  - "The full E2E suite showed 15 pre-existing failures (boot.spec.ts hardcoded-port assertion, redirect-password-gate.spec.ts host-header specs, auth.setup.ts timeouts, storage-state.spec.ts) attributable to this dev machine's documented port-remap workaround and the previously-logged 'accumulated Mailpit/DB state across back-to-back Playwright invocations' flake (STATE.md Phase 13 note) — confirmed NOT a regression from this plan by rebooting the compose stack fresh and re-running tests/authed/ at both default parallelism and --workers=1, where qr-dynamic-remap.spec.ts and every sibling spec passed cleanly both times."

patterns-established: []

requirements-completed: [QR-E2E-02]

coverage:
  - id: QR-E2E-02
    description: "a dynamic QR's printed /q/:code URL resolves to target A, then to target B after a real-UI remap, with exactly one ordered QrRemapHistory row recorded — the printed URL never changing"
    requirement: QR-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/qr-dynamic-remap.spec.ts — 'dynamic QR remap changes /q/:code resolution and records ordered history', run live against the built compose image, chromium-admin only"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-07-25
status: complete
---

# Phase 15 Plan 03: QR-E2E-02 Dynamic Remap + Ordered History Summary

**A dynamic QR's printed `/q/:code` URL resolves to target A, then — after a real-UI remap through `.target-select` — to target B, with exactly one ordered `QrRemapHistory` row recorded; proven live with zero apps/api/apps/web diffs.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-25
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Wrote `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts`: seeds `targetA`/`targetB` Links (no UTM, so `applyUtmParams` passes each `targetUrl` through unchanged) and a `dynamic` QrCode bound to `targetA` via `createE2eQrCode` (15-01's direct-Prisma fixture — creation itself is not this test's subject, only the remap is).
- BEFORE assertion: real `GET /q/:code` (maxRedirects:0) returns 302 with `Location === targetA.targetUrl`.
- REMAP driven through the REAL `QrCodesView.vue` UI: `page.goto('/qr-codes?selected={qrId}')`, confirmed the selected card's `.target-select` starts at `targetA.id`, then `selectOption(targetB.id)` while awaiting the real `PATCH /api/qr-codes/:id` (`handleRemapChange` -> `remapQrCode`'s `$transaction`).
- AFTER assertion: the SAME `/q/:code` now 302s to `targetB.targetUrl` — the printed code never changed, only its current destination did (QR-03's headline guarantee).
- HISTORY assertion: direct-Prisma `qrRemapHistory.findMany` (ordered `createdAt asc`) returns exactly one row `{fromLinkId: targetA.id, toLinkId: targetB.id}`.
- Scoped to `chromium-admin` only (`test.skip` under `chromium-member`, confirmed skipped live) with `test.describe.configure({ retries: 2 })` for the documented `db-isolation.spec.ts` cross-file `QrCode`/`QrRemapHistory`/`Link`-table truncate race.
- **Rule 1 bug fix (own test code):** the plain `request` fixture's default User-Agent is bot-classified by `isbot`, so the first run's BEFORE assertion got a 200 (bot-OG page) instead of a 302. Fixed by passing `headers: {"user-agent": BROWSER_UA}` on both `/q/:code` requests — `BROWSER_UA` is `apps/e2e/src/links.ts`'s already-established constant, and this is the identical, previously-documented fix `redirect-*.spec.ts` (Phase 12) already applies for the same reason. No `apps/api`/`apps/web` change was needed or made.
- Confirmed GREEN live against the built compose image under this dev machine's established port-remap workaround (alternate project `kurzly-e2e-p1503`, ports 13000/15433/18025/19000 — same pre-existing local conflicts on 3000/5433/8025/9000 documented in 11-06/12-01/12-02/14-01/15-01/15-02-SUMMARY.md). Used a `!override`-tagged port-remap overlay (Compose's default list-merge behavior for `ports` CONCATENATES rather than replaces, which otherwise left the original conflicting host ports also bound — `!override` forces replacement).
- Ran the targeted spec 3 ways, all green: `--project=chromium-admin` (3 passed), `--project=chromium-member` (correctly skipped), and twice more as the per-wave-merge gate below.
- Per-wave-merge gate (15-VALIDATION.md Sampling Rate): rebooted the compose stack fresh and ran the full `tests/authed/` directory at BOTH default parallelism (9 passed, 5 skipped — one pre-existing `links-crud.spec.ts` retry self-healed, unrelated to this plan) and `--workers=1` (9 passed, 5 skipped, zero retries) — `qr-dynamic-remap.spec.ts` passed cleanly in both runs.
- A separate, single full-suite invocation (`pnpm --filter @kurzly/e2e test`, all directories) surfaced 15 failures, but every one traces to either this dev machine's documented hardcoded-port artifacts (`boot.spec.ts`, `redirect-password-gate.spec.ts`'s host-header specs) or the previously-logged "accumulated Mailpit/DB state across back-to-back Playwright invocations on one long-lived compose stack" flake (STATE.md's Phase 13 note) — confirmed by the fresh-boot `tests/authed/`-only re-runs above, where this plan's spec and every sibling spec passed cleanly. Not a regression from this plan.
- Teardown confirmed clean: `down -v --remove-orphans`, removed the two dangling images this run built (`kurzly-e2e-p1503-app`, `kurzly-e2e-p1503-oidc-mock`), deleted the uncommitted port-remap override file and the auto-generated `.env`. `docker ps`/`git status --short` confirm the working tree and every other local project's containers were left exactly as found.
- `pnpm --filter @kurzly/e2e exec tsc --noEmit` clean, both before and after the UA fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: QR-E2E-02 spec (chromium-admin)** - `8e876b1` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts` - QR-E2E-02: dynamic QR remap A->B over real HTTP + real-UI `.target-select` remap + ordered direct-Prisma `QrRemapHistory` assertion.

## Decisions Made

- Rule 1 bug fix applied to this plan's own test file (never app code): an explicit `BROWSER_UA` header on both `/q/:code` requests, since Playwright's `request` fixture's default UA is bot-classified by `isbot` — identical, already-documented fix pattern from Phase 12's `redirect-*.spec.ts`.
- The pre-existing full-suite failures (port-hardcoding, Mailpit/DB accumulation flake) were investigated and confirmed environmental/out-of-scope, not a regression — re-verified via fresh-boot `tests/authed/`-only runs at two parallelism levels, both fully green for this plan's spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Playwright's default request UA is bot-classified, breaking the BEFORE/AFTER redirect assertions**
- **Found during:** Task 1, first live run against the built compose image.
- **Issue:** `request.get('/q/:code', {maxRedirects:0})` with no explicit User-Agent header returned 200 (the bot-OG page) instead of the expected 302, because Playwright's own default UA string (`Playwright/x.y.z`) matches `isbot`'s signature list (`apps/api/src/lib/botDetection.ts`), and `routes/qrRedirect.ts` routes any bot-classified request to the generic-OG 200 branch regardless of link state (D-06, no exceptions).
- **Fix:** Added `headers: {"user-agent": BROWSER_UA}` (imported from `apps/e2e/src/links.ts`, already an established constant) to both the BEFORE and AFTER `/q/:code` requests.
- **Files modified:** `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts`.
- **Commit:** `8e876b1`.

## Issues Encountered

- This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025`/`9000` documented in `11-06/12-01/12-02/14-01/15-01/15-02-SUMMARY.md` (unrelated local projects). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p1503`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`/`19000`), ran the targeted spec and the `tests/authed/`-only per-wave-merge gate (both parallelism levels, on freshly-rebooted stacks), then tore the stack down fully (containers/volumes/images) and deleted the override file + generated `.env`. Confirmed via `git status`/`docker ps` that the working tree and every other project's containers were left exactly as found.
- A single full-suite invocation (all directories, not just `tests/authed/`) surfaced 15 failures traceable to hardcoded-port assertions and the documented Mailpit/DB-accumulation flake from repeated back-to-back Playwright invocations against one long-lived stack — resolved by rebooting fresh and re-scoping to `tests/authed/` only (this phase's actual scope), which passed cleanly at both `--workers=1` and default parallelism. None of the 15 failures touch `qr-dynamic-remap.spec.ts` or any QR-related code path.
- Discovered (and worked around, via `!override`) that Docker Compose's default list-merge behavior for `ports` CONCATENATES entries from multiple `-f` files rather than replacing them — a plain port-remap overlay left the original, already-conflicting host ports also bound, causing the first stack-boot attempt to fail with "port is already allocated." The `!override` YAML merge tag forces replacement instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

QR-E2E-02 is proven green against the built compose image with zero `apps/api`/`apps/web` diffs. Plan 15-04 (QR-E2E-03, PNG/SVG export) can proceed independently — no shared state or blockers from this plan.

---
*Phase: 15-qr-studio-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/qr-dynamic-remap.spec.ts
- FOUND: .planning/phases/15-qr-studio-e2e/15-03-SUMMARY.md
- FOUND: commit 8e876b1
