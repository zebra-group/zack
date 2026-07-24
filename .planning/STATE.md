---
gsd_state_version: '1.0'
milestone: v1.1
milestone_name: E2E Test Coverage
status: planning
last_updated: "2026-07-24T13:00:00.000Z"
last_activity: 2026-07-24
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 11 — Playwright E2E Infrastructure & Fixtures

## Current Position

Phase: 11 of 17 (Playwright E2E Infrastructure & Fixtures) — first phase of milestone v1.1
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-07-24 — Roadmap created for v1.1 (7 phases, 32 requirements, 100% mapped)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed (v1.0): 65
- Average duration: ~8 min
- v1.1 plans completed: 0

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 11 | TBD | Not started |
| 12 | TBD | Not started |
| 13 | TBD | Not started |
| 14 | TBD | Not started |
| 15 | TBD | Not started |
| 16 | TBD | Not started |
| 17 | TBD | Not started |

**Recent Trend:**
- v1.0 shipped 2026-07-23 (10 phases, 65 plans); v1.1 not yet started
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Full decision log lives in PROJECT.md Key Decisions. Carried forward for v1.1:

- E2E harness must target the built Docker image in production shape (single Fastify origin), never split dev servers — Core Value (redirect handler as deployed) is what E2E must prove.
- E2E Postgres is a separate long-lived instance (published port 5433), distinct from the Vitest testcontainers harness; per-file truncate/reseed, not `BEGIN/ROLLBACK` (cross-process boundary).
- Sequence infra-first: shared foundation bugs (Mailpit inbox scoping, DB isolation, rate-limit 429s, CI healthchecks/shm) solved once in Phase 11 before any flow coverage.
- Domain-scoped authz E2E complements, does NOT re-run, the v1.0 integration Denial-Suite — only representative UI-layer proof per resource type.

### Pending Todos

None yet.

### Blockers/Concerns

Research flags to resolve during phase planning:
- Phase 11: DB-isolation mechanism (per-worker DB vs. unique-ID generation) needs a short spike; finalize rate-limit bypass mechanism.
- Phase 12: review actual bot-detection UA implementation before writing bot/OG specs; confirm custom-domain testing approach (/etc/hosts vs. host-header).
- Phase 13: mock OIDC IdP (oidc-provider) + better-auth genericOAuth callback specifics need planning validation; confirm where better-auth stores session (cookies vs. sessionStorage) before trusting storageState.
- Phase 14: confirm CSV import unit-test coverage; keep E2E light where already covered.

## Deferred Items

Items carried forward from v1.0 close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Decision revisit | OIDC admin card read-only status (D-10-02) may need a follow-up phase for dashboard-side OIDC config entry | Open | v1.0 close |

## Session Continuity

Last session: 2026-07-24 13:00
Stopped at: Roadmap and requirements traceability written for milestone v1.1; STATE initialized at Phase 11 ready-to-plan.
Resume file: None
