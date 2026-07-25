---
phase: 15-qr-studio-e2e
fixed_at: 2026-07-25T07:00:20Z
review_path: .planning/phases/15-qr-studio-e2e/15-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-07-25T07:00:20Z
**Source review:** .planning/phases/15-qr-studio-e2e/15-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (Warning only — no Critical/Blocker findings this round; Info findings IN-01/IN-02 excluded per `fix_scope: critical_warning`)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-02: QR-E2E-01's decode assertion was invariant to color/rounded/logo customization

**Files modified:** `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts`
**Commit:** `1092cac`
**Applied fix:** `resolveQrPayload`'s encoded short-URL string is independent of style fields (only `resolveRenderStyle` consumes `color`/`roundedModules`/`logoData`), so a silently-dropped customization PATCH would still pass the existing decode-only assertion. Added a direct-Prisma read-back after all three customization steps (color swatch, rounded toggle, logo upload), asserting `color`/`roundedModules`/`logoEnabled`/`logoData` were actually persisted — mirroring `qr-fixture.spec.ts`'s existing read-back pattern for the same model.

### WR-01: Whole-test retries gave no rationale for why the finer-grained retry helper wasn't used

**Files modified:** `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts`, `apps/e2e/tests/authed/qr-export-formats.spec.ts`, `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts`
**Commit:** `778f675`
**Applied fix:** All three new QR specs already carried `testInfo.retry`-keyed `console.warn` attribution logging (an improvement over Phase 14's original gap, apparently added proactively during execution) — the review's remaining, un-addressed concern was that none of the three explained WHY the coarser whole-test `retries: 2` was kept instead of Phase 12's finer-grained `fetchWithFixtureRaceRetry` helper. Added a per-spec code comment documenting this tradeoff (mirroring the rationale already recorded in `14-REVIEW-FIX.md` for Phase 14's own multi-step UI-journey specs): each spec is a multi-step real-UI journey (create→customize→decode; seed→redirect→remap→redirect→history-assert; export→download→decode ×2) rather than the single-HTTP-round-trip shape the helper was designed to wrap, and — specific to `qr-dynamic-remap.spec.ts` — an explicit note on why its two separate `/q/:code` GETs (pre- and post-remap) aren't split into independently-retryable units either, since the test's core assertion is that the SAME code resolves differently across the remap, which a per-request retry helper would not preserve.

## Verification

- `pnpm --filter @kurzly/e2e exec tsc --noEmit` — clean, no errors in any modified file, for both fixes (re-confirmed by the orchestrator after the fixer agent was interrupted mid-report by an API connection error).
- The fixer's own session log shows it invoked `scripts/e2e-compose.sh` for live re-verification and observed its teardown trap fire cleanly (no stray containers) before being cut off while drafting this report — the orchestrator independently confirmed via `docker ps -a` that no `kurzly*` containers remain and `git status --short` shows only pre-existing untracked planning docs (`15-CONTEXT.md`, `15-REVIEW.md`, `15-VALIDATION.md`), none of this fix's own files. Full pass/fail counts from that live run were not preserved in the crashed agent's final output — the orchestrator will perform an independent full live re-verification pass (per this milestone's established per-phase pattern) before marking Phase 15 verified.
- Both fixes are narrowly scoped and low-risk: WR-02 adds an additive Prisma read-back after existing PATCH calls (no changes to existing assertions or control flow); WR-01 adds only code comments (zero behavioral change).

---

_Fixed: 2026-07-25T07:00:20Z_
_Fixer: Claude (gsd-code-fixer, interrupted mid-report by an API error; report completed by the orchestrator from the fixer's committed work)_
_Iteration: 1_
