---
phase: 04
slug: links-management-bulk-import
status: planned
nyquist_compliant: true
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
| 04-01-01 | 01 | 1 | LINK-01, LINK-08 | T-04-SC-Gate | csv-parse/nanoid installed only after human supply-chain sign-off | human-check | blocking-human checkpoint (npmjs.com verify) | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | LINK-01, LINK-08 | T-04-SC-Gate | both packages resolve under ESM; no unapproved build script | integration | `pnpm --filter @kurzly/api exec node -e "…" && tsc --noEmit` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | LINK-01 | — | Link model migrated to real Postgres; generated client exposes Link | migration | `pnpm --filter @kurzly/api exec prisma migrate status && grep -c slug generated/…/Link.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | LINK-01, LINK-02 | T-04-BYPASS, T-04-SCHEME, T-04-RESERVED, T-04-AUTHZ, T-04-RACE | single validated write path; reject non-http(s); reserved+per-domain-unique slug; non-member denied | integration | `pnpm --filter @kurzly/api test -- --run test/links.integration.test.ts` (+ single-insert-site grep=1) | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | LINK-01, LINK-02, LINK-03 | T-04-AUTHZ, T-04-MASS | POST create (auto/custom slug); GET scoped list/search/filter; body allowlist | integration | `pnpm --filter @kurzly/api test -- --run test/links.integration.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | LINK-05, LINK-07 | T-04-IDOR | detail/delete gated by findUnique→requireDomainAccess(link.domainId); 404-for-both | integration | `pnpm --filter @kurzly/api test -- --run test/links.integration.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 3 | LINK-06 | T-04-BYPASS, T-04-SCHEME, T-04-MASS | edit target/slug via validated core; same reserved/collision/scheme rules; no domain change | integration | `pnpm --filter @kurzly/api test -- --run test/links.integration.test.ts` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 4 | LINK-08 | T-04-BYPASS | runImport parses once, sequential loop, single insert site preserved | integration | comment-filtered `link.create(` grep=1 + `tsc --noEmit` | ❌ W0 | ⬜ pending |
| 04-04-02 | 04 | 4 | LINK-08 | T-04-BYPASS, T-04-AUTHZ, T-04-RESERVED, T-04-DOS | no-bypass proof (commit count==validCount, zero rows for skipped); 4 skip reasons; preview zero-write; row cap | integration | `pnpm --filter @kurzly/api test -- --run test/links-import.integration.test.ts` | ❌ W0 | ⬜ pending |
| 04-05-01 | 05 | 5 | LINK-03, LINK-04, UI-06 | T-04-UIAUTHZ, T-04-COPYLEAK | server-driven search/filter; full-URL copy + toast; create/delete toasts | component | `pnpm --filter @kurzly/web test -- --run src/views/LinksView.test.ts src/components/LinkFormModal.test.ts` | ❌ W0 | ⬜ pending |
| 04-05-02 | 05 | 5 | LINK-05, LINK-06 | T-04-UIAUTHZ | detail attributes + placeholder stats; edit via modal (D-04 warning); delete | component | `pnpm --filter @kurzly/web test -- --run src/views/LinkDetailView.test.ts` | ❌ W0 | ⬜ pending |
| 04-05-03 | 05 | 5 | LINK-08 | T-04-PREVIEWDRIFT | server-driven live preview (N valid/M skipped) with 4 skip reasons; two-phase commit | component | `pnpm --filter @kurzly/web test -- --run src/views/LinksImportView.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Rows populated by the planner from RESEARCH.md ## Validation Architecture. "❌ W0" = the test file is a Wave 0 gap created RED-first inside the owning plan's TDD tasks.*

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

**Approval:** approved 2026-07-11 (UI-03 token-fidelity accepted; WR-10 partial-import UX copy accepted)
