---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 02
subsystem: database
tags: [qrcode, sharp, jsqr, prisma, migration, postgres, testcontainers]

# Dependency graph
requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (07-01)
    provides: Human sign-off approving qrcode/sharp/jsqr/@types-qrcode for install
provides:
  - "qrcode + sharp (prod) and jsqr + @types/qrcode (dev) installed in @kurzly/api"
  - "QrCode + QrRemapHistory Prisma models + QrCodeVariant enum, migrated and generated"
  - "Confirmed sharp SVG->PNG->raw RGBA pipeline works on this host (RESEARCH A4/A5)"
affects: [07-03, 07-04, 07-05, 07-06, 07-07, 07-08, 07-09]

# Tech tracking
tech-stack:
  added: ["qrcode@1.5.4", "sharp@0.35.3", "jsqr@1.4.0 (dev)", "@types/qrcode@1.5.6 (dev)"]
  patterns:
    - "QrCode single-write-path convention documented in schema.prisma header, naming apps/api/src/lib/qrCodes.ts as sole writer (mirrors Link's convention)"
    - "Migrations authored against a throwaway ad hoc postgres:18-alpine container (port 15432), never against the docker-compose db service — established pattern from 03-01/05-02/06-02"
    - "Schema-push proof test (qr-schema-push.test.ts) mirrors schema-push.test.ts/tracking-schema-push.test.ts: proves new models are genuinely queryable against real Postgres via the testcontainers harness, not just type-present"

key-files:
  created:
    - apps/api/prisma/migrations/20260720125110_add_qr_codes/migration.sql
    - apps/api/test/qr-schema-push.test.ts
    - apps/api/test/qrRenderSmoke.test.ts
  modified:
    - apps/api/package.json
    - pnpm-lock.yaml
    - apps/api/prisma/schema.prisma

key-decisions:
  - "Re-verified qrcode@1.5.4/sharp@0.35.3/jsqr@1.4.0/@types-qrcode@1.5.6 against the live npm registry at install time — all four match RESEARCH.md's 2026-07-20 pins exactly, no newer patch to consider"
  - "Authored the add_qr_codes migration against a throwaway ad hoc postgres:18-alpine container on host port 15432 (started, migrated, generated, stopped/removed) rather than the running docker-compose db service, which is not port-mapped to the host — mirrors the exact pattern documented in STATE.md/prior SUMMARYs (03-01, 05-02, 06-02)"
  - "Added test/qr-schema-push.test.ts (not explicitly listed in the plan's files_modified) under Rule 2 (auto-add missing critical functionality): the plan's own must_haves.truths requires proof that QrCode/QrRemapHistory rows persist in a real Postgres testcontainer, and every prior schema-migration plan in this codebase (02-02, 06-02) shipped an analogous schema-push test — omitting it would leave a documented must-have unverified"
  - "code (the /q short code) uses a plain @unique — flat global namespace, deliberately NOT domain-scoped like Link's composite @@unique([domainId, slug]) — per the plan's explicit data-model instruction"
  - "logoData stored as Bytes? directly on the QrCode row (RESEARCH Open-Question 3 resolution) rather than introducing object storage; bounded by the 2 MB upload cap enforced in 07-05"

patterns-established:
  - "QrCode.linkId is the single Link relation serving both static (bound link IS the target) and dynamic (current target) variants — no separate targetLinkId column"
  - "lifetimeScans mirrors Link.lifetimeClicks: pruning-resistant counter incremented only by the future /q scan hook (07-06), never a live COUNT"

requirements-completed: [QR-02, QR-03, QR-04, QR-07]

coverage:
  - id: D1
    description: "qrcode + sharp installed as prod deps, jsqr + @types/qrcode as dev deps of @kurzly/api, matching the 07-01-approved pinned versions"
    requirement: "QR-02"
    verification:
      - kind: other
        ref: "pnpm --filter @kurzly/api exec node -e \"require('qrcode'); require('sharp'); require('jsqr'); console.log('deps-ok')\" — printed deps-ok"
        status: pass
    human_judgment: false
  - id: D2
    description: "QrCode + QrRemapHistory models and QrCodeVariant enum added to schema.prisma with explicit indexes and cascade rules, migration authored and applied, client regenerated"
    requirement: "QR-03"
    verification:
      - kind: other
        ref: "prisma validate && prisma generate — both succeeded"
        status: pass
      - kind: integration
        ref: "test/qr-schema-push.test.ts#all 5 tests (delegate presence, count queries, static QrCode create, dynamic QrCode create with code+logo bytes, QrRemapHistory create + cascade delete)"
        status: pass
    human_judgment: false
  - id: D3
    description: "sharp's SVG rasterization and .raw() RGBA pixel output confirmed working on this host, de-risking RESEARCH Assumptions A4/A5 before the 07-03 decode-round-trip test depends on them"
    requirement: "QR-04"
    verification:
      - kind: unit
        ref: "test/qrRenderSmoke.test.ts#sharp image pipeline smoke test (A4/A5) — 2/2 tests pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "QrCode.code global-uniqueness and logoData Bytes? storage support the dynamic re-pointable QR + optional logo requirements (QR-07)"
    requirement: "QR-07"
    verification:
      - kind: integration
        ref: "test/qr-schema-push.test.ts#creates a dynamic QrCode with its own /q code, current target Link, and logo bytes"
        status: pass
    human_judgment: false

# Metrics
duration: 16min
completed: 2026-07-20
status: complete
---

# Phase 07 Plan 02: Install QR Deps + QrCode/QrRemapHistory Data Model Summary

**Installed qrcode/sharp/jsqr/@types-qrcode, added the QrCode + QrRemapHistory Prisma models (logo bytes on the row, globally-unique dynamic `/q` code) with a migration and regenerated client, and proved sharp's SVG→PNG→raw RGBA pipeline works on this host before any renderer depends on it.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-20T14:48:00Z
- **Completed:** 2026-07-20T15:04:11Z
- **Tasks:** 3
- **Files modified:** 6 (2 dependency/lockfile, 1 schema, 3 new files: migration.sql, qr-schema-push.test.ts, qrRenderSmoke.test.ts)

## Accomplishments
- Installed `qrcode@1.5.4` + `sharp@0.35.3` (prod) and `jsqr@1.4.0` + `@types/qrcode@1.5.6` (dev) into `@kurzly/api` — versions re-verified against the live npm registry, matching 07-01's approved pins exactly
- Added `QrCodeVariant` enum (`static`/`dynamic`), `QrCode` model (single Link relation for both bound-static and current-target-dynamic use, globally-unique optional `code`, style fields, `Bytes?` logo storage, `lifetimeScans` counter), and `QrRemapHistory` model (per-remap audit row, cascade-deletes with its QrCode) — all mirroring the Link/ClickEvent conventions exactly, with explicit `@@index` on every FK/lookup column
- Authored and applied migration `20260720125110_add_qr_codes` against a throwaway ad hoc `postgres:18-alpine` container (project's established pattern since no persistent local dev Postgres is host-port-mapped), fully additive — no interactive confirmation gate triggered
- Regenerated the Prisma client at `src/generated/prisma`; confirmed `prisma.qrCode` and `prisma.qrRemapHistory` delegates construct and are genuinely queryable
- Added `test/qr-schema-push.test.ts` proving the migration applies via the shared testcontainers harness and that static QrCode, dynamic QrCode (with `/q` code + logo bytes), and QrRemapHistory (incl. cascade delete) round-trip against real Postgres
- Added `test/qrRenderSmoke.test.ts` proving sharp rasterizes a trivial inline SVG to PNG without throwing (Assumption A5) and that `.raw({ resolveWithObject: true })` yields the exact `width*height*4` RGBA shape the 07-03 decode-round-trip test will feed jsQR (Assumption A4)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install qrcode + sharp (prod) and jsqr + @types/qrcode (dev)** - `5331227` (feat)
2. **Task 2: Add QrCode + QrRemapHistory models and QrCodeVariant enum, migrate, generate** - `ceb33b0` (feat)
3. **Task 3: sharp image-pipeline smoke test (de-risk A4/A5)** - `8514dd1` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit hash in phase history).

## Files Created/Modified
- `apps/api/package.json` - Added qrcode/sharp deps, jsqr/@types-qrcode devDeps
- `pnpm-lock.yaml` - Lockfile updated for the four new packages
- `apps/api/prisma/schema.prisma` - Added `QrCodeVariant` enum, `QrCode`/`QrRemapHistory` models, `qrCodes QrCode[]` inverse relation on `Link`
- `apps/api/prisma/migrations/20260720125110_add_qr_codes/migration.sql` - Additive migration: 1 enum, 2 tables, 5 indexes/unique constraints, 2 FKs (both `ON DELETE CASCADE`)
- `apps/api/test/qr-schema-push.test.ts` - Real-Postgres schema-push proof for QrCode + QrRemapHistory (static variant, dynamic variant with logo bytes, remap-history cascade delete)
- `apps/api/test/qrRenderSmoke.test.ts` - sharp SVG rasterization + raw RGBA pixel shape smoke test

## Decisions Made
- Re-verified all four package versions against the live npm registry at install time — exact match to RESEARCH.md's 2026-07-20 pins, nothing newer to reconsider
- Authored the migration against a throwaway ad hoc `postgres:18-alpine` container on host port 15432 (the running `docker-compose` `db` service has no host port mapping) — matches the established project pattern from 03-01/05-02/06-02, no lasting infra change, container removed immediately after
- `QrCode.code` uses a plain `@unique` (flat global namespace), deliberately not domain-scoped like `Link.slug`'s composite unique constraint, per the plan's explicit instruction
- `logoData` stored as `Bytes?` directly on the row rather than adding object storage — reuses the existing Postgres volume per RESEARCH Open-Question 3's resolution, bounded by the 2 MB cap enforced in 07-05

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `test/qr-schema-push.test.ts` real-Postgres persistence proof**
- **Found during:** Task 2 (schema + migration)
- **Issue:** The plan's `must_haves.truths` explicitly requires proof that "A QrCode row (static→bound Link, or dynamic→own /q code + current target Link + optional logo bytes) and a QrRemapHistory row can be persisted in a real Postgres testcontainer after migration" — but no task explicitly asked for a test file covering this, and Task 2's own `<verify>` only runs `prisma validate`/`prisma generate` (schema-static checks, no live-DB proof). Every prior schema-migration plan in this codebase (`schema-push.test.ts` in 02-02, `tracking-schema-push.test.ts` in 06-02) shipped exactly this kind of proof test; omitting it here would leave a documented must-have unverified.
- **Fix:** Added `apps/api/test/qr-schema-push.test.ts`, mirroring the established pattern: delegate-presence checks, count queries against real Postgres, a static QrCode create, a dynamic QrCode create (with `/q` code + logo `Bytes` + mimetype), and a QrRemapHistory create followed by a cascade-delete assertion.
- **Files modified:** `apps/api/test/qr-schema-push.test.ts` (new)
- **Verification:** All 5 tests pass against the shared testcontainers Postgres harness (`npx vitest run test/qr-schema-push.test.ts`)
- **Committed in:** `ceb33b0` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed a Buffer-vs-Uint8Array assertion mismatch in the new schema-push test**
- **Found during:** Task 2 (writing `qr-schema-push.test.ts`)
- **Issue:** `expect(qrCode.logoData).toEqual(logoData)` failed — Prisma 7's driver-adapter (`@prisma/adapter-pg`) path returns `Bytes` columns as a plain `Uint8Array`, not a Node `Buffer`, so a direct `toEqual` against a `Buffer` literal fails on constructor identity even though the byte content is identical.
- **Fix:** Compare via `Buffer.from(qrCode.logoData ?? [])` before asserting equality.
- **Files modified:** `apps/api/test/qr-schema-push.test.ts`
- **Verification:** Test passes after the fix; re-ran full file, all 5 green.
- **Committed in:** `ceb33b0` (Task 2 commit, same file/commit as deviation 1)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both necessary to satisfy the plan's own must_haves truth and to have a correct, passing test suite. No scope creep beyond what the plan's must_haves already demanded.

## Issues Encountered
- Running the full suite via `pnpm --filter @kurzly/api test` (and via `pnpm --filter @kurzly/api test -- <file>`, which is documented to ignore the file filter and run all 293 tests) surfaced the same pre-existing WSL2 testcontainer parallel-contention flake already tracked in `.planning/phases/06-internal-tracking-analytics/deferred-items.md` (logged as tech-debt in commit `35a9128`). Two separate full-suite runs failed a different, non-overlapping set of 4-12 unrelated integration test files each time (`links-import.integration.test.ts`, `redirect.integration.test.ts`, `server.integration.test.ts`, `tlsCheck.integration.test.ts`, `canary.integration.test.ts`, `domains.integration.test.ts`, `auth.integration.test.ts`, `analytics.test.ts`, `links.integration.test.ts`, `links-auto-slug-reserved.test.ts`, `redirect-tracking.integration.test.ts`) — all timeouts or transaction-isolation count mismatches, never the same files twice. Confirmed unrelated to this plan's changes: re-ran `links-import.integration.test.ts` and `redirect.integration.test.ts` individually (`npx vitest run <file>`) and both passed cleanly (12/12 and 17/17). Both new test files added by this plan (`qr-schema-push.test.ts`, `qrRenderSmoke.test.ts`) passed in every full-suite run, including the runs where other files flaked. No fix attempted — out of scope per the executor's scope-boundary rule (pre-existing, already-tracked tech debt unrelated to this plan's files).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `apps/api/src/generated/prisma` now exposes `qrCode`/`qrRemapHistory` delegates — 07-04 (service layer) can build its single-write-path module (`apps/api/src/lib/qrCodes.ts`, already named in the schema's doc-comment header) directly against them
- sharp's SVG rasterization + raw RGBA pixel shape confirmed on this host (A4/A5 de-risked) — 07-03 (render core) is unblocked to build the actual QR renderer + decode-round-trip test without discovering a platform gap mid-implementation
- No blockers for 07-03/07-04

---
*Phase: 07-qr-codes-static-dynamic-qr-studio*
*Completed: 2026-07-20*

## Self-Check: PASSED

All created files verified on disk (migration.sql, qr-schema-push.test.ts, qrRenderSmoke.test.ts, this SUMMARY). All 3 task commit hashes (5331227, ceb33b0, 8514dd1) verified present in `git log --oneline --all`.
