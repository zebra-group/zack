---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 01
current_phase_name: test-infrastructure-monorepo-deployment-scaffolding
status: executing
stopped_at: Phase 2 UI-SPEC approved
last_updated: "2026-07-11T11:38:05.386Z"
last_activity: 2026-07-10
last_activity_desc: Completed 01-09-PLAN.md (CI workflow + reverse-proxy/TLS documentation)
progress:
  total_phases: 10
  completed_phases: 1
  total_plans: 9
  completed_plans: 9
  percent: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-10)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 01 — test-infrastructure-monorepo-deployment-scaffolding

## Current Position

Phase: 01 (test-infrastructure-monorepo-deployment-scaffolding) — ALL PLANS COMPLETE
Plan: 9 of 9 (complete) — phase ready for transition
Status: Ready to execute
Last activity: 2026-07-10 — Completed 01-09-PLAN.md (CI workflow + reverse-proxy/TLS documentation)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 2
- Average duration: ~8 min
- Total execution time: ~0.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 16 min | 8 min |

**Recent Trend:**

- Last 5 plans: 01-01 (1 min), 01-02 (15 min)
- Trend: -

*Updated after each plan completion*
| Phase 01 P02 | 15 | 3 tasks | 24 files |
| Phase 01 P03 | 11min | 2 tasks | 8 files |
| Phase 01 P04 | 6min | 2 tasks | 4 files |
| Phase 01 P05 | 10min | 3 tasks | 5 files |
| Phase 01 P06 | 16min | 3 tasks | 10 files |
| Phase 01 P07 | 5min | 2 tasks | 4 files |
| Phase 01 P08 | 35min | 3 tasks | 8 files |
| Phase 01 P09 | 9min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Redirect Engine split into its own dedicated phase (5) from Links Management (4), per research's pitfall-density recommendation.
- Roadmap: Bulk CSV Import folded into Links Management (4) rather than a standalone phase, to avoid a single-requirement phase.
- Roadmap: TEAM-06 (domain-scoped authorization enforcement) placed in Phase 9, where it can be proven end-to-end against real Links/QR/Analytics resources — the underlying `requireDomainAccess` helper itself is built in Phase 2, ahead of the routes it must gate.
- [Phase 01]: allowBuilds extended to @prisma/engines and esbuild (beyond prisma/@prisma/client) - both required for pnpm -r build to succeed; testcontainers unused SSH-remote-docker deps (cpu-features/protobufjs/ssh2) left unapproved
- [Phase 01]: Dropped vue-tsc from apps/web (incompatible with typescript@7.0.2); typecheck now runs plain tsc --noEmit against a *.vue module shim
- [Phase 01]: Prisma 7.8.0 (point release beyond CLAUDE.md/RESEARCH.md) requires prisma.config.ts for datasource.url and an @prisma/adapter-pg driver adapter on PrismaClient construction - both added in 01-03; Phase 2's better-auth adapter must follow the same new PrismaClient({ adapter }) pattern — Bare new PrismaClient() and schema.prisma datasource.url no longer type-check/validate against the actually-installed Prisma 7.8.0
- [Phase 01]: 01-04: SMTP_FROM schema validated as z.email() (bare address) — RESEARCH.md's own .env.example example used the RFC5322 'Name <email>' header format while its Pattern 2 code sample used z.email(); resolved in favor of the schema.
- [Phase 01]: 01-04: loadEnv() is an explicit boot-time call (not a top-level side-effecting env.ts export) so importing env.ts never triggers process.exit(1) as an import side effect.
- [Phase 01]: 01-05: PrismaPg adapter pinned to pool max:1 for per-test BEGIN/ROLLBACK isolation - @prisma/adapter-pg's per-statement pool.query() can otherwise route BEGIN/ROLLBACK to different connections, silently breaking isolation
- [Phase 01]: 01-05: Vitest globalSetup confirmed empirically (A3) to start exactly one shared testcontainers Postgres per vitest run invocation, reused across multiple worker processes
- [Phase 01]: 01-06: buildApp() accepts an injectable prisma override so integration tests reuse setupFileEach.ts's transaction-wrapped client (GET /api/canary sees rows written by an earlier POST in the same rolled-back test transaction) — Routes hard-importing db.ts's singleton would use a separate un-rolled-back connection, leaking writes across tests
- [Phase 01]: 01-06: server.ts dynamically imports app.ts after loadEnv() so db.ts's module-level PrismaClient construction never runs ahead of fail-fast ENV validation (D-06)
- [Phase 01]: 01-07: GET /api/canary's { total, latest } response is typed as a local CanaryStatus in api.ts, not the shared CanaryResult DTO (which only matches POST's { token, total }) - avoids silently mistyping a field that doesn't exist on the GET response
- [Phase 01]: 01-07: apps/web/tsconfig.json adds "DOM" to compilerOptions.lib (app-local) - the first real browser fetch() call in the SPA needed fetch/Response types beyond the workspace base tsconfig's ES2022-only lib
- [Phase 01]: 01-08: pnpm deploy requires --legacy under pnpm 11's default injected-workspace mode for Docker-safe production output
- [Phase 01]: 01-08: postgres:18-alpine's named volume must mount at /var/lib/postgresql (not .../data) - image manages its own major-version-specific subdirectory; confirmed empirically, RESEARCH.md example predates this behavior change
- [Phase 01]: 01-08: prisma generate needs a placeholder DATABASE_URL at Docker build time since prisma.config.ts resolves it eagerly via env(), even though generate never connects to a DB
- [Phase 01]: 01-09: Split CI into a fast test job (workspace-only) and a smoke job (needs: test) that builds the Docker image and runs the compose boot/persistence smoke scripts
- [Phase 01]: 01-09: Reused the Dockerfile's placeholder-DATABASE_URL trick for CI's explicit prisma generate step since prisma.config.ts resolves DATABASE_URL eagerly via env() even for a connection-less generate call

### Pending Todos

None yet.

### Blockers/Concerns

- REQUIREMENTS.md's traceability summary previously stated "47 v1 requirements" — an actual count found 53 distinct v1 requirement IDs across the 10 categories. Traceability table has been corrected to 53/53 mapped. Flagging in case "47" was an intentional target that implies some listed items should have been out-of-scope — worth a quick confirmation with the user.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-11T10:51:15.827Z
Stopped at: Phase 2 UI-SPEC approved
Resume file: .planning/phases/02-magic-link-auth-app-shell-domain-authorization-core/02-UI-SPEC.md
