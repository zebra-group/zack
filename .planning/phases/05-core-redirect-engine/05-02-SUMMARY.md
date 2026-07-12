---
phase: 05-core-redirect-engine
plan: 02
subsystem: api
tags: [prisma, bcryptjs, links, tdd, dto, password-gate, expiry, query-forwarding]

requires:
  - phase: 05-core-redirect-engine
    provides: "05-01: bcryptjs@3.0.3 installed, PASSWORD_HASH_COST env key with fail-safe default (11)"
  - phase: 04-links-management-bulk-import
    provides: "lib/links.ts's D-01 single-write-path core (validateLinkInput/createLink/updateLink/toLinkDto) — extended in place, never duplicated"
provides:
  - "Link.passwordHash/expiresAt/forwardQuery columns migrated + generated client regenerated"
  - "createLink/updateLink hash/persist password (bcrypt), expiry (UTC end-of-day), and forwardQuery through the single D-01 write path"
  - "toLinkDto exposes passwordProtected/expiresAt/forwardQuery, never passwordHash"
  - "LinkDTO/CreateLinkInput/UpdateLinkInput extended in @kurzly/shared with keep/clear/set semantics for password/expiresAt"
affects: [05-05-PLAN.md, 05-06-PLAN.md]

tech-stack:
  added: []
  patterns:
    - "derivePasswordHash/deriveExpiresAt: undefined=no-change, null=explicit-clear, value=set — same three-state discipline the title WR-02 fix established, now reused for password/expiresAt"
    - "PATCH route layer maps a blank-string password to undefined (\"keep\") before it reaches the D-01 core, mirroring the existing slug/title keep-vs-clear convention"

key-files:
  created:
    - apps/api/prisma/migrations/20260712143938_add_link_password_expiry_forwardquery/migration.sql
  modified:
    - apps/api/prisma/schema.prisma
    - apps/api/src/lib/links.ts
    - apps/api/src/routes/links.ts
    - packages/shared/src/index.ts
    - apps/api/test/links.integration.test.ts
    - apps/web/src/views/LinkDetailView.test.ts
    - apps/web/src/views/LinksView.test.ts

key-decisions:
  - "prisma migrate dev ran non-interactively for all three new columns (no confirmation-shaped warning) — confirms RESEARCH Pitfall 3's prediction that additive/nullable/defaulted columns don't trip the gate that Phase 3's ALTER TABLE case did; the migrate-diff/deploy workaround was not needed."
  - "PASSWORD_HASH_COST is read directly from process.env inside lib/links.ts (not via loadEnv()'s parsed object) — mirrors routes/domains.ts's computeVerificationTarget convention, so this module works under Vitest (which never calls loadEnv()) with the same default (11) env.ts's schema documents."
  - "A blank-string password on PATCH is mapped to undefined (\"keep\") in the route layer before calling updateLink, not inside lib/links.ts — keeps the D-01 core's three-state contract (undefined/null/value) uniform for both create and update callers, while the route owns the HTTP-specific \"empty field means no change\" UX convention."
  - "expiresAt's day-granularity end-of-day semantics resolved as UTC 23:59:59.999Z (RESEARCH's Claude's-discretion item) — simplest, most predictable choice for a self-hosted tool with no per-user timezone concept."

patterns-established:
  - "Three-state (undefined/null/value) keep-clear-set derivation pair (derivePasswordHash/deriveExpiresAt) as pure helper functions inside lib/links.ts, reused identically by both createLink and updateLink via the shared validateLinkInput core — the pattern 05-05/05-06 should follow for any further Link field additions."

requirements-completed: [REDIR-01, REDIR-03, REDIR-04]

coverage:
  - id: D1
    description: "Link.passwordHash/expiresAt/forwardQuery columns applied to real Postgres via a committed migration; generated Prisma client exposes all three"
    requirement: "REDIR-04"
    verification:
      - kind: other
        ref: "prisma migrate deploy applied 20260712143938_add_link_password_expiry_forwardquery at the start of every test run (test/globalSetup.ts); grep -c passwordHash apps/api/src/generated/prisma/models/Link.ts > 0"
        status: pass
      - kind: unit
        ref: "pnpm -r typecheck (clean across api/web/shared)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A link created with a password stores a bcrypt hash (never plaintext), through createLink; toLinkDto exposes only passwordProtected, never passwordHash"
    requirement: "REDIR-04"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'create with a password: stores a bcrypt hash...' + 'passwordHash never appears in any GET list/detail response body'"
        status: pass
    human_judgment: false
  - id: D3
    description: "expiresAt (UTC end-of-day) and forwardQuery persist and round-trip through the DTO; both default to null/false when omitted"
    requirement: "REDIR-03"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'create with expiresAt' + 'create without expiresAt' + 'create with forwardQuery:true' describe cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "Editing a link can set, keep, or clear its password/expiresAt/forwardQuery; keep is the default when the field is blank/omitted"
    requirement: "REDIR-01"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'update: an explicit password:null clears...' + 'update: blank/omitted password keeps...' + 'update: a new non-empty password re-hashes...' + 'update: expiresAt:null clears; omitted keeps; a new date sets' + 'update: forwardQuery omitted keeps current value; explicit true/false sets'"
        status: pass
    human_judgment: false
  - id: D5
    description: "No second prisma.link write call site introduced; all three fields flow only through createLink/updateLink (D-01)"
    requirement: "REDIR-01"
    verification:
      - kind: other
        ref: "grep -vE '^\\s*(//|\\*|/\\*)' apps/api/src/lib/links.ts | grep -c 'link\\.create(' = 1; same grep for 'link\\.update(' = 1; grep -c 'prisma\\.link\\.\\(create\\|update\\)' apps/api/src/routes/links.ts = 0 real call sites (1 hit is a comment)"
        status: pass
    human_judgment: false

duration: ~18min
completed: 2026-07-12
status: complete
---

# Phase 5 Plan 2: TDD Password/Expiry/ForwardQuery Data Model Summary

**Extended the Link model + the D-01 single validated write path with a bcrypt-hashed password, a UTC-end-of-day expiry date, and a per-link query-forwarding flag — all three flow exclusively through createLink/updateLink, hash never crosses the DTO boundary, proven by a RED->GREEN TDD cycle.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2 (1 blocking migration, 1 TDD)
- **Files modified:** 8 (1 migration created)

## Accomplishments

- Added `Link.passwordHash String?`, `Link.expiresAt DateTime?`, `Link.forwardQuery Boolean @default(false)` to the Prisma schema; `prisma migrate dev` applied the migration non-interactively (all three columns additive/nullable/defaulted — no confirmation-shaped warning fired), and `prisma generate` refreshed the generated client at `apps/api/src/generated/prisma`.
- Extended `lib/links.ts`'s D-01 single-write-path core: `derivePasswordHash`/`deriveExpiresAt` pure helpers implement the same undefined-no-change/null-clear/value-set three-state discipline the existing `title` field already established, wired into both `createLink` and `updateLink`'s data objects.
- `toLinkDto` now returns `passwordProtected: boolean`, `expiresAt: string | null`, `forwardQuery: boolean` — `passwordHash` is never read onto the returned object.
- Extended `createLinkSchema`/`updateLinkSchema` in `routes/links.ts` with the new allowlisted fields; the PATCH handler collapses a blank-string password to "keep" before calling `updateLink`.
- Extended `@kurzly/shared`'s `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` with the three fields and rebuilt the shared package.
- Wrote 10 new integration tests (RED) covering every `<behavior>` case in the plan (bcrypt hash never plaintext, no-leak DTO, UTC end-of-day, default/persist forwardQuery, keep/clear/set semantics for password/expiresAt/forwardQuery); all now pass (GREEN). Fixed two pre-existing `apps/web` test fixtures that broke because `LinkDTO` gained required fields.

## Task Commits

Each task was committed atomically:

1. **Task 1: [BLOCKING] Add three Link columns + migrate + regenerate client** - `0b3c40a` (feat)
2. **Task 2 RED: add failing tests for password/expiry/forwardQuery** - `0ceffd3` (test)
3. **Task 2 GREEN: hash+persist+expose password/expiry/forwardQuery** - `5792d51` (feat)

**Plan metadata:** commit created after this summary (docs: complete plan)

## Files Created/Modified

- `apps/api/prisma/schema.prisma` - Adds `passwordHash`/`expiresAt`/`forwardQuery` to `model Link`
- `apps/api/prisma/migrations/20260712143938_add_link_password_expiry_forwardquery/migration.sql` - The committed additive migration (`ALTER TABLE "Link" ADD COLUMN ...`)
- `apps/api/src/lib/links.ts` - `derivePasswordHash`/`deriveExpiresAt`/`resolvePasswordHashCost` helpers; `ValidatedLink`/`ValidateLinkInputParams` extended; `createLink`/`updateLink` data objects extended; `toLinkDto` extended
- `apps/api/src/routes/links.ts` - `createLinkSchema`/`updateLinkSchema` extended; PATCH handler's blank-password-to-keep mapping
- `packages/shared/src/index.ts` - `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` extended
- `apps/api/test/links.integration.test.ts` - 10 new tests under a new "Password/expiry/forwardQuery" describe block
- `apps/web/src/views/LinkDetailView.test.ts`, `apps/web/src/views/LinksView.test.ts` - `makeLink()` fixture factories given default values for the three new required `LinkDTO` fields (Rule 1 fix)

## Decisions Made

- `prisma migrate dev` ran non-interactively (RESEARCH Pitfall 3's prediction confirmed) — the `migrate diff`/`deploy` workaround from 03-01/04-02 remains an unused fallback for this plan.
- `PASSWORD_HASH_COST` read directly via `process.env` inside `lib/links.ts` (not `loadEnv()`), matching `routes/domains.ts`'s existing raw-env-read convention, with the identical default (11) `env.ts`'s schema documents.
- Blank-string-password-means-keep is a route-layer (HTTP-input) concern, mapped to `undefined` in `routes/links.ts` before calling `updateLink` — `lib/links.ts`'s core stays a clean three-state (`undefined`/`null`/value) contract for both create and update callers.
- `expiresAt` day-granularity resolves to UTC end-of-day (`23:59:59.999Z`) — the simplest, most predictable choice for a self-hosted tool with no per-user timezone model (RESEARCH left this to Planner's discretion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fallout] Fixed two pre-existing `apps/web` test fixtures broken by the `LinkDTO` extension**
- **Found during:** Task 2 GREEN verification (`pnpm -r typecheck`)
- **Issue:** `LinkDetailView.test.ts` and `LinksView.test.ts` each define a `makeLink(overrides): LinkDTO` fixture factory returning an object literal that didn't include the three new required `LinkDTO` fields (`passwordProtected`/`expiresAt`/`forwardQuery`), causing `tsc --noEmit` to fail with "Type ... is not assignable to type 'LinkDTO'".
- **Fix:** Added `passwordProtected: false, expiresAt: null, forwardQuery: false` as defaults in both `makeLink()` factories, before the `...overrides` spread (so tests can still override them).
- **Files modified:** `apps/web/src/views/LinkDetailView.test.ts`, `apps/web/src/views/LinksView.test.ts`
- **Verification:** `pnpm -r typecheck` clean; full apps/web test suite unaffected (fixture-only change).
- **Committed in:** `5792d51` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, test fixture fallout from the plan's own DTO extension)
**Impact on plan:** Necessary — the plan's own shared-DTO change would otherwise leave `apps/web`'s typecheck red. No scope creep; only the minimum default values needed to satisfy the new required fields were added.

## Issues Encountered

- The full `apps/api` test suite (163 tests, 18 files) showed 3-4 non-deterministic timeout failures across two consecutive runs, each time in a *different* set of files (`canary.integration.test.ts`, `tlsCheck.integration.test.ts`, `links-auto-slug-reserved.test.ts`, `auth.integration.test.ts`, `domains.integration.test.ts`) — none touching code this plan changed. Running `links.integration.test.ts` in isolation (57 tests) and the full suite a third time both came back 100% green, confirming this is pre-existing resource-contention flakiness (parallel Vitest workers sharing one testcontainers Postgres under WSL2/Docker overhead) rather than a regression introduced by this plan. Not fixed — out of this plan's scope per the Scope Boundary rule (pre-existing, unrelated to `files_modified`).

## User Setup Required

None - no external service configuration required. The migration is committed and self-applying (via `test/globalSetup.ts`'s `prisma migrate deploy` for tests, and the existing Docker/production migration-apply step for real deployments).

## Next Phase Readiness

- `Link.passwordHash`/`expiresAt`/`forwardQuery` are real, migrated, generated-client-typed columns ready for 05-05 (the redirect engine reads them to classify expired/protected/normal state) and 05-06 (the link create/edit form writes them via the now-extended `CreateLinkInput`/`UpdateLinkInput` DTOs).
- `toLinkDto`'s `passwordProtected`/`expiresAt`/`forwardQuery` fields are the exact shape 05-06's form needs to pre-populate an edit view without ever seeing the hash.
- No blockers for downstream Phase 5 plans (wave 2 of 4 complete for this plan).

---

*Phase: 05-core-redirect-engine*
*Completed: 2026-07-12*

## Self-Check: PASSED

All 8 created/modified files confirmed on disk (schema.prisma, migration.sql, lib/links.ts, routes/links.ts, shared/index.ts, links.integration.test.ts, LinkDetailView.test.ts, LinksView.test.ts) plus this SUMMARY.md. Task commits `0b3c40a` (Task 1 migration), `0ceffd3` (RED), `5792d51` (GREEN), and `0b4dd98` (docs summary) all confirmed in `git log`.
