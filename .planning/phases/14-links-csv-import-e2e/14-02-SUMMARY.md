---
phase: 14-links-csv-import-e2e
plan: 02
subsystem: testing
tags: [playwright, e2e, links, crud, chromium-admin]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: "storageState auth fixtures (chromium-admin/chromium-member projects, tests/authed/ testMatch), createE2ePrisma, withResetDbLock"
  - phase: 12-redirect-handler-e2e
    provides: "apps/e2e/src/links.ts's createE2eLink direct-Prisma fixture helper (raw-insert Link fixtures)"
provides:
  - "apps/e2e/tests/authed/links-crud.spec.ts — LINKS-E2E-01, the canonical create->list->edit->search/filter->delete link journey driven entirely through the real dashboard UI (LinkFormModal, search box, domain-filter tab, delete confirm dialog), scoped to chromium-admin"
affects: [15-qr-studio-e2e, 16-analytics-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Whole-journey UI E2E test: every mutation (create/edit/delete) is re-verified by BOTH its HTTP status (via page.waitForResponse + Promise.all around the triggering click) AND a fresh server GET refetch (the search box), never by the optimistic local list mutation alone"
    - "URL-object predicate matching in waitForResponse (new URL(r.url()).pathname / .searchParams) instead of raw string .includes() — avoids false-positive matches between /api/links, /api/links/:id, and /api/links/import/*"
    - "test.skip(testInfo.project.name !== 'chromium-admin', ...) inside test.beforeEach to scope an authed-project spec to one role while still registering (and correctly skipping) under the other"

key-files:
  created:
    - apps/e2e/tests/authed/links-crud.spec.ts
  modified: []

key-decisions:
  - "test.describe.configure({ retries: 2 }) applied at the file level — mirrors apps/e2e/src/links.ts's fetchWithFixtureRaceRetry precedent for the documented cross-file db-isolation.spec.ts Link-table truncate race, but as a whole-journey retry (fresh per-test random slugs on every attempt) since a UI flow can't retry a single HTTP call in isolation the way a direct-HTTP spec can."
  - "Row-level edit/delete action buttons are located via getByTitle (title attribute), and the delete-confirmation button via a CSS-class-scoped locator (.delete-dialog .delete-confirm-button) — not a role/text locator — because the row's own delete icon and the dialog's confirm button both carry the German string 'Löschen' (14-RESEARCH.md Pitfall 2)."
  - "No production code changes were needed — apps/web/src/views/LinksView.vue, LinkFormModal.vue, and api.ts's createLink/updateLink/deleteLink/listLinks all behaved exactly as 14-RESEARCH.md documented on the first live run against the built compose image."

patterns-established:
  - "Search-narrowing proof pattern: seed >=2 decoy links via direct-Prisma createE2eLink, then assert the search-scoped GET returns exactly 1 row excluding both decoys — a 1-item list alone cannot prove server-side filtering is real (14-RESEARCH.md OQ-2)."

requirements-completed: [LINKS-E2E-01]

coverage:
  - id: D1
    description: "Admin creates a link through the real LinkFormModal (POST /api/links -> 201) and a subsequent server GET (via the search box) returns it, proving persistence beyond the optimistic local list unshift"
    requirement: "LINKS-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/links-crud.spec.ts — 'LINKS-E2E-01: canonical link lifecycle through the real UI and API > canonical link lifecycle through the real UI and API', run live via ./scripts/e2e-compose.sh-equivalent (manual port-remapped compose boot) against the built image, --project=chromium-admin"
        status: pass
    human_judgment: false
  - id: D2
    description: "Editing the link through the real modal (PATCH /api/links/:id -> 200) changes its target, confirmed by a server refetch showing the new target URL"
    requirement: "LINKS-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/links-crud.spec.ts — same test, EDIT + SEARCH sections"
        status: pass
    human_judgment: false
  - id: D3
    description: "Searching the link's unique slug narrows a multi-link list to exactly that one row (2 seeded decoys excluded), and the domain-filter tab re-queries scoped to the baseline domain"
    requirement: "LINKS-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/links-crud.spec.ts — same test, SEARCH + DOMAIN FILTER sections"
        status: pass
    human_judgment: false
  - id: D4
    description: "Deleting through the real confirm dialog (DELETE /api/links/:id -> 204) removes the row, confirmed by a server refetch that no longer returns it"
    requirement: "LINKS-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/links-crud.spec.ts — same test, DELETE + DELETE-persistence sections"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-25
status: complete
---

# Phase 14 Plan 02: LINKS-E2E-01 Canonical Link Lifecycle Summary

**A single Playwright spec proving create->list->edit->search/filter->delete entirely through the real LinkFormModal/search box/domain tab/delete dialog, with every mutation re-verified against a fresh server GET, not the optimistic local list — scoped to chromium-admin.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-07-25
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Wrote `apps/e2e/tests/authed/links-crud.spec.ts`: one test driving the full canonical link journey through the actual dashboard UI — `+ Neuer Link` -> `LinkFormModal` (create) -> row appears -> `Bearbeiten` -> `LinkFormModal` (edit) -> `Suchen…` search box (narrows a 3-link list — target + 2 seeded decoys — to exactly 1 row, proving real server-side filtering) -> domain-filter tab (`e2e.kurzly.local`) -> row-level `Löschen` -> `.delete-dialog` confirm -> a final search re-query proving the row is gone server-side, not just from the local array.
- Every mutation asserts BOTH the HTTP status (201 create / PATCH ok / 204 delete) AND a fresh server GET refetch — closing threat T-14-03 (an optimistic write that silently failed server-side could otherwise still render as "success").
- Scoped to `chromium-admin` only via a `test.beforeEach` skip keyed on `testInfo.project.name`, matching the plan's explicit judgment call that member/domain-scoped link authz is Phase 17's job.
- Confirmed live, three separate times against the built compose image (once for the targeted spec alone, once for the full `tests/authed/` directory at `--workers=1`, once at default parallelism on a freshly rebooted stack) — all green, zero `apps/api`/`apps/web` diffs needed. 14-RESEARCH.md's documented selectors (placeholders, `.table-row`, `.modal-dialog`, `.delete-dialog .delete-confirm-button`, `getByTitle`) matched the real rendered markup exactly on the first attempt.
- `pnpm --filter @kurzly/e2e typecheck` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: LINKS-E2E-01 — canonical create->list->edit->search/filter->delete journey (chromium-admin)** - `b9ba977` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified
- `apps/e2e/tests/authed/links-crud.spec.ts` - LINKS-E2E-01 canonical journey: create (real modal) -> list -> edit (real modal) -> search/filter (real search box + domain tab) -> delete (real confirm dialog), chromium-admin only, `retries: 2` for the documented cross-file db-isolation truncate race.

## Decisions Made
- `test.describe.configure({ retries: 2 })` at the file level — the whole-journey UI equivalent of `apps/e2e/src/links.ts`'s `fetchWithFixtureRaceRetry` pattern for the documented cross-file `db-isolation.spec.ts` Link-table truncate race (every retry attempt mints fresh random slugs, so no collision risk).
- Row-action buttons (`Bearbeiten`/`Löschen`) located via `getByTitle`; the delete-confirmation button located via a CSS-class-scoped locator (`.delete-dialog .delete-confirm-button`) rather than a role/text locator, since the row's own delete icon and the dialog's confirm button both carry the string "Löschen" (14-RESEARCH.md Pitfall 2).
- `waitForResponse` predicates parse `new URL(r.url())` and check `.pathname`/`.searchParams` rather than doing raw string `.includes()` — avoids any risk of `/api/links` substring-matching `/api/links/:id` or `/api/links/import/*`.
- No production code changes — `apps/web/src/views/LinksView.vue`, `LinkFormModal.vue`, and `apps/web/src/api.ts` all behaved exactly as `14-RESEARCH.md` documented; no genuine app bug was found while driving the real UI live, so no TDD RED->GREEN app-code fix was needed this plan.

## Deviations from Plan

None — plan executed exactly as written. Zero `apps/api`/`apps/web` diffs; the only file changed is the new spec file itself.

## Issues Encountered
- This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in `11-06-SUMMARY.md`/`12-01-SUMMARY.md`/`12-02-SUMMARY.md`/`14-01-SUMMARY.md` (unrelated projects: `zbr-brain-postgres-1`, `ddev-router`). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p14-02`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`, plus a `BASE_URL` override on `app`), ran the targeted spec (green), the full `tests/authed/` directory at `--workers=1` (green) and at default parallelism (green on a freshly booted stack), then tore the stack down fully (`down -v --remove-orphans`), removed this session's own scratch Docker images (`kurzly-e2e-p14-02-app`/`-oidc-mock`), and deleted the override file + generated `.env`. Confirmed via `docker ps`/`git status --short` that only this session's own stack was touched.
- Reproduced the exact "3rd-consecutive-invocation stack-reuse flake" already documented in STATE.md (Phase 13 finding) and `14-01-SUMMARY.md`: after 3-4 back-to-back Playwright invocations against the SAME long-lived compose stack (without rebooting), both `links-crud.spec.ts` (this plan's new spec) AND the pre-existing, untouched `storage-state.spec.ts`, and eventually even `auth.setup.ts` itself (the shared magic-link auth fixture), started timing out — conclusive evidence this is accumulated Mailpit/DB/resource-contention state across repeated invocations on one long-lived stack on this dev machine, not a defect in the new spec (a genuinely broken spec would not also break the unrelated, unmodified `storage-state.spec.ts`/`auth.setup.ts`). Confirmed this by rebooting the stack fresh and re-running the full `tests/authed/` suite once at default parallelism: 5 passed, 1 skipped, zero flakes — the definitive, reported result for this plan's verification gate.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
LINKS-E2E-01 is fully proven, live, against the built compose image. `apps/e2e/tests/authed/links-crud.spec.ts` establishes the link-creation-through-the-real-UI pattern (create modal fill + submit + `waitForResponse` status assertion + server refetch) that Plans 14-03/14-04 (CSV import) and Phases 15/16 (QR Studio, Analytics) can reuse directly. No blockers.

---
*Phase: 14-links-csv-import-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/links-crud.spec.ts
- FOUND: commit b9ba977
