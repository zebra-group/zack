---
phase: 04-links-management-bulk-import
plan: 02
subsystem: api
tags: [prisma, fastify, zod, nanoid, links, authorization]

# Dependency graph
requires:
  - phase: 04-links-management-bulk-import
    provides: "04-01: csv-parse@7.0.1 + nanoid@5.1.16 installed and proven ESM-resolvable in apps/api"
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "requireDomainAccess/scopedDomainIds frozen signatures (apps/api/src/lib/authorization.ts)"
  - phase: 03-domains-multi-domain-tls-routing
    provides: "domainsRoute route-factory pattern, isUniqueConstraintViolation P2002 check, migrate-diff/deploy workaround precedent"
provides:
  - "Link model (domainId FK cascade, createdBy FK SetNull, @@unique([domainId, slug]), @@index([domainId])) migrated to real Postgres, generated client regenerated"
  - "Six shared DTOs: LinkDTO, CreateLinkInput, UpdateLinkInput, LinkSkipReason, ImportRowResult, ImportPreviewResult, ImportCommitResult"
  - "apps/api/src/lib/links.ts — the D-01 single-write-path core: validateLinkInput (pure gate) + createLink (sole insert site) + previewLink (validate-only) + updateLink (sole update site) + generateSlug/RESERVED_SLUGS/validateTargetUrl/toLinkDto/isUniqueConstraintViolation"
  - "POST/GET /api/links wired into app.ts (linksRoute factory) — manual create (auto or custom slug) and scoped/searchable list"
  - "LINK_CREATE_RATE_LIMIT + LINK_IMPORT_RATE_LIMIT rate-limit consts for this and later Phase 4 plans"
affects: [04-03-PLAN.md, 04-04-PLAN.md, 04-05-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-01 single-write-path core: one pure validateLinkInput gate (authorize -> validate target -> resolve slug, zero writes) that every write path (createLink/previewLink/updateLink) routes through — grep-provable as exactly one prisma.link.create call site"
    - "Reserved-slug allowlist hand-maintained as a Set<string> sourced from the real Fastify + Vue Router route tables, not dynamically introspected"

key-files:
  created:
    - apps/api/src/lib/links.ts
    - apps/api/src/routes/links.ts
    - apps/api/test/links.integration.test.ts
    - apps/api/prisma/migrations/20260711195142_add_link_model/migration.sql
  modified:
    - apps/api/prisma/schema.prisma
    - packages/shared/src/index.ts
    - apps/api/src/plugins/rateLimit.ts
    - apps/api/src/app.ts

key-decisions:
  - "prisma migrate dev ran non-interactively without needing the migrate-diff/deploy workaround this time — the Link table is a fresh CREATE TABLE with no confirmation-shaped warning (unlike Phase 3's 03-01 ALTER TABLE case), so the direct path worked; the diff/deploy fallback documented in STATE.md remains the known escape hatch for future ALTER-shaped migrations."
  - "GET /api/links: an out-of-scope ?domainId= silently narrows to [] rather than 403ing — matches GET /api/domains's existing 'scope silently, never leak' convention (never discloses which domain IDs exist to a non-member)."
  - "resolveSlug's custom-slug shape-check failure (regex/length) is reported as SLUG_RESERVED (400), not a separate error code — the plan's LinkErrorCode union has no dedicated 'malformed slug' code, and both cases are equally 'this slug cannot be used', so re-using SLUG_RESERVED avoids growing the union beyond what the plan specified."
  - "updateLink (04-03's future entry point) and its NOT_FOUND-signal shape were built now, in the D-01 core, rather than deferred — the plan's must_haves truth explicitly requires createLink/previewLink/updateLink to all call validateLinkInput this plan, even though no route calls updateLink yet."

patterns-established:
  - "Route factory + resolveUserId + Zod-allowlist-body + LinkErrorCode-to-status mapping — the template 04-03 (edit/delete) and 04-04 (CSV import) reuse directly."

requirements-completed: [LINK-01, LINK-02, LINK-03]

coverage:
  - id: D1
    description: "Link model applied to real Postgres via a committed migration; generated Prisma client exposes the Link model"
    requirement: "LINK-01"
    verification:
      - kind: other
        ref: "prisma migrate deploy applied 20260711195142_add_link_model to the testcontainers Postgres at the start of every test run (test/globalSetup.ts); grep -c slug apps/api/src/generated/prisma/models/Link.ts > 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "validateLinkInput is the sole pure validation core (zero DB writes); createLink is the sole prisma.link.create call site; previewLink is validate-only; updateLink is the sole prisma.link.update call site"
    requirement: "LINK-01"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'validateLinkInput (D-01 pure core)' + 'createLink / previewLink write behavior (D-01)' describe blocks"
        status: pass
      - kind: other
        ref: "test \"$(grep -vE '^\\s*(//|\\*|/\\*)' apps/api/src/lib/links.ts | grep -c 'link\\.create(')\" = \"1\""
        status: pass
    human_judgment: false
  - id: D3
    description: "POST /api/links creates a link for a member+ caller (blank slug auto-generates Base62, custom slug validated/reserved-checked/collision-checked); reserved slugs and non-http(s) schemes are rejected; cross-domain create is denied"
    requirement: "LINK-02"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'POST /api/links (route layer)' describe block (blank/custom slug 201, 401/403/400/409, mass-assignment resistance)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/links returns only links in the caller's scopedDomainIds, filtered by optional ?q= and ?domainId= (out-of-scope domainId yields [])"
    requirement: "LINK-03"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'GET /api/links (route layer)' describe block (scoping, ?domainId= narrow, ?q= search, 401)"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-11
status: complete
---

# Phase 4 Plan 02: Link Foundation — Model, D-01 Core, Create/List Routes Summary

**Link model migrated to Postgres, a structurally-enforced single-write-path core (validateLinkInput -> createLink/previewLink/updateLink, exactly one insert site), and POST/GET /api/links delivering the first working "create + search my links" capability.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-11T21:48:16Z
- **Completed:** 2026-07-11T22:01:55Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- `Link` model (id, domainId FK cascade, slug, targetUrl, title?, createdBy FK SetNull, timestamps, `@@unique([domainId, slug])`, `@@index([domainId])`) migrated to real Postgres via a committed migration and regenerated into the Prisma client
- Six shared DTOs (`LinkDTO`, `CreateLinkInput`, `UpdateLinkInput`, `LinkSkipReason`, `ImportRowResult`, `ImportPreviewResult`, `ImportCommitResult`) added to `packages/shared`, unblocking 04-03/04-04's UI and import work
- `apps/api/src/lib/links.ts` built: `validateLinkInput` (pure gate: `requireDomainAccess` member+ -> http(s)-only `targetUrl` via Zod `z.url()` -> Base62 auto-slug or custom-slug shape/reserved/collision check), `createLink` (the sole `prisma.link.create` call site, P2002 -> `SLUG_TAKEN` safety net), `previewLink` (validate-only), `updateLink` (the sole `prisma.link.update` call site, `excludeLinkId`-aware)
- `POST /api/links` (auto or custom slug, member+-gated, Zod body allowlist against mass-assignment) and `GET /api/links` (scoped via `scopedDomainIds`, `?domainId=`/`?q=` filters) wired into `app.ts` after `domainsRoute`/`tlsCheckRoute` and before the redirect stub
- 21 new integration tests (13 core, 13 route — some overlap in setup) added to `apps/api/test/links.integration.test.ts`, all green against real testcontainers Postgres; full `apps/api` suite (115 tests) and workspace-wide `tsc --noEmit` both green

## Task Commits

Each task was committed atomically (Task 2 and Task 3 as TDD RED/GREEN pairs per this plan's `type: tdd`):

1. **Task 1 [BLOCKING]: Link schema + migration + regenerate client + shared DTOs + rate-limit consts** - `350ea64` (feat)
2. **Task 2: lib/links.ts — the D-01 single-write-path core** - `5922fd0` (test, RED) + `993b6cf` (feat, GREEN)
3. **Task 3: routes/links.ts POST create + GET list/search/filter, wire app.ts** - `c8ed8ba` (test, RED) + `721c5c2` (feat, GREEN)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/prisma/schema.prisma` - added `Link` model + back-relations on `Domain`/`User`
- `apps/api/prisma/migrations/20260711195142_add_link_model/migration.sql` - `CREATE TABLE "Link"` + unique index over `(domainId, slug)` + FKs
- `packages/shared/src/index.ts` - six new DTOs for links + import
- `apps/api/src/plugins/rateLimit.ts` - `LINK_CREATE_RATE_LIMIT`, `LINK_IMPORT_RATE_LIMIT`
- `apps/api/src/lib/links.ts` - the D-01 core (new file)
- `apps/api/src/routes/links.ts` - `linksRoute(prisma, auth)` factory (new file)
- `apps/api/src/app.ts` - registers `linksRoute` after domains/tls-check, before the redirect stub
- `apps/api/test/links.integration.test.ts` - LINK-01/02/03 real-Postgres suite (new file)

## Decisions Made
- `prisma migrate dev` succeeded non-interactively for this additive `CREATE TABLE` (no confirmation-shaped warning), so the Phase-3-documented `migrate diff`/`migrate deploy` workaround wasn't needed this time — kept as the known fallback for future `ALTER TABLE`-shaped migrations.
- `GET /api/links` silently narrows an out-of-scope `?domainId=` to `[]` rather than 403ing, matching `GET /api/domains`'s existing "scope silently, never leak" convention.
- A malformed custom slug (fails the `[a-zA-Z0-9_-]{2,32}` shape check) is reported as `SLUG_RESERVED` (400) rather than a new error code, since the plan's `LinkErrorCode` union has no dedicated "malformed" variant and both are "this slug cannot be used."
- `updateLink` was built now (not deferred to 04-03) because the plan's `must_haves` truth explicitly requires `createLink`/`previewLink`/`updateLink` to all route through `validateLinkInput` in this plan — 04-03 will add the `PATCH` route that calls it, no route calls it yet.

## Deviations from Plan

None - plan executed exactly as written. `updateLink`'s presence (rather than a stub) is an explicit `must_haves` requirement of this plan, not a deviation.

## Issues Encountered
None. `.env`/`.env.example` at the repo root are permission-denied to this agent's Read tool; migration authoring instead used a throwaway `postgres:18-alpine` Docker container (`docker run` with inline credentials, port 5433) exactly as 03-01's documented workaround pattern anticipated, then removed after `prisma generate` completed — no `.env` access was needed.

## User Setup Required
None - no external service configuration required. The committed migration applies automatically via `prisma migrate deploy` on next boot/CI run, exactly like the three prior migrations.

## Next Phase Readiness
- 04-03 (edit/delete + detail view) can call `updateLink` directly — it already exists and is tested.
- 04-04 (CSV bulk import) can call `createLink` row-by-row and `previewLink` for the dry-run — both are proven single-write-path-safe; `LINK_IMPORT_RATE_LIMIT` is already in place.
- No blockers or concerns carried forward.

---
*Phase: 04-links-management-bulk-import*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: apps/api/src/lib/links.ts
- FOUND: apps/api/src/routes/links.ts
- FOUND: apps/api/test/links.integration.test.ts
- FOUND: apps/api/prisma/migrations/20260711195142_add_link_model/migration.sql
- FOUND: packages/shared/src/index.ts
- FOUND: apps/api/src/plugins/rateLimit.ts
- FOUND: apps/api/src/app.ts
- FOUND: apps/api/prisma/schema.prisma
- FOUND commit: 350ea64
- FOUND commit: 5922fd0
- FOUND commit: 993b6cf
- FOUND commit: c8ed8ba
- FOUND commit: 721c5c2
