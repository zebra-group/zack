# Phase 14: Links & CSV Import E2E - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss — user is AFK, proceeding without pausing for questions.

<domain>
## Phase Boundary

Prove the canonical dashboard link lifecycle (create → list → edit → search/filter → delete) and the two-step CSV bulk-import flow (upload → preview → commit, including a slug-conflict case) work end-to-end through the real UI and database. This phase establishes the link-fixture-via-real-UI pattern that Phase 15 (QR Studio) and Phase 16 (Analytics) will reuse — unlike Phases 11-13, where link/user fixtures were created via direct Prisma inserts, this phase's own subject IS link creation through the UI, so at least the canonical-journey test must drive the real create-link form, not bypass it.

</domain>

<decisions>
## Known facts (verified against actual source, not assumed)

- **Reusable E2E infra:** `apps/e2e/src/db.ts` (seedBaseline, withResetDbLock, BASELINE_DOMAIN_HOSTNAME, admin/member fixtures), `apps/e2e/src/mailpit.ts`, `apps/e2e/src/links.ts` (`createE2eLink`, `derivePasswordHash`, `deriveExpiresAt`, `fetchWithFixtureRaceRetry` — already used for direct-Prisma link fixtures in Phase 12's redirect specs; reusable here for any test that needs a PRE-EXISTING link without going through the create-UI, e.g. as setup state for edit/search/delete specs).
- **Auth fixtures:** Phase 11's `storageState` pattern (Admin + Member) — this phase's specs should run under the `chromium-admin`/`chromium-member` Playwright projects (`dependencies: ["setup"]`), same as any other authenticated-dashboard test, not the standalone `auth` project used only by Phase 13's login-proving specs.
- **CSV import is two-step (preview → commit)** per LINKS-E2E-02/03 wording — must read the actual backend route(s) and Vue view driving this flow during phase research (do not assume the request/response shape), likely a `POST` that returns a preview/diff without persisting, then a separate commit `POST` referencing that preview.
- **Slug-conflict behavior (skip/overwrite)** is described in the requirement as "verhält sich wie spezifiziert" (behaves as specified) — the actual conflict-resolution strategy (skip vs. overwrite, and whether the UI offers a choice per-row or per-import) must be read from the real backend/frontend code during research, not guessed.

## Claude's Discretion

- Whether the canonical-journey test (LINKS-E2E-01) drives 100% of its own fixture through the real UI (create) vs. seeding some list-context items via Prisma to keep the search/filter assertions deterministic — planner's call once research clarifies the list/search UI's actual query behavior.
- Exact CSV fixture file(s) needed (valid happy-path CSV, and a CSV containing a slug already present in the DB) — construct these as fixtures inside `apps/e2e/tests/links/` or a shared `fixtures/` subfolder, planner's call on layout.
- Spec file layout under `apps/e2e/tests/` — likely a new `tests/links/` directory paralleling `tests/auth/`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/e2e/src/links.ts` (Phase 12) — direct-Prisma link fixture creation, reusable for setup-only links.
- `apps/e2e/src/db.ts` — seedBaseline/admin+member fixtures.
- `apps/e2e/tests/authed/storage-state.spec.ts` (Phase 11) — reference pattern for authenticated dashboard specs.

### Established Patterns
- Real UI interaction (not API bypass) is required wherever the phase's own requirement IS the UI flow itself (create-link form, CSV upload/preview/commit) — mirrors Phase 13's insistence on driving real login forms rather than calling better-auth's API directly.
- `fetchWithFixtureRaceRetry` pattern (Phase 12) applies to any assertion racing the per-file DB truncate/reseed isolation strategy.

</code_context>

<specifics>
## Specific Ideas

None beyond what's captured above — read the actual Links dashboard view, the CSV import view/routes, and the backend link/import routes during phase research before planning.

</specifics>

<deferred>
## Deferred Ideas

- QR-code-specific link behavior — Phase 15's job.
- Analytics/click-tracking on these links — Phase 16's job.
- Team/domain-scoped authorization on link CRUD — Phase 17's job (this phase uses the single baseline domain/admin+member fixtures only, no cross-domain denial testing here).

</deferred>
