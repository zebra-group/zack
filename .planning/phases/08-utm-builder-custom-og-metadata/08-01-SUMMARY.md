---
phase: 08-utm-builder-custom-og-metadata
plan: 01
subsystem: database
tags: [prisma, postgresql, zod, tdd, utm, opengraph, mass-assignment-guard]

# Dependency graph
requires:
  - phase: 04-links-management-bulk-import
    provides: "lib/links.ts's D-01 single-write-path core (validateLinkInput/createLink/updateLink); title's three-state PATCH precedent (WR-02)"
  - phase: 05-core-redirect-engine
    provides: "password/expiresAt three-state derivation precedent (derivePasswordHash/deriveExpiresAt) that deriveMetaField mirrors"
provides:
  - "Link.utmSource/utmMedium/utmCampaign and Link.ogTitle/ogDescription/ogImageUrl (all String?, nullable, no default) — live, migrated, generated-client-typed"
  - "LinkErrorCode extended with UTM_VALUE_TOO_LONG/OG_TITLE_TOO_LONG/OG_DESCRIPTION_TOO_LONG/OG_IMAGE_URL_TOO_LONG/OG_IMAGE_URL_INVALID"
  - "deriveMetaField + validateMetaField + validateOgImageUrl (lib/links.ts) — the three-state keep/clear/set core for all six fields, reusable by future 08-xx plans"
  - "UTM_VALUE_MAX_LENGTH/OG_TITLE_MAX_LENGTH/OG_DESCRIPTION_MAX_LENGTH/OG_IMAGE_URL_MAX_LENGTH named constants (D-08-05 single source of truth)"
  - "Six fields threaded through validateLinkInput/createLink/updateLink/toLinkDto and allowlisted on POST/PATCH /api/links"
  - "LinkDTO/CreateLinkInput/UpdateLinkInput extended in @kurzly/shared"
affects: [08-02-utm-application-og-rendering, 08-03-utm-builder-ui, 08-04-og-preview-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-state field derivation generalized beyond password/expiresAt: deriveMetaField treats BOTH null AND an empty/whitespace string as 'clear' (deliberately unlike password's blank-means-keep), because these six fields have no 'accidentally submitted blank' concern the way a password confirmation field does."
    - "Length-before-shape validation ordering for ogImageUrl: validateMetaField's TOO_LONG check runs before the z.url() shape check, so a value that is both over-length and malformed reports the length code, not the shape code — deterministic precedence documented in the plan and mirrored in tests."

key-files:
  created:
    - apps/api/prisma/migrations/20260722202851_add_link_utm_and_og_metadata/migration.sql
    - apps/api/test/meta-schema-push.test.ts
    - apps/api/test/links-meta.test.ts
  modified:
    - apps/api/prisma/schema.prisma
    - apps/api/src/lib/links.ts
    - apps/api/src/routes/links.ts
    - packages/shared/src/index.ts
    - apps/api/test/links.integration.test.ts
    - apps/web/src/views/LinkDetailView.test.ts
    - apps/web/src/views/LinksView.test.ts
    - apps/web/src/views/QrCodesView.test.ts

key-decisions:
  - "prisma migrate dev ran non-interactively for the entire additive schema change (6 new nullable Link columns, no defaults) — no confirmation-shaped warning fired, matching 05-02/06-02/07-02 precedent. The 03-01 migrate-diff/deploy workaround was not needed."
  - "Authored the migration against a throwaway postgres:18-alpine Docker container (port 15432, started/stopped ad hoc) since no persistent local dev Postgres was running — same pattern documented in STATE.md decisions 03-01/05-02/06-02."
  - "prisma generate had to be re-run explicitly with DATABASE_URL set after migrate dev — prisma.config.ts requires env('DATABASE_URL') to resolve even for a schema-only generate, and the first migrate dev invocation did not leave the generated client updated (client regeneration verified via grep before proceeding to Task 2)."
  - "mapErrorToSkipReason (CSV import skip-reason mapping) required explicit cases for the five new LinkErrorCode values to keep the exhaustive switch compiling — CSV rows never carry UTM/OG columns (EXPECTED_CSV_COLUMNS is ziel_url/slug/domain only), so these branches throw an 'unreachable' Error rather than silently bucketing into an unrelated skip reason."

patterns-established:
  - "Generalized three-state helper (deriveMetaField/validateMetaField) factored out as a reusable building block for the next field group needing keep/clear/set semantics, rather than hand-inlining six near-duplicate derivations."

requirements-completed: [META-01, META-02]

coverage:
  - id: D1
    description: "Link.utmSource/utmMedium/utmCampaign/ogTitle/ogDescription/ogImageUrl exist in the live DB via a committed additive migration, are queryable, default to null on rows created without them, and toLinkDto exposes all six verbatim"
    requirement: "META-01"
    verification:
      - kind: integration
        ref: "apps/api/test/meta-schema-push.test.ts (3 tests, all pass)"
        status: pass
      - kind: unit
        ref: "pnpm -r exec tsc --noEmit (clean across api/web/shared)"
        status: pass
    human_judgment: false
  - id: D2
    description: "createLink/updateLink validate the six fields to D-08-05's per-field length limits (UTM 200, OG title 200, OG description 500, OG image URL 2048) with distinct typed error codes, never throwing"
    requirement: "META-01"
    verification:
      - kind: unit
        ref: "apps/api/test/links-meta.test.ts — createLink describe block (9 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ogImageUrl is validated http(s)-only via the same z.url() WHATWG-parser idiom targetUrl uses; javascript:/data:/relative values are rejected as OG_IMAGE_URL_INVALID, and the server never fetches the value anywhere on the write path"
    requirement: "META-02"
    verification:
      - kind: unit
        ref: "apps/api/test/links-meta.test.ts — 'rejects ogImageUrl %s with OG_IMAGE_URL_INVALID' (3 cases) + 'accepts a valid https ogImageUrl'"
        status: pass
      - kind: other
        ref: "grep -rn 'ogImageUrl' apps/api/src — no fetch/axios/http-request call site introduced anywhere (structural SSRF mitigation, T-08-SSRF)"
        status: pass
    human_judgment: false
  - id: D4
    description: "updateLink honours the three-state contract per D-08-05: field absent keeps, null or empty string clears, a value sets/replaces — proven at both the lib core and the HTTP PATCH surface"
    requirement: "META-01"
    verification:
      - kind: unit
        ref: "apps/api/test/links-meta.test.ts — 'updateLink three-state contract (D-08-05)' describe block (4 tests, all pass)"
        status: pass
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'PATCH: utmSource ...' and 'PATCH: ogTitle ...' (2 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D5
    description: "POST/PATCH /api/links allowlist exactly the six fields via Zod (createLinkSchema/updateLinkSchema); an unknown metadata-shaped key (utmTerm, ogSiteName) never reaches the database; the six are written ONLY through createLink/updateLink"
    requirement: "META-01"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — '201s a create carrying all six fields' + 'mass-assignment: unknown metadata-shaped keys ...' + two 400 cases (4 tests, all pass)"
        status: pass
      - kind: other
        ref: "grep -rn 'prisma\\.link\\.create\\|prisma\\.link\\.update' apps/api/src — exactly 1 create site (lib/links.ts createLink), exactly 1 content-field update site (lib/links.ts updateLink), plus the documented lifetimeClicks-only exception in routes/redirect.ts"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-22
status: complete
---

# Phase 08 Plan 01: UTM Builder + Custom OG Metadata — Foundation Slice Summary

**Six nullable Link columns (utmSource/utmMedium/utmCampaign, ogTitle/ogDescription/ogImageUrl) with an additive migration, a generalized three-state keep/clear/set validation core in `lib/links.ts`, http(s)-only shape validation for the OG image URL (SSRF-safe — the server never fetches it), and a Zod allowlist on POST/PATCH `/api/links` — the foundation every later Phase 8 plan (UTM application at redirect time, OG rendering for bots, and the builder/preview UI) reads.**

## Performance

- **Duration:** ~35 min (schema/migration authoring against a throwaway Postgres container, three TDD cycles, full-suite + workspace type-check verification)
- **Started:** 2026-07-22T20:20:00Z (approx.)
- **Completed:** 2026-07-22T20:55:00Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 11 (3 new, 8 modified)

## Accomplishments
- Extended `model Link` in `schema.prisma` with six nullable `String?` columns, each doc-commented with its D-08-0x citation; authored and applied the additive migration `20260722202851_add_link_utm_and_og_metadata` non-interactively against a throwaway `postgres:18-alpine` container (no confirmation-shaped warning — purely additive, matching 05-02/06-02/07-02 precedent).
- Extended `@kurzly/shared`'s `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` with the six fields and rebuilt the package; `toLinkDto` passes all six through verbatim (no encoding/escaping — those are 08-02's redirect-time and render-time concerns).
- Built a generalized three-state validation core (`deriveMetaField`/`validateMetaField`/`validateOgImageUrl`) in `lib/links.ts`, modelled on `deriveExpiresAt`'s shape but deliberately treating an empty/whitespace string as CLEAR (unlike `password`'s blank-means-keep) per D-08-05. Added five new typed `LinkErrorCode` values and four named length-limit constants as the single source of truth.
- `ogImageUrl` reuses the same `z.url({ protocol: /^https?$/ })` WHATWG-parser idiom `targetUrl` already uses (no hand-rolled regex); length is checked before shape so an over-long malformed value reports `OG_IMAGE_URL_TOO_LONG` deterministically. No fetch/request call was added anywhere — SSRF is closed structurally (T-08-SSRF), not by a runtime guard.
- Threaded all six fields through `validateLinkInput`/`createLink`/`updateLink` (the D-01 sole write path) and allowlisted them on `createLinkSchema`/`updateLinkSchema` (`routes/links.ts`), mapping the five new error codes to HTTP 400. The PATCH handler passes all six straight through from `parsed.data` with no `??` fallback, mirroring the existing WR-02 `title` discipline.
- Verified structurally: exactly one `prisma.link.create` call site and exactly one content-field `prisma.link.update` call site remain (grep-confirmed), `prisma migrate status` reports the schema up to date with zero drift, and `pnpm -r exec tsc --noEmit` is clean across api/web/shared.

## Task Commits

Each task was committed atomically:

1. **Task 1: Six nullable Link columns + migration + shared DTO/Input types** - `39ad248` (feat)
2. **Task 2 RED: failing cases for UTM/OG validation and three-state updates** - `99a64c2` (test)
2. **Task 2 GREEN: validate and thread UTM/OG fields through the single write path** - `635af51` (feat)
3. **Task 3 RED: failing HTTP-surface cases for UTM/OG allowlist + PATCH pass-through** - `22e497a` (test)
3. **Task 3 GREEN: allowlist UTM/OG fields on the links HTTP surface** - `2b0a931` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/prisma/schema.prisma` - six new nullable `Link` columns, D-08-0x doc comments
- `apps/api/prisma/migrations/20260722202851_add_link_utm_and_og_metadata/migration.sql` - the committed additive migration
- `apps/api/test/meta-schema-push.test.ts` - [Task 1] persistence + DTO round-trip proof against real Postgres
- `apps/api/src/lib/links.ts` - `LinkErrorCode` +5, four length constants, `deriveMetaField`/`validateMetaField`/`validateOgImageUrl`, `ValidatedLink`/`ValidateLinkInputParams` widened, `validateLinkInput`/`updateLink`/`toLinkDto`/`mapErrorToSkipReason` extended
- `apps/api/test/links-meta.test.ts` - [Task 2] 14 lib-level createLink/updateLink cases (length limits, scheme validation, three-state contract)
- `apps/api/src/routes/links.ts` - `createLinkSchema`/`updateLinkSchema` allowlist the six fields, `statusForLinkError` maps the five new codes to 400, PATCH handler pass-through
- `apps/api/test/links.integration.test.ts` - [Task 3] new "UTM + custom OG metadata HTTP surface" describe block (6 tests: create-all, two 400 cases, mass-assignment, two PATCH four-case sequences)
- `packages/shared/src/index.ts` - `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` extended with the six fields, package rebuilt
- `apps/web/src/views/LinkDetailView.test.ts` / `LinksView.test.ts` / `QrCodesView.test.ts` - `makeLink()` fixture factories extended with the six new required `LinkDTO` fields (Rule 1 fallout, mirrors the 06-02 precedent)

## Decisions Made
- `deriveMetaField` deliberately clears on BOTH `null` and an empty/whitespace-only string — a genuine divergence from `derivePasswordHash`'s blank-means-keep convention, because D-08-05 explicitly calls this out and these fields have no "accidentally-blank-submission" risk a password confirmation UI has.
- Length validation runs before shape validation for `ogImageUrl` specifically, so a value that is both over-length and malformed reports `OG_IMAGE_URL_TOO_LONG` rather than `OG_IMAGE_URL_INVALID` — deterministic, tested precedence per the plan's explicit instruction.
- `mapErrorToSkipReason`'s five new branches throw an "unreachable" `Error` rather than silently mapping to an existing `LinkSkipReason` — CSV import structurally cannot produce these codes (its columns are `ziel_url`/`slug`/`domain` only), so a defensive throw is more honest than a misleading bucket assignment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fallout] Fixed three pre-existing `apps/web` test fixtures broken by the `LinkDTO` extension**
- **Found during:** Full-workspace `pnpm -r exec tsc --noEmit` verification after Task 3
- **Issue:** `LinkDetailView.test.ts`, `LinksView.test.ts`, and `QrCodesView.test.ts` each define a `makeLink(overrides): LinkDTO` fixture factory whose object literal didn't include the six new required `LinkDTO` fields, causing `tsc --noEmit` to fail with "Type ... is not assignable to type 'LinkDTO'" — exact repeat of the 06-02 precedent when `trackingEnabled`/`lifetimeClicks` were added.
- **Fix:** Added `utmSource: null, utmMedium: null, utmCampaign: null, ogTitle: null, ogDescription: null, ogImageUrl: null` as defaults in all three `makeLink()` factories, before the `...overrides` spread.
- **Files modified:** `apps/web/src/views/LinkDetailView.test.ts`, `apps/web/src/views/LinksView.test.ts`, `apps/web/src/views/QrCodesView.test.ts`
- **Verification:** `pnpm -r exec tsc --noEmit` clean; `pnpm --filter @kurzly/web test` — 14/14 files, 136/136 tests pass.
- **Committed in:** `2b0a931` (Task 3 GREEN commit)

**2. [Rule 3 - Blocking] `mapErrorToSkipReason`'s exhaustive switch required explicit handling of the five new error codes**
- **Found during:** Task 2 GREEN `pnpm --filter @kurzly/api exec tsc --noEmit`
- **Issue:** Extending the `LinkErrorCode` union made `mapErrorToSkipReason`'s `const exhaustive: never = code` fallback fail to compile (the five new codes weren't assignable to `never`).
- **Fix:** Added explicit `case` branches for the five new codes that throw a documented "unreachable" `Error`, since CSV import rows never carry UTM/OG columns.
- **Files modified:** `apps/api/src/lib/links.ts`
- **Verification:** `pnpm --filter @kurzly/api exec tsc --noEmit` clean.
- **Committed in:** `635af51` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 test fallout, 1 blocking type error). Both necessary consequences of the plan's own type extensions; no scope creep.
**Impact on plan:** None beyond the minimum fixes required to keep the workspace compiling and the existing web test suite green.

## Issues Encountered
- No persistent local dev Postgres was running (no `apps/api/.env`, no running `docker-compose` `db` service) to author `prisma migrate dev` against. Resolved by starting a throwaway `postgres:18-alpine` container ad hoc (port 15432), pointing `DATABASE_URL` at it for the migration authoring and a subsequent explicit `prisma generate`, then stopping/removing the container immediately after. No lasting infrastructure change — the migration SQL is committed and self-applying via the existing `test/globalSetup.ts`/production `entrypoint.sh` `prisma migrate deploy` paths. A second throwaway container was used transiently to run `prisma migrate status` as the plan's overall verification step, then torn down.
- The first `prisma migrate dev` invocation applied the migration but did not leave the generated Prisma client visibly updated (grep for `utmSource` in the generated `Link.ts` returned zero matches); running `prisma generate` explicitly (with `DATABASE_URL` set, since `prisma.config.ts` requires it to resolve even for schema-only generation) fixed this before Task 1's persistence test was run.

## User Setup Required

None - no external service configuration required. The migration is committed and self-applying (via `test/globalSetup.ts`'s `prisma migrate deploy` for tests, and the existing Docker/production migration-apply step for real deployments).

## Next Phase Readiness

- All six columns are live, migrated, generated-client-typed, and durably validated/persisted through the single write path — 08-02 (UTM application at redirect time + custom OG rendering for bots) and the builder/preview UI plans can build directly on top without ever reopening the schema.
- `deriveMetaField`/`validateMetaField` are exported-shaped internal helpers (not yet exported from the module) — if 08-02's redirect-time UTM-application code needs the same trim/clear semantics independently of `lib/links.ts`, export them or factor into a shared utility rather than re-implementing.
- `ogImageUrl` is proven never fetched anywhere on the write path (T-08-SSRF structural mitigation) — 08-02's `renderBotOgPage`/`publicHtml.ts` work must preserve this invariant when it starts reading the stored value (HTML-escape on output, never a server-side request).
- No blockers for downstream Phase 8 plans (wave 1 of the phase complete for this plan).

---

*Phase: 08-utm-builder-custom-og-metadata*
*Completed: 2026-07-22*

## Self-Check: PASSED

All 11 files referenced above (migration, schema, lib/links.ts, routes/links.ts, shared/src/index.ts, 3 new/modified API test files, 3 web fixture files) confirmed present on disk. All 5 task commits (`39ad248`, `99a64c2`, `635af51`, `22e497a`, `2b0a931`) confirmed present in `git log --oneline --all`.
