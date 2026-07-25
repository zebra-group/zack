---
phase: 11-playwright-e2e-infrastructure-fixtures
reviewed: 2026-07-24T21:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - .github/workflows/ci.yml
  - apps/api/package.json
  - apps/api/src/app.ts
  - apps/api/src/env.ts
  - apps/api/src/plugins/rateLimit.ts
  - apps/api/test/rate-limit-bypass.test.ts
  - apps/api/test/env.test.ts
  - apps/e2e/global-setup.ts
  - apps/e2e/global-teardown.ts
  - apps/e2e/package.json
  - apps/e2e/playwright.config.ts
  - apps/e2e/src/db.ts
  - apps/e2e/src/mailpit.ts
  - apps/e2e/tests/auth.setup.ts
  - apps/e2e/tests/authed/storage-state.spec.ts
  - apps/e2e/tests/smoke/boot.spec.ts
  - apps/e2e/tests/smoke/db-isolation.spec.ts
  - apps/e2e/tests/smoke/mailpit-wiring.spec.ts
  - apps/e2e/tests/smoke/prisma-import.spike.spec.ts
  - apps/e2e/tests/smoke/rate-limit-bypass.spec.ts
  - apps/e2e/tsconfig.json
  - scripts/e2e-compose.sh
  - docker-compose.e2e.yml
findings:
  critical: 0
  warning: 0
  info: 1
  total: 1
status: clean
---

# Phase 11: Code Review Report (Iteration 3 — final re-review, WR-01 fixed post-review)

**Post-review update (orchestrator, 2026-07-24):** WR-01 (duplicated `isE2EStack` marker-detection logic) was fixed directly after this review completed — extracted the exact `isE2EComposeOverlay()` helper this review's own "Fix" section suggested into `apps/api/src/env.ts`, and `apps/api/src/plugins/rateLimit.ts` now imports it instead of re-deriving the predicate (commit `341a8cd`). Re-verified: `pnpm --filter @kurzly/api exec tsc --noEmit` clean, `pnpm --filter @kurzly/api exec vitest run test/env.test.ts test/env-example-drift.test.ts test/rate-limit-bypass.test.ts` — 34/34 passed. Only IN-01 (carried-over, out-of-scope `tsconfig.json` broadness) remains, non-blocking. Frontmatter above updated to `status: clean` accordingly; the WR-01 section below is left in place as a record of what was found and fixed.

**Reviewed:** 2026-07-24
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Third and final pass. Iteration 2's own re-review found CR-05 (a genuine regression: CR-02's `nodeEnv` gate and WR-03's boot-time guard, both correct in isolation, together crash-looped the E2E stack and permanently disabled its own rate-limit bypass, because both assumed "E2E-shaped env" and "`NODE_ENV=production`" never coincide — they do, by this phase's own INFRA-01 design). `11-REVIEW-FIX.md` claims this was resolved by introducing `E2E_COMPOSE_OVERLAY`, a hardcoded marker literal in `docker-compose.e2e.yml`, that both `env.ts` and `rateLimit.ts` now key off instead of `NODE_ENV` alone.

This iteration re-traced that fix against the actual current source (not the fix report's narrative) and independently re-ran the verification suite rather than trusting the report's numbers:

- **CR-05 fix — genuinely correct.** Traced end-to-end: `docker-compose.e2e.yml:35` hardcodes `E2E_COMPOSE_OVERLAY: "true"` only in that file; a repo-wide grep confirms it appears nowhere in `docker-compose.yml`, `docker-compose.dev.yml`, or `.env.example` — structurally absent from every real-production config surface, exactly as claimed. `env.ts:230-247`'s boot guard and `rateLimit.ts:197-203`'s bypass gate both correctly key on `isE2EStack` (a non-empty, non-whitespace `E2E_COMPOSE_OVERLAY`) ANDed with the pre-existing `nodeEnv === "production"` check, so: (a) a real production deployment (no marker, ever) keeps both original protections fully intact — a leaked bypass secret alone still hard-fails boot, and the bypass allowList is still forced inert; (b) the E2E compose stack (marker present) now boots successfully with `NODE_ENV=production` retained (INFRA-01 fidelity preserved) AND the bypass mechanism functional (INFRA-06 restored). `test/env.test.ts` and `test/rate-limit-bypass.test.ts` both carry new regression tests asserting the exact merged `docker-compose.e2e.yml` env shape succeeds, and that the same shape *minus* the marker still fails/stays gated — closing the exact gap (fixes tested in isolation, not together) that let CR-05 slip through the first time.
- **Independently re-executed, not just inspected:** `pnpm --filter @kurzly/api exec tsc --noEmit` — clean. `pnpm --filter @kurzly/e2e exec tsc --noEmit` — clean. `pnpm --filter @kurzly/api exec vitest run` — **46 files / 572 tests passed**, matching the fix report's claimed count exactly. Nothing in this session's run contradicts the "572/572 passes, both packages typecheck clean" claim in the task brief.
- **IN-02 (`resetDb()` dead code) — confirmed removed.** `apps/e2e/src/db.ts` no longer exports a `resetDb()` wrapper; `withResetDbLock` is the sole reset entry point and its own header comment documents why the narrower wrapper was removed rather than left as unused public API.

One new, non-blocking finding surfaced during this pass (below): the `isE2EStack` marker-detection logic itself is now duplicated verbatim across two files with no shared source of truth — the exact structural pattern (two independently-maintained security-relevant checks that must stay in lockstep) that produced CR-05 in the first place. Flagged as a WARNING so it can't quietly drift apart in a future change, not because anything is currently wrong.

## Warnings

### WR-01: `isE2EStack` marker-detection logic is duplicated verbatim in two files with no shared helper

**File:** `apps/api/src/env.ts:230-231`, `apps/api/src/plugins/rateLimit.ts:197-199`

**Issue:** Both files independently compute the exact same predicate:

```ts
// env.ts
const isE2EStack =
  typeof source.E2E_COMPOSE_OVERLAY === "string" && source.E2E_COMPOSE_OVERLAY.trim() !== "";

// rateLimit.ts
const isE2EStack =
  typeof process.env.E2E_COMPOSE_OVERLAY === "string" &&
  process.env.E2E_COMPOSE_OVERLAY.trim() !== "";
```

This is precisely the pattern that produced CR-05: two security-relevant checks (WR-03's boot guard, CR-02's bypass gate) written independently, each individually correct in isolation, that silently interacted badly because neither test suite exercised them together. The fix for CR-05 re-established parity between the two checks, but did so by duplicating the new predicate rather than centralizing it — so a future change to either copy (e.g., someone "simplifying" one side's whitespace handling, or adding an additional required condition to only one of the two) can reintroduce the exact same class of drift-based regression, and neither file's own unit tests would catch it (each file's tests only exercise that file's own copy).

**Fix:** Extract a single exported helper (e.g., in `env.ts`, since it's already the canonical home for env-shape logic) and have `rateLimit.ts` import it, so there is exactly one place this predicate can be defined or changed:

```ts
// env.ts
export function isE2EComposeOverlay(source: NodeJS.ProcessEnv): boolean {
  return typeof source.E2E_COMPOSE_OVERLAY === "string" && source.E2E_COMPOSE_OVERLAY.trim() !== "";
}

// rateLimit.ts
import { isE2EComposeOverlay } from "../env.js";
const isE2EStack = isE2EComposeOverlay(process.env);
```

## Info

### IN-01 (carried over, unchanged across all three iterations): `apps/e2e/tsconfig.json`'s `include: ["."]` is unusually broad

**File:** `apps/e2e/tsconfig.json:6`

**Issue:** Still unchanged since iteration 1 (explicitly out of `fix_scope: critical_warning` both times). `"include": ["."]` includes the entire package root rather than a scoped glob, unlike the rest of the workspace's convention. Not a functional bug (TypeScript's default extension filtering already excludes non-`.ts` artifacts, and `tsc --noEmit` for `apps/e2e` is confirmed clean in this session), but looser than the rest of the workspace.

**Fix:** Scope explicitly, e.g. `"include": ["*.ts", "tests/**/*.ts", "src/**/*.ts"]`.

---

_Reviewed: 2026-07-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 (final re-review of 11-REVIEW-FIX.md's iteration-2 fixes)_
