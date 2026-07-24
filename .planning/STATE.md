---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: E2E Test Coverage
current_phase: 11
current_phase_name: Playwright E2E Infrastructure & Fixtures
status: executing
stopped_at: Phase 11 Plan 05 (auth.setup.ts, storageState fixture, chromium-admin/chromium-member projects, storage-state.spec.ts) complete. Ready to execute 11-06.
last_updated: "2026-07-24T14:38:48.235Z"
last_activity: 2026-07-24
last_activity_desc: "Plan 11-05 complete: apps/e2e/tests/auth.setup.ts (per-role magic-link round trip, storageState fixture), playwright.config.ts (setup/chromium-admin/chromium-member projects), apps/e2e/tests/authed/storage-state.spec.ts (fresh-context reuse proof, role-specific UI assertion)"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 6
  completed_plans: 5
  percent: 83
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 11 — Playwright E2E Infrastructure & Fixtures

## Current Position

Phase: 11 of 17 (Playwright E2E Infrastructure & Fixtures) — first phase of milestone v1.1
Plan: 5 of 6 complete (11-05: auth.setup.ts storageState fixture, chromium-admin/chromium-member projects, storage-state.spec.ts)
Status: In progress — 1 plan remaining in Phase 11
Last activity: 2026-07-24 — Plan 11-05 complete: apps/e2e/tests/auth.setup.ts (per-role magic-link round trip, storageState fixture), playwright.config.ts (setup/chromium-admin/chromium-member projects), apps/e2e/tests/authed/storage-state.spec.ts (fresh-context reuse proof, role-specific UI assertion)

Progress: [████████░░] 83%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.0): 65
- Average duration: ~8 min
- v1.1 plans completed: 3

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 11 | 4/6 | In progress |
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
| Phase 11 P04 | 27min | 3 tasks | 9 files |
| Phase 11 P05 | 15min | 2 tasks | 3 files |

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
- [Phase 11]: better-auth 1.6.23's magic-link verify URL confirmed empirically from installed source as /api/auth/magic-link/verify?token= (basePath default /api/auth), closing RESEARCH A2/OQ-2 with certainty
- [Phase 11]: resetDb() wraps its TRUNCATE+reseed in pg_advisory_lock/unlock so parallel fullyParallel worker files never interleave; db-isolation.spec.ts uses cryptographically-random per-test slugs so a real P2002 is structurally impossible regardless of scheduling
- [Phase 11]: auth.setup.ts requests magic links via direct request.post (mirroring 11-04's mailpit-wiring pattern) rather than driving the LoginView UI form — the UI login flow itself is Phase 13 scope; keeps the auth fixture focused on establishing a real session
- [Phase 11]: storage-state.spec.ts detects role via testInfo.project.name in a single shared spec file instead of two near-duplicate per-role files — one assertion body proves both "reaches an authenticated route" and "correct role's session was captured" (T-11-08) for chromium-admin and chromium-member alike

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

Last session: 2026-07-24T14:38:32.447Z
Stopped at: Phase 11 Plan 05 (auth.setup.ts, storageState fixture, chromium-admin/chromium-member projects, storage-state.spec.ts) complete. Ready to execute 11-06.
Resume file: None
