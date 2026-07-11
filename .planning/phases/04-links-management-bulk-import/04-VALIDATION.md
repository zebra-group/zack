---
phase: 04
slug: links-management-bulk-import
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-11
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (api + web workspaces) |
| **Config file** | apps/api/vitest.config.ts · apps/web/vitest.config.ts |
| **Quick run command** | `pnpm --filter @kurzly/api test -- --run` |
| **Full suite command** | `pnpm -r test -- --run` |
| **Estimated runtime** | ~80 seconds (api uses testcontainers Postgres) |

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
| {N}-01-01 | 01 | 1 | LINK-01 | T-04-XX | {expected secure behavior} | unit | `{command}` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner populates concrete rows from the RESEARCH.md ## Validation Architecture section during planning.*

---

## Wave 0 Requirements

- [ ] Shared `validateLinkInput` unit tests against real Postgres: authz (member of A cannot create in B → denied), target-URL scheme validation (reject javascript:/data:/file:), per-domain slug uniqueness, reserved-slug rejection, custom-slug-taken error
- [ ] **The D-01 no-bypass invariant test:** CSV import commit routes through the exact same validated path as manual create — an import row with an invalid/reserved/unauthorized slug/domain is skipped identically to a manual-create rejection (no raw-row DB write)
- [ ] CSV preview skip-reason matrix tests (invalid URL / taken-or-reserved slug / unauthorized-or-unknown domain / in-file duplicate) — preview is a dry-run of the same validator
- [ ] Link-by-id IDOR guard tests (findUnique → requireDomainAccess(link.domainId); a user without access to the link's domain is denied on detail/edit/delete)
- [ ] Frontend component tests (@vue/test-utils): LinksView list/search/filter, create modal, edit modal (slug warning), delete confirm, ImportView live preview, toasts

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pixel-fidelity of Links screens (list/create/detail/edit/import) vs. prototype | UI-03 | Visual comparison not reliably automatable | Compare at 1440px Light + Dark against the design handoff |

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
