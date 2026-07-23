---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 04
subsystem: api
tags: [fastify, prisma, postgres, zod, transactions]

# Dependency graph
requires:
  - phase: 09-03
    provides: "lib/team.ts (toTeamMemberDto/listTeamMembers/inviteMember, typed-result convention), routes/team.ts (teamRoute factory, admin gate, resolveUserId), TeamMemberDTO/InviteMemberInput shared DTOs"
provides:
  - "lib/team.ts: assignMemberDomains (TEAM-03), changeMemberRole (TEAM-04, D-09-05 atomic promote-clear), removeMember (TEAM-05, D-09-06 schema-only cleanup)"
  - "countAdmins(tx): SELECT ... FOR UPDATE-locked admin count, the D-09-07 concurrency-safe lockout primitive"
  - "PATCH /api/team/:id/role, PUT /api/team/:id/domains, DELETE /api/team/:id — admin-gated, typed-error-mapped mutation routes"
  - "TeamErrorCode/UpdateMemberRoleInput/AssignDomainsInput shared DTOs (packages/shared)"
affects: [09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lockout-guard transaction: SELECT ... FOR UPDATE on the invariant-holding rows (accountRole=admin) inside the SAME prisma.$transaction as the guarded mutation, re-reading the target's CURRENT state inside the transaction rather than trusting a pre-transaction read — the concurrency-safe version of check-then-act for a 'last row of a type must survive' invariant"
    - "statusForTeamError mirrors routes/links.ts's statusForLinkError: a compile-time exhaustive switch over a shared TeamErrorCode mapping typed lib results to HTTP status + { error: code } body"

key-files:
  created:
    - apps/api/test/team-mutations.integration.test.ts
  modified:
    - packages/shared/src/index.ts
    - apps/api/src/lib/team.ts
    - apps/api/src/routes/team.ts

key-decisions:
  - "A plain count() re-asserted inside a prisma.$transaction, as the plan's action text literally describes, is NOT sufficient to prevent two concurrent demote/remove requests from both observing the same pre-mutation admin count under Postgres' default READ COMMITTED isolation (each transaction's own SELECT only sees the last COMMITTED state, never another transaction's in-flight write — two admins concurrently demoting two DIFFERENT admin rows would both see count===2 and both proceed). countAdmins(tx) instead issues a raw SELECT ... FOR UPDATE across every accountRole=admin row, so Postgres blocks the second transaction's lock acquisition until the first COMMITS and it re-reads the POST-mutation admin set. This is Rule 2 (missing critical functionality) — the plan's own T-09-LOCKOUT threat entry and success criteria demand the invariant hold under concurrency, not just serially, and a plain count does not deliver that guarantee."
  - "The demote/remove lockout guards re-read the target's CURRENT accountRole inside the transaction (tx.user.findUniqueOrThrow) rather than trusting the role read before the transaction opened — closes the same class of stale-read race for the target's own state, not just the admin count."
  - "removeMember's LAST_ADMIN guard does not special-case 'removing your own account' — it guards purely on the target id's current role and the live admin count, so 'admin removes another sole admin' and 'admin removes themselves as sole admin' both hit the identical code path (D-09-07's third case falls out of the general guard, not a separate branch)."

patterns-established:
  - "TeamErrorCode (packages/shared) is the one shared vocabulary for team-mutation failures across lib/team.ts, routes/team.ts, and (per UI-09-07) the frontend's ApiError.code — future team mutations should extend this enum rather than inventing ad hoc error strings."

requirements-completed: [TEAM-03, TEAM-04, TEAM-05]

coverage:
  - id: D1
    description: "assignMemberDomains replaces a member's DomainMembership set with exactly the given domainIds in one transaction; [] clears every assignment; an unknown domainId is rejected with INVALID_DOMAIN before any write"
    requirement: "TEAM-03"
    verification:
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#assignMemberDomains (TEAM-03) > replaces the target's domain set exactly, and clears it when passed []"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#assignMemberDomains (TEAM-03) > rejects an unknown domain id with INVALID_DOMAIN and makes no change"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PUT /api/team/:id/domains > assigns exactly the given domains as admin"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PUT /api/team/:id/domains > returns 400 INVALID_DOMAIN for an unknown domain id"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PUT /api/team/:id/domains > returns 403 for a non-admin member caller"
        status: pass
    human_judgment: false
  - id: D2
    description: "changeMemberRole promoting to admin deletes ALL the target's DomainMemberships and sets accountRole=admin in one transaction (D-09-05); demoting to member is refused with LAST_ADMIN if the target is the sole admin"
    requirement: "TEAM-04"
    verification:
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#changeMemberRole (TEAM-04, D-09-05) > promoting a member with domains to admin clears ALL domain memberships atomically"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#changeMemberRole (TEAM-04, D-09-05) > demoting the sole extra admin (two admins present) leaves them with zero domain assignments"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PATCH /api/team/:id/role > promotes a member as admin, clearing the target's domains"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PATCH /api/team/:id/role > returns 409 LAST_ADMIN and changes nothing when demoting the sole admin"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PATCH /api/team/:id/role > returns 403 for a non-admin member caller"
        status: pass
    human_judgment: false
  - id: D3
    description: "removeMember deletes the User row; a Link the removed user created survives with createdBy=null (D-09-06), relying entirely on the schema's Cascade/SetNull with no manual cleanup"
    requirement: "TEAM-05"
    verification:
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#removeMember (TEAM-05, D-09-06) > deletes the User row and cascades away their DomainMembership rows"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#removeMember (TEAM-05, D-09-06) > preserves a removed user's created Link with createdBy set to null (D-09-06)"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#DELETE /api/team/:id > removes a user as admin (204)"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#DELETE /api/team/:id > returns 403 for a non-admin member caller"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-09-07 lockout guards: removing/demoting the last admin returns LAST_ADMIN and changes nothing; with two admins, removing or demoting either succeeds; the guard is concurrency-safe (FOR UPDATE-locked count), proven by firing two demote requests simultaneously and asserting exactly one succeeds"
    verification:
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#Lockout guards (D-09-07) > removeMember on the only admin returns LAST_ADMIN and deletes nothing"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#Lockout guards (D-09-07) > changeMemberRole('member') on the only admin returns LAST_ADMIN and changes nothing"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#Lockout guards (D-09-07) > with two admins, removing one succeeds and the other remains the sole admin"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#Lockout guards (D-09-07) > with two admins, demoting one succeeds and the other remains admin"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#Lockout guards (D-09-07) > never lets two concurrent demote requests both succeed and leave zero admins"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#DELETE /api/team/:id > returns 409 LAST_ADMIN and deletes nothing when removing the sole admin"
        status: pass
    human_judgment: false
  - id: D5
    description: "All three mutation routes are account-admin-gated (401/403), NOT_FOUND targets return 404, and request bodies are Zod-allowlisted (never reaching Prisma directly)"
    verification:
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#assignMemberDomains (TEAM-03) > returns NOT_FOUND for an unknown target id"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#changeMemberRole (TEAM-04, D-09-05) > returns NOT_FOUND for an unknown target id"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#removeMember (TEAM-05, D-09-06) > returns NOT_FOUND for an unknown target id"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PATCH /api/team/:id/role > returns 404 for an unknown target id"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#PATCH /api/team/:id/role > returns 401 with no session"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#DELETE /api/team/:id > returns 404 for an unknown target id"
        status: pass
      - kind: integration
        ref: "apps/api/test/team-mutations.integration.test.ts#DELETE /api/team/:id > returns 401 with no session"
        status: pass

# Metrics
duration: 19min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 4: Team Mutations (Assign / Role / Remove) + Lockout Guards Summary

**Assign/promote/remove team mutations on top of 09-03's `lib/team.ts`, with promote-to-admin clearing domain assignments in one transaction (D-09-05) and D-09-07's lockout guards made genuinely concurrency-safe via `SELECT ... FOR UPDATE`, not just a transaction-wrapped count**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-07-23T09:19:00+02:00
- **Completed:** 2026-07-23T09:38:00+02:00
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Added `TeamErrorCode`, `UpdateMemberRoleInput`, `AssignDomainsInput` to `packages/shared` — one shared vocabulary for team-mutation failures across the API and (per UI-09-07) the frontend's `ApiError.code`.
- Extended `apps/api/src/lib/team.ts` with `assignMemberDomains` (TEAM-03, replace-exactly semantics), `changeMemberRole` (TEAM-04, D-09-05 atomic promote-clear via one `prisma.$transaction`), and `removeMember` (TEAM-05, D-09-06 — deletes the `User` row and trusts the schema's `Link.creator onDelete:SetNull` / `DomainMembership onDelete:Cascade` entirely, no manual cleanup query).
- Built `countAdmins(tx)` on a raw `SELECT id FROM "user" WHERE "accountRole" = 'admin'::"AccountRole" FOR UPDATE` rather than a plain `count()` — the row-locking mechanism that actually delivers the "at least one admin remains, even under concurrency" guarantee the plan's threat model (T-09-LOCKOUT) and success criteria require (see Deviations).
- Extended `apps/api/src/routes/team.ts` with `PATCH /:id/role`, `PUT /:id/domains`, `DELETE /:id`, all admin-gated via the existing `isAccountAdmin` gate, Zod-allowlisted, and mapped through a new `statusForTeamError` (mirrors `routes/links.ts`'s `statusForLinkError`) — `NOT_FOUND`→404, `LAST_ADMIN`→409, `INVALID_DOMAIN`→400, with a compile-time exhaustive `never` default.
- Created `apps/api/test/team-mutations.integration.test.ts` (a new file, 09-03's `team.integration.test.ts` untouched) — 25 cases total: 14 direct `lib/team.ts` calls (Task 1) plus 11 `app.inject` route-level cases (Task 2), including a genuine two-concurrent-requests test proving the FOR UPDATE lock (not just a serial check) enforces the lockout invariant.

## Task Commits

Each task followed RED → GREEN, with genuine RED verified by stashing only the implementation file, running the suite, and confirming every new case failed before restoring it:

1. **Task 1: lib/team.ts mutations — assign domains, change role (promote clears), remove, lockout guards**
   - `c40d44d` test(09-04): failing assign/role/remove/lockout cases (14/14 failed with "is not a function")
   - `6d5ffe6` feat(09-04): team mutations with atomic promote-clear and lockout guards (all 487 tests pass)
2. **Task 2: PATCH role / PUT domains / DELETE member routes with admin gate + typed-error status mapping**
   - `842a381` test(09-04): failing team mutation route cases (11/11 failed with 404)
   - `590da52` feat(09-04): PATCH role / PUT domains / DELETE member routes with typed-error mapping (all 500 tests pass)

## Files Created/Modified
- `packages/shared/src/index.ts` - `TeamErrorCode`, `UpdateMemberRoleInput`, `AssignDomainsInput`
- `apps/api/src/lib/team.ts` - `countAdmins` (FOR UPDATE-locked), `assignMemberDomains`, `changeMemberRole`, `removeMember`
- `apps/api/src/routes/team.ts` - `PATCH /api/team/:id/role`, `PUT /api/team/:id/domains`, `DELETE /api/team/:id`, `statusForTeamError`
- `apps/api/test/team-mutations.integration.test.ts` - 25-case suite (14 lib-level + 11 route-level), including a real concurrent-demote race test

## Decisions Made
- **The plan's literal mechanism ("count re-asserted inside the same `prisma.$transaction`") does not actually close the race it describes.** Under Postgres' default READ COMMITTED isolation, two concurrent transactions each demoting/removing a DIFFERENT admin row would both run their `count()` before either commits and both see the pre-mutation count — the exact "two concurrent requests both observe count===2" failure the plan's own text says must not happen. `countAdmins(tx)` instead locks every `accountRole="admin"` row with `SELECT ... FOR UPDATE`, so Postgres blocks the second transaction until the first commits, and it re-reads the post-mutation admin set. Verified with a real concurrent-request test (`Promise.all` of two demotes against a real Postgres testcontainer), not just sequential calls.
- `removeMember`'s guard makes no distinction between "removing someone else's sole-admin account" and "removing your own account while sole admin" — both are the same code path (current role + live admin count), which is what the route layer relies on to cover D-09-07's third lockout case without any caller-vs-target special-casing.
- `assignMemberDomains` places no guard on assigning domains to an `accountRole: "admin"` target — not specified as an error case by the plan (an admin's domain array is simply ignored everywhere it's read, per D-09-02), and the UI never offers domain assignment for an admin role in the first place.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `countAdmins` uses `SELECT ... FOR UPDATE` instead of a plain `count()`**
- **Found during:** Task 1 (lib/team.ts mutations)
- **Issue:** The plan's action text specifies "the count is asserted inside the same transaction as the mutation" as the concurrency-safety mechanism. A plain `prisma.user.count()` inside a `$transaction`, even re-asserted, does not prevent two concurrent transactions from both observing the same pre-mutation count under Postgres' default READ COMMITTED isolation when the two transactions write to different rows (e.g., two admins each demoting a different admin) — each transaction's own `SELECT` only ever sees the last COMMITTED state, never a concurrent transaction's in-flight write. This directly contradicts the plan's own explicit correctness requirement ("two concurrent demote/remove requests cannot each observe count===2 and both proceed") and the threat model's T-09-LOCKOUT entry (severity: high, disposition: mitigate).
- **Fix:** `countAdmins(tx)` issues a raw parameterized `SELECT id FROM "user" WHERE "accountRole" = 'admin'::"AccountRole" FOR UPDATE` (mirrors `lib/analytics.ts`'s existing `Prisma.sql`/enum-cast raw-query precedent) instead of `prisma.user.count()`. `FOR UPDATE` forces Postgres to block the second transaction's lock acquisition until the first commits, so the second transaction's count reflects the post-mutation admin set.
- **Files modified:** `apps/api/src/lib/team.ts`
- **Verification:** A dedicated test fires two concurrent `changeMemberRole(..., "member")` calls (via `Promise.all`) against two real admins in a real Postgres testcontainer and asserts exactly one succeeds, the other returns `LAST_ADMIN`, and exactly one admin remains afterward.
- **Committed in:** `6d5ffe6` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical — concurrency-safety correctness)
**Impact on plan:** The fix strengthens the exact guarantee the plan itself specifies (T-09-LOCKOUT, high severity) without changing the function signatures, typed-result shapes, or route contracts the plan describes. No scope creep — the change is internal to `countAdmins`'s implementation.

## Issues Encountered

None — `pnpm --filter @kurzly/shared build`, `pnpm -r exec tsc --noEmit`, and the full API suite (39 files / 500 tests) were all clean on the first GREEN run of each task, with zero regressions across auth/domains/links/qr/analytics/authorization/team suites.

## User Setup Required

None - no external service configuration required; this plan adds no new environment variables, dependencies, or dashboard steps.

## Next Phase Readiness

- `lib/team.ts` now exposes the full TEAM-01..05 mutation surface (`listTeamMembers`, `inviteMember`, `assignMemberDomains`, `changeMemberRole`, `removeMember`) and `routes/team.ts` exposes the full `GET/POST/PATCH/PUT/DELETE /api/team*` route surface — later plans (09-05+, the frontend TeamView) can consume this directly without further backend changes for TEAM-01..05.
- `TeamErrorCode` is the fixed vocabulary the frontend's `ApiError.code`-driven inline messaging (UI-09-07) should switch on; no new error codes were introduced beyond `NOT_FOUND`/`LAST_ADMIN`/`INVALID_DOMAIN`.
- No blockers or concerns for subsequent plans.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 5 created/modified files verified present on disk; all 4 task commit hashes (`c40d44d`, `6d5ffe6`, `842a381`, `590da52`) verified present in git history.
