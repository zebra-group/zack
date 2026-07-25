---
phase: 12
slug: redirect-handler-e2e-core-value
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-24
---

# Phase 12 — Validation Strategy

> Derived from 12-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (existing, Phase 11) |
| **Config file** | `apps/e2e/playwright.config.ts` (existing — `smoke` project covers `tests/smoke/*.spec.ts`) |
| **Quick run command** | `pnpm --filter @kurzly/e2e exec playwright test --project=smoke tests/smoke/redirect-*.spec.ts` (stack already up) |
| **Full suite command** | `./scripts/e2e-compose.sh` |

---

## Sampling Rate

- **Per task commit:** the single new spec file against an already-booted stack.
- **Per wave merge:** `./scripts/e2e-compose.sh` (full suite, all of `apps/e2e/tests/`).
- **Phase gate:** full suite green before phase completion, matching CI's own `e2e` job gate.

---

## Per-Task Verification Map

| Task ID | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|-------------|-----------------|-----------|-------------------|--------|
| 12-W0-01 | 0 | (infra) | `host-header.spike.spec.ts` proves Playwright's APIRequestContext delivers a caller-supplied Host header unmodified | e2e/spike | `playwright test tests/smoke/host-header.spike.spec.ts` | ⬜ pending |
| 12-W0-02 | 0 | (infra) | `apps/e2e/src/links.ts` fixture helper creates Links via raw Prisma insert with correct bcrypt password hash + UTC end-of-day expiresAt | unit/infra | typecheck + used by all 5 feature specs | ⬜ pending |
| 12-01-01 | 1 | REDIRECT-E2E-01 | Slug→target happy path: exact 3xx status + Location header, maxRedirects:0 | e2e | `playwright test tests/smoke/redirect-slug-redirect.spec.ts` | ⬜ pending |
| 12-02-01 | 1 | REDIRECT-E2E-03 | Expired link → 410, distinct from 404, no leak | e2e | `playwright test tests/smoke/redirect-expiry.spec.ts` | ⬜ pending |
| 12-03-01 | 1 | REDIRECT-E2E-04 | Bot UA (real isbot-matched string) → custom OG never target, still gated; browser UA → real redirect | e2e | `playwright test tests/smoke/redirect-bot-og-render.spec.ts` | ⬜ pending |
| 12-04-01 | 1 | REDIRECT-E2E-05 | UTM + request-time query merge, exact canonical ordering | e2e | `playwright test tests/smoke/redirect-utm-merge.spec.ts` | ⬜ pending |
| 12-05-01 | 2 | REDIRECT-E2E-02 | Password gate: wrong rejected, correct frees, real browser cookie jar, no-leak grep of every pre-unlock response body | e2e (real page) | `playwright test tests/smoke/redirect-password-gate.spec.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/e2e/tests/smoke/host-header.spike.spec.ts` — must pass before any other spec in this phase depends on Host-header targeting
- [ ] `apps/e2e/src/links.ts` — raw-insert fixture helper (bcrypt hash, UTC end-of-day expiry), since `createLink`/`updateLink` are confirmed unreachable via `@kurzly/api`'s `exports` map

---

## Manual-Only Verifications

*None — all behaviors have automated verification per the map above.*

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-24 (autonomous mode, per 12-RESEARCH.md Validation Architecture)
