# Phase 14: Links & CSV Import E2E - Research

**Researched:** 2026-07-25
**Domain:** Playwright E2E for Vue 3 dashboard CRUD + two-step CSV bulk-import, against a Fastify/Prisma/PostgreSQL backend
**Confidence:** HIGH

## Summary

This phase adds real-browser E2E coverage for the Links dashboard (`apps/web/src/views/LinksView.vue`, `LinkFormModal.vue`) and the CSV bulk-import screen (`LinksImportView.vue`) against the actual Fastify routes (`apps/api/src/routes/links.ts`) and Prisma-backed core (`apps/api/src/lib/links.ts`). All source was read directly this session — nothing in this document about request/response shapes or UI behavior is inherited from CONTEXT.md's open questions without independent verification.

Two of CONTEXT.md's explicitly-flagged unknowns are now resolved with certainty, and both resolve differently than CONTEXT.md's phrasing implied:

1. **Commit does NOT reference the preview by an ID/token.** `POST /api/links/import/commit` takes the exact same request body shape as `POST /api/links/import/preview` — `{ csv: string, defaultDomainId?: string }` — and re-parses/re-runs the raw CSV text through the identical `runImport` core (`lib/links.ts`), only with `mutate: true` instead of `false`. There is no server-side preview cache, no preview ID, nothing to reference. The Vue view (`LinksImportView.vue`) simply keeps the original `csvText` ref in memory and resends it verbatim on commit. **The E2E test must resend the same CSV string for the preview and commit calls** — this is a structural fact, not a design choice the planner gets to make.

2. **Slug-conflict resolution is SKIP ONLY — there is no overwrite mode, server-side or in the UI.** `mapErrorToSkipReason` in `lib/links.ts` maps a `SLUG_TAKEN` (or `SLUG_RESERVED`/`SLUG_INVALID_SHAPE`/`SLUG_GENERATION_EXHAUSTED`) validation failure to the `"slug_conflict"` `LinkSkipReason`; the row is marked `valid: false` and is never written, on both preview and commit. There is no per-row or per-import "overwrite" option anywhere in `routes/links.ts`, `lib/links.ts`, or `LinksImportView.vue`. LINKS-E2E-03's German wording "verhält sich wie spezifiziert (skip/overwrite)" describes two *possible* strategies in the abstract requirement-writing sense, but the actual shipped behavior is unconditional skip. The test must assert skip behavior; asserting or building for an "overwrite" path would test something that does not exist in the code.

**Primary recommendation:** Write these specs under `apps/e2e/tests/authed/` (NOT a new top-level `tests/links/` directory — `playwright.config.ts`'s `chromium-admin`/`chromium-member` projects are hard-wired via `testMatch: /authed\/.*\.spec\.ts$/`, so any spec outside that directory silently never runs under either authenticated project). Drive the real create-link form and the real CSV upload/preview/commit UI per CONTEXT.md's mandate; there are zero `data-testid` attributes anywhere in `apps/web/src` (confirmed by full reads of `LinksView.vue`, `LinkFormModal.vue`, `LinksImportView.vue`) — every selector must be built from Playwright's `getByRole`/`getByPlaceholder`/`getByText` or scoped CSS-class locators, never an invented test-id.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Link create/edit/delete form submission | Browser / Client | API / Backend | `LinkFormModal.vue` collects input and emits a payload; `LinksView.vue` calls `api.ts`'s `createLink`/`updateLink`/`deleteLink`, but every rule (slug shape, domain access, target-URL scheme) is enforced server-side in `lib/links.ts`'s `validateLinkInput` — the client never re-implements validation, only renders errors the server returns. |
| Link list search/filter | Browser / Client | API / Backend | `LinksView.vue`'s search input and domain tabs are debounced triggers only (`SEARCH_DEBOUNCE_MS = 250`); the actual filtering (`q`/`domainId` query params, case-insensitive `contains` on slug/targetUrl/title) happens in `GET /api/links` (routes/links.ts). No client-side array filtering exists — every keystroke/tab click re-fetches. |
| CSV parsing + row validation | API / Backend | — | `LinksImportView.vue` reads the file client-side via `FileReader.readAsText` ONLY to get a string to POST — it does zero parsing or validation of its own. `runImport` (lib/links.ts) is the sole parser (`csv-parse/sync`) and validator, shared identically between preview and commit. |
| Preview/commit consistency | API / Backend | — | Both `previewImport` and `commitImport` are thin wrappers around the same `runImport(prisma, userId, csv, defaultDomainId, mutate)` function — `mutate` is the only branch point. This structurally guarantees preview can never drift from commit (documented in lib/links.ts's header comment as an explicit anti-pattern guard). |
| Link persistence (single insert path) | Database / Storage | API / Backend | `createLink` is the ONLY `prisma.link.create` call site in the codebase — both the manual-create route and the CSV importer's row loop funnel through it. No `createMany`/batch insert exists anywhere. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | 1.61.1 (already pinned, confirmed in `apps/e2e/package.json`) | E2E test runner | Already the project's sole E2E framework (Phase 11-13); no new library needed for this phase. |

No new core dependency is required for this phase — every capability needed (file-upload simulation, form interaction, real HTTP assertions) is covered by the already-installed `@playwright/test`.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@kurzly/api/prisma-client` (workspace subpath export) | n/a (workspace) | Direct-Prisma DB assertions after CSV commit (LINKS-E2E-02/03's "asserted directly against the database" requirement) | Reuse `apps/e2e/src/db.ts`'s existing `createE2ePrisma()` — do not add a second DB client. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Driving the real `<input type="file">` via `setInputFiles` | Calling `page.evaluate` to inject a `File` object and dispatch `drop` | `setInputFiles` is simpler and Playwright-native; the drop-zone's `@drop` handler is a secondary UX path (drag-and-drop) that duplicates the same `readFile()` function the file-input `@change` handler calls — testing via `setInputFiles` on the (hidden) `<input>` exercises the identical code path with far less flakiness. Only test the drop path if a future phase explicitly wants drag-and-drop coverage. |
| Building CSV fixtures as static files under `apps/e2e/tests/authed/fixtures/` | Generating CSV strings inline in the spec and writing them to a Playwright `tmpdir` at runtime | Either works; static fixture files are simpler to read/review and match the "Beispieldatei laden" (`SAMPLE_CSV`) precedent already in `LinksImportView.vue`. Runtime-generated CSVs are only worth it if a test needs a CSV whose content depends on a fixture ID computed at test time (e.g. embedding a dynamically-created link's slug to force a conflict) — likely needed for LINKS-E2E-03, see Pattern 2 below. |

**Installation:** None — no new packages.

**Version verification:** `@playwright/test` version confirmed via `apps/e2e/package.json` (already pinned `^1.61.1`, matches STACK.md); no registry lookup needed since nothing new is being added.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are being installed — every capability (file upload simulation, form driving, DB assertions) is covered by already-installed, already-audited dependencies (`@playwright/test`, `@kurzly/api/prisma-client`, `@prisma/adapter-pg`, `bcryptjs`, all vetted in Phase 11/12's research). If the planner discovers a genuine need for a new package (e.g. a CSV-building helper library), route it back through this gate before use.

## Architecture Patterns

### System Architecture Diagram

```
Playwright test (chromium-admin/-member project)
        |
        | 1. page.goto("/links") -- authenticated via storageState
        v
LinksView.vue  ---- GET /api/links?q=&domainId= ---->  routes/links.ts
        |                                                     |
        | 2. click "+ Neuer Link"                             | scopedDomainIds + Prisma findMany
        v                                                     v
LinkFormModal.vue (mode=create)                        PostgreSQL (Link table)
        |
        | 3. fill Ziel-URL/Slug, submit
        v
api.ts createLink() ---- POST /api/links -------->  routes/links.ts
                                                            |
                                                            v
                                                   lib/links.ts createLink()
                                                     -> validateLinkInput()
                                                     -> prisma.link.create()  (SOLE insert site)
        |
        | 4. list re-renders (unshift), row appears
        v
LinksView.vue table row -- click "Bearbeiten" ---> LinkFormModal.vue (mode=edit)
        |                                                |
        | 5. change targetUrl, submit                    v
        v                                          PATCH /api/links/:id -> updateLink() -> prisma.link.update()
        | 6. type in search box (debounced 250ms)
        v
GET /api/links?q=<term> -> case-insensitive Prisma `contains` filter -> re-render
        |
        | 7. click delete icon -> confirm dialog -> confirmDelete()
        v
DELETE /api/links/:id -> resolveOwnedLink (IDOR guard) -> prisma.link.delete()


CSV import flow (separate route /links/import):

Playwright test
        |
        | 1. page.goto("/links/import")
        v
LinksImportView.vue
        |
        | 2. setInputFiles() on hidden <input type=file> -> FileReader.readAsText()
        |    -> csvText.value set -> loadPreview() fires automatically
        v
api.ts previewImport(csvText, defaultDomainId) --- POST /api/links/import/preview --> routes/links.ts
                                                                                          |
                                                                                          v
                                                                            lib/links.ts previewImport()
                                                                              -> runImport(mutate=false)
                                                                              -> csv-parse -> per-row previewLink()
                                                                              ZERO DB writes
        |
        | 3. preview.value populated -> preview-row list renders (valid/invalid + reason)
        v
        | 4. click "Importieren (N)" -> handleCommit()
        v
api.ts commitImport(csvText, defaultDomainId) --- POST /api/links/import/commit --> routes/links.ts
                                                                                        |
                                                                                        v
                                                                          lib/links.ts commitImport()
                                                                            -> runImport(mutate=true)
                                                                            -> SAME csv-parse + row loop
                                                                            -> per-row createLink() (SOLE insert site)
        |
        | 5. toast shown, router.push({name:"links"}) after 900ms
        v
Playwright test asserts directly against PostgreSQL via apps/e2e/src/db.ts's Prisma client
```

### Recommended Project Structure
```
apps/e2e/tests/authed/
├── links-crud.spec.ts        # LINKS-E2E-01: create -> list -> edit -> search/filter -> delete
├── csv-import-happy.spec.ts  # LINKS-E2E-02: valid CSV, preview row count/diff, commit writes exactly previewed rows
├── csv-import-conflict.spec.ts  # LINKS-E2E-03: CSV with a slug conflict, preview surfaces it, commit skips it
└── fixtures/
    ├── links-import-valid.csv     # 2-3 rows, all new slugs, no conflicts
    └── links-import-conflict.csv  # includes one row whose slug already exists in the DB at test time
```
`storage-state.spec.ts` (Phase 11) already lives directly under `tests/authed/`, not a subfolder — new specs should follow that same flat layout (one file per behavior), not introduce a nested `tests/authed/links/` directory, to stay consistent with the existing single-level convention.

### Structure Rationale

The `tests/authed/` placement is not a style preference — it is required by `playwright.config.ts`'s `testMatch: /authed\/.*\.spec\.ts$/` on both `chromium-admin` and `chromium-member`. A spec placed under a new top-level `tests/links/` directory (as CONTEXT.md's discretion note speculated) would match no project's `testMatch` and would never execute under an authenticated session — Playwright would silently skip it or, if a bare invocation without `--project` were used, fail with "No tests found" the way `auth` project specs did before Wave 1 landed (STATE.md's Phase 13 note). This is the single most important structural correction this research makes to CONTEXT.md's assumptions.

### Pattern 1: No `data-testid` anywhere — selector strategy must use roles/text/CSS classes

**What:** Every interactive element in `LinksView.vue`, `LinkFormModal.vue`, and `LinksImportView.vue` is a plain `<button>`/`<input>`/`<select>` with no `data-testid`, and labels have no `for`/`id` binding (e.g. `<label class="field-label">Ziel-URL</label>` followed by a sibling `<input>` with no `id`), so Playwright's `getByLabel()` will NOT resolve them.

**When to use:** Every spec in this phase.

**Example (verified against actual markup):**
```typescript
// Source: apps/web/src/views/LinksView.vue + LinkFormModal.vue (read this session)

// List screen — open create modal
await page.getByRole("button", { name: "+ Neuer Link" }).click();

// Modal is unscoped by test-id; scope by role/structure instead.
const modal = page.locator(".modal-dialog");
await modal.getByPlaceholder("https://example.com/sehr/lange/url").fill(targetUrl);
// Slug field has NO placeholder in edit mode, and a DIFFERENT placeholder
// ("leer lassen = automatisch") only in create mode — for create mode:
await modal.getByPlaceholder("leer lassen = automatisch").fill(slug);
await modal.getByRole("button", { name: "Link erstellen" }).click();

// List row — search
await page.getByPlaceholder("Suchen…").fill(searchTerm);
// 250ms debounce (LinksView.vue's SEARCH_DEBOUNCE_MS) — wait for the
// network response, not an arbitrary timeout:
await page.waitForResponse((r) => r.url().includes("/api/links") && r.request().method() === "GET");

// Domain filter tabs (button text == hostname, e.g. "e2e.kurzly.local")
await page.getByRole("button", { name: "e2e.kurzly.local" }).click();

// Edit
await page.locator(".table-row", { hasText: slug }).getByTitle("Bearbeiten").click();

// Delete (confirm dialog)
await page.locator(".table-row", { hasText: slug }).getByTitle("Löschen").click();
await page.getByRole("button", { name: "Löschen" }).click(); // the dialog's confirm button, same text as the row's title attr — scope to `.delete-dialog` to disambiguate
```

**Anti-pattern to avoid:** Do not add `data-testid` attributes to the Vue components as part of this phase's plan unless a locator is genuinely unworkable without one (e.g. two elements with identical accessible name and no distinguishing ancestor) — introducing test-ids piecemeal for E2E convenience is a larger, cross-cutting UI change outside this phase's stated scope (E2E test coverage, not product code changes, per REQUIREMENTS.md's milestone scope note: "Dieses Milestone liefert keine neuen Produkt-Features"). Prefer scoped locators (`.table-row`, `.modal-dialog`, `.preview-row`) first; only escalate to the planner if a genuine ambiguity is hit.

### Pattern 2: Forcing a slug conflict for LINKS-E2E-03 requires a DB round-trip before building the CSV

**What:** `LinksImportView.vue`'s CSV format has no way to declare "this row's target is expected to already exist" — a conflict is purely a function of whatever slug already sits in the `Link` table for the resolved domain at request time. To reliably produce a `slug_conflict` skip reason in the preview, the test must first create a real Link (via the create-UI, to satisfy CONTEXT.md's "own subject IS link creation through the UI" mandate for at least the canonical journey — the CSV-conflict spec MAY use the direct-Prisma `createE2eLink` fixture helper instead, since CSV-conflict's own subject is the *import flow*, not link creation) with a known slug, then build a CSV fixture whose row uses that exact same slug.

**When to use:** LINKS-E2E-03 only.

**Example:**
```typescript
// Source: apps/e2e/src/links.ts (Phase 12, reused verbatim) + apps/e2e/src/db.ts
import { createE2eLink } from "../../src/links.js";

const prisma = createE2ePrisma();
await createE2eLink(prisma, { slug: "existing-slug", targetUrl: "https://example.com/pre-existing" });

const csv = `ziel_url,slug,domain\nhttps://example.com/new,existing-slug,\n`;
// POST this csv as-is; the preview response's rows[0] must have
// valid: false, reason: "slug_conflict" (LinkSkipReason, @kurzly/shared).
```

**Note on `defaultDomainId`:** the CSV's `domain` column is blank in the example above, which means the row falls back to whatever `defaultDomainId` the test selects in the UI's dropdown (`LinksImportView.vue`'s `select v-model="defaultDomainId"`, populated from `activeDomains`). Since this phase seeds only the baseline domain (`e2e.kurzly.local`, per CONTEXT.md's Deferred Ideas — no cross-domain testing here), select that hostname in the dropdown before uploading.

### Anti-Patterns to Avoid
- **Asserting the preview response shape without reading `@kurzly/shared`'s actual field names first:** `ImportRowResult` uses German-ish field names (`zielUrl`, not `targetUrl`) that mirror the CSV column header, NOT the `LinkDTO`'s English field names used elsewhere. A spec that asserts `row.targetUrl` will silently read `undefined` (TypeScript would catch this if the spec imports the real type; JS-style loose assertions would not) — always type the response as `ImportPreviewResult`/`ImportCommitResult` from `@kurzly/shared`.
- **Assuming commit accepts a previously-returned preview identifier:** confirmed false this session (see Summary) — do not write a test (or ask the planner to write a task) that tries to extract an "importId" from the preview response; no such field exists in `ImportPreviewResult`.
- **Testing an "overwrite" commit mode:** confirmed not to exist in the shipped code (see Summary) — LINKS-E2E-03 must assert skip behavior only. If the requirement's German wording is read literally as requiring an actual choice between skip/overwrite, that is a scope mismatch to flag to the user/planner, not something to build a test double for.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV file upload simulation | A real drag-and-drop event simulation via low-level mouse events | `page.locator('input[type="file"]').setInputFiles(path)` | Playwright's native file-input API works even though the input is `display:none` (`class="hidden-file-input"`) — `setInputFiles` does not require the element to be visible, unlike most other Playwright actions. No need to click the visible dropzone/trigger the native OS file picker (which Playwright cannot drive anyway). |
| Waiting for the search debounce | `page.waitForTimeout(300)` | `page.waitForResponse()` scoped to the `GET /api/links` request matching the debounced call | `SEARCH_DEBOUNCE_MS` is 250ms — a fixed sleep is both slower than necessary and a source of flakiness if CI is under load and the debounce+round-trip takes longer than the hardcoded wait. |
| Fixture Link creation for the CSV-conflict spec | Driving the CSV import UI twice (once to create the conflicting link, again to test the conflict) | `apps/e2e/src/links.ts`'s existing `createE2eLink` (direct Prisma insert, already used by Phase 12) | Reuses proven, already-audited fixture code; keeps the conflict spec focused on import behavior, not a second round of create-UI testing already covered by LINKS-E2E-01. |

**Key insight:** This phase's specs need almost no new fixture infrastructure — `apps/e2e/src/db.ts` (seedBaseline, `withResetDbLock`, `BASELINE_DOMAIN_HOSTNAME`) and `apps/e2e/src/links.ts` (`createE2eLink`) already cover every DB-side need. The only genuinely new asset is the two CSV fixture files themselves.

## Runtime State Inventory

Not applicable — this is a greenfield test-authoring phase (new Playwright spec files + CSV fixtures), not a rename/refactor/migration. No existing runtime state, stored data, or registered OS/service state is being renamed or moved.

## Common Pitfalls

### Pitfall 1: Search input race between debounce and the requestId guard
**What goes wrong:** A test that fills the search box and immediately asserts on `links.value` (or the rendered rows) without waiting for the actual network response can read stale data, OR flake if two searches overlap.
**Why it happens:** `LinksView.vue`'s `handleSearchInput` debounces 250ms before calling `loadLinks()`, which itself stamps a `requestId` and only applies the response if it's still the latest in-flight request.
**How to avoid:** Always `await page.waitForResponse(...)` for the specific `GET /api/links` call matching the search term, then assert on the rendered `.table-row` elements — never assert immediately after `.fill()`.
**Warning signs:** Intermittent failures only under `--workers=N` or CI load, never locally at `--workers=1`.

### Pitfall 2: The delete-confirm button's accessible name collides with the row's own delete icon's `title`
**What goes wrong:** Both the row-level delete icon (`title="Löschen"`, an emoji button `🗑` with no text content) and the confirm-dialog's actual button (`<button>Löschen</button>`) can match a loosely-scoped `getByText("Löschen")` or `getByRole("button", { name: "Löschen" })` locator.
**Why it happens:** `title` attributes are read by Playwright's accessible-name computation similarly to visible text, so an unscoped locator can match either element depending on DOM order/visibility at the time.
**How to avoid:** Scope the row's delete trigger to `.table-row` (use `getByTitle("Löschen")`, which IS distinct — the row button's accessible name comes from `title`, the dialog button's from its text content — but to be safe, scope the dialog confirm to `.delete-dialog` explicitly).
**Warning signs:** A test that clicks "delete" twice in a row, or that the delete confirmation dialog never actually appears in a screenshot/trace despite the test passing.

### Pitfall 3: CSV `defaultDomainId` interacting with `watch(defaultDomainId, ...)` re-fires preview
**What goes wrong:** `LinksImportView.vue` has a `watch(defaultDomainId, () => { if (csvText.value) loadPreview(); })` — selecting the domain dropdown AFTER uploading a file triggers a second preview request. A test that asserts on the FIRST preview response (before selecting the domain) will race against this second automatic re-fetch.
**Why it happens:** The default-domain select and the file upload are two independent triggers that both call `loadPreview()`; order of operations in the test matters.
**How to avoid:** Select the default domain in the UI BEFORE uploading the CSV (or before triggering `loadSample()`), so only one `loadPreview()` call fires, and always wait for the specific `POST /api/links/import/preview` response before asserting on `preview.value`'s rendered rows.
**Warning signs:** Preview row count occasionally short by the rows that depend on `defaultDomainId` resolution (a blank-`domain`-column CSV row with no default domain selected yet resolves to `UNAUTHORIZED_DOMAIN`/`domain_unauthorized`, not the expected valid outcome).

### Pitfall 4: `CsvRow` header validation rejects any CSV that doesn't literally match `ziel_url,slug,domain`
**What goes wrong:** A hand-written test CSV with a different column order, extra whitespace in header names, or English column names (`target_url` instead of `ziel_url`) throws a top-level `400` error (`isImportHeaderMismatchError`) before any row is even evaluated — this looks like the whole import silently failed, not a row-level skip.
**Why it happens:** `EXPECTED_CSV_COLUMNS = ["ziel_url", "slug", "domain"]` is checked via `Set` membership against the parsed header keys (IN-04 fix) — order doesn't matter (it's a Set), but exact key names do.
**How to avoid:** Always start fixture CSVs from the header line `ziel_url,slug,domain` exactly, matching `LinksImportView.vue`'s own `SAMPLE_CSV` constant. `slug`/`domain` cells may be blank; the header row itself must always have all three keys present.
**Warning signs:** A `previewImport` call that throws/returns a 400 for the whole request instead of a per-row `invalid` result.

## Code Examples

### Building a valid CSV fixture (mirrors the shipped sample)
```typescript
// Source: apps/web/src/views/LinksImportView.vue's SAMPLE_CSV constant (read this session)
export const VALID_IMPORT_CSV = `ziel_url,slug,domain
https://example.com/willkommen,e2e-import-a,
https://example.com/hilfe,e2e-import-b,
`;
```

### Uploading a CSV fixture via the hidden file input
```typescript
// Source: apps/web/src/views/LinksImportView.vue (verified: <input ref="fileInput" type="file" accept=".csv" class="hidden-file-input" @change="handleFileInputChange" />)
await page.locator('input[type="file"]').setInputFiles({
  name: "links-import-valid.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(VALID_IMPORT_CSV, "utf-8"),
});
await page.waitForResponse(
  (r) => r.url().includes("/api/links/import/preview") && r.request().method() === "POST",
);
```

### Asserting DB state directly after commit (LINKS-E2E-02's "no silent extras" requirement)
```typescript
// Source: apps/e2e/src/db.ts's createE2ePrisma() (Phase 11, reused verbatim)
const prisma = createE2ePrisma();
const importedLinks = await prisma.link.findMany({
  where: { slug: { in: ["e2e-import-a", "e2e-import-b"] } },
});
expect(importedLinks).toHaveLength(2); // exactly the previewed valid rows, nothing extra
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| CONTEXT.md's assumption: commit "references the preview by an ID/token" | Commit resends the raw CSV text verbatim; no server-side preview cache exists | Confirmed this research pass by reading `routes/links.ts`/`lib/links.ts` directly | Test authors must keep the CSV string in scope across the preview and commit calls in one spec — no lookup step needed or possible. |
| CONTEXT.md's assumption: slug-conflict resolution "skip vs. overwrite... must be read from the real backend/frontend code" | Confirmed: skip-only, no overwrite path exists anywhere in the codebase | Confirmed this research pass | LINKS-E2E-03 tests skip behavior exclusively; do not scope a task for testing overwrite semantics. |
| CONTEXT.md's assumption: new spec directory likely `apps/e2e/tests/links/` | Must be `apps/e2e/tests/authed/` — enforced by `playwright.config.ts`'s `testMatch` regex | Confirmed this research pass by reading `playwright.config.ts` | Placing specs in the wrong directory means they silently never run under `chromium-admin`/`chromium-member`. |

**Deprecated/outdated:** none.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Playwright's `setInputFiles()` will fire the Vue `@change` handler on the `hidden-file-input` reliably without needing the dropzone to be visible/interacted-with first | Don't Hand-Roll, Code Examples | Low — this is documented, standard Playwright behavior (`setInputFiles` explicitly works on non-visible file inputs); if it somehow doesn't fire the Vue reactivity in this app's build, the fallback is to use `page.locator(".dropzone-trigger").click()` first to ensure the input is "focused" per any hidden browser quirk, then retry `setInputFiles` — a same-day implementation fix, not a redesign. |
| A2 | The confirm-dialog's delete button (`.delete-dialog .delete-confirm-button`, text "Löschen") is reliably distinguishable from the row-level delete icon's `title="Löschen"` attribute via Playwright's accessible-name resolution without extra scoping | Common Pitfalls, Pitfall 2 | Low — worst case a test needs an explicit `.locator(".delete-dialog").getByRole(...)` scope, which this document already recommends as the safe default. |

**If this table is empty:** N/A — two low-risk implementation-detail assumptions above; everything else in this document (route paths, request/response shapes, validation behavior, selector availability) was verified by direct source reads this session, not assumed.

## Open Questions

1. **Should the canonical LINKS-E2E-01 journey use a dedicated, uniquely-generated slug/target-URL per test run, or rely on `withResetDbLock`'s per-file truncate for isolation?**
   - What we know: `Link` is one of the tables `withResetDbLock` truncates (`apps/e2e/src/db.ts`), and Phase 12's redirect specs already established the convention of cryptographically-random per-test slugs for `fullyParallel` safety.
   - What's unclear: whether this phase's specs need the SAME per-test-random-slug discipline, or whether truncate-per-file is sufficient given this phase's specs likely run one canonical journey per file (lower parallelism collision risk than Phase 12's many-small-tests-per-file shape).
   - Recommendation: default to a random slug suffix per test (matches established codebase convention, near-zero cost) unless the planner has a specific reason to rely on truncate-only isolation.

2. **Does the search/filter portion of LINKS-E2E-01 need additional seeded links (beyond the one created via the real form) to prove the search actually narrows a non-trivial list?**
   - What we know: `GET /api/links` is server-driven and will return every link in scope regardless of count; a single created link would trivially "pass" a search assertion even if search were completely broken (a 1-item list can't prove narrowing).
   - What's unclear: exactly how many additional links, and whether they should be created via `createE2eLink` (direct Prisma, faster, per CONTEXT.md's "Claude's Discretion" note) or also via the UI.
   - Recommendation (per CONTEXT.md's explicit discretion grant): seed 1-2 additional decoy links via `createE2eLink` (direct Prisma) alongside the UI-created link, so the search assertion proves the decoys are correctly excluded and the target link is correctly included — this keeps the test fast while still proving real narrowing behavior.

## Environment Availability

Not applicable — this phase adds no new external dependency (no new npm package, no new Docker service, no new tool). It reuses the entire Phase 11-13 E2E harness (compose stack, Postgres, Mailpit is not needed for this phase since no email flow is involved) as-is.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` 1.61.1 |
| Config file | `apps/e2e/playwright.config.ts` |
| Quick run command | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/links-crud.spec.ts --project=chromium-admin` (adjust filename once the planner finalizes spec names) |
| Full suite command | `scripts/e2e-compose.sh` (boots the compose stack, runs `pnpm --filter @kurzly/e2e test`, always tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| LINKS-E2E-01 | Create (real form) -> appears in list -> edit (real form) -> found via search/filter -> delete (real UI, confirm dialog) | e2e (browser, chromium-admin + chromium-member) | `playwright test tests/authed/links-crud.spec.ts` | ❌ Wave 0 |
| LINKS-E2E-02 | Valid CSV -> preview shows correct row count/diff -> commit writes exactly the previewed rows, asserted at the DB | e2e (browser + direct Prisma assertion) | `playwright test tests/authed/csv-import-happy.spec.ts` | ❌ Wave 0 |
| LINKS-E2E-03 | CSV with a slug conflict -> preview surfaces `slug_conflict` -> commit skips that row (no overwrite exists) | e2e (browser + direct Prisma fixture + Prisma assertion) | `playwright test tests/authed/csv-import-conflict.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted spec file only, e.g. `playwright test tests/authed/links-crud.spec.ts --project=chromium-admin`, against a running local compose stack.
- **Per wave merge:** full `tests/authed/` directory at both `--workers=1` and the CI's configured parallelism, to catch any new search-debounce/DB-truncate race this phase's specs introduce (mirrors Phase 11/12's own db-isolation discipline).
- **Phase gate:** full E2E suite (`scripts/e2e-compose.sh`, all directories) green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/e2e/tests/authed/links-crud.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/csv-import-happy.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/csv-import-conflict.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/fixtures/links-import-valid.csv` — CSV fixture file, does not exist yet.
- [ ] `apps/e2e/tests/authed/fixtures/links-import-conflict.csv` (or built inline in the spec per Pattern 2, since the conflicting slug must match a runtime-created fixture — a purely static file cannot pre-know that slug unless the spec hardcodes and creates a matching fixture Link with the SAME hardcoded slug, which also works and is simpler; planner's call).
- [ ] No `lib/links.ts` or `routes/links.ts` code changes are anticipated — this phase is test-authoring only, confirmed by full reads of both files.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes (indirect) | Specs run under existing `chromium-admin`/`chromium-member` `storageState` fixtures (Phase 11) — no new auth mechanism, just consuming the existing one. |
| V3 Session Management | no (unchanged) | This phase adds no session-management code. |
| V4 Access Control | yes (existing, tested incidentally) | `resolveOwnedLink`'s IDOR guard (routes/links.ts) and `scopedDomainIds` are exercised naturally by every create/edit/delete/list call this phase's specs make, but full domain-denial-matrix testing is explicitly Phase 17's job (CONTEXT.md's Deferred Ideas) — this phase does not need a dedicated denial spec. |
| V5 Input Validation | yes (existing, tested incidentally) | `validateLinkInput`'s target-URL scheme check, slug shape/reserved-word checks, and the CSV header/row validation are all exercised by the happy-path and conflict specs, but exhaustive validation-error-message testing is explicitly out of scope for this milestone (REQUIREMENTS.md's Out of Scope table: "Exhaustive Validierungsfehler-Meldungen... gehört in Unit-Tests"). |
| V6 Cryptography | n/a | No new crypto surface — Links created in this phase's specs do not need password protection (that's Phase 12's redirect-handler scope), so `derivePasswordHash` is not exercised here. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| CSV import row limit / resource exhaustion (`MAX_IMPORT_ROWS = 500`, `CSV_MAX_LENGTH = 1_800_000`) | Denial of Service | Already enforced server-side (lib/links.ts, routes/links.ts) — this phase's specs use small (2-5 row) fixtures and do not need to re-test the row-limit boundary itself (that would be a unit-test concern per the milestone's Out-of-Scope table, unless the planner decides a lightweight smoke-boundary check adds value). |
| CSV per-row domain-authorization bypass via a crafted `domain` column value | Elevation of Privilege | Already covered by `resolveRowDomainId`/`requireDomainAccess` (lib/links.ts) — every row, default-domain or explicit, passes through the same authorization gate as a manual create. Not this phase's job to re-prove (that's the existing v1.0 integration Denial-Suite's scope, and Phase 17's E2E-level representative case). |

## Sources

### Primary (HIGH confidence)
- `apps/api/src/routes/links.ts` — full read, this session
- `apps/api/src/lib/links.ts` — full read, this session
- `apps/web/src/views/LinksView.vue` — full read, this session
- `apps/web/src/views/LinksImportView.vue` — full read, this session
- `apps/web/src/components/LinkFormModal.vue` — full read, this session
- `apps/web/src/api.ts` — full read, this session (Links + CSV import client sections)
- `packages/shared/src/index.ts` — targeted read (ImportRowResult/ImportPreviewResult/ImportCommitResult/LinkSkipReason), this session
- `apps/web/src/router/index.ts` — targeted read (route names/paths), this session
- `apps/e2e/src/links.ts`, `apps/e2e/src/db.ts` — full reads, this session
- `apps/e2e/playwright.config.ts` — full read, this session
- `apps/e2e/tests/authed/storage-state.spec.ts` — full read, this session (reference pattern)
- `apps/e2e/package.json` — full read, this session (confirms no new package needed)
- `.planning/phases/11-playwright-e2e-infrastructure-fixtures/11-RESEARCH.md`, `.planning/phases/13-authentication-session-e2e/13-RESEARCH.md` — read for RESEARCH.md structural/style precedent

### Secondary (MEDIUM confidence)
- None this pass — every claim in this document traces to a direct source read above.

### Tertiary (LOW confidence)
- None this pass.

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new dependency, everything already pinned/installed and read directly.
- Architecture: HIGH — every route/component/type read in full this session; the two CONTEXT.md open questions (preview/commit linkage, skip-vs-overwrite) are now closed with certainty, not assumption.
- Pitfalls: HIGH — every pitfall traces to specific code read this session (debounce timing, header-validation regex, watch-triggered re-preview), not generic Playwright folklore.

**Research date:** 2026-07-25
**Valid until:** 30 days (stable, code-verified; revisit only if `lib/links.ts`/`routes/links.ts`/the three Vue views change before planning completes)
