---
phase: 16
slug: analytics-e2e
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 16 — Validation Strategy

> Derived from 16-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (existing) |
| **Config file** | `apps/e2e/playwright.config.ts` (existing `chromium-admin`/`chromium-member` authenticated projects, `tests/authed/`) |
| **Quick run command** | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/<spec>.spec.ts --project=chromium-admin` (stack already up) |
| **Full suite command** | `./scripts/e2e-compose.sh` |

---

## Sampling Rate

- **Per task commit:** targeted spec file against a running local stack, `--project=chromium-admin`.
- **Per wave merge:** full `tests/authed/` at the CI's configured parallelism (`ClickEvent` already covered by `withResetDbLock`'s truncate list — same documented cross-file race applies, no new isolation code needed).
- **Phase gate:** full E2E suite green before phase completion.

---

## Per-Task Verification Map

| Plan | Wave | Requirement(s) | Secure Behavior | Test Type | Status |
|------|------|-----------------|-----------------|-----------|--------|
| 16-01 | 1 | ANALYTICS-E2E-01 | Real HTTP click (BROWSER_UA, no gates) → ClickEvent row + lifetimeClicks increment (synchronous, no race) → fresh navigation to per-link view reflects the new count | e2e | ⬜ pending |
| 16-02 | 1 | ANALYTICS-E2E-02 | trackingEnabled off → real HTTP click still 302s → prisma.clickEvent.count is exactly 0, Link.lifetimeClicks unchanged (DB-asserted) | e2e | ⬜ pending |
| 16-03 | 1 | ANALYTICS-E2E-03 | 2+ real HTTP clicks across 2 Links → fresh navigation to global overview → rollup numbers correctly reflect the sum (server-side aggregated) | e2e | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

No Wave 0 needed — no new fixture helpers required (createE2eLink, BROWSER_UA, fetchWithFixtureRaceRetry, createE2ePrisma, BASELINE_DOMAIN_HOSTNAME already cover every need).

---

## Wave 0 Requirements

- [ ] `apps/e2e/tests/authed/analytics-real-click.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/analytics-tracking-off.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/analytics-global-rollup.spec.ts` — does not exist yet
- [ ] No new fixture helpers or production code changes anticipated (confirmed via full research reads)

---

## Manual-Only Verifications

*None — all behaviors have automated verification per the map above.*

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity maintained
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-25 (autonomous mode, per 16-RESEARCH.md Validation Architecture)
