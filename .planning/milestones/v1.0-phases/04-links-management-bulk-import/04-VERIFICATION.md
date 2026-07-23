---
phase: 04-links-management-bulk-import
verified: 2026-07-11T21:45:51Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Compare LinksView, LinkDetailView, and LinksImportView at 1440px in both Light and Dark theme against design_handoff_url_shortener/Kurzly Prototyp.dc.html — colors, spacing, radii, typography, and interaction states."
    expected: "Pixel-accurate match to the locked Phase-2/3 design tokens; no new font sizes/weights introduced (04-UI-SPEC.md, prohibitions confirm 0 new tokens in source)."
    why_human: "UI-03 visual fidelity cannot be verified by static analysis — requires a rendered-pixel comparison. Automated structure/behavior tests (61/61 web tests) pass and the Links screens reuse the already-accepted Phase 2/3 design system."
    result: "PASSED (operator-accepted 2026-07-11). Deterministic token-fidelity audit of the four Links SFCs (LinksView/LinkDetailView/LinksImportView/LinkFormModal): 120 var(--*) token references, accent #d7ff01 applied only via var(--accent) (never hard-coded), the D-04 slug-warning uses the documented --danger-tint (derived from the locked #e5484d), and the only direct hex values (#1b1b18/#f1f1ec/#e5484d) are exact matches to the locked --text tokens + the documented static destructive color — no drift, 0 new sizes/weights. Same acceptance basis the operator applied to Phase 2 and Phase 3's UI-03; a live headless-browser pixel-diff is not runnable in this WSL environment (no working browser)."
  - test: "Trigger a genuine mid-loop CSV commit failure in a real environment (e.g. transient DB blip) and confirm the resulting 'N Links importiert – Import wurde vorzeitig abgebrochen, bitte Liste prüfen.' toast wording and no-auto-retry behavior matches product intent."
    expected: "User understands the import was partially applied and knows to check the list, without any confusing auto-retry or silent data loss."
    why_human: "WR-10's fix changes commit-loop control flow and partial-state semantics. The integration test proves the specific spied-failure scenario (partial:true, importedCount correct, no over/under-commit) but the UX wording judgment for a real incident is a product decision, per 04-REVIEW-FIX.md's own note."
    result: "ACCEPTED (operator-accepted 2026-07-11). The underlying correctness — no data loss, no over-commit, accurate partial-state reporting — is proven by a passing integration test; only the German toast copy is a cosmetic product-judgment call, accepted as reasonable and trivially adjustable later. Not a correctness gap."
---

# Phase 4: Links Management & Bulk Import Verification Report

**Phase Goal:** Users can create, organize, search, and bulk-import short links across their domains through ONE consistent, authorized creation path — bulk CSV import reuses the exact same validation/authorization/reserved-slug rules as manual creation, never a separate bypass path.
**Verified:** 2026-07-11T21:45:51Z
**Status:** passed (UI-03 token-fidelity sign-off recorded 2026-07-11; WR-10 partial-import UX copy accepted)
**Re-verification:** No — initial verification

**Process note:** ROADMAP.md tags Phase 4 `Mode: mvp`, but the phase-level Goal text is a technical/architectural invariant statement ("ONE consistent, authorized creation path"), not a `As a X, I want Y, so that Z.` User Story sentence — it does not pass the User Story format guard. The five per-plan Goals inside the phase ARE written as User Stories. Since the assigning task explicitly requested a full technical/security-invariant audit (D-01 single-write-path, IDOR guard, reserved-slug, domain-active check) rather than a narrowed MVP user-flow check, this report proceeds with standard goal-backward verification (all four levels: exists, substantive, wired, data-flow) rather than refusing to verify or applying the narrowed MVP Mode format. This is a process observation, not a phase-goal gap.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **D-01 CENTRAL INVARIANT**: exactly ONE `prisma.link.create(` call site and ONE `prisma.link.update(` call site in the entire app codebase, both in `apps/api/src/lib/links.ts`; CSV importer (`runImport`) routes every row through the same `createLink`/`previewLink`/`validateLinkInput` core, sequentially, never a parallel/batch write | ✓ VERIFIED | Grep across `apps/api/src` (excluding generated Prisma client internals) finds exactly one real call site each: `links.ts:270` (`createLink`) and `links.ts:311` (`updateLink`). No `prisma.link.createMany`/raw SQL insert anywhere in app code. `runImport` (links.ts:483-581) loops `for (const row of rows)` with `await` inside the loop (sequential, not `Promise.all`), calling `mutate ? createLink : previewLink` per row (links.ts:549-556). Behavioral proof: `apps/api/test/links-import.integration.test.ts:222` "writes exactly validCount rows; zero rows leak for any of the 4 skipped rows" — part of the 152/152 green suite (re-run independently, see Behavioral Spot-Checks). |
| 2 | User creates a short link by choosing a domain + destination URL; a blank slug auto-generates (Base62, 7 chars); a custom slug is validated/reserved-checked/collision-checked (LINK-01/02) | ✓ VERIFIED | `POST /api/links` (routes/links.ts:166-188) → `createLink` → `validateLinkInput` → `resolveSlug` (links.ts:136-183, auto-gen retry loop + custom-slug shape/reserved/collision checks). Frontend: `LinkFormModal.vue` blank-slug placeholder "leer lassen = automatisch"; `LinksView.vue handleCreateSubmit`. Tests: `links.integration.test.ts:305` "blank slug auto-generates a 7-char Base62 slug", `:473` "custom-slug create using that exact slug", `:596` "409s a custom-slug-taken create". |
| 3 | User searches/filters the link list by domain, copies a link's full URL (with toast), opens its detail page, edits settings, or deletes it (LINK-03/04/05/06/07, UI-06) | ✓ VERIFIED | `GET /api/links?q=&domainId=` scoped via `scopedDomainIds` (routes/links.ts:190-226); `LinksView.vue` server-driven search+domain tabs (debounced, race-guarded per WR-08). Copy: `handleCopy` composes `https://{hostname}/{slug}` via `navigator.clipboard.writeText` + toast (LinksView.vue:206-214, LinkDetailView.vue:74-83). Detail: `GET /api/links/:id` IDOR-guarded via `resolveOwnedLink` (404-for-both). Edit: `PATCH /api/links/:id` → `updateLink`. Delete: `DELETE /api/links/:id` → 204, confirm dialog + toast in both views. Tests: `links.integration.test.ts` `GET /api/links` scoping/`?q=`/`?domainId=` block (:653-786), IDOR-guard blocks for GET/PATCH/DELETE (:797-1330). |
| 4 | User bulk-imports links from a CSV (`ziel_url, slug, domain`) with a live "N valid / M skipped" preview before commit; every skip carries one of 4 reasons; reserved/unauthorized rows are skipped exactly as manual creation would reject them (LINK-08, D-01/D-05) | ✓ VERIFIED | `POST /api/links/import/preview` (mutate=false) and `/commit` (mutate=true) both call `runImport`, differing only by the boolean (links.ts:483-597). `mapErrorToSkipReason` maps every `LinkErrorCode` to exactly one of 4 `LinkSkipReason`s (invalid_url, slug_conflict, domain_unauthorized, duplicate_in_file) — exhaustive `switch` with a `never` fallthrough guard (links.ts:451-474). `LinksImportView.vue` renders only the backend's `ImportPreviewResult` (no client-side re-validation), shows "N gültig · M übersprungen" (`preview-summary`), per-row skip reason labels, and disables commit at `validCount === 0`. Tests: `links-import.integration.test.ts:173` "returns validCount 1 / skippedCount 4 with the 4 distinct skip reasons, and writes ZERO rows (dry-run)"; `:222` the no-bypass proof; `:289` preview↔commit parity. |
| 5 | IDOR guard: every Link-by-id route resolves via `resolveOwnedLink` (scopedDomainIds → `link.findFirst` filtered to that set) BEFORE read/write; not-found and forbidden both answer 404 with an identical query cost (no existence oracle) | ✓ VERIFIED | `resolveOwnedLink` (routes/links.ts:155-162) performs the SAME two queries on every outcome (WR-04 fix, timing-symmetric). Used by GET/PATCH/DELETE `/api/links/:id`. Tests: `links.integration.test.ts:845` "404s (identical body to non-existent) for a link the caller cannot access" and equivalent blocks for PATCH/DELETE. |
| 6 | Reserved-slug protection applies to BOTH custom-supplied AND auto-generated slugs (no Link may shadow a system/app route) | ✓ VERIFIED | Custom path: `resolveSlug`'s `RESERVED_SLUGS.has(slug.toLowerCase())` check after shape validation (links.ts:152-154). Auto-gen path (WR-06 fix): the retry loop at links.ts:166-180 explicitly checks `RESERVED_SLUGS.has(candidate.toLowerCase())` and `continue`s past a reserved collision exactly like a DB collision. Dedicated test `apps/api/test/links-auto-slug-reserved.test.ts:132` mocks `nanoid` to force a reserved first-candidate and proves the retry loop skips it. `RESERVED_SLUGS` (links.ts:79-95) documents its source-of-truth status and the 5 shape-shadowed entries (IN-01). |
| 7 | `targetUrl` rejects any non-http(s) scheme (javascript:/data:/file:) at BOTH create and update time | ✓ VERIFIED | `targetUrlSchema = z.url({ protocol: /^https?$/ }).max(2048)` (links.ts:119), used by `validateTargetUrl`, which is the sole scheme-check call inside `validateLinkInput` — reached by both `createLink` and `updateLink` (single shared core, D-01). Test: `links.integration.test.ts:157` "rejects javascript:, data:, file: schemes and a bare non-URL string". |
| 8 | WR-03: a Link write against a non-`active` Domain is rejected for BOTH manual create and CSV import (via the shared `validateLinkInput` core, not duplicated route-layer logic) | ✓ VERIFIED | `validateLinkInput` (links.ts:219-252) queries `prisma.domain.findUnique` and returns `DOMAIN_NOT_ACTIVE` when `domain.status !== "active"`, positioned right after the `requireDomainAccess` call and BEFORE URL/slug validation — inherited automatically by every caller (createLink, previewLink, updateLink, and CSV's per-row createLink/previewLink calls). `mapErrorToSkipReason` buckets `DOMAIN_NOT_ACTIVE` into `domain_unauthorized` (links.ts:467-468, deliberate no-existence-oracle grouping). Tests: `links.integration.test.ts:325/346/364` (validateLinkInput + route-layer 403), `links-import.integration.test.ts:336` "skips a row whose domain is still pending". |
| 9 | The 5-plan wave chain wires end-to-end: `/links`, `/links/:id`, `/links/import` replace the `ComingSoonView` placeholder and route to real screens; the typed API client (`api.ts`) exposes create/list/get/update/delete/previewImport/commitImport; `linksRoute` is registered in `app.ts` before the redirect stub and static fallback so `/api/links` is never shadowed | ✓ VERIFIED | `router/index.ts:43-59` — 3 dedicated routes to `LinksView`/`LinksImportView`/`LinkDetailView` (not `ComingSoonView`). `app.ts:135` registers `linksRoute(prisma, auth)` after `authRoute`/`domainsRoute` (line 127-128) and before `redirectRoute` (line 137) and `registerStatic()` (line 139) — comment at app.ts:133 confirms deliberate ordering. `api.ts:234-308` — all 7 typed client functions present and wired to the correct HTTP verbs/paths. |
| 10 | Toast confirmations fire for create, copy, import, and delete (UI-06/D-06) | ✓ VERIFIED | `LinksView.vue`: create (`:146`), copy (`:210`), delete (`:200`). `LinkDetailView.vue`: copy (`:79`), edit-save (`:124`), delete (`:143`). `LinksImportView.vue`: commit success/partial (`:135-139`). All via the same per-view `showToast`/`setTimeout` pattern (04-PATTERNS.md), consistent with the rest of the dashboard. |

**Score:** 10/10 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/prisma/schema.prisma` — Link model | domainId FK, slug, targetUrl, title?, createdBy? SetNull, `@@unique([domainId, slug])`, `@@index([domainId])` | ✓ VERIFIED | schema.prisma:177-192 — matches exactly, including cascade/SetNull semantics documented in the model's doc comment. |
| `apps/api/prisma/migrations/20260711195142_add_link_model/migration.sql` | Applied migration | ✓ VERIFIED | CreateTable + both indexes + both FKs present, matches schema. |
| `apps/api/src/generated/prisma/` | Regenerated client with Link model | ✓ VERIFIED | `models/Link.ts` present; `PrismaClient` type imports resolve in `lib/links.ts`/`routes/links.ts`. |
| `packages/shared/src/index.ts` | LinkDTO, CreateLinkInput, UpdateLinkInput, LinkSkipReason, ImportRowResult, ImportPreviewResult, ImportCommitResult | ✓ VERIFIED | All 7 types present (index.ts:68-142), including WR-10's `partial?: boolean` on `ImportCommitResult`. |
| `apps/api/src/lib/links.ts` | validateLinkInput / createLink / previewLink / updateLink / generateSlug / RESERVED_SLUGS / validateTargetUrl / toLinkDto / isUniqueConstraintViolation / runImport / previewImport / commitImport / resolveRowDomainId / mapErrorToSkipReason / MAX_IMPORT_ROWS / EXPECTED_CSV_COLUMNS | ✓ VERIFIED | All present, all match the documented D-01 shape. |
| `apps/api/src/plugins/rateLimit.ts` | LINK_CREATE_RATE_LIMIT (20/15min), LINK_IMPORT_RATE_LIMIT (5/15min) | ✓ VERIFIED | rateLimit.ts:75-90, applied via `config: { rateLimit: ... }` on the corresponding routes. |
| `apps/api/src/routes/links.ts` | linksRoute(prisma, auth): POST/GET /api/links, GET/PATCH/DELETE /api/links/:id, POST /api/links/import/{preview,commit} | ✓ VERIFIED | All 7 endpoints present and correctly delegate to lib/links.ts. |
| `apps/api/test/links.integration.test.ts` + `links-import.integration.test.ts` + `links-auto-slug-reserved.test.ts` | Real-Postgres suites for LINK-01..08 + D-01 no-bypass proof + WR fixes | ✓ VERIFIED | 2019 combined lines, part of the 18-file/152-test green suite (re-run independently below). |
| `apps/web/src/api.ts` | createLink/listLinks/getLink/updateLink/deleteLink/previewImport/commitImport | ✓ VERIFIED | api.ts:234-308, all typed and wired to the correct endpoints. |
| `apps/web/src/router/index.ts` | /links, /links/:id, /links/import routes | ✓ VERIFIED | index.ts:43-59, `ComingSoonView` no longer used for these paths. |
| `apps/web/src/components/LinkFormModal.vue` | shared create/edit modal + D-04 slug warning | ✓ VERIFIED | Persistent warning block shown whenever `mode === 'edit'` (LinkFormModal.vue:94-103). |
| `apps/web/src/views/LinksView.vue`, `LinkDetailView.vue`, `LinksImportView.vue` + co-located tests | 3 screens | ✓ VERIFIED | All present with test files; full web suite green. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `apps/api/src/app.ts` | `apps/api/src/routes/links.ts` | `app.register(linksRoute(prisma, auth))` registered AFTER auth/domains, BEFORE redirect stub + static fallback | ✓ WIRED | app.ts:127-139; comment at :133-134 explicitly documents the ordering rationale. |
| `apps/api/src/lib/links.ts` (`validateLinkInput`) | `apps/api/src/lib/authorization.ts` (`requireDomainAccess`) | Direct import, called unchanged | ✓ WIRED | links.ts:31 import, :224 call — zero new authorization logic. |
| `apps/api/src/lib/links.ts` (`createLink`) | Prisma `link.create` | Sole insert site | ✓ WIRED | links.ts:270, confirmed unique via repo-wide grep. |
| `apps/api/src/lib/links.ts` (`runImport`) | `apps/api/src/lib/links.ts` (`createLink`/`previewLink`) | Row-by-row sequential call, no batch insert | ✓ WIRED | links.ts:549-556, `for...of` with `await`, never `Promise.all`. |
| `apps/web/src/views/LinksImportView.vue` | `POST /api/links/import/{preview,commit}` | `previewImport`/`commitImport` client functions, raw CSV text via FileReader, no client-side re-validation | ✓ WIRED | LinksImportView.vue:108-149, api.ts:282-308. |
| `apps/web/src/views/LinksView.vue` / `LinkDetailView.vue` | `GET /api/links` (search/filter) | Server-driven `listLinks({q, domainId})`, never a client-only filter | ✓ WIRED | LinksView.vue:69-96 (`loadLinks`, debounced, request-id-guarded). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| D-01 no-bypass proof + full LINK-01..08 integration suite | `pnpm --filter @kurzly/api test -- --run` (re-run independently in this verification, not trusted from SUMMARY) | 18 test files, 152 tests passed | ✓ PASS |
| Frontend component/view suite | `pnpm --filter @kurzly/web test -- --run` (re-run independently) | 10 test files, 61 tests passed | ✓ PASS |
| Backend typecheck | `pnpm --filter @kurzly/shared build && pnpm --filter @kurzly/api exec tsc --noEmit` | 0 errors after rebuilding `packages/shared` (see note below) | ✓ PASS |
| Frontend typecheck | `pnpm --filter @kurzly/web exec tsc --noEmit` | 0 errors after rebuilding `packages/shared` | ✓ PASS |
| D-01 structural grep proof | `grep -rn "prisma\.link\.create\(" apps/api/src` / same for `.update(` | Exactly 1 real call site each (both in `lib/links.ts`), rest are generated-client doc comments/type stubs | ✓ PASS |

**Note on the two typecheck runs above:** a bare `tsc --noEmit` per-app against the on-disk `packages/shared/dist/` initially failed with `TS2353: Object literal may only specify known properties, and 'partial' does not exist in type 'ImportCommitResult'` in both `apps/api` and `apps/web`, because the on-disk `dist/` (gitignored build artifact, not committed) predated the WR-10 commit that added `partial?: boolean` to the shared `ImportCommitResult` type. This is not a source-code gap: `.github/workflows` CI runs `pnpm run -r build` (topological — `packages/shared` before both apps) BEFORE `pnpm run typecheck`, so a correct CI/fresh-clone run rebuilds `packages/shared` first and never hits this. Rebuilding `packages/shared` locally (`pnpm --filter @kurzly/shared build`) immediately resolved both typecheck runs to 0 errors, confirming this was a stale local build artifact from my own verification process, not a defect in the phase's delivered code or its CI pipeline.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LINK-01 | 04-02 | Create link: domain + target URL, blank slug auto-generates | ✓ SATISFIED | Truth #2 |
| LINK-02 | 04-02 | Custom slug | ✓ SATISFIED | Truth #2 |
| LINK-03 | 04-02, 04-05 | Search + domain-filter list | ✓ SATISFIED | Truth #3 |
| LINK-04 | 04-05 | Copy full URL to clipboard | ✓ SATISFIED | Truth #3 |
| LINK-05 | 04-03, 04-05 | Detail page with attributes + statistics | ✓ SATISFIED (with documented scope cut) | Attributes fully implemented; statistics section is an explicit static placeholder ("Statistiken — bald verfügbar") per 04-CONTEXT.md's `<deferred>` section — real click stats are Phase 6 (Analytics) scope, not a Phase 4 gap. |
| LINK-06 | 04-03, 04-05 | Edit settings (incl. slug w/ warning) | ✓ SATISFIED | Truth #3, D-04 warning verified in LinkFormModal.vue |
| LINK-07 | 04-03, 04-05 | Delete | ✓ SATISFIED | Truth #3 |
| LINK-08 | 04-04, 04-05 | CSV bulk import with live preview, same validation rules | ✓ SATISFIED | Truth #1, #4 |
| UI-06 | 04-05 | Toast confirmations | ✓ SATISFIED | Truth #10 |

No orphaned requirements — REQUIREMENTS.md's Phase 4 row set (LINK-01..08, UI-06) exactly matches the union of `requirements:` fields declared across the 5 plans.

### Anti-Patterns Found

None. Scanned all phase-modified source files (`lib/links.ts`, `routes/links.ts`, `app.ts`, `packages/shared/src/index.ts`, `api.ts`, `router/index.ts`, `LinkFormModal.vue`, `LinksView.vue`, `LinkDetailView.vue`, `LinksImportView.vue`, `plugins/rateLimit.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` and empty-implementation patterns — zero matches. The one visible "placeholder" (`LinkDetailView.vue`'s static Statistik card) is a documented, in-scope deferral (see LINK-05 row above), not an undisclosed stub.

### Human Verification Required

### 1. UI-03 Pixel Fidelity (Links screens)

**Test:** Compare LinksView, LinkDetailView, and LinksImportView at 1440px in both Light and Dark theme against `design_handoff_url_shortener/Kurzly Prototyp.dc.html`.
**Expected:** Pixel-accurate match to the locked Phase-2/3 design tokens (Geist fonts, lime accent `#d7ff01`, spacing, radii) — no new font size/weight introduced.
**Why human:** Visual fidelity requires rendered-pixel comparison; cannot be verified by static source analysis. Automated evidence is strong (61/61 web tests pass; grep confirms only existing `var(--...)` tokens and already-used `font-size`/`font-weight` values are reused — no new literals introduced in the reviewed files), and the Links screens reuse the already-accepted Phase 2/3 design system, so this is a low-risk item, not a suspected regression.

### 2. WR-10 Partial-Import UX Wording

**Test:** Trigger (or simulate in a staging environment) a genuine mid-loop CSV commit failure and review the resulting toast ("N Links importiert – Import wurde vorzeitig abgebrochen, bitte Liste prüfen.") and the absence of any auto-retry.
**Expected:** The wording and behavior match product intent for a real transient-failure incident (clear, not misleadingly "complete", tells the user to check the list).
**Why human:** This is a product/UX judgment call, not a correctness question — 04-REVIEW-FIX.md itself flags this as needing human sign-off. The underlying correctness (no data loss, no over-commit, `partial: true` set accurately) IS proven by an automated integration test (`links-import.integration.test.ts:460`, part of the green 152-test suite).

### Gaps Summary

No gaps found. Every roadmap Success Criterion, every plan-level must-have truth/artifact/key-link, and the explicitly-requested CENTRAL INVARIANT (D-01 single validated write path) are verified present, substantive, and wired in the current codebase (HEAD `5da399d`), independently re-confirmed by re-running both test suites (152/152 API, 61/61 web) rather than trusting SUMMARY.md's reported numbers. The two items above are routine pre-ship human-judgment checks (visual pixel fidelity, UX wording for an edge-case incident path), not defects — they route this report to `human_needed` rather than `passed` per the verification decision tree, but do not block phase progression pending sign-off on those two low-risk items.

---

_Verified: 2026-07-11T21:45:51Z_
_Verifier: Claude (gsd-verifier)_
