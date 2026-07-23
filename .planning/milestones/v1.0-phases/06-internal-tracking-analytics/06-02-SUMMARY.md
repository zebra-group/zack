---
phase: 06-internal-tracking-analytics
plan: 02
subsystem: database
tags: [prisma, postgresql, zod, tdd, mass-assignment-guard]

# Dependency graph
requires:
  - phase: 05-core-redirect-engine
    provides: "lib/links.ts's D-01 single-write-path core (validateLinkInput/createLink/updateLink) and the forwardQuery field-threading precedent this plan mirrors exactly"
provides:
  - "Link.trackingEnabled (Boolean, default true) and Link.lifetimeClicks (Int, default 0) — live, migrated, generated-client-typed"
  - "model ClickEvent (id, linkId, createdAt, country?, referrerHost?, visitorHash, source) with @@index([linkId]/[createdAt]/[source]) — the FK join table every later analytics query depends on"
  - "enum ScanSource { link, qr } — qr reserved for Phase 7 QR scans"
  - "model DailySalt (date PK, value, createdAt) — input for 06-03's privacy-preserving visitorHash derivation"
  - "trackingEnabled threaded through the D-01 sole write path; LinkDTO/CreateLinkInput/UpdateLinkInput extended in @kurzly/shared"
affects: [06-03-geoip-visitorhash-transforms, 06-04-click-recording-retention, 06-05-analytics-read-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Field-threading through the D-01 single-write-path core: a plain optional boolean (trackingEnabled) needs zero tri-state derivation, unlike password/expiresAt — omitted keeps current value on update, Prisma column default covers create."

key-files:
  created:
    - apps/api/prisma/migrations/20260713081735_add_click_tracking/migration.sql
    - apps/api/test/tracking-schema-push.test.ts
  modified:
    - apps/api/prisma/schema.prisma
    - apps/api/src/lib/links.ts
    - apps/api/src/routes/links.ts
    - packages/shared/src/index.ts
    - apps/api/test/links.integration.test.ts
    - apps/web/src/views/LinkDetailView.test.ts
    - apps/web/src/views/LinksView.test.ts

key-decisions:
  - "prisma migrate dev ran non-interactively for the entire additive schema change (2 new Link columns, 1 new enum, 2 new tables) — no confirmation-shaped warning fired, matching 05-02's precedent that additive/nullable/defaulted changes don't trip the interactive gate. The 03-01 migrate-diff/deploy workaround was not needed."
  - "Authored the migration against a throwaway postgres:18-alpine Docker container (started/stopped ad hoc, not docker-compose) since no persistent local dev Postgres was running — mirrors the pattern documented in STATE.md decisions 03-01/05-02 for authoring migrations outside the testcontainers-per-test-run harness."
  - "trackingEnabled needs NO tri-state (undefined/null/value) derivation helper unlike password/expiresAt — a plain optional boolean threaded straight through validateLinkInput's returned data, exactly as forwardQuery already established."

patterns-established:
  - "Schema-push proof test convention extended: tracking-schema-push.test.ts mirrors schema-push.test.ts's shape (delegate-defined check, count()===0 check, minimal-fixture-defaults check) for a second, unrelated model group in the same file-per-schema-slice style."

requirements-completed: [TRACK-01]

coverage:
  - id: D1
    description: "Link.trackingEnabled/lifetimeClicks, ClickEvent, ScanSource, DailySalt exist in the live DB via a committed migration and are queryable"
    requirement: "TRACK-01"
    verification:
      - kind: integration
        ref: "apps/api/test/tracking-schema-push.test.ts (3 tests, all pass)"
        status: pass
      - kind: unit
        ref: "pnpm -r exec tsc --noEmit (clean across api/web/shared)"
        status: pass
    human_judgment: false
  - id: D2
    description: "trackingEnabled threads through validateLinkInput/createLink/updateLink (the D-01 sole write path); create defaults true, update persists false, omitted keeps current value"
    requirement: "TRACK-01"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'Tracking (TRACK-01, T-06-MASS/T-06-WRITEPATH)' describe block (4 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "lifetimeClicks is never client-settable — a POST body attempting lifetimeClicks:999 is silently ignored and stays 0 (mass-assignment guard, T-06-MASS)"
    requirement: "TRACK-01"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'mass-assignment guard: a body attempting lifetimeClicks:999 is ignored (stays 0)'"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-13
status: complete
---

# Phase 06 Plan 02: Tracking-Datenmodell + Single-Write-Path-Anbindung Summary

**Prisma-Migration für ClickEvent/ScanSource/DailySalt plus Link.trackingEnabled/lifetimeClicks; trackingEnabled läuft ausschließlich durch den bestehenden D-01-Single-Write-Path (validateLinkInput → createLink/updateLink), exakt nach dem forwardQuery-Vorbild aus Phase 5.**

## Performance

- **Duration:** ~25 min (inkl. Kontext-Lektüre, Migration-Authoring gegen einen Wegwerf-Postgres-Container, TDD-Zyklus)
- **Started:** 2026-07-13T10:11:00+02:00
- **Completed:** 2026-07-13T10:29:29+02:00
- **Tasks:** 2 (1 auto [BLOCKING] + 1 TDD)
- **Files modified:** 9 (2 neu, 7 geändert)

## Accomplishments
- Link-Modell um `trackingEnabled Boolean @default(true)` und `lifetimeClicks Int @default(0)` erweitert; neues `enum ScanSource { link, qr }`, `model ClickEvent` (mit expliziten `linkId`/`createdAt`/`source`-Indizes, FK `onDelete: Cascade`) und `model DailySalt` hinzugefügt.
- Migration `20260713081735_add_click_tracking` non-interaktiv via `prisma migrate dev` erzeugt und angewendet (rein additiv — keine Bestätigungs-Warnung ausgelöst), `prisma generate` aktualisiert den generierten Client.
- Schema-Push-Proof-Test (`tracking-schema-push.test.ts`) beweist ClickEvent/DailySalt sind gegen echtes Postgres abfragbar und ein frisch erstellter Link hat die korrekten Defaults.
- `trackingEnabled` läuft komplett durch den einzigen autorisierten Schreibpfad (`lib/links.ts`s `validateLinkInput`/`createLink`/`updateLink`) — kein zweiter `prisma.link.create`/`.update`-Aufrufort eingeführt (grep-verifiziert: genau 1 Create-, 1 Update-Call-Site).
- `routes/links.ts`s Zod-Allowlists (`createLinkSchema`/`updateLinkSchema`) um `trackingEnabled: z.boolean().optional()` erweitert; `lifetimeClicks` bewusst NIE allowlisted (Mass-Assignment-Guard, T-06-MASS).
- `@kurzly/shared`s `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` erweitert und Paket neu gebaut.

## Task Commits

Each task was committed atomically:

1. **Task 1: [BLOCKING] Schema + migration — tracking columns, ClickEvent, ScanSource, DailySalt** - `27bc45e` (feat)
2. **Task 2 RED: add failing tests for trackingEnabled threading + mass-assignment guard** - `59a0ff6` (test)
3. **Task 2 GREEN: thread trackingEnabled through the single write path** - `b7f381a` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/prisma/schema.prisma` - `Link.trackingEnabled`/`lifetimeClicks`, `model ClickEvent`, `enum ScanSource`, `model DailySalt`
- `apps/api/prisma/migrations/20260713081735_add_click_tracking/migration.sql` - the committed additive migration
- `apps/api/test/tracking-schema-push.test.ts` - [BLOCKING] queryable-against-real-Postgres proof
- `apps/api/src/lib/links.ts` - `trackingEnabled` threaded through `ValidateLinkInputParams`/`ValidatedLink`/`createLink`/`updateLink`/`toLinkDto`
- `apps/api/src/routes/links.ts` - `trackingEnabled` allowlisted on create/update Zod schemas, passed through PATCH handler
- `packages/shared/src/index.ts` - `LinkDTO.trackingEnabled`/`lifetimeClicks`, `CreateLinkInput.trackingEnabled`, `UpdateLinkInput.trackingEnabled`
- `apps/api/test/links.integration.test.ts` - new "Tracking (TRACK-01, T-06-MASS/T-06-WRITEPATH)" describe block (4 tests)
- `apps/web/src/views/LinkDetailView.test.ts` / `LinksView.test.ts` - `makeLink()` fixture factories extended with the two new required `LinkDTO` fields (Rule 1 fallout fix)

## Decisions Made
- `prisma migrate dev` ran fully non-interactively for the whole additive schema change (2 new Link columns, 1 new enum, 2 new tables) — no confirmation-shaped warning, so the migrate-diff/deploy workaround (03-01) was not needed.
- Authored the migration against a throwaway `postgres:18-alpine` Docker container started/stopped ad hoc for this session (no persistent local dev Postgres was running) — `prisma migrate dev` needs a live DB to introspect and diff against; the test-time testcontainers harness (`globalSetup.ts`) only ever runs `migrate deploy` against already-committed migrations, never authors new ones.
- `trackingEnabled` needed no tri-state (`undefined`/`null`/value) derivation helper unlike `password`/`expiresAt` — a plain optional boolean passed straight through, exactly mirroring `forwardQuery`'s existing shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fallout] Fixed two pre-existing `apps/web` test fixtures broken by the `LinkDTO` extension**
- **Found during:** Task 2 GREEN verification (`pnpm --filter @kurzly/web exec tsc --noEmit`)
- **Issue:** `LinkDetailView.test.ts` and `LinksView.test.ts` each define a `makeLink(overrides): LinkDTO` fixture factory whose object literal didn't include the two new required `LinkDTO` fields (`trackingEnabled`/`lifetimeClicks`), causing `tsc --noEmit` to fail with "Type ... is not assignable to type 'LinkDTO'" (exact repeat of the 05-02 precedent when `forwardQuery`/`expiresAt`/`passwordProtected` were added).
- **Fix:** Added `trackingEnabled: true, lifetimeClicks: 0` as defaults in both `makeLink()` factories, before the `...overrides` spread (so tests can still override them).
- **Files modified:** `apps/web/src/views/LinkDetailView.test.ts`, `apps/web/src/views/LinksView.test.ts`
- **Verification:** `pnpm --filter @kurzly/web exec tsc --noEmit` clean; `pnpm --filter @kurzly/web test` — 10/10 files, 67/67 tests pass.
- **Committed in:** `b7f381a` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, test fixture fallout from the plan's own DTO extension — identical pattern to 05-02's precedent)
**Impact on plan:** Necessary — the plan's own shared-DTO change would otherwise leave `apps/web`'s typecheck red. No scope creep; only the minimum default values needed to satisfy the two new required fields were added.

## Issues Encountered
- No persistent local dev Postgres was running (no `apps/api/.env`, no running `docker-compose` `db` service) to author `prisma migrate dev` against. Resolved by starting a throwaway `postgres:18-alpine` container ad hoc (`docker run -d -p 15432:5432 ...`), pointing `DATABASE_URL` at it for the single `prisma migrate dev --name add_click_tracking` invocation, then stopping/removing the container immediately after. No lasting infrastructure change; the migration SQL is committed and self-applying via the existing `test/globalSetup.ts`/production `entrypoint.sh` `prisma migrate deploy` paths.
- Running the full test suite via `pnpm --filter @kurzly/api test -- <file>` (with the extra `--`) ignored the file filter and ran all 22 test files, surfacing the WSL2 testcontainer parallel-contention flake already documented in `deferred-items.md` (06-01) — several unrelated files (`canary.integration.test.ts`, `links-auto-slug-reserved.test.ts`, `links-import.integration.test.ts`, `domains.integration.test.ts`, `redirect.integration.test.ts`, `tlsCheck.integration.test.ts`) timed out at 5000ms under parallel load, non-deterministically across repeated runs. Confirmed unrelated to this plan's changes by re-running each affected file individually via `npx vitest run <file>` directly — all pass cleanly in isolation (0 failures). This plan's own target files (`test/tracking-schema-push.test.ts`, `test/links.integration.test.ts`) pass both in isolation and combined (64/64 tests).

## User Setup Required

None - no external service configuration required. The migration is committed and self-applying (via `test/globalSetup.ts`'s `prisma migrate deploy` for tests, and the existing Docker/production migration-apply step for real deployments).

## Next Phase Readiness

- `ClickEvent`/`ScanSource`/`DailySalt` are live, migrated, and generated-client-typed — 06-03 (GeoIP/referrer/visitorHash transforms) and 06-04 (click recording + retention) can build directly on top without ever reopening the schema.
- `Link.trackingEnabled` is durably persisted and DTO-exposed with default-on semantics — 06-04's redirect click hook can gate `recordClickHook`'s write on this field once it's built.
- `Link.lifetimeClicks` exists with the correct default (0) and is provably not client-settable — ready for 06-04 to be the ONLY code path that ever increments it.
- No blockers for downstream Phase 6 plans (wave 1 of 4 complete for this plan).

---

*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

All created/modified files verified present on disk (schema.prisma, migration.sql, tracking-schema-push.test.ts, lib/links.ts, routes/links.ts, shared/src/index.ts, links.integration.test.ts, LinkDetailView.test.ts, LinksView.test.ts). Task commits `27bc45e`, `59a0ff6`, `b7f381a` all confirmed present in `git log --oneline`.
