---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
plan: 02
subsystem: auth
tags: [better-auth, magic-link, prisma, postgres, nodemailer, domain-authorization]

# Dependency graph
requires:
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "02-01: better-auth/@fastify/rate-limit/@fastify/helmet installed, INITIAL_ADMIN_EMAIL ENV contract"
provides:
  - "betterAuth() instance (lib/auth.ts) — magicLink() only, 15-min expiry, disableSignUp, 7-day sliding session, bundled prismaAdapter sharing db.ts's singleton"
  - "lib/mailer.ts — nodemailer SMTP transport + sendMagicLinkEmail({to, url})"
  - "lib/allowlist.ts — isEmailAllowed(prisma, email): the User table IS the invite-only allowlist (D-01)"
  - "Prisma schema: User/Session/Account/Verification (better-auth-generated) + minimal Domain + DomainMembership (composite PK, cascade relations)"
  - "Committed migration add_auth_and_domain_models, applied to real Postgres, client regenerated at apps/api/src/generated/prisma"
  - "packages/shared DTOs: ROLE_HIERARCHY, Role, SessionUser, DomainMembership, Domain, AuthSession"
affects: [02-03, 02-04, 02-05, 02-06, auth, authorization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level env reads via direct process.env access + requireEnv() guard (mirrors db.ts), NOT loadEnv() — avoids a second full envSchema validation crashing tests that don't set every ENV key (vitest.config.ts only sets DATABASE_URL)"
    - "The User table doubles as the invite-only allowlist — no separate AllowedEmail table (RESEARCH OQ-3 resolution)"
    - "D-01 neutral response: allowlist check lives inside sendMagicLink, returns silently (no throw) on a non-allowlisted email"

key-files:
  created:
    - apps/api/src/lib/auth.ts
    - apps/api/src/lib/mailer.ts
    - apps/api/src/lib/allowlist.ts
    - apps/api/prisma/migrations/20260711121129_add_auth_and_domain_models/migration.sql
    - apps/api/test/schema-push.test.ts
  modified:
    - packages/shared/src/index.ts
    - apps/api/prisma/schema.prisma

key-decisions:
  - "auth.ts/mailer.ts read process.env directly with a requireEnv() guard (same pattern as db.ts), not loadEnv() — loadEnv() validates the FULL envSchema and calls process.exit(1) on any missing key, which would crash the Vitest process for any test file that imports these modules without every unrelated ENV key set"
  - "Confirmed OQ-2 empirically: better-auth/adapters/prisma re-exports the bundled @better-auth/prisma-adapter package (node_modules inspection) — the bundled import path is correct and no direct dependency was added, matching CLAUDE.md's locked guidance"
  - "Ran @better-auth/cli generate against lib/auth.ts (required auth.ts to exist first, since the CLI introspects the magicLink() plugin config) then manually appended Domain + DomainMembership models with a composite (userId, domainId) PK"
  - "Authored the live migration by spinning up a throwaway local postgres:18-alpine Docker container (not the test harness's testcontainer, which only ever applies already-committed migrations) — removed after prisma migrate dev completed"

patterns-established:
  - "Any lib/ module needing ENV at import time reads process.env directly + throws a descriptive error if unset, rather than calling loadEnv() — reserve loadEnv() for server.ts's single boot-time gate"

requirements-completed: []

coverage:
  - id: D1
    description: "betterAuth() instance compiles with magicLink()-only, disableSignUp:true, 15-min expiry, 7-day sliding session, and the bundled prismaAdapter importing db.ts's shared client (no second PrismaClient)"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
      - kind: other
        ref: "grep -n \"from \\\"../db\" apps/api/src/lib/auth.ts; grep -nE \"disableSignUp:\\s*true|expiresIn:\\s*900\" apps/api/src/lib/auth.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "isEmailAllowed(prisma, email) gates sendMagicLink from inside the callback (D-01 neutral response — no separate pre-check route, no enumeration oracle)"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "The byte-identical HTTP response guarantee (D-01) is not empirically proven by this plan — it requires an integration test hitting the mounted /api/auth/* route, which is 02-04's scope (auth.ts is not yet wired into app.ts here). This plan only proves the callback's control flow compiles and returns silently on a false allowlist check; the security property itself needs 02-04's canary test."
  - id: D3
    description: "schema.prisma holds User/Session/Account/Verification (better-auth-generated) plus a minimal Domain and DomainMembership (composite PK, cascade relations); migration applied to real Postgres; regenerated client exposes all six model delegates and they are genuinely queryable"
    requirement: null
    verification:
      - kind: integration
        ref: "apps/api/test/schema-push.test.ts (all 3 tests, real-Postgres testcontainers harness)"
        status: pass
      - kind: other
        ref: "prisma validate; ls apps/api/prisma/migrations/*add_auth_and_domain_models*/migration.sql"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-07-11
status: complete
---

# Phase 2 Plan 2: better-auth Instance, Invite-Only Allowlist & Domain Authorization Schema Summary

**betterAuth() magicLink()-only instance sharing db.ts's Prisma client, User-table-as-allowlist gate, and a live-Postgres-applied schema (User/Session/Account/Verification + Domain/DomainMembership)**

## Performance

- **Duration:** 32 min
- **Started:** 2026-07-11T13:45:00+02:00 (approx.)
- **Completed:** 2026-07-11T14:17:00+02:00
- **Tasks:** 3
- **Files modified:** 7 (3 new lib files, 1 new migration, 1 new test, 2 modified: schema.prisma, packages/shared/src/index.ts)

## Accomplishments

- Built `lib/auth.ts`'s `betterAuth()` instance: `magicLink()` as the sole plugin (900s expiry — AUTH-02, `disableSignUp: true` — D-01), bundled `prismaAdapter` sharing `db.ts`'s single generated client (Pitfall 2 avoided), 7-day sliding session (AUTH-03 groundwork).
- Built `lib/mailer.ts` (nodemailer SMTP transport + `sendMagicLinkEmail`) and `lib/allowlist.ts` (`isEmailAllowed` — the `User` table itself is the invite-only allowlist), with the allowlist check wired inside `sendMagicLink`'s callback per D-01's neutral-response requirement.
- Extended `packages/shared` with `ROLE_HIERARCHY`, `Role`, `SessionUser`, `DomainMembership`, `Domain`, and `AuthSession` DTOs.
- Ran `@better-auth/cli generate` against `lib/auth.ts` to append `User`/`Session`/`Account`/`Verification` to `schema.prisma`, then hand-added a minimal `Domain` model and a `DomainMembership` model with a composite `(userId, domainId)` primary key and cascade relations — the exact shape `requireDomainAccess`/`scopedDomainIds` (02-03) will query.
- [BLOCKING] Authored and applied the `add_auth_and_domain_models` migration against a real `postgres:18-alpine` instance, regenerated the client at `apps/api/src/generated/prisma`, and proved the six new model delegates are genuinely queryable (not just type-present) via `schema-push.test.ts` against the real-Postgres testcontainers harness.

## Task Commits

Each task was committed atomically:

1. **Task 1: better-auth instance + mailer + allowlist + shared auth DTOs** - `99649a2` (feat)
2. **Task 2: Generate better-auth tables + add minimal Domain/DomainMembership models** - `572928b` (feat)
3. **Task 3: [BLOCKING] Apply schema to live Postgres + regenerate client + schema-push verification** - `d85dc14` (feat)

**Plan metadata:** committed as part of this SUMMARY finalization

## Files Created/Modified

- `apps/api/src/lib/auth.ts` - `betterAuth()` instance: magicLink 900s/disableSignUp, bundled prismaAdapter over db.ts's client, 7-day sliding session, neutral-response sendMagicLink
- `apps/api/src/lib/mailer.ts` - nodemailer SMTP transport + `sendMagicLinkEmail({to, url})`, German subject line
- `apps/api/src/lib/allowlist.ts` - `isEmailAllowed(prisma, email)` — User-row-existence check
- `packages/shared/src/index.ts` - Adds `ROLE_HIERARCHY`, `Role`, `SessionUser`, `DomainMembership`, `Domain`, `AuthSession`
- `apps/api/prisma/schema.prisma` - Adds `User`, `Session`, `Account`, `Verification` (CLI-generated) + hand-added `Domain`, `DomainMembership`
- `apps/api/prisma/migrations/20260711121129_add_auth_and_domain_models/migration.sql` - Creates all six new tables against real Postgres
- `apps/api/test/schema-push.test.ts` - Proves the regenerated client's new delegates are queryable (not a generated-types false positive)

## Decisions Made

- `auth.ts`/`mailer.ts` read `process.env` directly (with a `requireEnv()` guard) rather than calling `loadEnv()` — matches `db.ts`'s existing singleton pattern and avoids crashing any test that imports these modules without the full `envSchema` surface set (`vitest.config.ts` only provides a placeholder `DATABASE_URL`).
- Confirmed empirically (node_modules inspection, not assumed) that `better-auth/adapters/prisma` re-exports the bundled `@better-auth/prisma-adapter` package — RESEARCH.md's OQ-2 is resolved in favor of the bundled import path exactly as CLAUDE.md locks in; no separate adapter dependency was added.
- The `User` table is the allowlist itself (no separate `AllowedEmail` table) per RESEARCH.md OQ-3's resolution — kept the schema minimal as D-02b specifies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reordered Task 1/Task 2 actions (not commits) to satisfy Task 1's own tsc verification**
- **Found during:** Task 1 (writing `allowlist.ts`, which calls `prisma.user.findUnique(...)`)
- **Issue:** `allowlist.ts` types against the generated Prisma client, but at the moment Task 1's action alone completes, the client (built in Phase 1) only has the `PersistenceCanary` model — `prisma.user` doesn't exist yet, so `pnpm --filter @kurzly/api exec tsc --noEmit` (Task 1's own verify step) would fail. The `User`/`Session`/etc. models are only added to `schema.prisma` by Task 2's action, and the client isn't regenerated with them until Task 3's blocking live-DB step.
- **Fix:** Executed Task 2's schema-authoring action (`@better-auth/cli generate` + hand-added `Domain`/`DomainMembership`) before running Task 1's verify step, then ran a schema-only `prisma generate` (no live DB connection required — Prisma generates client types purely from `schema.prisma`) so the TS client exposed all six models. This let Task 1's `tsc --noEmit` genuinely pass. Commits stayed correctly scoped per task (Task 1's commit contains only `lib/*` and `packages/shared`; Task 2's commit contains only `schema.prisma`) — only the *execution order* of writing/generating was adjusted, not what got committed under each task.
- **Files modified:** No extra files beyond what each task's `<files>` frontmatter already specified.
- **Verification:** `pnpm --filter @kurzly/shared build && pnpm --filter @kurzly/api exec tsc --noEmit` passes cleanly after the reorder; both tasks' individual acceptance-criteria greps also pass.
- **Committed in:** `99649a2` (Task 1) and `572928b` (Task 2) — unchanged file scope, just executed together before either commit landed.

---

**Total deviations:** 1 auto-fixed (1 blocking, execution-order only — no scope change)
**Impact on plan:** Necessary consequence of Task 2's own stated dependency ("auth.ts... must exist first" for the CLI to introspect) combined with Task 1's tsc verify needing the resulting schema — no scope creep, no extra files.

## Issues Encountered

- `prisma migrate dev` needs a real, reachable Postgres to author against (the test harness's testcontainer only applies already-committed migrations via `migrate deploy`, it doesn't author new ones). Spun up a throwaway `postgres:18-alpine` Docker container on a scratch port (`kurzly-migrate-authoring`), ran `prisma migrate dev --name add_auth_and_domain_models` against it, then removed the container — exactly the "spin up... for authoring" fallback the plan itself named. No lasting infrastructure artifact from this.

## User Setup Required

None - no external service configuration required. `SMTP_*`/`BASE_URL`/`BETTER_AUTH_SECRET`/`INITIAL_ADMIN_EMAIL` were already established as required boot-time ENV in 02-01; this plan adds no new required ENV keys.

## Next Phase Readiness

- `lib/auth.ts`, `lib/mailer.ts`, `lib/allowlist.ts` are ready for 02-04 to mount `/api/auth/*` into `app.ts` and write the magic-link round-trip integration test (including the D-01 byte-identical-response canary — genuinely proven only there, not here).
- The `DomainMembership`/`Domain` schema and regenerated client are ready for 02-03's `requireDomainAccess`/`scopedDomainIds` helpers to query against directly.
- `AUTH-01..04` remain **Pending** in REQUIREMENTS.md from this plan's perspective — this plan built the auth config/schema foundation only; no route is mounted yet and no end-user-facing behavior exists to verify. `requirements-completed` is intentionally left empty here; 02-04's integration tests are the actual completion evidence for those requirement IDs.
- No blockers for 02-03 through 02-06.

---
*Phase: 02-magic-link-auth-app-shell-domain-authorization-core*
*Completed: 2026-07-11*

## Self-Check: PASSED
