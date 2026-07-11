---
phase: 02
slug: magic-link-auth-app-shell-domain-authorization-core
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-11
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (api + web workspaces) |
| **Config file** | apps/api/vitest.config.ts · apps/web/vitest.config.ts |
| **Quick run command** | `pnpm --filter @kurzly/api test -- --run` |
| **Full suite command** | `pnpm -r test -- --run` |
| **Estimated runtime** | ~60 seconds (api uses testcontainers Postgres) |

---

## Sampling Rate

- **After every task commit:** Run `{quick run command}`
- **After every plan wave:** Run `{full suite command}`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-02 | 01 | 1 | AUTH-01 | T-02-SC-Gate | Packages vetted post-human-signoff; INITIAL_ADMIN_EMAIL required + documented | unit | `pnpm --filter @kurzly/api test -- --run env.test.ts env-example-drift.test.ts` | ✅ (extends) | ⬜ pending |
| 02-02-01 | 02 | 2 | AUTH-01..04 | T-02-01 / T-02-02 | Single Prisma client; allowlist gate inside sendMagicLink; magicLink-only | typecheck | `pnpm --filter @kurzly/api exec tsc --noEmit` | n/a (compile) | ⬜ pending |
| 02-02-03 | 02 | 2 | AUTH-01..04 | T-02-09 | Auth + domain schema applied to live Postgres; models queryable | integration | `pnpm --filter @kurzly/api test -- --run schema-push.test.ts` | ❌ W0 | ⬜ pending |
| 02-03 | 03 | 3 | TEAM-06 | T-02-03 / T-02-10 | Deny-by-default domain authorization (rank hierarchy, unknown user/domain denied) | unit (real PG) | `pnpm --filter @kurzly/api test -- --run authorization.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-03 | 04 | 3 | AUTH-01..04 | T-02-04 / T-02-05 / T-02-06 / T-02-07 / T-02-08 | Neutral response canary (D-01); seeded-admin login despite disableSignUp; session survives refresh; logout clears; helmet headers; rate-limit | integration | `pnpm --filter @kurzly/api test -- --run auth.integration.test.ts server.integration.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 3 | UI-02, UI-03 | T-02-12 | Theme toggle flips data-theme + persists; LOCKED tokens applied | component | `pnpm --filter @kurzly/web test -- --run theme.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-03 | 05 | 3 | AUTH-01 (D-05) | T-02-11 / T-02-12 | Login Idle→Sent neutral copy (no enumeration); generic magic-link error page | component | `pnpm --filter @kurzly/web test -- --run LoginView.test.ts` | ❌ W0 | ⬜ pending |
| 02-06-03 | 06 | 4 | UI-01, AUTH-03, AUTH-04 | T-02-14 / T-02-15 | 212px shell + nav render; theme toggle; logout calls signOut() (from every page) | component | `pnpm --filter @kurzly/web test -- --run AppShell.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*UI-03 pixel-fidelity is verified manually (see Manual-Only Verifications) — component tests assert structure/behavior, not pixel comparison.*

---

## Wave 0 Requirements

- [ ] Authorization-core unit tests (`requireDomainAccess` / `scopedDomainIds`) against real Postgres via the Phase-1 testcontainers harness
- [ ] Magic-link auth round-trip integration test via `fastify.inject` + Mailpit (neutral-response assertion for D-01)
- [ ] Vue App-Shell / theme-toggle component tests (@vue/test-utils)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pixel-fidelity of App Shell (212px sidebar + Dashboard + Coming-soon) vs. Hi-Fi prototype | UI-03 | Visual pixel comparison is not reliably automatable | Compare rendered shell (plan 02-06) against design_handoff prototype (Kurzly Prototyp.dc.html) at 1440px, Light + Dark; record drift in the 02-06 Task Summary |
| Pixel-fidelity of Login (Idle/Sent) + magic-link error page vs. prototype | UI-03 | Visual pixel comparison is not reliably automatable | Compare rendered auth views (plan 02-05) against the prototype at 1440px, Light + Dark; record drift in the 02-05 Task Summary |

**Sign-off:** Design/owner visual review of the UI-03 pixel-fidelity gates above is **required before the `/gsd-verify-work` gate** — the phase is not verifiable-complete until the manual Light + Dark comparison for both the App Shell (02-06) and the auth views (02-05) is signed off and any drift is either fixed or explicitly accepted.

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-11 (UI-03 token-fidelity audit; operator-accepted)
