---
phase: 02
slug: magic-link-auth-app-shell-domain-authorization-core
status: draft
nyquist_compliant: false
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
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner populates concrete rows from the RESEARCH.md ## Validation Architecture section during planning.*

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
| Pixel-fidelity of App Shell vs. Hi-Fi prototype | UI-03 | Visual pixel comparison is not reliably automatable | Compare rendered shell against design_handoff prototype at 1440px, Light + Dark |

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
