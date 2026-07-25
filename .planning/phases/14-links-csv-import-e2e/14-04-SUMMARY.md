---
phase: 14-links-csv-import-e2e
plan: 04
subsystem: testing
tags: [playwright, e2e, links, csv-import, chromium-admin, slug-conflict]

# Dependency graph
requires:
  - phase: 14-links-csv-import-e2e
    provides: "14-01's apps/e2e/src/csv.ts buildImportCsv/IMPORT_CSV_HEADER fixture builder"
  - phase: 14-links-csv-import-e2e
    provides: "14-03's csv-import-happy.spec.ts upload/preview/commit UI-driving pattern (select-domain-before-upload, setInputFiles on the hidden input, waitForResponse-scoped preview/commit assertions)"
  - phase: 12-redirect-handler-e2e-core-value
    provides: "apps/e2e/src/links.ts's createE2eLink (direct-Prisma Link fixture)"
provides:
  - "apps/e2e/tests/authed/csv-import-conflict.spec.ts — LINKS-E2E-03, the CSV bulk-import slug-conflict path (pre-seeded conflicting Link -> preview surfaces it -> commit skips it), DB-asserted as skip-not-overwrite"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skip-not-overwrite DB proof: seed a pre-existing Link via createE2eLink INSIDE the test body with a DISTINCT target than the CSV row's target, then after commit assert the conflict slug still resolves to EXACTLY ONE row whose target is the UNCHANGED pre-existing value — a stronger proof than just importedCount/skippedCount, since it structurally rules out both overwrite and duplicate-row outcomes"

key-files:
  created:
    - apps/e2e/tests/authed/csv-import-conflict.spec.ts
  modified: []

key-decisions:
  - "The pre-existing conflicting link is seeded via createE2eLink (direct Prisma), not the create-UI — this spec's own subject is the import flow, not link creation (14-RESEARCH.md Pattern 2 explicitly permits this)."
  - "Seeded the conflict fixture INSIDE the test body (not beforeAll) so the whole-test retry (test.describe.configure({ retries: 2 })) re-seeds cleanly with a fresh random slug/target if a cross-file DB truncate races the seed-then-preview window."
  - "Asserted skip-not-overwrite directly at the DB via prisma.link.findMany({ where: { slug: conflictSlug } }) returning exactly one row whose targetUrl equals the pre-existing target (never the CSV-attempt target) — the definitive proof, per T-14-06, that no overwrite path exists."
  - "No overwrite mode was built or asserted — 14-RESEARCH.md confirmed with certainty that conflict resolution is skip-only everywhere in the codebase (routes/links.ts, lib/links.ts, LinksImportView.vue)."

patterns-established: []

requirements-completed: [LINKS-E2E-03]

coverage:
  - id: D1
    description: "A CSV row whose slug already exists renders in the preview as invalid (reason slug_conflict, label 'Slug bereits vergeben oder reserviert'), while a second, new-slug row previews valid — '1 gültig · 1 übersprungen'"
    requirement: "LINKS-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/csv-import-conflict.spec.ts — 'LINKS-E2E-03: CSV import slug conflict (preview surfaces it, commit skips it) > CSV slug conflict is surfaced in preview and skipped on commit (never overwritten)', run live against the built compose image, --project=chromium-admin"
        status: pass
    human_judgment: false
  - id: D2
    description: "Committing imports only the valid row (importedCount 1, skippedCount 1) and SKIPS the conflict row — the pre-existing link's target URL is UNCHANGED in the database afterward (skip, never overwrite; no duplicate row created for that slug)"
    requirement: "LINKS-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/csv-import-conflict.spec.ts — same test, COMMIT + DB assertion sections (prisma.link.findMany scoped to the conflict slug returns exactly 1 row with the unchanged pre-existing targetUrl; the new slug's row was imported with its own target), run live"
        status: pass
    human_judgment: false

duration: 60min
completed: 2026-07-25
status: complete
---

# Phase 14 Plan 04: LINKS-E2E-03 CSV Import Slug Conflict Summary

**A single Playwright spec proving the CSV bulk-import slug-conflict path end-to-end: a CSV row colliding with a pre-existing Link's slug is surfaced in the preview as invalid (`slug_conflict`), and committing skips that row entirely — proven directly at the database that the pre-existing Link's target is unchanged (skip, never overwrite; no duplicate row).**

## Performance

- **Duration:** ~60 min
- **Completed:** 2026-07-25
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Wrote `apps/e2e/tests/authed/csv-import-conflict.spec.ts`: seeds a pre-existing Link (`createE2eLink`, direct Prisma) with a distinct target INSIDE the test body, builds a two-row CSV via 14-01's `buildImportCsv` (row 1 collides with the seeded slug but carries a DIFFERENT CSV-attempt target; row 2 is a brand-new slug), selects the baseline domain in the dropdown BEFORE upload (Pitfall 3), uploads via `setInputFiles` on the real hidden file input, and asserts:
  - the typed preview response body (`validCount: 1`, `skippedCount: 1`, the conflict row `valid: false`/`reason: "slug_conflict"`, the new row `valid: true`) AND the rendered UI (`.valid-count` = "1 gültig", `.skipped-count` = "1 übersprungen", the conflict row carries the `.invalid` class with `.preview-reason` text "Slug bereits vergeben oder reserviert", the new row does not);
  - the real `Importieren (1)` button click, and the commit response (`importedCount: 1`, `skippedCount: 1`);
  - **the definitive skip-not-overwrite DB proof:** `prisma.link.findMany({ where: { slug: conflictSlug } })` returns EXACTLY ONE row whose `targetUrl` still equals the pre-existing value (never the CSV-attempt target this row's commit would have written under an overwrite semantics that does not exist) — and the new slug's row was imported with its own target.
- Scoped to `chromium-admin` only via a `test.beforeEach` skip, matching 14-02/14-03's precedent (member/domain-scoped import authz is Phase 17's job).
- No production code changes — live-driving the real UI/API matched 14-RESEARCH.md's documented behavior exactly on the first attempt; no genuine app bug surfaced.
- Confirmed live, three separate times against the built compose image: the targeted spec alone, the full `tests/authed/` directory at `--workers=1`, and the full `tests/authed/` directory at default parallelism on a freshly rebooted stack — all green.
- `pnpm --filter @kurzly/e2e typecheck` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: LINKS-E2E-03 — CSV slug conflict previews + commit skips, DB-asserted skip-not-overwrite (chromium-admin)** - `c716b9a` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified
- `apps/e2e/tests/authed/csv-import-conflict.spec.ts` - LINKS-E2E-03: pre-seeded slug conflict -> preview surfaces it -> commit skips it, DB-asserted skip-not-overwrite (pre-existing target unchanged, new-slug row imported), chromium-admin only.

## Decisions Made
- Pre-existing conflicting link seeded via `createE2eLink` (direct Prisma), not the create-UI — this spec's own subject is the import flow, not link creation (14-RESEARCH.md Pattern 2).
- Seed happens INSIDE the test body, not `beforeAll` — a full-suite truncate race between seed and preview is recovered by the whole-test retry (`test.describe.configure({ retries: 2 })`) minting a fresh random slug/target.
- The DB assertion is the crux of this plan: proving exactly one row for the conflict slug with the UNCHANGED pre-existing target is a stronger, more specific proof of "skip, not overwrite, not duplicate" than the commit response's `importedCount`/`skippedCount` numbers alone.
- No overwrite mode was built or asserted anywhere — confirmed by 14-RESEARCH.md with certainty that skip is the only conflict-resolution strategy shipped in the codebase.
- Local minimal response-body types (`ImportPreviewBody`/`ImportCommitBody`/`ImportPreviewRow`) rather than importing `@kurzly/shared`'s types — `apps/e2e` has no dependency on `@kurzly/shared` (same rationale as 14-03).

## Deviations from Plan

None - plan executed exactly as written. Zero `apps/api`/`apps/web` diffs; the only file changed is the new spec file itself.

## Issues Encountered
- Same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in `11-06`/`12-01` through `12-05`/`14-01` through `14-03-SUMMARY.md` (unrelated projects: `zbr-brain-postgres-1`, `ddev-router`). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p14-04`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`, plus a `BASE_URL` override on `app`).
- First boot attempt failed with `db` unhealthy — `initdb: error: could not create directory ... No space left on device`. Diagnosed as Docker Desktop's own VM disk being full (`docker system df` showed 19.85GB of reclaimable build cache plus 32GB of images), not a host-disk issue (host had 189GB free). Fixed with `docker builder prune -af` (safe — build cache only, does not touch any running container or volume of any other project), which freed the needed space; the stack then booted healthy on the retry.
- Hit the exact documented "3rd-consecutive-invocation" flake (STATE.md/`13-*`/`14-01`-through-`14-03-SUMMARY.md`) on the first default-parallelism attempt against the same long-lived stack: `links-crud.spec.ts` timed out waiting for `+ Neuer Link`, and `storage-state.spec.ts` landed on `/login`/`/team` unexpectedly for both projects — accumulated Mailpit/DB state across back-to-back Playwright invocations on one long-lived compose stack, not a spec defect. Rebooted the stack fresh (`down` + `up -d --wait`, keeping the same project) and re-ran the full `tests/authed/` suite once at default parallelism: **7 passed, 3 skipped, zero flakes** — the definitive, reported result for this plan's per-wave-merge gate.
- Tore the stack down fully (`down -v --remove-orphans`), removed this session's own scratch Docker images (`kurzly-e2e-p14-04-app`/`-oidc-mock`), and deleted the override compose file + generated `.env`/`.env.bak`. Confirmed via `docker ps`/`git status --short` that only this session's own containers were touched, every unrelated project's containers are untouched, and the working tree is clean apart from this plan's own spec file (plus the pre-existing, already-untracked `14-CONTEXT.md`/`14-VALIDATION.md` files this plan did not create or modify).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
LINKS-E2E-03 is fully proven, live, against the built compose image. This is the last plan in Phase 14 (Links & CSV Import E2E) — all three requirements (LINKS-E2E-01, LINKS-E2E-02, LINKS-E2E-03) are now covered by real-browser E2E specs under `apps/e2e/tests/authed/`, with the full `tests/authed/` directory green at both `--workers=1` and default parallelism on a fresh stack boot. No blockers for Phase 15 (QR Studio).

---
*Phase: 14-links-csv-import-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/csv-import-conflict.spec.ts
- FOUND: commit c716b9a
