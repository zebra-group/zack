---
phase: 17
slug: team-management-domain-scoped-authz-e2e
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 17 — Validation Strategy

> Derived from 17-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (existing) |
| **Config file** | `apps/e2e/playwright.config.ts` (existing `chromium-admin`/`chromium-member` authenticated projects, `tests/authed/`) |
| **Quick run command** | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/team-*.spec.ts tests/authed/authz-*.spec.ts --project=chromium-admin --project=chromium-member` |
| **Full suite command** | `./scripts/e2e-compose.sh` |

---

## Sampling Rate

- **Per task commit:** targeted spec file against a running local stack.
- **Per wave merge:** full `team-*.spec.ts`/`authz-*.spec.ts` set at `--workers=1` then again at higher parallelism — this phase mutates User/Session/DomainMembership rows more aggressively than prior phases (invite creates new Users, removal deletes them), a genuine new cross-file interference risk against the shared baseline admin/member fixtures.
- **Phase gate:** full E2E suite green — this is also the milestone's own closing regression check, since this is the final phase.

---

## Per-Task Verification Map

| Plan | Wave | Requirement(s) | Secure Behavior | Test Type | Status |
|------|------|-----------------|-----------------|-----------|--------|
| 17-01 (Wave 0, optional) | 0 | (infra) | `apps/e2e/src/team.ts` direct-Prisma team-mutation helpers for setup-only preconditions (not a substitute for the real-UI actions TEAM-E2E-01/02/03 themselves prove) | e2e/infra | ⬜ pending |
| 17-02 | 1 | TEAM-E2E-01 | Invite send → Mailpit → accept → Team-list status flips "Ausstehend" → "Aktiv" | e2e | ⬜ pending |
| 17-03 | 1 | TEAM-E2E-02 | Admin reassigns role/domain → member's own re-navigated session reflects only the newly scoped domains | e2e | ⬜ pending |
| 17-04 | 1 | TEAM-E2E-03 | Member removal → member's very NEXT request (old session cookie) is rejected immediately, not eventually | e2e | ⬜ pending |
| 17-05 | 1 | AUTHZ-E2E-01 | Zero-domain member denied: Link/QR return 404 (.not-found-card), Analytics silently scopes to empty rollup | e2e | ⬜ pending |
| 17-06 | 1 | AUTHZ-E2E-02 | Account-admin (zero DomainMembership rows) reaches a never-assigned domain's resource successfully | e2e | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/e2e/src/team.ts` (optional, planner's call) — direct-Prisma team-mutation helpers for setup-only preconditions
- [ ] `apps/e2e/tests/authed/team-invite-accept.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/team-member-removal.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/authz-domain-denial.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/authz-admin-bypass.spec.ts` — does not exist yet
- [ ] Per-test cryptographically-unique emails required for any new zero-domain member fixture (User rows are NOT truncated between spec files per `db.ts`'s own header comment) — avoid P2002 across repeated runs.

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

**Approval:** approved 2026-07-25 (autonomous mode, per 17-RESEARCH.md Validation Architecture)
