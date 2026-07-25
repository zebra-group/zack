---
phase: 14
slug: links-csv-import-e2e
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 14 — Validation Strategy

> Derived from 14-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (existing) |
| **Config file** | `apps/e2e/playwright.config.ts` (existing `chromium-admin`/`chromium-member` authenticated projects, `testMatch: /authed\/.*\.spec\.ts$/` — specs MUST live under `apps/e2e/tests/authed/`) |
| **Quick run command** | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/<spec>.spec.ts --project=chromium-admin` (stack already up) |
| **Full suite command** | `./scripts/e2e-compose.sh` |

---

## Sampling Rate

- **Per task commit:** targeted spec file against a running local stack, `--project=chromium-admin`.
- **Per wave merge:** full `tests/authed/` at `--workers=1` then again at higher parallelism.
- **Phase gate:** full E2E suite green before phase completion.

---

## Per-Task Verification Map

| Plan | Wave | Requirement(s) | Secure Behavior | Test Type | Status |
|------|------|-----------------|-----------------|-----------|--------|
| 14-01 (Wave 0) | 0 | (infra) | CSV fixture file(s)/inline fixture strategy for happy-path + slug-conflict import | e2e/infra | ⬜ pending |
| 14-02 | 1 | LINKS-E2E-01 | Canonical link journey: create (real form) → list → edit (real form) → search/filter → delete (real UI) | e2e | ⬜ pending |
| 14-03 | 1 | LINKS-E2E-02 | Valid CSV → preview shows correct row count/diff → commit writes exactly the previewed rows (DB-asserted) | e2e | ⬜ pending |
| 14-04 | 1 | LINKS-E2E-03 | CSV with slug conflict → preview surfaces `slug_conflict` → commit skips that row (no overwrite path exists) | e2e | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/e2e/tests/authed/links-crud.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/csv-import-happy.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/csv-import-conflict.spec.ts` — does not exist yet
- [ ] CSV fixture(s) for happy-path and slug-conflict scenarios (static file vs. inline generation with a matching runtime-created Link fixture — planner's call per 14-RESEARCH.md's note)

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

**Approval:** approved 2026-07-25 (autonomous mode, per 14-RESEARCH.md Validation Architecture)
