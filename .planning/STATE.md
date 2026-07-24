---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: E2E Test Coverage
current_phase: 12
current_phase_name: Redirect Handler E2E (Core Value
status: executing
stopped_at: Completed 12-04-PLAN.md
last_updated: "2026-07-24T20:49:21.972Z"
last_activity: 2026-07-24
last_activity_desc: Phase 12 execution started
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 11
  completed_plans: 10
  percent: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 12 — Redirect Handler E2E (Core Value)

## Current Position

Phase: 12 (Redirect Handler E2E (Core Value)) — EXECUTING
Plan: 5 of 5
Status: Ready to execute
Last activity: 2026-07-24 — Phase 12 execution started

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.0): 65
- Average duration: ~8 min
- v1.1 plans completed: 6

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 11 | 6/6 | Complete |
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
| Phase 11 P06 | 10min | 2 tasks | 2 files |
| Phase 12 P01 | 20min | 1 tasks | 1 files |
| Phase 12 P02 | 25min | 2 tasks | 4 files |
| Phase 12 P03 | 35min | 2 tasks | 3 files |
| Phase 12 P04 | 20min | 2 tasks | 2 files |

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
- [Phase 11]: rate-limit-bypass.spec.ts runs the negative burst before the positive burst against the same probe IP so the positive burst proves the bypass overrides an already-tripped bucket
- [Phase 11]: CI's e2e job generates E2E_RATE_LIMIT_BYPASS_SECRET itself via a dedicated openssl rand -hex 32 step (id: bypass-secret) rather than relying solely on scripts/e2e-compose.sh's own fallback, making per-run provenance explicit in ci.yml
- [Phase 12]: RESEARCH OQ-1/A1 CONFIRMED live against the built compose image — Playwright APIRequestContext delivers a caller-supplied Host header unmodified to Fastify, no raw http.request fallback needed for this phase's feature specs
- [Phase 12]: Confirmed RESEARCH Q2's resolved finding empirically -- @kurzly/api's exports map makes lib/links.ts's createLink/updateLink unreachable from apps/e2e, so createE2eLink is a raw prisma.link.create mirroring derivePasswordHash/deriveExpiresAt's exact derivation shape
- [Phase 12]: bcryptjs added as an explicit apps/e2e devDependency -- pnpm's non-hoisted workspace layout does not expose a sibling workspace package's (apps/api) transitive deps as bare imports, even when already pinned/vetted in the shared lockfile
- [Phase 12]: REDIRECT-E2E-01/03 proven over real HTTP against the built compose image; fetchWithFixtureRaceRetry added to apps/e2e/src/links.ts to close a cross-file DB race between db-isolation.spec.ts's concurrent Link-table truncates and a fixture-creating real-HTTP test's read-back
- [Phase 12]: Bot-vs-human test reuses the SAME slug/Link for both the bot-UA and browser-UA requests, proving the branch is driven purely by User-Agent, not by any incidental fixture difference between two separate Links
- [Phase 12]: REDIRECT-E2E-04/REDIRECT-E2E-05 required zero changes to apps/e2e/src/links.ts -- the existing createE2eLink/BOT_UA/BROWSER_UA/CANARY_TARGET/assertNoLeak/fetchWithFixtureRaceRetry vocabulary from 12-02/12-03 covered every fixture and assertion verbatim

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

Last session: 2026-07-24T20:49:21.966Z
Stopped at: Completed 12-04-PLAN.md
Resume file: None
