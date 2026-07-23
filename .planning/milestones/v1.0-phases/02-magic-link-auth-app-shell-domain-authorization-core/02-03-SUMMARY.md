---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
plan: 03
subsystem: auth
tags: [prisma, postgres, authorization, rbac, domain-scoping]

# Dependency graph
requires:
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "02-02: Domain + DomainMembership Prisma schema (composite userId_domainId PK), applied to real Postgres, client regenerated at apps/api/src/generated/prisma"
provides:
  - "apps/api/src/lib/authorization.ts — ROLE_RANK (member<admin<owner), Role type, ForbiddenError, requireDomainAccess(prisma,userId,domainId,minRole), scopedDomainIds(prisma,userId) — the single frozen-signature server-side authorization path"
  - "apps/api/test/authorization.test.ts — six-case real-Postgres unit suite proving deny-by-default (D-02)"
affects: [03, 04, 05, 06, 07, 08, 09, authorization, links, qr-codes, analytics, domains, team]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Domain-scoped authorization funnels through requireDomainAccess/scopedDomainIds exclusively — no route may implement its own ad-hoc role check (D-02, frozen for Phases 3-9)"
    - "Unit tests seed rows directly via setupFileEach.ts's transaction-wrapped Prisma client (real Postgres, BEGIN/ROLLBACK per test) rather than mocking Prisma"

key-files:
  created:
    - apps/api/src/lib/authorization.ts
    - apps/api/test/authorization.test.ts
  modified: []

key-decisions:
  - "Signature frozen exactly as RESEARCH.md Pattern 4 specifies: (prisma, userId, domainId, minRole) / (prisma, userId) — no deviation, so Phases 3-9 can depend on it without churn"
  - "No Fastify route created to consume these helpers — zero callers in Phase 2 by design, correctness proven entirely by the unit suite"
  - "Skipped an empty REFACTOR commit — the GREEN implementation was already minimal and required no cleanup"

patterns-established:
  - "Any future domain-scoped route calls requireDomainAccess(prisma, userId, domainId, minRole) before touching domain-owned data, or scopedDomainIds(prisma, userId) to scope list queries"

requirements-completed: []

coverage:
  - id: D1
    description: "requireDomainAccess resolves when membership role rank >= minRole and throws ForbiddenError otherwise, including for unknown user/domain pairs (deny-by-default)"
    verification:
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#requireDomainAccess (4 cases: owner>=admin resolves, member<admin throws, admin==admin resolves, unknown pair throws)"
        status: pass
    human_judgment: false
  - id: D2
    description: "scopedDomainIds returns exactly the domain IDs a user is a member of, and an empty array for a user with no memberships"
    verification:
      - kind: unit
        ref: "apps/api/test/authorization.test.ts#scopedDomainIds (2 cases: two-domain membership set, zero-membership empty array)"
        status: pass
    human_judgment: false
  - id: D3
    description: "authorization.ts's TypeScript compiles cleanly against the generated Prisma client and the wider apps/api workspace"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-11
status: complete
---

# Phase 2 Plan 3: Domain-Scoped Authorization Core Summary

**Frozen-signature `requireDomainAccess`/`scopedDomainIds` helpers (deny-by-default, member<admin<owner rank hierarchy) proven by a six-case real-Postgres TDD suite, with zero route callers by design**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-11T14:22:00+02:00 (approx.)
- **Completed:** 2026-07-11T14:25:07+02:00
- **Tasks:** 1 (RED → GREEN)
- **Files modified:** 2 (1 new test file, 1 new lib file)

## Accomplishments

- Wrote `apps/api/test/authorization.test.ts` FIRST (RED): six behavior cases covering owner/admin/member rank comparisons, the equal-rank-allowed edge case, and deny-by-default for an unknown user/domain pair with no membership row, plus `scopedDomainIds`'s two-domain membership set and zero-membership empty-array cases. Confirmed RED via `Cannot find module '../src/lib/authorization.js'`.
- Implemented `apps/api/src/lib/authorization.ts` (GREEN): `ROLE_RANK = { member:0, admin:1, owner:2 } as const`, `type Role`, `ForbiddenError`, `requireDomainAccess(prisma,userId,domainId,minRole)` querying the composite `userId_domainId` unique key and throwing on null membership OR insufficient rank, `scopedDomainIds(prisma,userId)` mapping `findMany` results to a `string[]`. All six new tests pass; full suite (34 tests, 10 files) green.
- No REFACTOR commit needed — the GREEN implementation was already minimal and idiomatic (matches RESEARCH.md Pattern 4 near-verbatim).
- Confirmed zero callers exist in `apps/api/src` (grep for `authorization.js|requireDomainAccess|scopedDomainIds` outside the lib file itself returns nothing) — this phase builds the foundation only.

## Task Commits

Each gate was committed atomically:

1. **RED: failing real-Postgres unit suite** - `941cffd` (test)
2. **GREEN: requireDomainAccess/scopedDomainIds implementation** - `3d9d595` (feat)

**Plan metadata:** committed as part of this SUMMARY finalization

## TDD Gate Compliance

- RED gate commit: `941cffd` (`test(02-03): ...`) — precedes GREEN, confirmed test failure was "module not found" (not a false-positive passing test).
- GREEN gate commit: `3d9d595` (`feat(02-03): ...`) — all six new cases pass, full 34-test suite green.
- REFACTOR gate: skipped (no cleanup needed; implementation matched the researched pattern from first write).

## Files Created/Modified

- `apps/api/src/lib/authorization.ts` - `ROLE_RANK`, `Role`, `ForbiddenError`, `requireDomainAccess`, `scopedDomainIds` — the frozen-signature domain authorization core
- `apps/api/test/authorization.test.ts` - Real-Postgres unit suite (six cases) proving deny-by-default and correct rank comparisons

## Decisions Made

- Kept the helper signatures byte-identical to RESEARCH.md Pattern 4 and 02-PATTERNS.md's code sample — no deviation, since Phases 3–9 depend on this shape without churn.
- Deliberately created no Fastify route consuming these helpers (plan's explicit prohibition) — the unit suite is the sole correctness proof for this plan.
- User seed rows in the test suite use a per-test incrementing `id`/`email` suffix (`u_authz_N`, `authz-N@test.kurzly`) rather than fixed literals, avoiding any cross-test unique-constraint collision risk even though each test's writes are rolled back independently.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. This plan adds no new ENV keys and touches no infrastructure.

## Next Phase Readiness

- `requireDomainAccess(prisma, userId, domainId, minRole)` and `scopedDomainIds(prisma, userId)` are ready for Phase 3+ routes to call before touching any domain-scoped resource (Links, QR Codes, Analytics, Domains, Team).
- TEAM-06 (Phase 9) will prove this mechanism end-to-end against real routes; this plan proves the mechanism itself in isolation.
- No blockers for 02-04 (magic-link route mounting + integration tests), 02-05, or 02-06.

---
*Phase: 02-magic-link-auth-app-shell-domain-authorization-core*
*Completed: 2026-07-11*

## Self-Check: PASSED
