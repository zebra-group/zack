---
phase: 11
slug: playwright-e2e-infrastructure-fixtures
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-24
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 11-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (new — this phase introduces it) |
| **Config file** | `apps/e2e/playwright.config.ts` (new) |
| **Quick run command** | `pnpm --filter @kurzly/e2e test -- --project=setup --project=chromium-admin tests/smoke/` |
| **Full suite command** | `./scripts/e2e-compose.sh` |
| **Estimated runtime** | ~90-150s (compose boot + browser install cache + smoke specs) |

---

## Sampling Rate

- **After every task commit:** Run the relevant single smoke spec (`pnpm --filter @kurzly/e2e test -- tests/smoke/<file>.spec.ts`) against a manually-booted `docker-compose.e2e.yml` stack left running locally.
- **After every plan wave:** `./scripts/e2e-compose.sh` (full boot + full suite + teardown) at least once at default worker count.
- **Before phase is considered complete:** `./scripts/e2e-compose.sh` green at BOTH `--workers=1` and CI's configured worker count (INFRA-03's explicit two-run requirement).
- **Max feedback latency:** ~150s (one full compose cycle).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 11-W0-01 | 01 | 0 | INFRA-01 | `apps/e2e` scaffold resolves as a pnpm workspace member | infra | `pnpm install && pnpm --filter @kurzly/e2e list` | ❌ W0 | ⬜ pending |
| 11-W0-02 | 01 | 0 | INFRA-01 | Prisma-client subpath export resolves under Playwright's runtime (spike) | infra/spike | `pnpm --filter @kurzly/e2e exec tsx -e "import('@kurzly/api/prisma-client')"` exits 0 | ❌ W0 | ⬜ pending |
| 11-01-01 | 01 | 1 | INFRA-01 | `scripts/e2e-compose.sh` boots the 3-file compose stack against the built image, never dev servers | infra/smoke | `./scripts/e2e-compose.sh` exit 0; smoke spec asserts baseURL is `:3000` and `GET /health` returns 200 with no dev-server headers | ❌ | ⬜ pending |
| 11-02-01 | 02 | 1 | INFRA-02 | Mailpit-read magic-link round trip, scoped by unique recipient, zero cross-worker theft | integration/smoke | `tests/smoke/mailpit-wiring.spec.ts` run at `--workers=4`; hard assert `To[0].Address === expectedRecipient` before extracting the link | ❌ | ⬜ pending |
| 11-03-01 | 02 | 1 | INFRA-03 | Truncate/reseed DB isolation holds under parallel workers, zero P2002 | integration | Full suite run twice: `--workers=1` then `--workers=N`; both exit 0, zero `P2002` in logs | ❌ | ⬜ pending |
| 11-04-01 | 03 | 2 | INFRA-04 | Fresh context from saved storageState reaches an authenticated route per role, no re-login | integration | `tests/smoke/storage-state.spec.ts` — one test per role, asserts final URL is not `/login` and a role-specific element renders | ❌ | ⬜ pending |
| 11-05-01 | 04 | 2 | INFRA-05 | CI `e2e` job runs after test/build, uploads report/trace on failure | infra | Deliberately break one throwaway assertion once during Wave rollout; confirm artifact appears in the failed run's Summary page | ❌ | ⬜ pending |
| 11-06-01 | 04 | 2 | INFRA-06 | Narrow bypass — unheadered request still gets a real 429, headered requests never do | integration | `tests/smoke/rate-limit-bypass.spec.ts` (`test.describe.serial`) — both the negative (429 without header) and positive (all succeed with header) proof in the same file | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/e2e/package.json`, `playwright.config.ts`, `tsconfig.json` — package scaffold
- [ ] `apps/api/package.json`'s `exports` field — does not exist today (only `"main"`), must be added from scratch
- [ ] `docker-compose.e2e.yml`, `scripts/e2e-compose.sh` — new files
- [ ] Prisma-client-subpath-resolves-under-Playwright spike (must run before any fixture code depends on it)
- [ ] `.gitignore` additions: `apps/e2e/playwright/.auth/`, `apps/e2e/playwright-report/`, `apps/e2e/test-results/`
- [ ] `.github/workflows/ci.yml`'s new `e2e` job

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification per the map above. This phase IS the test infrastructure; nothing in its own scope requires a human to eyeball.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-24 (autonomous mode, per 11-RESEARCH.md Validation Architecture)
