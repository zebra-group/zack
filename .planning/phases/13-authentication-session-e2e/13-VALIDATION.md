---
phase: 13
slug: authentication-session-e2e
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 13 — Validation Strategy

> Derived from 13-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (existing) |
| **Config file** | `apps/e2e/playwright.config.ts` (add a new standalone `auth` project — no `dependencies: ["setup"]`, since these specs prove login itself) |
| **Quick run command** | `pnpm --filter @kurzly/e2e exec playwright test tests/auth/` (stack + oidc-mock already up) |
| **Full suite command** | `./scripts/e2e-compose.sh` (must boot the new `oidc-mock` service too) |

---

## Sampling Rate

- **Per task commit:** targeted spec file against a running local stack.
- **Per wave merge:** full `tests/auth/` at `--workers=1` then again at higher parallelism.
- **Phase gate:** full E2E suite green (including `oidc-mock` boot) before phase completion.

---

## Per-Task Verification Map

| Plan | Wave | Requirement(s) | Secure Behavior | Test Type | Status |
|------|------|-----------------|-----------------|-----------|--------|
| 13-01 | 0 | (infra) | `apps/e2e/oidc-mock` (Dockerfile + server.mjs wrapping oidc-provider@9.10.0) boots and serves discovery/token/userinfo; docker-compose.e2e.yml wires OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET | e2e/infra | ⬜ pending |
| 13-02 | 0 | (infra) | `apps/e2e/src/oidc-mock.ts` client + `apps/e2e/src/users.ts` fixtures; standalone `auth` Playwright project, no `dependencies:["setup"]` | unit/infra | ⬜ pending |
| 13-03 | 1 | AUTH-E2E-01, AUTH-E2E-02 | Magic-link round trip reaches active session; consumed/expired/malformed token rejected, no session | e2e | ⬜ pending |
| 13-04 | 1 | AUTH-E2E-03 | Non-invited email — zero email, zero session | e2e | ⬜ pending |
| 13-05 | 1 | AUTH-E2E-06 | Logout + route guard | e2e | ⬜ pending |
| 13-06 | 1 | AUTH-E2E-07 | Rate-limited resend shows exact German UI copy, isolated real limiter | e2e | ⬜ pending |
| 13-07 | 1 | AUTH-E2E-04 | OIDC round trip, least-privilege even against admin-shaped claims | e2e | ⬜ pending |
| 13-08 (TDD RED→GREEN) | 2 | AUTH-E2E-05 | `account.accountLinking` fix in auth.ts; SSO-after-invite merges to one account | e2e + code fix | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/e2e/oidc-mock/Dockerfile` + `server.mjs` (oidc-provider@9.10.0 — legitimacy-gate SUS flag on version recency, approved: 562K weekly downloads, maintained by panva/jose/openid-client author, real GitHub history)
- [ ] `apps/e2e/src/oidc-mock.ts` — thin fetch client for the mock's test-control routes
- [ ] `apps/e2e/src/users.ts` — Prisma helper for invited-unverified User fixtures
- [ ] `docker-compose.e2e.yml` OIDC env wiring

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

**Approval:** approved 2026-07-25 (autonomous mode, per 13-RESEARCH.md Validation Architecture)
