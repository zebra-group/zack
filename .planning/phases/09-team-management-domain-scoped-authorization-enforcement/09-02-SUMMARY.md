---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 02
subsystem: api
tags: [authorization, prisma, postgres, accountRole]

# Dependency graph
requires:
  - phase: 09-team-management-domain-scoped-authorization-enforcement
    provides: "AccountRole enum, User.accountRole column, isAccountAdmin(prisma, userId) primitive (09-01)"
provides:
  - "requireDomainAccess/scopedDomainIds admin-bypass branches (D-09-02) — the admin half of TEAM-06, inherited by every existing Link/QR/Analytics call site with zero route edits"
  - "Real-Postgres regression proof that a plain Member's domain scoping is unchanged by the admin bypass"
affects: [09-03, 09-04, 09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Account-admin bypass checked FIRST inside the two frozen authorization helpers, before any membership lookup — the single-choke-point pattern D-09-02 establishes for any future installation-wide-vs-scoped rule"
    - "Test fixtures for per-domain-scoping suites must use a plain prisma.user.upsert (default accountRole=member), never seedInitialAdmin, once accountRole has real behavioural effect"

key-files:
  created: []
  modified:
    - apps/api/src/lib/authorization.ts
    - apps/api/test/authorization.test.ts
    - apps/api/test/analytics.test.ts
    - apps/api/test/domains.integration.test.ts
    - apps/api/test/links-import.integration.test.ts
    - apps/api/test/qrCodes.integration.test.ts

key-decisions:
  - "Both requireDomainAccess and scopedDomainIds gate on isAccountAdmin FIRST, returning/short-circuiting before touching DomainMembership at all — a non-admin falls through completely unchanged to the pre-existing deny-by-default/CR-01 logic"
  - "The admin bypass in requireDomainAccess grants regardless of whether domainId even refers to a real Domain row (per plan text: 'grant, regardless of domainId/minRole') — resource-existence checking is deliberately NOT this helper's job, matching its pre-existing authorization-only contract"
  - "Discovered and fixed a fixture-reuse regression, NOT an authorization bug: four pre-existing integration suites (analytics, domains, links CSV import, QR codes) called seedInitialAdmin() purely as a generic 'create + verify a test user' convenience helper. Since 09-01 that always sets accountRole=admin, which had zero effect until this plan's bypass gave it teeth — silently turning those fixtures into unintended account-wide admins and defeating the very per-domain scoping the suites were written to prove. Fixed by switching each to a plain prisma.user.upsert (accountRole defaults to member), matching the pattern already used for those files' outsider/second-user fixtures."

patterns-established:
  - "D-09-02 admin-bypass-first pattern inside requireDomainAccess/scopedDomainIds — any future installation-wide capability that must reach every domain should gate the same way, before the per-domain check"
  - "Never reuse seedInitialAdmin() as a generic authenticated-test-user helper in a per-domain-scoping test — use a plain prisma.user.upsert so the fixture stays a non-privileged member"

requirements-completed: [TEAM-06]

coverage:
  - id: D1
    description: "requireDomainAccess grants an account-admin access to any domain (with or without membership), at any minRole"
    requirement: "TEAM-06"
    verification:
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#account-admin bypass (D-09-02) requireDomainAccess resolves for an account-admin on a domain they hold NO membership on, at minRole 'admin'"
        status: pass
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#account-admin bypass (D-09-02) requireDomainAccess resolves for an account-admin on a domain they hold NO membership on, at minRole 'member'"
        status: pass
    human_judgment: false
  - id: D2
    description: "scopedDomainIds returns every domain id for an account-admin, including domains they hold no membership on"
    requirement: "TEAM-06"
    verification:
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#account-admin bypass (D-09-02) scopedDomainIds returns EVERY domain id for an account-admin, including domains they hold no membership on"
        status: pass
    human_judgment: false
  - id: D3
    description: "A plain member's behaviour is provably unchanged: requireDomainAccess still denies an unassigned domain, and scopedDomainIds still returns exactly their own memberships, never all domains"
    requirement: "TEAM-06"
    verification:
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#account-admin bypass (D-09-02) member-unchanged regression: still throws ForbiddenError for a plain member on a domain they hold no membership on"
        status: pass
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#account-admin bypass (D-09-02) member-unchanged regression: scopedDomainIds still returns EXACTLY a member's own memberships, never all domains"
        status: pass
      - kind: integration
        ref: "full apps/api suite (37 files / 464 tests) via `rtk proxy npx vitest run` — all pre-existing links/qr/analytics/domains integration suites green"
        status: pass
    human_judgment: false
  - id: D4
    description: "Frozen (prisma,userId,domainId,minRole) / (prisma,userId) signatures preserved — no route caller changed"
    requirement: "TEAM-06"
    verification:
      - kind: other
        ref: "manual read-through of apps/api/src/lib/authorization.ts — signatures byte-identical; grep for requireDomainAccess/scopedDomainIds call sites shows zero route file changes in this plan's diff"
        status: pass
    human_judgment: false

# Metrics
duration: 16min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 2: Account-Admin Authorization Bypass Summary

**Account-admin bypass added inside `requireDomainAccess`/`scopedDomainIds` (D-09-02) — an installation-wide admin now transparently reaches every domain across every existing Link/QR/Analytics endpoint, with zero route edits, while a plain Member's scoping is proven byte-for-byte unchanged**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-07-23T08:36:00+02:00
- **Completed:** 2026-07-23T08:52:00+02:00
- **Tasks:** 1
- **Files modified:** 6 (2 in the plan's own scope, 4 as a Rule 1/3 deviation fix)

## Accomplishments
- `requireDomainAccess` and `scopedDomainIds` each gate on `isAccountAdmin(prisma, userId)` FIRST — an account-admin resolves/returns immediately, before any `DomainMembership` lookup, so `lib/links.ts`, `lib/qrCodes.ts`, and `routes/analytics.ts` all inherit the admin bypass with zero route edits.
- Extended `apps/api/test/authorization.test.ts` with a `describe("account-admin bypass (D-09-02)")` block: admin-grant cases at both `minRole` values, an admin `scopedDomainIds` "every domain id" case, and the two mandatory member-unchanged regression cases.
- Found and fixed a real fixture-reuse regression surfaced by turning the bypass on: four pre-existing integration suites were unknowingly running their "domain-scoped owner" fixture as a real account-admin (via `seedInitialAdmin`), silently defeating their own per-domain scoping assertions. Restored each to a plain non-admin fixture.
- Full `apps/api` suite (37 files / 464 tests) green; `pnpm -r exec tsc --noEmit` clean.

## Task Commits

1. **Task 1: Account-admin bypass inside requireDomainAccess and scopedDomainIds**
   - `a08dd02` test(09-02): failing account-admin bypass + member-unchanged regression cases
   - `ddc8243` feat(09-02): account-admin bypass in requireDomainAccess/scopedDomainIds
   - `0573bfc` fix(09-02): stop reusing seedInitialAdmin as a plain test-user fixture (deviation, see below)

## Files Created/Modified
- `apps/api/src/lib/authorization.ts` - Admin-bypass branch added at the top of both `requireDomainAccess` and `scopedDomainIds`, gated on `isAccountAdmin`; header comment updated to document D-09-02
- `apps/api/test/authorization.test.ts` - `seedAdminUser` fixture + `describe("account-admin bypass (D-09-02)")` covering grant/scope-all/member-unchanged cases
- `apps/api/test/analytics.test.ts` - `OWNER_EMAIL` fixture switched from `seedInitialAdmin` to a plain `prisma.user.upsert` (member)
- `apps/api/test/domains.integration.test.ts` - `ADMIN_EMAIL` fixture switched from `seedInitialAdmin` to a plain `prisma.user.upsert` (member)
- `apps/api/test/links-import.integration.test.ts` - `OWNER_EMAIL` fixture switched from `seedInitialAdmin` to a plain `prisma.user.upsert` (member)
- `apps/api/test/qrCodes.integration.test.ts` - `ROUTE_OWNER_EMAIL` fixture switched from `seedInitialAdmin` to a plain `prisma.user.upsert` (member)

## Decisions Made
- The admin bypass in `requireDomainAccess` grants unconditionally once `isAccountAdmin` resolves true — it does not additionally verify the target `domainId` refers to a real `Domain` row. This matches the plan's literal instruction ("grant, regardless of domainId/minRole") and preserves the helper's existing scope (authorization only, never resource-existence checking) — that responsibility already belonged to callers before this plan and still does.
- Both bypass branches are placed as the very first statement in each function, before any Prisma query against `DomainMembership`, so the non-admin path is textually and behaviourally identical to the pre-09-02 code below the new branch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / Rule 3 - Blocking] Fixed four integration suites conflating `seedInitialAdmin` with a plain per-domain test fixture**
- **Found during:** Task 1's plan-mandated verification step (`pnpm --filter @kurzly/api test` full suite)
- **Issue:** `apps/api/test/analytics.test.ts`, `domains.integration.test.ts`, `links-import.integration.test.ts`, and `qrCodes.integration.test.ts` each called `seedInitialAdmin(prisma, EMAIL)` purely as a "create + magic-link-verify an authenticated test user" convenience helper — a pattern that predates the `AccountRole` concept entirely. Since plan 09-01, `seedInitialAdmin` always sets `accountRole: "admin"` (the D-09-07 lockout-guard precondition), which had zero observable effect until this plan's bypass gave `accountRole` real behavioural teeth. The moment the bypass landed, these four fixtures became unintended account-wide admins, and 5 pre-existing assertions started failing/silently-passing-for-the-wrong-reason: `GET /api/analytics` returned the whole instance's click count instead of the caller's own domain; `POST /api/domains/:id/verify` for a nonexistent domain id 500'd instead of 403'ing (the admin bypass short-circuits before any domain-existence check, exposing a downstream null-domain path the deny-by-default membership check had always shielded); the CSV import's `domain_unauthorized` skip reason stopped firing for a foreign domain; and `GET /api/qr-codes` started listing another domain's QR codes.
- **Fix:** Replaced each `seedInitialAdmin(prisma, EMAIL)` call with a plain `prisma.user.upsert({ ..., create: { ..., emailVerified: true } })` — identical shape to the already-established pattern used for these same files' "outsider"/"second user" fixtures — so `accountRole` defaults to `"member"` (schema default) and the fixture stays a non-privileged, per-domain-scoped test user, matching each suite's original intent.
- **Files modified:** `apps/api/test/analytics.test.ts`, `apps/api/test/domains.integration.test.ts`, `apps/api/test/links-import.integration.test.ts`, `apps/api/test/qrCodes.integration.test.ts`
- **Verification:** Full `apps/api` suite green (37 files / 464 tests via `rtk proxy npx vitest run`); `pnpm -r exec tsc --noEmit` clean.
- **Committed in:** `0573bfc`

---

**Total deviations:** 1 auto-fixed (4 files, one root cause: fixture-reuse regression exposed by the admin bypass going live)
**Impact on plan:** Necessary to satisfy the plan's own explicit verification requirement ("the existing links/qr/analytics/domains integration suites must still pass, proving the bypass did not break member scoping at real call sites"). No production authorization logic was touched by this fix — only test fixture seeding in four test files. No route file was edited, honoring the plan's explicit constraint.

## Issues Encountered
None beyond the deviation documented above — no further problems during the RED/GREEN cycle, the full-suite verification, or the type-check.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `requireDomainAccess`/`scopedDomainIds` now enforce the full TEAM-06 admin-and-member contract across every Link/QR/Analytics endpoint, proven against real Postgres. Plans 09-03 onward (team routes, invite flow, role changes) can rely on this as settled, tested infrastructure.
- No blockers or concerns for subsequent plans in this phase. Note for any future plan touching `seedInitialAdmin`-based test fixtures elsewhere in the suite: if a fixture's ONLY purpose is "an authenticated non-privileged test user," seed it with a plain `prisma.user.upsert`, not `seedInitialAdmin` — the latter is reserved for testing the actual bootstrap/admin-seeding behaviour itself.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 6 created/modified files verified present on disk; all 3 task commit hashes (`a08dd02`, `ddc8243`, `0573bfc`) verified present in git history.
