---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: magic-link-auth-app-shell-domain-authorization-core
status: executing
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-07-11T12:53:18.573Z"
last_activity: 2026-07-11
last_activity_desc: Phase 02 execution started
progress:
  total_phases: 10
  completed_phases: 1
  total_plans: 15
  completed_plans: 13
  percent: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-10)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 02 — magic-link-auth-app-shell-domain-authorization-core

## Current Position

Phase: 02 (magic-link-auth-app-shell-domain-authorization-core) — EXECUTING
Plan: 5 of 6
Status: Ready to execute
Last activity: 2026-07-11 — Phase 02 execution started

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
| Phase 02 P01 | 20min | 2 tasks | 6 files |
| Phase 02 P02 | 32min | 3 tasks | 7 files |
| Phase 02 P03 | 5min | 1 tasks | 2 files |
| Phase 02 P04 | 23min | 3 tasks | 10 files |

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
- [Phase 02]: 02-01: Operator-approved supply-chain sign-off for better-auth, @fastify/rate-limit, @fastify/helmet, @better-auth/cli at CLAUDE.md-pinned versions (T-02-SC-Gate)
- [Phase 02]: 02-01: better-sqlite3 (transitive optional dep of better-auth's bundled kysely/drizzle adapters) set to allowBuilds: false in pnpm-workspace.yaml - Postgres-only project, same no-blanket-lifecycle-script rationale as Phase 1's cpu-features/protobufjs/ssh2
- [Phase 02]: 02-02: auth.ts/mailer.ts read process.env directly with a requireEnv() guard (matching db.ts), not loadEnv() — avoids crashing tests that only set a placeholder DATABASE_URL
- [Phase 02]: 02-02: Confirmed empirically that better-auth/adapters/prisma re-exports the bundled @better-auth/prisma-adapter package (RESEARCH OQ-2 resolved) — no direct adapter dependency added
- [Phase 02]: 02-02: User table doubles as the invite-only allowlist (RESEARCH OQ-3 resolved) — no separate AllowedEmail table; DomainMembership composite PK (userId,domainId) built for 02-03's requireDomainAccess
- [Phase 02]: 02-03: requireDomainAccess/scopedDomainIds signature frozen exactly as researched — (prisma,userId,domainId,minRole)/(prisma,userId), zero route callers this phase
- [Phase ?]: lib/auth.ts refactored from a singleton to a createAuth(prisma) factory (auth=createAuth(defaultPrisma) kept for production) so tests can bind auth writes to the same transaction-wrapped Prisma client as the rest of the harness
- [Phase ?]: The tight magic-link rate limit is applied via a separate, more specific static route (POST /api/auth/sign-in/magic-link) ahead of the /api/auth/* wildcard catch-all, scoping it without touching other better-auth endpoints
- [Phase ?]: vitest.config.ts test env extended with BASE_URL/BETTER_AUTH_SECRET/SMTP_* placeholders since app.ts now transitively imports lib/auth.ts/lib/mailer.ts for every test file calling buildApp()

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

Last session: 2026-07-11T12:53:18.534Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None
