---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: E2E Test Coverage
current_phase: 11
current_phase_name: Playwright E2E Infrastructure & Fixtures
status: executing
stopped_at: Phase 11 Plan 03 (compose E2E overlay, boot script, boot smoke spec) complete. Ready to execute 11-04.
last_updated: "2026-07-24T14:15:09.482Z"
last_activity: 2026-07-24
last_activity_desc: "Plan 11-03 complete: docker-compose.e2e.yml additive overlay, scripts/e2e-compose.sh boot/run/teardown entrypoint, and boot.spec.ts proving the suite hits the built Fastify image at :3000"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 6
  completed_plans: 3
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 11 — Playwright E2E Infrastructure & Fixtures

## Current Position

Phase: 11 of 17 (Playwright E2E Infrastructure & Fixtures) — first phase of milestone v1.1
Plan: 3 of 6 complete (11-03: compose E2E overlay, boot script, boot smoke spec)
Status: In progress — 3 plans remaining in Phase 11
Last activity: 2026-07-24 — Plan 11-03 complete: docker-compose.e2e.yml, scripts/e2e-compose.sh, and boot.spec.ts proving the suite hits the built Fastify image at :3000

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.0): 65
- Average duration: ~8 min
- v1.1 plans completed: 3

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 11 | 3/6 | In progress |
| 12 | TBD | Not started |
| 13 | TBD | Not started |
| 14 | TBD | Not started |
| 15 | TBD | Not started |
| 16 | TBD | Not started |
| 17 | TBD | Not started |

**Recent Trend:**

- v1.0 shipped 2026-07-23 (10 phases, 65 plans); v1.1 started 2026-07-24 with Phase 11 Plan 01
- Trend: -

**Recent Plans:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 11 P01 | 10min | 3 tasks | 6 files |

*Updated after each plan completion*
| Phase 11 P02 | 12min | 2 tasks | 2 files |
| Phase 11 P03 | 25min | 3 tasks | 3 files |

## Accumulated Context

### Decisions

Full decision log lives in PROJECT.md Key Decisions. Carried forward for v1.1:

- E2E harness must target the built Docker image in production shape (single Fastify origin), never split dev servers — Core Value (redirect handler as deployed) is what E2E must prove.
- E2E Postgres is a separate long-lived instance (published port 5433), distinct from the Vitest testcontainers harness; per-file truncate/reseed, not `BEGIN/ROLLBACK` (cross-process boundary).
- Sequence infra-first: shared foundation bugs (Mailpit inbox scoping, DB isolation, rate-limit 429s, CI healthchecks/shm) solved once in Phase 11 before any flow coverage.
- Domain-scoped authz E2E complements, does NOT re-run, the v1.0 integration Denial-Suite — only representative UI-layer proof per resource type.
- [Phase 11]: Raw-.ts Prisma-client subpath export (apps/api/package.json exports['./prisma-client']) resolves directly under Playwright's runtime — RESEARCH OQ-1/A1 closed green, no compiled-artifact fallback needed.
- [Phase 11]: allowList (not a custom keyGenerator hack) is the correct @fastify/rate-limit mechanism for full request exclusion — set once at global registration, covers global bucket + every named per-route override
- [Phase 11]: E2E_RATE_LIMIT_BYPASS_SECRET is read directly from process.env in registerRateLimit, never added to envSchema/.env.example — structurally impossible to set via production config, proven by a dedicated schema-absence test
- [Phase 11]: scripts/e2e-compose.sh derives E2E_DATABASE_URL Postgres credentials from the bootstrapped .env at runtime (fallback kurzly/changeme/kurzly), not a hardcoded string

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

Last session: 2026-07-24T14:15:09.475Z
Stopped at: Phase 11 Plan 03 (compose E2E overlay, boot script, boot smoke spec) complete. Ready to execute 11-04.
Resume file: None
