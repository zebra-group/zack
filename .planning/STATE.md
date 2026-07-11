---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 04
current_phase_name: links-management-bulk-import
status: executing
stopped_at: Completed 04-03-PLAN.md
last_updated: "2026-07-11T20:38:53.597Z"
last_activity: 2026-07-11
last_activity_desc: Phase 04 execution started
progress:
  total_phases: 10
  completed_phases: 3
  total_plans: 24
  completed_plans: 23
  percent: 30
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-10)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 04 — links-management-bulk-import

## Current Position

Phase: 04 (links-management-bulk-import) — EXECUTING
Plan: 5 of 5
Status: Ready to execute
Last activity: 2026-07-11 — Phase 04 execution started

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 12
- Average duration: ~8 min
- Total execution time: ~0.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 16 min | 8 min |
| 02 | 6 | - | - |
| 03 | 4 | - | - |

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
| Phase 02 P05 | 7min | 3 tasks | 9 files |
| Phase 02 P06 | 7min | 3 tasks | 8 files |
| Phase 03 P01 | 20min | 3 tasks | 11 files |
| Phase 03 P02 | 13min | 2 tasks | 5 files |
| Phase 03 P03 | 10min | 3 tasks | 6 files |
| Phase 03 P04 | 15min | 3 tasks | 4 files |
| Phase 04 P01 | 6min | 2 tasks | 2 files |
| Phase 04 P02 | 14min | 3 tasks | 8 files |
| Phase 04 P03 | 12min | 2 tasks | 2 files |
| Phase 04 P04 | 22min | 2 tasks | 3 files |

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
- [Phase ?]: [Phase 02]: 02-05: theme store's watch() uses flush:'sync' so body[data-theme]/localStorage stay synchronously consistent with the reactive theme ref (Pinia/Vue's default 'pre' flush would defer the DOM write to a microtask)
- [Phase ?]: [Phase 02]: 02-05: getSession() normalizes better-auth's raw null|{session,user} get-session response into the shared AuthSession DTO at the api.ts boundary, not left for stores/components to interpret
- [Phase ?]: [Phase 02]: 02-06: main.ts awaits router.isReady() before app.mount() so the beforeEach guard's redirect always resolves before App.vue's first render (no flash of a protected view for unauthenticated users)
- [Phase ?]: [Phase 02]: 02-06: test/App.test.ts rewritten (not deleted) for App.vue's new layout-switching behavior since the Phase 1 walking-skeleton canary UI it tested was fully replaced
- [Phase ?]: [Phase 03]: 03-01: prisma migrate dev refuses to run non-interactively even with --create-only on any confirmation-shaped warning (e.g. unique constraint on an empty table) — authored the migration via prisma migrate diff (temporary shadowDatabaseUrl, reverted) against a throwaway container, applied non-interactively via prisma migrate deploy
- [Phase ?]: [Phase 03]: 03-01: domainsRoute(prisma, auth) domain creation bootstraps its own owner DomainMembership in a single $transaction (RESEARCH A1) — the one exception to requireDomainAccess since no domainId exists pre-creation
- [Phase ?]: verifyDomain treats DNS mismatches as expected non-error outcomes; only lookup failures (ENOTFOUND/ENODATA/DNS_TIMEOUT) populate error
- [Phase ?]: GET /:id/instructions is admin-gated (not just any member) since it discloses the operator's exact DNS target for a domain
- [Phase ?]: A failed verify leaves verifiedAt untouched — only a successful check ever stamps it, preserving pending-vs-has-failed-before information
- [Phase 03]: 03-03: resolveActiveDomainByHost/GET /api/tls-check kept exactly to RESEARCH Pattern 4/3's spec — frozen signature for Phase 5 redirect engine reuse — Deny-by-default host guard + operator-delegated TLS ask endpoint satisfies DOMAIN-03 and Success Criterion 4 without deviation
- [Phase 03]: 03-03: reverse-proxy.md's Caddy example uses ask-only form (no interval/burst), Domain.status is the authoritative gate — RESEARCH State of the Art flags interval/burst as deprecated in favor of Caddy's permission module
- [Phase 03]: 03-04: ApiError class (extends Error, carries .status) added to api.ts so DomainsView can map 409/429 to exact locked copy; all prior throw sites migrated for consistency
- [Phase 03]: 03-04: verify failures (DNS-mismatch or 429) render as an inline .verify-error-row under the domain row, never a toast — only a successful verify toasts, per 03-UI-SPEC.md's DNS-Verify-Interaction contract
- [Phase ?]: Operator-approved supply-chain sign-off for csv-parse and nanoid at RESEARCH-pinned versions (T-04-SC-Gate)
- [Phase ?]: No pnpm-workspace allowBuilds entry needed for csv-parse/nanoid - neither introduced a build-script-requiring transitive dependency
- [Phase ?]: [Phase 04]: 04-02: prisma migrate dev ran non-interactively for the additive Link CREATE TABLE (no confirmation-shaped warning) - the migrate-diff/deploy workaround from 03-01 remains the fallback for future ALTER-shaped migrations
- [Phase ?]: [Phase 04]: 04-02: GET /api/links silently narrows an out-of-scope ?domainId= to [] rather than 403ing, matching GET /api/domains's scope-silently-never-leak convention
- [Phase ?]: resolveOwnedLink stays route-layer plumbing in routes/links.ts (not lib/links.ts's D-01 core) — composes requireDomainAccess with a link-specific lookup, not a shared validation rule.
- [Phase ?]: PATCH's title: null currently means 'keep existing title' (not clear it) since updateLink's ValidatedLink.title has no null variant and lib/links.ts is out of this plan's files_modified scope.
- [Phase 04]: runImport(mutate) shared by preview/commit reuses @kurzly/shared LinkSkipReason/ImportRowResult types instead of redeclaring them locally

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

Last session: 2026-07-11T20:36:07.426Z
Stopped at: Completed 04-03-PLAN.md
Resume file: None
