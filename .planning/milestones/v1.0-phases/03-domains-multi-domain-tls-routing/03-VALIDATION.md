---
phase: 03
slug: domains-multi-domain-tls-routing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-11
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (api + web workspaces) |
| **Config file** | apps/api/vitest.config.ts · apps/web/vitest.config.ts |
| **Quick run command** | `pnpm --filter @kurzly/api test -- --run` |
| **Full suite command** | `pnpm -r test -- --run` |
| **Estimated runtime** | ~70 seconds (api uses testcontainers Postgres; DNS lookups stubbed) |

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
| 03-01-01 | 01 | 1 | DOMAIN-01 | T-03-06 | Extended Domain schema migrated to real Postgres; generated client exposes new fields | migrate/typecheck | `pnpm --filter @kurzly/api exec prisma migrate status` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | DOMAIN-01 | T-03-06 | New env vars validated + documented; fail-safe defaults; drift guard green | integration | `pnpm --filter @kurzly/api test -- test/env-example-drift.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | DOMAIN-01 | T-03-03a | Session-gated create bootstraps owner membership in one tx; list scoped; 401/409/400 | integration | `pnpm --filter @kurzly/api test -- test/domains.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | DOMAIN-02 | T-03-01 | DNS verify is injectable, timeout-bounded, never-throwing, DNS-only (no fetch) | unit | `pnpm --filter @kurzly/api test -- test/dnsClient.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | DOMAIN-02, DOMAIN-04 | T-03-03b, T-03-05 | verify/delete/instructions admin-gated (403 member); status transitions; CNAME/A records | integration | `pnpm --filter @kurzly/api test -- test/domains.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 3 | DOMAIN-03 | T-03-02 | resolveActiveDomainByHost exact-match, deny-by-default; spoof/partial/pending/failed → null | unit | `pnpm --filter @kurzly/api test -- test/domainResolution.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 3 | DOMAIN-03 | T-03-04 | ask endpoint 200 active / 404 else, empty body, no session, rejects spoofed host | integration | `pnpm --filter @kurzly/api test -- test/tlsCheck.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 3 | DOMAIN-03 | T-03-04 | reverse-proxy.md documents Caddy on_demand_tls.ask; TLS is operator's job (D-01) | doc-grep | `grep -c "tls-check" docs/deployment/reverse-proxy.md` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 3 | DOMAIN-01/02/04 | T-03-09 | Typed domain client fns compile against DomainDTO | typecheck | `pnpm --filter @kurzly/web exec tsc --noEmit` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 3 | DOMAIN-01/02/04 | T-03-10 | /domains renders DomainsView at 860px; D-01 TLS hint wording | typecheck/build | `pnpm --filter @kurzly/web build` | ❌ W0 | ⬜ pending |
| 03-04-03 | 04 | 3 | DOMAIN-01/02/04 | T-03-09 | list/add/verify/instructions/delete-confirm/empty proven with mocked api | component | `pnpm --filter @kurzly/web test -- test/DomainsView.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Domain CRUD + status-transition unit/integration tests against real Postgres (creation → pending → active/failed), incl. owner-bootstrap authorization (A1)
- [ ] DNS verification tests with `dns/promises` stubbed (CNAME match/mismatch, A-record match/mismatch, timeout) — deterministic, no real network
- [ ] `ask`/tls-check status endpoint tests (200 for active, 404/403 otherwise; no target/account leak)
- [ ] Host-header / X-Forwarded-Host spoofing rejection test (`resolveActiveDomainByHost` exact-match; spoofed/unregistered host rejected)
- [ ] Domains screen component tests (@vue/test-utils): list, add, verify action, DNS-instruction panel/copy, empty state

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real operator reverse-proxy on-demand-TLS integration (Caddy `on_demand_tls.ask`) | DOMAIN-03 | Requires a live operator proxy + public DNS + Let's Encrypt — out of automated-test scope | Follow docs/deployment/reverse-proxy.md; confirm a cert is issued only for a verified/active domain and refused for a pending one |
| Pixel-fidelity of Domains screens vs. prototype | UI-03 | Visual comparison not reliably automatable | Compare Domains list/add/DNS-instruction panel at 1440px Light + Dark against the design handoff |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-11 (UI-03 token-fidelity accepted; operator-proxy TLS integration deferred to deployment per D-01)
