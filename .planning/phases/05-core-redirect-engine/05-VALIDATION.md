---
phase: 5
slug: core-redirect-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` §Validation Architecture. The Per-Task Verification
> Map below is populated by the planner/executor as tasks are created; the test
> infrastructure and sampling contract are fixed here.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (`vitest run`) + `fastify.inject` (light-my-request) for route/integration; `@testcontainers/postgresql` for real-Postgres integration; Playwright reserved for critical E2E |
| **Config file** | `apps/api/vitest.config.ts` (existing); shared testcontainers globalSetup from Phase 1 |
| **Quick run command** | `pnpm --filter @kurzly/api test` |
| **Full suite command** | `pnpm -r test` |
| **Estimated runtime** | ~60–120 seconds (one shared testcontainers Postgres per vitest run; per-test BEGIN/ROLLBACK isolation) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @kurzly/api test` (scoped to the redirect-engine test files under change)
- **After every plan wave:** Run `pnpm -r test`
- **Before `/gsd-verify-work`:** Full suite must be green + `pnpm -r typecheck` clean
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _(planner-populated)_ | — | — | REDIR-01..05 / UI-04 / UI-05 | T-05-* | see per-requirement expectations below | unit / integration | `pnpm --filter @kurzly/api test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Per-requirement expected coverage (from RESEARCH §Validation Architecture)

| Requirement | Test level | What must be proven |
|-------------|-----------|---------------------|
| REDIR-01 | integration (`fastify.inject`) | Valid slug on active host → 302 to exact stored `targetUrl`. |
| REDIR-02 | integration | Host-based scoping: same slug on two domains resolves to each domain's own link; unknown/inactive host → deny (branded 404), never cross-domain leak. |
| REDIR-03 | integration | Expired link → HTTP 410 + branded expiration HTML; body/headers never contain the target URL (assert absence). |
| REDIR-04 | integration + **no-leak canary** | GET protected link → password page, distinctive canary target string absent from HTML/JSON/headers; correct POST → sets link-bound session cookie → 302; wrong POST → same page + inline error, still no leak; verify path is rate-limited. |
| REDIR-05 | integration | Bot UA on normal link → 200 OG HTML, no 302, no destination in a redirect; bot UA on protected/expired link → generic OG only, real target absent. |
| UI-04 | integration (HTML assertion) | Public password page renders per UI-SPEC tokens/copy; escapes the raw `:slug` echo (reflected-XSS guard). |
| UI-05 | integration (HTML assertion) | Public expiration page renders per UI-SPEC; 410 status; no redirect. |
| forwardQuery (D-12/13) | unit | Merge incoming query onto stored target; stored params win on key conflict; encoding correctness (WHATWG URL). |
| Precedence (D-14) | integration | Ordering expiration(410) → password → bot/OG → 302 holds for all state combinations; `Cache-Control: no-store` on every redirect/public response. |

---

## Wave 0 Requirements

- [ ] New test files for the redirect engine (resolution, precedence, 410, password-gate, bot/OG, forwardQuery merge, no-leak canary) — created test-first per TDD mandate.
- [ ] Reuse existing testcontainers globalSetup + transaction-rollback harness (Phase 1); no new framework install.
- [ ] Fixtures: helper to create a Link with password/expiry/forwardQuery variants through the real `createLink`/`updateLink` service (not raw DB inserts) to honor D-01's single authorized path.

*New npm deps (`bcryptjs`, `isbot`, `@fastify/cookie`) are installed in an early wave behind the supply-chain human-verify checkpoint before their tests can go green.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real social-preview rendering (e.g. paste a protected link into Slack/WhatsApp) | REDIR-05 | Third-party crawler behavior can't be fully asserted in unit tests | Optional post-merge smoke: paste a normal and a protected link into a social composer; confirm generic OG shows and no real target leaks. Automated `isbot` UA tests are the primary gate. |

*All security-critical behaviors (no-leak, precedence, 410, rate-limit) have automated verification; the above is a supplementary real-world smoke only.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, not `vitest`)
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
