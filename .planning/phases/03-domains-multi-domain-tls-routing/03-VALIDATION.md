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
| {N}-01-01 | 01 | 1 | DOMAIN-01 | T-03-XX | {expected secure behavior} | unit | `{command}` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner populates concrete rows from the RESEARCH.md ## Validation Architecture section during planning.*

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

**Approval:** pending
