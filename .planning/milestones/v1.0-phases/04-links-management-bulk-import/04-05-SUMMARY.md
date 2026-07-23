---
phase: 04-links-management-bulk-import
plan: 05
subsystem: ui
tags: [vue, vue-router, vitest, vue-test-utils, links, csv-import]

# Dependency graph
requires:
  - phase: 04-links-management-bulk-import
    provides: "04-02: LinkDTO/CreateLinkInput/UpdateLinkInput DTOs + POST/GET /api/links"
  - phase: 04-links-management-bulk-import
    provides: "04-03: GET/PATCH/DELETE /api/links/:id (IDOR-guarded)"
  - phase: 04-links-management-bulk-import
    provides: "04-04: ImportPreviewResult/ImportCommitResult DTOs + POST /api/links/import/{preview,commit}"
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "ApiError/parseJsonOrThrow fetch pattern, App Shell nav, requiresAuth router guard"
  - phase: 03-domains-multi-domain-tls-routing
    provides: "DomainsView.vue reference SFC (per-view toast, modal shell, delete-confirm dialog)"
provides:
  - "apps/web/src/api.ts — createLink/listLinks/getLink/updateLink/deleteLink/previewImport/commitImport typed client; ApiError gains an optional `code` field + mapLinkFormError helper"
  - "apps/web/src/router/index.ts — /links (LinksView), /links/:id (LinkDetailView), /links/import (LinksImportView), replacing the ComingSoonView placeholder"
  - "apps/web/src/components/LinkFormModal.vue — shared create/edit modal with the persistent D-04 slug-change warning"
  - "apps/web/src/views/LinksView.vue, LinkDetailView.vue, LinksImportView.vue — the full Links workspace UI"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ApiError.code (Rule 2 addition): parseJsonOrThrow now best-effort parses the JSON error body's `error` field into ApiError.code, since several Link mutations share one HTTP status for distinct causes (both INVALID_TARGET_URL and SLUG_RESERVED return 400) — status alone can't drive precise inline field errors."
    - "mapLinkFormError lives in api.ts, not inside LinkFormModal.vue's SFC — the generic `declare module \"*.vue\"` shim (vite-env.d.ts) only declares a `default` export, so a named export from an SFC's <script> block would not type-check under plain `tsc --noEmit` (no vue-tsc in this repo)."
    - "Toast-then-delayed-navigate: LinkDetailView's delete and LinksImportView's commit both show the per-view toast first, then router.push after a short setTimeout — preserves the strict per-view-ref/no-global-store toast convention (04-PATTERNS.md) while still surfacing the toast before the view unmounts on navigation."
    - "Server-driven search/filter: LinksView re-fetches via listLinks({ q, domainId }) on every search keystroke and domain-tab click — no client-side filtering of a cached array, so the list always reflects only the scoped API response (D-03, T-04-UIAUTHZ)."

key-files:
  created:
    - apps/web/src/components/LinkFormModal.vue
    - apps/web/src/components/LinkFormModal.test.ts
    - apps/web/src/views/LinksView.vue
    - apps/web/src/views/LinksView.test.ts
    - apps/web/src/views/LinkDetailView.vue
    - apps/web/src/views/LinkDetailView.test.ts
    - apps/web/src/views/LinksImportView.vue
    - apps/web/src/views/LinksImportView.test.ts
  modified:
    - apps/web/src/api.ts
    - apps/web/src/router/index.ts

key-decisions:
  - "ApiError extended with an optional `code` field (parsed from the JSON error body's `error` field) rather than mapping inline field errors from HTTP status alone — enables precise 400-vs-400 disambiguation (INVALID_TARGET_URL vs SLUG_RESERVED) that status codes alone cannot provide. Backward compatible: existing call sites reading only `.status` are unaffected."
  - "Toast-then-delayed-navigate pattern for delete (LinkDetailView) and import-commit (LinksImportView): both show the toast on the current view for ~900ms before router.push, since the toast is per-view state (04-PATTERNS.md's explicit no-global-store convention) that would otherwise vanish instantly on navigation."
  - "isFiltering heuristic (searchQuery non-empty OR a domain tab selected) distinguishes the full 'Noch keine Links' empty state from the lighter 'Keine Links gefunden' no-match state, since the client has no separate signal for 'account has zero links total' vs 'current filter matched zero'."
  - "Domain is immutable in edit mode (read-only chip, not a Select) — matches 04-UI-SPEC.md's explicit Copywriting Contract note (Claude's Discretion, avoids redirect-scoping ambiguity)."

patterns-established:
  - "Shared create/edit form modal owning its own local field state (fresh instance per v-if open), with the parent view owning the actual API call and passing the last error back via a prop for inline mapping — reusable for any future create/edit pair (e.g. QR codes)."

requirements-completed: [LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, UI-06]

coverage:
  - id: D1
    description: "/links renders LinksView (list + search + domain-filter tabs + create/edit modals + delete confirm), replacing ComingSoonView; /links/:id renders LinkDetailView; /links/import renders LinksImportView"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts — full describe block (list render, empty state)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The link list is searchable and filterable by domain via server-side listLinks({ q, domainId }) calls, not client-only filtering"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#typing in the search field calls listLinks with the matching q param; #clicking a domain filter tab calls listLinks with the matching domainId param"
        status: pass
    human_judgment: false
  - id: D3
    description: "Copy composes the FULL https://{domain}/{slug} URL via navigator.clipboard and toasts 'Link kopiert' (LINK-04, D-06), from both the list row and the detail page"
    requirement: "LINK-04"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#copy composes the FULL https URL...; apps/web/src/views/LinkDetailView.test.ts#copy composes the FULL https URL..."
        status: pass
    human_judgment: false
  - id: D4
    description: "Edit modal changes target/slug and shows the persistent D-04 slug-change warning whenever open in edit mode"
    requirement: "LINK-06"
    verification:
      - kind: unit
        ref: "apps/web/src/components/LinkFormModal.test.ts#edit mode renders the PERSISTENT D-04 slug-change warning...; apps/web/src/views/LinksView.test.ts#edit mode renders the D-04 slug-change warning and saves via updateLink"
        status: pass
    human_judgment: false
  - id: D5
    description: "Detail page shows link attributes plus a STATIC placeholder stats card (no analytics API call) and supports copy/edit/delete"
    requirement: "LINK-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinkDetailView.test.ts — full describe block"
        status: pass
    human_judgment: false
  - id: D6
    description: "Delete requires confirmation, then calls deleteLink and toasts 'Link gelöscht' (list row and detail page both)"
    requirement: "LINK-07"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts#delete requires confirmation...; apps/web/src/views/LinkDetailView.test.ts#delete requires confirmation, calls deleteLink, toasts, then navigates to /links"
        status: pass
    human_judgment: false
  - id: D7
    description: "CSV import screen renders a LIVE server-computed preview ('{N} gültig · {M} übersprungen' + per-row skip reason for all four LinkSkipReason values), with no client-side CSV parsing/re-validation, and a two-phase preview->commit flow"
    requirement: "LINK-08"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksImportView.test.ts — full describe block (preview render, disabled-at-zero, commit toast, no re-validation)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Toast confirmations fire for create, copy, import, and delete (UI-06/D-06)"
    requirement: "UI-06"
    verification:
      - kind: unit
        ref: "apps/web/src/views/LinksView.test.ts (create/copy/delete toasts); apps/web/src/views/LinksImportView.test.ts#clicking Importieren calls commitImport and toasts"
        status: pass
    human_judgment: false
  - id: D9
    description: "UI-03 pixel-fidelity of the Links screens (list/detail/modals/import) vs. the prototype at 1440px, Light + Dark"
    verification: []
    human_judgment: true
    rationale: "Visual pixel-accuracy against the locked design tokens requires human/screenshot-based comparison — 04-UI-SPEC.md's own Verification section flags this as Manual-Only (per 04-VALIDATION.md), same as Phase 2/3's precedent. Component tests assert structure/behavior, not rendered pixel geometry."

# Metrics
duration: 18min
completed: 2026-07-11
status: complete
---

# Phase 4 Plan 05: Links Frontend — List, Detail, Bulk Import UI Summary

**Full Links workspace built on the Phase-2/3 SFC conventions: server-driven search/filter list, shared create/edit modal with the persistent D-04 slug-change warning, a detail page with a static Analytics-phase stats placeholder, and a two-phase CSV import screen whose live preview renders only the backend's dry-run result.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-11T20:38:53Z
- **Completed:** 2026-07-11T20:56:15Z
- **Tasks:** 3
- **Files modified:** 10 (2 modified, 8 created)

## Accomplishments
- `apps/web/src/api.ts` extended with the full Link/import typed client (`createLink`/`listLinks`/`getLink`/`updateLink`/`deleteLink`/`previewImport`/`commitImport`), reusing the existing `ApiError`/`parseJsonOrThrow`/same-origin `fetch` pattern
- `ApiError` gained an optional `code` field (best-effort parsed from the JSON error body) plus `mapLinkFormError`, enabling precise inline field errors even where `INVALID_TARGET_URL` and `SLUG_RESERVED` share HTTP 400
- Router: `/links` now resolves to `LinksView` (the `ComingSoonView` placeholder is gone for this route); `/links/:id` → `LinkDetailView`; `/links/import` → `LinksImportView`, all `requiresAuth: true`
- `LinkFormModal.vue`: shared create/edit modal — domain Select (active + accessible only) in create mode, a read-only domain chip in edit mode, and the PERSISTENT D-04 slug-change warning box shown for the entire time the edit modal is open
- `LinksView.vue`: server-driven search (`q`) + domain-filter tabs (`domainId`), the Kurzlink/Domain/Ziel/Erstellt table with Kopieren/Bearbeiten/Löschen row actions, row-click → detail, empty state vs. no-match state, full-URL copy + toasts for create/copy/delete
- `LinkDetailView.vue`: attributes header, chips row, a STATIC "Statistiken — bald verfügbar" placeholder card (no backend call), and copy/edit/delete wired to the same modal/dialog patterns
- `LinksImportView.vue`: dropzone + native file picker + drag-drop, `FileReader.readAsText` feeding `previewImport`, a live "{N} gültig · {M} übersprungen" summary with all four German skip-reason labels, "Beispieldatei laden" demo CSV, and a disabled-at-zero "Importieren (N)" that calls `commitImport` and toasts
- 55/55 `pnpm --filter @kurzly/web test` green (34 new component tests across the four new/modified test files), `pnpm --filter @kurzly/web exec tsc --noEmit` clean, `pnpm --filter @kurzly/web build` succeeds, workspace-wide `pnpm -r exec tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: api.ts client + routes + LinkFormModal + LinksView (list/search/filter/create/delete/copy/toasts)** - `cd22b01` (feat)
2. **Task 2: LinkDetailView (attributes + placeholder stats + copy/edit/delete)** - `3e4c7fb` (feat)
3. **Task 3: LinksImportView (file picker + live N valid/M skipped preview + commit)** - `5a95719` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/web/src/api.ts` - Link/import typed client functions; `ApiError.code` + `mapLinkFormError`
- `apps/web/src/router/index.ts` - `/links`→LinksView (replaces ComingSoon), `/links/:id`→LinkDetailView, `/links/import`→LinksImportView
- `apps/web/src/components/LinkFormModal.vue` - shared create/edit modal (D-04 slug warning)
- `apps/web/src/components/LinkFormModal.test.ts` - `mapLinkFormError` unit tests + modal render/emit tests
- `apps/web/src/views/LinksView.vue` - Links list screen
- `apps/web/src/views/LinksView.test.ts` - list/search/filter/create/copy/edit/delete/navigation tests
- `apps/web/src/views/LinkDetailView.vue` - Link detail screen with placeholder stats
- `apps/web/src/views/LinkDetailView.test.ts` - detail render/copy/edit/delete/not-found tests
- `apps/web/src/views/LinksImportView.vue` - CSV bulk-import screen
- `apps/web/src/views/LinksImportView.test.ts` - preview/commit/sample-CSV tests

## Decisions Made
- `ApiError.code` (parsed best-effort from the JSON error body) added rather than relying on HTTP status alone for inline field-error mapping — several Link mutations return 400 for two distinct causes (`INVALID_TARGET_URL` vs `SLUG_RESERVED`), and status-only mapping couldn't disambiguate. Backward compatible: optional field, existing status-only call sites unaffected.
- `mapLinkFormError` lives in `api.ts`, not inside `LinkFormModal.vue`'s SFC — the project's generic `declare module "*.vue"` shim (`vite-env.d.ts`, adopted in Phase 1 to drop `vue-tsc`) only declares a `default` export, so a named export from inside an SFC's plain `<script>` block would fail `tsc --noEmit` on import. Discovered and fixed during Task 1 authoring, before any commit.
- Toast-then-delayed-`router.push` (≈900ms) for LinkDetailView's delete and LinksImportView's commit — both need to show a toast that would otherwise vanish instantly since the current view unmounts on navigation, while staying within the project's strict per-view-ref/no-global-store toast convention (04-PATTERNS.md) rather than introducing cross-page toast state (a query param or a shared store).
- Domain is immutable in edit mode (read-only chip, not a Select) per the UI-SPEC's explicit Copywriting Contract note — avoids redirect-scoping ambiguity, matches the plan's `<action>` guidance.
- `isFiltering` (search text non-empty OR a domain tab selected) drives which empty state renders — the client has no separate "total links across all domains" signal, so this heuristic distinguishes "no links at all" from "current filter matched nothing."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved the Link-form error-mapping function out of the SFC's `<script>` block into `api.ts`**
- **Found during:** Task 1 (authoring `LinkFormModal.vue` + its test)
- **Issue:** The original design put a plain, testable `mapLinkFormError` function in a second `<script lang="ts">` block alongside `LinkFormModal.vue`'s `<script setup>`, intending to import it as a named export in the test file. `apps/web/src/vite-env.d.ts`'s `declare module "*.vue"` ambient shim only declares a `default` export (adopted in Phase 1 to run plain `tsc --noEmit` without `vue-tsc`, since `typescript@7.0.2` is incompatible with `vue-tsc`) — a named export from inside the SFC would not type-check when imported elsewhere, blocking `tsc --noEmit`.
- **Fix:** Moved `LinkFormFieldErrors`/`mapLinkFormError` into `apps/web/src/api.ts` (already the natural home for anything touching `ApiError`); `LinkFormModal.vue` imports it from there, and `LinkFormModal.test.ts` does too.
- **Files modified:** `apps/web/src/api.ts`, `apps/web/src/components/LinkFormModal.vue`, `apps/web/src/components/LinkFormModal.test.ts`
- **Verification:** `pnpm --filter @kurzly/web exec tsc --noEmit` clean; all `LinkFormModal.test.ts` assertions pass.
- **Committed in:** `cd22b01` (Task 1 commit — caught before the first commit, no separate fix commit needed).

**2. [Rule 2 - Missing Critical] Added `ApiError.code` (parsed error body) instead of status-only field-error mapping**
- **Found during:** Task 1 (implementing the D-04 slug/target inline validation error mapping)
- **Issue:** The plan's acceptance criteria describe mapping "409→taken, 400→reserved/invalid" — but the backend's `POST/PATCH /api/links` routes return HTTP 400 for TWO distinct `LinkErrorCode`s (`INVALID_TARGET_URL` and `SLUG_RESERVED`), and the pre-existing `ApiError` class only carried `.status`, not the response body's `error` code string. Status-only mapping could not correctly attribute a 400 to the target-URL field vs. the slug field.
- **Fix:** Extended `parseJsonOrThrow` to best-effort parse the JSON error body's `error` field into a new optional `ApiError.code`, and built `mapLinkFormError`'s primary branch on `code` (falling back to status-only mapping when no code was parsed, e.g. a non-JSON body).
- **Files modified:** `apps/web/src/api.ts`
- **Verification:** `LinkFormModal.test.ts`'s `mapLinkFormError` describe block asserts both the code-based and status-only-fallback paths.
- **Committed in:** `cd22b01` (Task 1 commit).

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both auto-fixes were necessary for correctness (precise field-error mapping) and for the build to type-check at all. No scope creep — no new files outside the plan's stated deliverables, no new routes/endpoints.

## Issues Encountered
- Running the plan's literal `<verify>` command via `pnpm --filter @kurzly/web test -- --run <files>` did not filter to the specified files in this environment (pnpm's argument-forwarding inserted a second `--`, causing vitest to collect the entire suite instead). Confirmed this is a pnpm/rtk CLI-forwarding quirk, not a test-isolation problem, by running `npx vitest run <files>` directly inside `apps/web` (21/21 passed for Task 1's two target files in true isolation, independent of Task 2/3's not-yet-existing files). The full suite (`pnpm --filter @kurzly/web test`, no extra args) passes 55/55 regardless.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (Links Management & Bulk Import) is now functionally complete end-to-end: a user can create, search, filter, view, edit (with the D-04 slug warning), delete, and bulk-import links entirely through the dashboard, with the server as the sole authorization/validation boundary throughout.
- **Manual UAT gate (UI-03, per 04-VALIDATION.md Manual-Only):** pixel-fidelity of the Links screens (list/detail/modals/import) against the prototype at 1440px, Light + Dark themes — not automatable, flagged for `/gsd-verify-work`.
- The Statistik-Platzhalter card on `LinkDetailView` is an intentional, documented placeholder (no backend call) — real click numbers are Phase 6 (Analytics). Not a stub requiring follow-up within this phase.
- No blockers or concerns carried forward.

---
*Phase: 04-links-management-bulk-import*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: apps/web/src/api.ts
- FOUND: apps/web/src/router/index.ts
- FOUND: apps/web/src/components/LinkFormModal.vue
- FOUND: apps/web/src/components/LinkFormModal.test.ts
- FOUND: apps/web/src/views/LinksView.vue
- FOUND: apps/web/src/views/LinksView.test.ts
- FOUND: apps/web/src/views/LinkDetailView.vue
- FOUND: apps/web/src/views/LinkDetailView.test.ts
- FOUND: apps/web/src/views/LinksImportView.vue
- FOUND: apps/web/src/views/LinksImportView.test.ts
- FOUND commit: cd22b01
- FOUND commit: 3e4c7fb
- FOUND commit: 5a95719
