---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 01
subsystem: database
tags: [prisma, postgres, better-auth, authorization]

# Dependency graph
requires:
  - phase: 02-magic-link-auth-domain-authorization-core
    provides: "requireDomainAccess/scopedDomainIds (lib/authorization.ts), createAuth(prisma) factory, seedInitialAdmin upsert"
provides:
  - "AccountRole native Postgres enum {admin, member} + User.accountRole @default(member) column, additive migration"
  - "isAccountAdmin(prisma, userId) — the single shared account-admin check primitive"
  - "SessionUser.accountRole + AccountRole type alias in packages/shared"
  - "better-auth get-session response carries user.accountRole via user.additionalFields"
  - "seedInitialAdmin always sets accountRole=admin on both create and update (idempotent, never demotes)"
affects: [09-02, 09-03, 09-04, 09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Global AccountRole enum kept deliberately separate from the existing per-domain Role enum (installation-wide vs. per-domain authorization)"
    - "better-auth user.additionalFields with input:false as the non-client-settable session-field wiring pattern for future server-owned user fields"
    - "isAccountAdmin as the single shared account-admin-check primitive other modules import rather than re-deriving"

key-files:
  created:
    - apps/api/prisma/migrations/20260723061259_add_user_account_role/migration.sql
    - apps/api/src/lib/accountRole.ts
    - apps/api/test/account-role-schema-push.test.ts
    - apps/api/test/account-role-session.integration.test.ts
  modified:
    - apps/api/prisma/schema.prisma
    - apps/api/src/lib/admin-seed.ts
    - apps/api/src/lib/auth.ts
    - packages/shared/src/index.ts

key-decisions:
  - "Confirmed empirically: no @better-auth/cli generate step is needed for accountRole — the column is a plain additive Prisma column, and user.additionalFields only teaches better-auth's Prisma adapter to READ it into the get-session/get-user response, never to create schema"
  - "Migration authored against a throwaway ad hoc postgres:18-alpine container on host port 15432 (docker-compose's db service has no host port mapping) — same established pattern as 03-01/05-02/06-02/07-02/08-01; ran non-interactively via prisma migrate dev with no confirmation-shaped warning"
  - "user.additionalFields.accountRole set to {type:'string', required:false, input:false} exactly per plan — input:false is defense-in-depth alongside disableSignUp:true so accountRole is never client-settable through any auth/signup/update-user path"

patterns-established:
  - "AccountRole (global) vs Role (per-domain) enum separation — D-09-01's precedent for any future installation-wide-vs-scoped role distinction"
  - "isAccountAdmin as the sole account-admin-check primitive — plans 09-02/09-03/09-04 must import it, never re-derive accountRole==='admin' inline"

requirements-completed: [TEAM-01, TEAM-04, TEAM-06]

coverage:
  - id: D1
    description: "User.accountRole native enum column, defaulting existing/new rows to member, round-trips admin via create/findUnique"
    requirement: "TEAM-01"
    verification:
      - kind: unit
        ref: "apps/api/test/account-role-schema-push.test.ts#defaults a newly created User's accountRole to member"
        status: pass
      - kind: unit
        ref: "apps/api/test/account-role-schema-push.test.ts#round-trips an explicit admin accountRole through create + findUnique"
        status: pass
    human_judgment: false
  - id: D2
    description: "isAccountAdmin resolves true only for accountRole=admin, false for member and unknown users"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "apps/api/test/account-role-schema-push.test.ts#isAccountAdmin returns true only for an accountRole=admin user"
        status: pass
      - kind: unit
        ref: "apps/api/test/account-role-schema-push.test.ts#isAccountAdmin returns false for an unknown userId"
        status: pass
    human_judgment: false
  - id: D3
    description: "seedInitialAdmin sets accountRole=admin on fresh create and re-affirms (never demotes) on re-run"
    requirement: "TEAM-06"
    verification:
      - kind: integration
        ref: "apps/api/test/account-role-session.integration.test.ts#seedInitialAdmin creates a fresh admin with accountRole=admin"
        status: pass
      - kind: integration
        ref: "apps/api/test/account-role-session.integration.test.ts#seedInitialAdmin re-run against an already-seeded row re-affirms accountRole=admin (idempotent)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/auth/get-session response carries user.accountRole for the signed-in seeded admin (UI-09-02 data contract)"
    verification:
      - kind: integration
        ref: "apps/api/test/account-role-session.integration.test.ts#GET /api/auth/get-session for the signed-in seeded admin returns user.accountRole=admin"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 1: Account-Role Foundation Summary

**Global `AccountRole` enum + `User.accountRole` column, `isAccountAdmin` primitive, and better-auth session wiring so `accountRole` flows from Postgres to the get-session response and `SessionUser` DTO**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-23T08:12:09+02:00
- **Completed:** 2026-07-23T08:31:51+02:00
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- Added the native Postgres `AccountRole` enum `{admin, member}` and a defaulted `User.accountRole` column via an additive migration (`add_user_account_role`) — every existing row backfills to `member`, no silent elevation.
- Created `apps/api/src/lib/accountRole.ts`'s `isAccountAdmin(prisma, userId)` — the single shared primitive plans 09-02/09-03/09-04 will import for the account-admin check.
- Extended `packages/shared`'s `SessionUser` with `accountRole: "admin" | "member"` and added an `AccountRole` type alias, rebuilt the shared package.
- `seedInitialAdmin` now sets `accountRole: "admin"` in both the `create` and `update` branches — idempotent across redeploys, never demotes (the D-09-07 lockout-guard precondition).
- Wired `better-auth`'s `user.additionalFields.accountRole` (`{type:"string", required:false, input:false}`) in `lib/auth.ts` so `GET /api/auth/get-session` carries `user.accountRole` — confirmed empirically that no `@better-auth/cli generate` step is needed since the column already exists.

## Task Commits

Each task followed RED -> GREEN:

1. **Task 1: AccountRole enum + User.accountRole column + migration + isAccountAdmin + shared DTO**
   - `5405cd9` test(09-01): failing account-role schema + isAccountAdmin cases
   - `a5169ce` feat(09-01): add global AccountRole enum, User.accountRole column, isAccountAdmin
2. **Task 2: Seed the initial admin as an account admin + carry accountRole in the session**
   - `fd2da8b` test(09-01): failing session-carries-accountRole + admin-seed cases
   - `22f3936` feat(09-01): seed initial admin as account admin, expose accountRole in session

## Files Created/Modified
- `apps/api/prisma/schema.prisma` - Added `AccountRole` enum + `User.accountRole @default(member)` column, doc-commented per D-09-01
- `apps/api/prisma/migrations/20260723061259_add_user_account_role/migration.sql` - Additive enum + defaulted column migration
- `apps/api/src/lib/accountRole.ts` - `isAccountAdmin(prisma, userId)` — single shared account-admin primitive
- `apps/api/src/lib/admin-seed.ts` - `accountRole: "admin"` in both create and update branches of the seed upsert
- `apps/api/src/lib/auth.ts` - `user.additionalFields.accountRole` wiring on the `betterAuth({...})` config
- `packages/shared/src/index.ts` - `SessionUser.accountRole`, `AccountRole` type alias, `ACCOUNT_ROLES` const
- `apps/api/test/account-role-schema-push.test.ts` - Real-Postgres proof: default/round-trip/isAccountAdmin cases
- `apps/api/test/account-role-session.integration.test.ts` - admin-seed idempotency + get-session accountRole propagation

## Decisions Made
- Confirmed empirically (planner-required finding, recorded here): `accountRole` needs no `@better-auth/cli generate` step — it is a plain additive Prisma column, and `user.additionalFields` only teaches better-auth's Prisma adapter to read that existing column into the get-session/get-user response body, not to create schema. Verified by `account-role-session.integration.test.ts`'s get-session assertion passing without ever invoking the CLI generator.
- Migration authored against a throwaway ad hoc `postgres:18-alpine` container on host port 15432 (the running `docker-compose` `db` service has no host port mapping) — same established pattern as 03-01/05-02/06-02/07-02/08-01. `prisma migrate dev --name add_user_account_role` ran non-interactively with no confirmation-shaped warning (same additive shape as 06-02's precedent); the migrate-diff/deploy fallback was not needed.
- `user.additionalFields.accountRole` set to `{type: "string", required: false, input: false}` exactly per the plan — `input: false` is defense-in-depth alongside `disableSignUp: true` so `accountRole` can never be set through any client-facing auth/signup/update-user path; the only writers remain `admin-seed.ts` and (from 09-04 onward) the admin-gated team routes.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' file lists, behaviors, and verification steps matched the plan; no Rule 1/2/3/4 fixes were needed.

## Issues Encountered

None - the full API test suite (37 files / 459 tests) passed on the first run after Task 2's implementation, `pnpm -r exec tsc --noEmit` was clean throughout, and `prisma migrate status` reported the schema up to date against a fresh throwaway database.

## User Setup Required

None - no external service configuration required. The migration is committed and self-applying via `test/globalSetup.ts`'s `prisma migrate deploy` for tests and the existing Docker/production migration-apply step for real deployments.

## Next Phase Readiness

- The `AccountRole` enum, `User.accountRole` column, `isAccountAdmin` primitive, and `SessionUser.accountRole`/get-session wiring are all in place and proven against real Postgres — plan 09-02 (authorization-helper admin bypass) can now import `isAccountAdmin` directly, and 09-03/09-04 (team routes) have the same primitive plus a session that already carries `accountRole` for the frontend's Team-screen visibility guard.
- No blockers or concerns for subsequent plans in this phase.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 8 created/modified files verified present on disk; all 4 task commit hashes (`5405cd9`, `a5169ce`, `fd2da8b`, `22f3936`) verified present in git history.
