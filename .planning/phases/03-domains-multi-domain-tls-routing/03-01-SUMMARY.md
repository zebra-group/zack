---
phase: 03-domains-multi-domain-tls-routing
plan: 01
subsystem: api
tags: [prisma, postgres, fastify, better-auth, domains, dns, tdd]

# Dependency graph
requires:
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: requireDomainAccess/scopedDomainIds authorization core, better-auth session cookie, createAuth(prisma) factory pattern
provides:
  - Extended Domain model (hostname/type/status/verificationTarget/verifiedAt/lastCheckedAt/lastCheckError) + DomainType/DomainStatus enums, migrated to real Postgres
  - packages/shared DomainDTO replacing the Phase-2 placeholder Domain type
  - CNAME_TARGET / A_RECORD_IP env vars (fail-safe defaults, drift-guard documented)
  - VERIFY_RATE_LIMIT / TLS_CHECK_RATE_LIMIT consts for downstream Phase 3 plans
  - domainsRoute(prisma, auth): POST /api/domains (owner-bootstrap transaction) + GET /api/domains (scoped list), wired into app.ts
affects: [03-02, 03-03, 03-04, 05-redirect-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "domainsRoute(prisma, auth) factory mirrors authRoute(auth)/canaryRoute(prisma) — production wires db.ts/lib/auth.ts singletons, tests wire the transaction-wrapped test client + a bound createAuth instance"
    - "Domain creation bootstraps its own DomainMembership (owner) in a single prisma.$transaction — the ONE deliberate exception to requireDomainAccess (RESEARCH A1), since no domainId exists before creation"
    - "P2002 unique-constraint handling via structural error-shape check (isUniqueConstraintViolation) rather than importing Prisma.PrismaClientKnownRequestError directly"

key-files:
  created:
    - apps/api/prisma/migrations/20260711151644_extend_domain_lifecycle/migration.sql
    - apps/api/src/routes/domains.ts
    - apps/api/test/domains.integration.test.ts
  modified:
    - apps/api/prisma/schema.prisma
    - packages/shared/src/index.ts
    - apps/api/src/env.ts
    - .env.example
    - apps/api/src/plugins/rateLimit.ts
    - apps/api/src/app.ts
    - apps/api/test/authorization.test.ts
    - apps/api/test/schema-push.test.ts

key-decisions:
  - "prisma migrate dev refuses to run non-interactively even with --create-only when a warning (unique-constraint-on-empty-table) is present — authored the migration via prisma migrate diff --from-migrations/--to-schema against a throwaway postgres:18-alpine container (with a temporary shadowDatabaseUrl added to prisma.config.ts, reverted after authoring), then applied non-interactively via prisma migrate deploy. Migration SQL matches exactly what migrate dev would have produced."
  - "Domain creation reads CNAME_TARGET/A_RECORD_IP directly from process.env (not loadEnv()'s parsed result), matching db.ts/lib/auth.ts's existing 'read after boot-time validation' convention, with the SAME literal fallback env.ts's Zod defaults document"
  - "GET /api/domains scopes via scopedDomainIds (any membership role, not admin+) — matches D-04's 'member nutzen Domains nur' intent; management actions (verify/delete, later plans) will require admin+ via requireDomainAccess"

requirements-completed: [DOMAIN-01]

coverage:
  - id: D1
    description: "Extended Domain schema migrated to real Postgres (hostname/type/status/verificationTarget/verifiedAt/lastCheckedAt/lastCheckError), generated client + shared DomainDTO expose the new fields"
    requirement: "DOMAIN-01"
    verification:
      - kind: integration
        ref: "prisma migrate status (up to date) + grep -c hostname apps/api/src/generated/prisma/models/Domain.ts (35 matches)"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit && pnpm --filter @kurzly/shared build"
        status: pass
    human_judgment: false
  - id: D2
    description: "Authenticated admin POSTs to /api/domains and gets a pending Domain + owner DomainMembership created atomically in one transaction"
    requirement: "DOMAIN-01"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#DOMAIN-01: creates a pending Domain + owner DomainMembership in one transaction"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#computes verificationTarget from A_RECORD_IP for apex domains"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/domains returns only the caller's own domains (scopedDomainIds) — never leaks another user's rows"
    requirement: "DOMAIN-01"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#returns only the caller's domains (scopedDomainIds) — never another user's"
        status: pass
    human_judgment: false
  - id: D4
    description: "401/400/409 negative paths: unauthenticated create/list, invalid body, duplicate hostname create zero extra rows"
    requirement: "DOMAIN-01"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#401s an unauthenticated create and writes zero rows"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#400s an invalid body (missing hostname)"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#400s an invalid body (bad type)"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#409s a duplicate hostname and creates no second row"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#401s an unauthenticated list request"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 1: Domain schema + owner-bootstrap creation Summary

**Extended Domain model migrated to real Postgres (hostname/type/status/verification lifecycle), owner-bootstrap POST /api/domains transaction, and scoped GET /api/domains list — DOMAIN-01 proven against real Postgres via 8 new integration tests.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-11T15:11:00Z
- **Completed:** 2026-07-11T15:31:35Z
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments
- Extended `Domain` with `hostname`/`type`/`status`/`verificationTarget`/`verifiedAt`/`lastCheckedAt`/`lastCheckError`/`updatedAt`, plus `DomainType`/`DomainStatus` enums, migrated to real Postgres via a committed migration; regenerated Prisma client confirmed queryable
- `packages/shared`'s Phase-2 placeholder `Domain` type replaced with the full `DomainDTO`
- `CNAME_TARGET`/`A_RECORD_IP` env vars added with fail-safe defaults (drift-guard test green); `VERIFY_RATE_LIMIT`/`TLS_CHECK_RATE_LIMIT` consts added for downstream Phase 3 plans
- `domainsRoute(prisma, auth)` — `POST /api/domains` creates a `pending` Domain + owner `DomainMembership` in one `$transaction` (RESEARCH A1 authz-bootstrap resolution), `GET /api/domains` scoped via `scopedDomainIds`; wired into `app.ts` between `authRoute` and `registerStatic()`

## Task Commits

Each task was committed atomically:

1. **Task 1 [BLOCKING]: Extend Domain schema + enums, migrate, DomainDTO** - `51053c8` (feat)
2. **Task 2: CNAME_TARGET/A_RECORD_IP env vars + rate-limit consts** - `a988d08` (feat, includes Rule 1/3 test-fallout fix)
3. **Task 3: domains.ts POST/GET + app.ts wiring + integration suite** - `8f15b41` (test, RED) → `91921e4` (feat, GREEN)

**Plan metadata:** (this commit, docs: complete plan)

_TDD tasks (1 and 3) followed RED→GREEN: Task 1's schema/migration change is itself the "make the type exist" gate proven by the acceptance-criteria grep/status checks; Task 3 has an explicit test-then-implementation commit pair._

## Files Created/Modified
- `apps/api/prisma/schema.prisma` - Extended `Domain` model + `DomainType`/`DomainStatus` enums
- `apps/api/prisma/migrations/20260711151644_extend_domain_lifecycle/migration.sql` - Committed additive migration (2 new enums, 7 new columns, unique index on hostname, index on status)
- `packages/shared/src/index.ts` - `DomainDTO` replacing the Phase-2 placeholder `Domain` type
- `apps/api/src/env.ts` - `CNAME_TARGET`/`A_RECORD_IP` schema keys (fail-safe defaults)
- `.env.example` - Documents both new keys (drift-guard)
- `apps/api/src/plugins/rateLimit.ts` - `VERIFY_RATE_LIMIT`/`TLS_CHECK_RATE_LIMIT` consts
- `apps/api/src/routes/domains.ts` - `domainsRoute(prisma, auth)`: POST/GET `/api/domains`
- `apps/api/src/app.ts` - Registers `domainsRoute(prisma, auth)` after `authRoute`, before `registerStatic()`
- `apps/api/test/domains.integration.test.ts` - DOMAIN-01 creation/list/authz suite (8 tests, real Postgres)
- `apps/api/test/authorization.test.ts` - Fixed pre-existing `prisma.domain.create({data:{}})` calls (now-required fields)
- `apps/api/test/schema-push.test.ts` - Fixed pre-existing `prisma.domain.create({data:{}})` call (now-required fields)

## Decisions Made
- `prisma migrate dev` (even with `--create-only`) refuses to run non-interactively whenever Prisma emits any confirmation-requiring warning (here: "unique constraint... will be added" on the Domain table, even though the table is genuinely empty). Worked around by authoring the migration SQL via `prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --script` against a throwaway `postgres:18-alpine` container (temporarily adding `shadowDatabaseUrl` to `prisma.config.ts`, reverted immediately after authoring — never committed), hand-placing the output into a timestamped migration directory, then applying it non-interactively via `prisma migrate deploy`. The resulting SQL is identical to what `migrate dev` would have generated (`CREATE TYPE`, `ALTER TABLE ... ADD COLUMN`, `CREATE UNIQUE INDEX`, `CREATE INDEX`).
- `computeVerificationTarget()` in `domains.ts` reads `process.env.CNAME_TARGET`/`A_RECORD_IP` directly (not through `loadEnv()`'s parsed object), matching `db.ts`/`lib/auth.ts`'s existing "read raw env after boot-time validation" convention — with the identical literal fallback `env.ts`'s Zod `.default(...)` documents, so behavior is consistent whether or not `loadEnv()` ran first (e.g. under Vitest, which never sets these two vars).
- `GET /api/domains` scopes via `scopedDomainIds` (any membership role) rather than requiring admin+ — a `member` can see the domain list per D-04 ("member nutzen Domains nur"); admin+-gated actions (verify/delete/instructions) are deferred to later Phase 3 plans.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Blocking test fallout] Fixed pre-existing tests broken by the now-required Domain fields**
- **Found during:** Task 2 verification (`env-example-drift.test.ts` run triggers the full suite via testcontainers, surfacing failures in unrelated files)
- **Issue:** Phase 2's `authorization.test.ts` (7 call sites) and `schema-push.test.ts` (1 call site) created `Domain` rows via `prisma.domain.create({ data: {} })`. Task 1's [BLOCKING] schema extension made `hostname`/`type`/`verificationTarget` required NOT NULL columns, so every one of those calls started throwing `PrismaClientValidationError: Argument 'hostname' is missing`.
- **Fix:** Added a `seedDomain()` helper to `authorization.test.ts` (unique hostname per call, `type: "subdomain"`, `verificationTarget: "shortener.kurzly.local"`) and replaced all 7 bare-create call sites; added the same three required fields inline to `schema-push.test.ts`'s single call site.
- **Files modified:** `apps/api/test/authorization.test.ts`, `apps/api/test/schema-push.test.ts`
- **Verification:** Full suite (`pnpm -r test`) — 53/53 tests pass, exit code 0.
- **Committed in:** `a988d08` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1/3, blocking test fallout from the plan's own [BLOCKING] schema change)
**Impact on plan:** Necessary — the plan's own schema change would otherwise leave the Phase-2 suite red. No scope creep; only the minimum field values needed to satisfy the new NOT NULL constraints were added.

## Issues Encountered
- `prisma migrate dev`/`--create-only` both hit "Prisma Migrate has detected that the environment is non-interactive" even on a genuinely empty authoring table, because Prisma's confirmation gate triggers on the *presence* of any data-loss-shaped warning, not on actual row counts. Resolved via the `migrate diff` + hand-placed-migration + `migrate deploy` workaround documented above (Decisions Made). No lasting infrastructure change — the throwaway authoring container and its temporary shadow database were both removed after the migration SQL was captured, and `prisma.config.ts` was reverted to its pre-existing state (no `shadowDatabaseUrl` committed).

## User Setup Required

None - no external service configuration required. `CNAME_TARGET`/`A_RECORD_IP` ship with fail-safe placeholder defaults; an operator sets real values in their own `.env` before going live with real domains (documented in `.env.example`).

## Next Phase Readiness
- `Domain`/`DomainType`/`DomainStatus` schema, `DomainDTO`, `VERIFY_RATE_LIMIT`/`TLS_CHECK_RATE_LIMIT`, and the owner-bootstrap creation pattern are all in place for 03-02 (DNS verification via `dnsClient.ts` + `POST /api/domains/:id/verify`) and 03-03 (the `ask`/`tls-check` endpoint + `resolveActiveDomainByHost`) to build directly on top of.
- No blockers. `requireDomainAccess`/`scopedDomainIds` remain untouched (frozen signature, per Phase 2) — later plans wire them into the verify/delete/instructions routes as planned.

---
*Phase: 03-domains-multi-domain-tls-routing*
*Completed: 2026-07-11*

## Self-Check: PASSED

All created files verified present on disk (migration.sql, routes/domains.ts, test/domains.integration.test.ts, schema.prisma, shared/src/index.ts, env.ts, rateLimit.ts, app.ts). All 4 task commit hashes (51053c8, a988d08, 8f15b41, 91921e4) verified present in `git log --oneline --all`.
