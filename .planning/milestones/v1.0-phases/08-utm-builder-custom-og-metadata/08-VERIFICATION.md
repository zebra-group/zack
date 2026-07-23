---
phase: 08-utm-builder-custom-og-metadata
verified: 2026-07-23T00:50:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 8: UTM Builder + Custom OG Metadata Verification Report

**Phase Goal:** Users can enrich links with campaign-tracking parameters and custom social-preview metadata, entirely through user-typed fields — no server-side fetching of the destination, sidestepping the SSRF surface entirely.
**Verified:** 2026-07-23T00:50:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Mode:** mvp (ROADMAP.md declares `**Mode:** mvp` for Phase 8; the phase-goal user story is present verbatim in every plan's "Phase Goal" section)

## User Flow Coverage

User story: «As a dashboard user managing campaign links, I want to attach UTM parameters and custom social-preview metadata to a short link and see exactly what the final URL and the social card will look like before I save, so that my campaign traffic is attributed correctly and my links preview the way I intend — without Kurzly ever fetching the destination.»

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Open link form, expand "UTM-Parameter" | Section is closed by default; clicking opens it and closes any other open section | `LinkFormModal.vue:130-133` (`openSection` single-ref exclusive accordion), `:aria-expanded` on all three headers (lines 383, 430, 511) | ✓ |
| Type `utm_source`/`utm_medium`/`utm_campaign` | Preview of the assembled destination URL updates on every keystroke, no network call | `LinkFormModal.vue:273-283` (`utmPreview` computed calling `buildUtmPreview`), `apps/web/src/lib/utm.ts` (pure function, no fetch) | ✓ |
| Expand "Custom OG-Tags", type title/description/image URL | Social-card preview updates live; card always renders (hatch placeholder when empty); domain line shows the short link's own domain, not the destination | `LinkFormModal.vue:440-497` (og-section markup), `ogCardDomain` computed (`LinkFormModal.vue:202-205`, derives from `domains`/`domainHostname`, never `targetUrl`) | ✓ |
| Save the link | UTM/OG values persist; badges/chips appear without reload | `LinksView.vue:191-196,254-259`, `LinkDetailView.vue:330-335` (payload threading), `hasUtm`/`hasOg` badges (`LinksView.vue:380-381`) and chips (`LinkDetailView.vue:408-409`) computed from the returned `LinkDTO` | ✓ |
| Visitor follows the short link | Redirect target carries the owner's UTM params, overriding same-named target params | `redirect.ts:307-310`, `qrRedirect.ts:181-185`; unit-verified in `redirectEngine.test.ts` (37/37 pass), integration-verified in `redirect.integration.test.ts`/`qrRedirect.integration.test.ts` (48/48 pass) | ✓ |
| A crawler/bot requests the link | Bot receives the owner's custom OG title/description/image as a 200, for every link state (ok/expired/protected), never the real destination, never a fetch of `ogImageUrl` | `redirect.ts:236-247`, `qrRedirect.ts` (mirrored), `publicHtml.ts` `renderBotOgPage`/`isAbsoluteHttpUrl`; repo-wide grep for `fetch(`/`axios`/`got(`/`http.get`/`undici` in `apps/api/src` (excl. generated Prisma client) returns zero hits | ✓ |
| Outcome: campaign attribution + social preview, no SSRF surface | UTM lands on the destination (including the password-unlock redirect, CR-01 fixed), OG values reach bots exactly as typed, `ogImageUrl` is never server-fetched | All of the above, plus `08-REVIEW-FIX.md` fix commits `eebdb69`/`94aacfa` present and green | ✓ |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User builds UTM parameters (source/medium/campaign) and sees a live preview of the final destination URL with parameters appended | ✓ VERIFIED | `apps/web/src/lib/utm.ts::buildUtmPreview`, wired via `LinkFormModal.vue:280` computed `utmPreview`; `utm.test.ts` 13/13 pass |
| 2 | User sets custom OG title/description/image and sees a live social-card preview | ✓ VERIFIED | `LinkFormModal.vue:440-497` og-section + `og-card` preview markup; `LinkFormModal.test.ts` (part of 109/109 passing web component tests) |
| 3 | The user-typed OG values (never auto-fetched) are exactly what bots/crawlers receive | ✓ VERIFIED | `publicHtml.ts::renderBotOgPage` interpolates `ctx.ogTitle/ogDescription/ogImageUrl` through `escapeHtml`, falling back to brand defaults only when blank (D-08-03); `redirect.ts`/`qrRedirect.ts` bot branches pass the link's three OG fields for every state (ok/expired/protected); `publicHtml.test.ts` 50/50 pass (bundled with `links-meta`/`meta-schema-push`) |
| 4 | No server-side fetch of the destination or of `ogImageUrl` — SSRF surface sidestepped | ✓ VERIFIED | Repo-wide grep of `apps/api/src` (excluding `src/generated/prisma`) for `fetch(`, `axios`, `got(`, `http.get`, `https.get`, `undici` returns zero matches; `ogImageUrl` only validated (`ogImageUrlSchema` write-time, `isAbsoluteHttpUrl` render-time) and escaped into an attribute — never requested |
| 5 | UTM parameters actually change where a visitor lands, on both `/:slug` and `/q/:code`, including the password-unlock path (CR-01) | ✓ VERIFIED | `redirect.ts:307,372`, `qrRedirect.ts:181,248` all call `applyUtmParams`; named tests `redirect.integration.test.ts -t "CR-01"` and `qrRedirect.integration.test.ts -t "CR-01"` both pass; full integration suites 48/48 pass |
| 6 | Owner-configured UTM parameters override same-named target parameters without erasing target-embedded keys the builder left unset (WR-01) | ✓ VERIFIED | `redirectEngine.ts:149-161` narrowed delete-then-set per present field only (not blanket delete of all three); `apps/web/src/lib/utm.ts:76-79` mirrors the same narrowing; `redirectEngine.test.ts` 37/37 pass, `utm.test.ts` 13/13 pass |
| 7 | The six fields are written only through `lib/links.ts` (D-08-06/D-01), validated to D-08-05's limits, and follow the three-state PATCH contract | ✓ VERIFIED | `links.ts::validateLinkInput` (create) and update path apply `validateMetaField`/`validateOgImageUrl`; `routes/links.ts` Zod allowlist (`createLinkSchema`/`updateLinkSchema`) explicitly lists all six, PATCH schema is `nullable().optional()` with the empty-string-clears exception documented at `routes/links.ts:104-109`; `links.integration.test.ts` 67/67 pass, `links-meta.test.ts` + `meta-schema-push.test.ts` 50/50 pass |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/prisma/migrations/20260722202851_add_link_utm_and_og_metadata/` | Additive migration for six nullable columns | ✓ VERIFIED | Migration directory present; `schema.prisma:217-230` declares `utmSource/utmMedium/utmCampaign/ogTitle/ogDescription/ogImageUrl` all `String?` |
| `apps/api/src/lib/links.ts` | Single write path, six fields threaded, D-08-05 validation | ✓ VERIFIED | `validateLinkInput` validates all six after existing checks (lines ~426-446); `updateLink` honours three-state contract |
| `apps/api/src/routes/links.ts` | Zod allowlist for create + PATCH | ✓ VERIFIED | `createLinkSchema`/`updateLinkSchema` explicitly list all six fields (lines 71-77, 104-109) |
| `apps/api/src/lib/redirectEngine.ts` | `applyUtmParams` pure helper | ✓ VERIFIED | Lines 143-165+, doc comment cites D-08-02 composition order; WR-01 fix applied |
| `apps/api/src/lib/publicHtml.ts` | `renderBotOgPage` custom OG + anti-SSRF render guard | ✓ VERIFIED | `BotOgPageCtx` extended (line 80-83), `isAbsoluteHttpUrl` defence-in-depth guard (lines 333-345) |
| `apps/api/src/routes/redirect.ts`, `apps/api/src/routes/qrRedirect.ts` | UTM + OG wired into both public handlers, incl. verify branch | ✓ VERIFIED | `applyUtmParams` called in `ok` branch and `POST …/verify` branch of both files; bot branches pass OG fields for every state |
| `packages/shared/src/index.ts` | `LinkDTO`/input types carry the six fields | ✓ VERIFIED | 19 matches across the relevant type declarations; `packages/shared/dist/*` rebuilt (dist newer than src) |
| `apps/web/src/lib/utm.ts` | Client-side mirror of `applyUtmParams` for the live preview | ✓ VERIFIED | `buildUtmPreview`, WR-01-narrowed mutation, no server request |
| `apps/web/src/api.ts` | `mapLinkFormError` maps the five new codes | ✓ VERIFIED | `UTM_VALUE_TOO_LONG`, `OG_TITLE_TOO_LONG`, `OG_DESCRIPTION_TOO_LONG`, `OG_IMAGE_URL_TOO_LONG`, `OG_IMAGE_URL_INVALID` all mapped to locked German messages |
| `apps/web/src/components/LinkFormModal.vue` | Exclusive 3-section accordion, UTM preview, OG preview, payload threading | ✓ VERIFIED | `openSection` single ref, `utmPreview`/OG preview computeds, debounced `<img>` binding with `@error` fallback |
| `apps/web/src/views/LinksView.vue`, `apps/web/src/views/LinkDetailView.vue` | Badges/chips, payload forwarding, destination line unaffected by UTM | ✓ VERIFIED | `hasUtm`/`hasOg` badges and chips; `link-target` div renders bare `link.targetUrl` (UI-08-07) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `schema.prisma` columns | `LinkDTO` (shared) | `toLinkDto` in `links.ts:585` | ✓ WIRED | Six fields cross the JSON boundary raw |
| `routes/links.ts` Zod allowlist | `validateLinkInput`/`updateLink` | direct call | ✓ WIRED | Both create and PATCH schemas map 1:1 onto validator params |
| `applyUtmParams` output | `mergeQuery` | `redirect.ts:307-309`, `qrRedirect.ts:181-185` | ✓ WIRED | UTM applied first, then `forwardQuery` merge — D-08-02 order preserved |
| `POST …/verify` success branch | `applyUtmParams` | `redirect.ts:372`, `qrRedirect.ts:248` | ✓ WIRED | CR-01 fix confirmed in both handlers |
| `BotOgPageCtx` three new fields | `escapeHtml` | `publicHtml.ts:306-308` | ✓ WIRED | Every interpolation point escaped |
| `LinkFormModal` `openSection` ref | all three `aria-expanded` bindings and section bodies | template bindings (lines 383/430/511, 393/440/517) | ✓ WIRED | Single source of truth for exclusivity |
| `buildUtmPreview` | server `applyUtmParams` | mirrored delete-then-set logic | ✓ WIRED | Confirmed byte-for-byte behavioral parity post WR-01 fix (both test suites pass) |
| Modal's emitted payload keys | `LinksView`/`LinkDetailView` → `createLink`/`updateLink` | `payload.utmSource` etc. forwarded unchanged | ✓ WIRED | `LinksView.vue:191-196,254-259`, `LinkDetailView.vue:330-335` |
| `mapLinkFormError`'s new fields | modal's `fieldErrors` computed | single error prop | ✓ WIRED | No second error channel introduced |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01 fix — UTM survives password-unlock redirect (`/:slug`) | `vitest run test/redirect.integration.test.ts -t "CR-01"` | PASS (1) | ✓ PASS |
| CR-01 fix — UTM survives password-unlock redirect (`/q/:code`) | `vitest run test/qrRedirect.integration.test.ts -t "CR-01"` | PASS (1) | ✓ PASS |
| WR-01 fix — `applyUtmParams` preserves unset embedded UTM keys | `vitest run test/redirectEngine.test.ts` | 37/37 pass | ✓ PASS |
| WR-01 fix — client preview mirrors server exactly | `vitest run src/lib/utm.test.ts` (web) | 13/13 pass | ✓ PASS |
| Full redirect + QR-redirect integration suites | `vitest run test/redirect.integration.test.ts test/qrRedirect.integration.test.ts` | Test Files 2 passed (2), Tests 48 passed (48) | ✓ PASS |
| Links CRUD + validation integration suite | `vitest run test/links.integration.test.ts` | Test Files 1 passed (1), Tests 67 passed (67) | ✓ PASS |
| Bot OG rendering + meta validation units | `vitest run test/publicHtml.test.ts test/links-meta.test.ts test/meta-schema-push.test.ts` | 50/50 pass | ✓ PASS |
| Web form/view/api unit + component tests | `vitest run src/components/LinkFormModal.test.ts src/views/LinksView.test.ts src/views/LinkDetailView.test.ts src/api.link.test.ts` | 109/109 pass | ✓ PASS |
| Repo-wide TypeScript check | `pnpm -r exec tsc --noEmit` | No output (clean) | ✓ PASS |
| Anti-SSRF grep — no fetch of `ogImageUrl`/destination anywhere in `apps/api/src` | `grep -rn "fetch(\|axios\|got(\|http.get\|https.get\|undici" apps/api/src` (excl. generated) | zero matches | ✓ PASS |

No full-suite re-run was performed (per task guidance — the full 452/205-test suites were already confirmed green and re-running needs Docker + ~90s); instead every file the review flagged (CR-01, WR-01) and every artifact/plan's core test file was run individually above, all green.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| META-01 | 08-01, 08-02, 08-03, 08-04, 08-06 | UTM builder with live preview of final destination URL | ✓ SATISFIED | Confirmed end-to-end: form → preview → API → redirect (Truths 1, 5, 6, 7) |
| META-02 | 08-01, 08-02, 08-03, 08-05, 08-06 | Per-link custom OG title/description/image with social-card preview, served to bots | ✓ SATISFIED | Confirmed end-to-end: form → preview → API → bot OG page (Truths 2, 3, 4, 7) |

**Note (documentation gap, not a functional gap):** `.planning/REQUIREMENTS.md` lines 74-75 (checkbox) and lines 167-168 (status table) still show META-01/META-02 as `[ ]` / "Pending", while the equivalent Phase 7 entries (QR-05..07) were updated to `[x]` / "Complete" once their phase finished. Both requirements are functionally satisfied per the evidence above; this is a stale-tracking-doc issue, not a phase-goal failure, but the requirements table should be updated to `Complete` as part of closing this phase (or the next docs pass).

### Anti-Patterns Found

None of the debt-marker categories (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`) were found in any file modified by this phase. The only `PLACEHOLDER`-adjacent hit is `UNFILLED_TARGET_PLACEHOLDER`, a legitimately named constant in `apps/web/src/lib/utm.ts` (the fallback preview string for an empty target field), not a stub marker.

No stub patterns (`return null`/`return {}`/empty handlers/hardcoded static returns) were found in any of the 13 phase-touched files reviewed.

### Human Verification Required

None. All must-haves are either directly grep/read-verified in the codebase or confirmed via passing automated tests (unit + integration), including the two review-flagged fixes (CR-01, WR-01) re-verified via their named regression tests. No visual/real-time/external-service behavior in this phase's scope required human judgment beyond what the existing automated test suites already cover (the UI-SPEC was separately verified and approved per the project's UI-checker pass noted in the memory context).

### Gaps Summary

No gaps. Both review findings (CR-01 critical, WR-01 warning) have their fix commits (`eebdb69`, `94aacfa`) present in the code and their regression tests passing. IN-01 (LinkDetailView tracking-toggle drop) is confirmed pre-existing (Phase 6), correctly out of Phase 8's scope, and does not affect any Phase 8 truth. The only non-blocking finding is the stale `REQUIREMENTS.md` tracking status noted above, which does not affect goal achievement.

---

_Verified: 2026-07-23T00:50:00Z_
_Verifier: Claude (gsd-verifier)_
