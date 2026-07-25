---
phase: 16-analytics-e2e
fixed_at: 2026-07-25T08:08:36Z
review_path: .planning/phases/16-analytics-e2e/16-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-07-25T08:08:36Z
**Source review:** .planning/phases/16-analytics-e2e/16-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 1 (Warning only — no Critical/Blocker findings this round; Info finding IN-01 explicitly excluded per `fix_scope: critical_warning`, no `--all` flag)
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-01: `analytics-global-rollup.spec.ts`'s per-link "Top Links" row assertions assumed the fixture links stay inside `getGlobalAnalytics`'s top-5 cap, with no floor beyond a "comparatively high" click-count heuristic

**Files modified:** `apps/e2e/tests/authed/analytics-global-rollup.spec.ts`
**Commit:** `06d03e6`
**Applied fix:** Re-read `getGlobalAnalytics`'s `topLinks` query (`apps/api/src/lib/analytics.ts:199-208`) directly — confirmed it is an **all-time, unfiltered** `ORDER BY clicks DESC LIMIT 5` across every Link ever created on the shared baseline domain (no `createdAt` window, unlike `clicks30Days`), so the prior 3-click/2-click fixture pair was only a heuristic, not a guaranteed floor, under full-suite concurrent noise. Applied both mitigations the review suggested, combined rather than either alone:

1. **Raised the margin (option a):** `nA`/`nB` went from `3`/`2` to `25`/`20`. Cross-checked against every other spec in this suite that generates real clicks against the shared baseline domain (`analytics-real-click.spec.ts`, `analytics-tracking-off.spec.ts`, Phase 12's redirect specs) — none generate more than 0-1 real clicks per fixture Link — so this leaves comfortable headroom against realistic concurrent-suite noise without needing a second Domain or any production-code change.
2. **Added a diagnostic fallback (option b):** wrapped the per-link row assertion in a local `assertTopLinksRow` helper that, on a failed/missing-row match, dumps the actually-rendered `.top-links-row` texts via `console.warn` before re-throwing — converting a bare locator timeout into an immediately diagnosable "here's what was actually in the top-5" message. The assertion itself remains **exact equality** (`toHaveText(String(count))`), so the fix closes the flakiness risk without weakening ANALYTICS-E2E-03's actual proof.

Option (c) (asserting via a non-capped API/DB shape instead of the UI list) was considered but not applied: `getGlobalAnalytics`'s `topLinks` DTO is itself capped to `TOP_N` (5) server-side — there is no uncapped per-link endpoint to assert against instead, so this option would have required a production-code change, which the review explicitly says is not implied ("No production code change is implied — `topLinks`' current all-time/no-window ranking is Phase 6's existing, already-shipped behavior").

Updated the file's header doc-comment to explain the new click counts and the WR-01 mitigation rationale, mirroring how this suite already documents the whole-test-retry tradeoff inline.

## Verification

- **Tier 1 (mandatory):** Re-read the full modified file after editing — the doc-comment, `nA`/`nB` values, the `assertTopLinksRow` helper, and both call sites are present and structurally intact; no surrounding code was disturbed.
- **Tier 2:** `pnpm --filter @kurzly/e2e exec tsc --noEmit` — clean, no type errors (only a pre-existing, unrelated `Unsupported engine` pnpm warning about the local Node version, present before this change too).
- **Live Playwright re-verification against the Docker compose stack was NOT performed** by this fixer pass (explicitly skipped due to time — noted per the task's instructions). The orchestrator will perform a final live re-verification pass regardless, per this milestone's established per-phase pattern.
- This is a test-file-only change (no `apps/api`/`apps/web` production code touched) and is additive/low-risk: the exact-equality assertions are unchanged in shape, only their inputs (`nA`/`nB`) and a wrapping diagnostic try/catch were added.

---

_Fixed: 2026-07-25T08:08:36Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
