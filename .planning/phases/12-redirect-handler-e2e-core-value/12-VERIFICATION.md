---
phase: 12-redirect-handler-e2e-core-value
verified: 2026-07-25T00:30:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 12: Redirect Handler E2E Core Value Verification Report

**Phase Goal:** Prove the redirect handler — Kurzly's stated single most important guarantee — behaves correctly end-to-end across every state, against the built image, with no dependency on authentication (public endpoint).
**Verified:** 2026-07-25T00:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Playwright `APIRequestContext` delivers a caller-supplied `Host` header unmodified to Fastify, resolving the real registered Domain (Wave 0 gate). | ✓ VERIFIED | `apps/e2e/tests/smoke/host-header.spike.spec.ts` — live-run this session: both cases pass (positive branded-404-with-host-echo, control SPA-fallback-marker-absent). |
| 2 | Fixture Link helper stores a REAL bcrypt hash (never plaintext) and the exact UTC end-of-day `expiresAt`. | ✓ VERIFIED | `apps/e2e/src/links.ts` `derivePasswordHash`/`deriveExpiresAt`/`createE2eLink`; `apps/e2e/tests/smoke/links-fixture.spec.ts` — live-run this session: all 10 fixture-helper tests pass, including the 5 `fetchWithFixtureRaceRetry` unit tests added in the WR-02 review fix. |
| 3 | A slug on `e2e.kurzly.local` resolves to its exact stored target with 302 + exact `Location` + `Cache-Control: no-store`, over real HTTP with `maxRedirects: 0`. [REDIRECT-E2E-01] | ✓ VERIFIED | `apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts` — live-run this session: 2/2 pass (happy-path 302 + exact Location/no-store; reflected-XSS-guard entity-escaped 404). |
| 4 | Password gate: wrong password rejected with LOCKED inline error (no leak), correct password frees via a real browser cookie jar, unlock cookie carries on next navigation without re-prompt. [REDIRECT-E2E-02] | ✓ VERIFIED | `apps/e2e/tests/smoke/redirect-password-gate.spec.ts` — live-run this session (see Environment Note below): 2/2 pass, including host-resolution proof and the full wrong→correct→cookie-carry flow. |
| 5 | An expired link returns HTTP 410 (distinct from 404), no `Location`, no leak of target; expiry beats password gate (D-14). [REDIRECT-E2E-03] | ✓ VERIFIED | `apps/e2e/tests/smoke/redirect-expiry.spec.ts` — live-run this session: 3/3 pass (410 no-leak, distinct 404, expired+protected still 410 not password page). |
| 6 | Bot UA receives configured custom OG values (never target), respects password/expiry gates; browser UA is redirected. [REDIRECT-E2E-04] | ✓ VERIFIED | `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts` — live-run this session: 3/3 pass (bot-vs-human, bot+protected, bot+expired — all no-leak asserted). |
| 7 | Owner UTM + visitor query merge in canonical order on the final redirect `Location`; owner UTM overrides stale target key; forwardQuery-off ignores visitor params. [REDIRECT-E2E-05] | ✓ VERIFIED | `apps/e2e/tests/smoke/redirect-utm-merge.spec.ts` — live-run this session: 3/3 pass (canonical order, owner-override, forwardQuery-off). |
| 8 | The production change enabling REDIRECT-E2E-02 (`addContentTypeParser` for form-urlencoded POST) stays scoped to `POST /:slug/verify` and does not leak app-wide. | ✓ VERIFIED | `apps/api/src/routes/redirect.ts:253` scoped `app.addContentTypeParser` inside `registerRedirectRoute`; `apps/api/test/redirect.integration.test.ts`'s WR-04 regression test (sibling `POST /api/links` still 415) — live-run this session: 33/33 integration tests pass. |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/e2e/tests/smoke/host-header.spike.spec.ts` | Wave 0 Host-header proof | ✓ VERIFIED | Exists, substantive, wired, live-passing. |
| `apps/e2e/src/links.ts` | Fixture helper + shared vocabulary | ✓ VERIFIED | Exists, substantive (bcrypt hash, UTC expiry, retry helper), wired (imported by all 5 feature specs + links-fixture.spec.ts), live-passing. |
| `apps/e2e/tests/smoke/links-fixture.spec.ts` | RED→GREEN fixture-helper proof | ✓ VERIFIED | Exists, substantive (15 assertions across 5 describe blocks incl. `fetchWithFixtureRaceRetry`), live-passing. |
| `apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts` | REDIRECT-E2E-01 + XSS guard | ✓ VERIFIED | Exists, substantive, wired, live-passing. |
| `apps/e2e/tests/smoke/redirect-expiry.spec.ts` | REDIRECT-E2E-03 | ✓ VERIFIED | Exists, substantive, wired, live-passing. |
| `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts` | REDIRECT-E2E-04 | ✓ VERIFIED | Exists, substantive, wired, live-passing. |
| `apps/e2e/tests/smoke/redirect-utm-merge.spec.ts` | REDIRECT-E2E-05 | ✓ VERIFIED | Exists, substantive, wired, live-passing. |
| `apps/e2e/tests/smoke/redirect-password-gate.spec.ts` | REDIRECT-E2E-02 (real browser + cookie jar) | ✓ VERIFIED | Exists, substantive, wired, live-passing (including the host-resolution browser mechanism proof). |
| `apps/api/src/routes/redirect.ts` (production diff) | `addContentTypeParser` scoped to `POST /:slug/verify` | ✓ VERIFIED | 24-line addition confirmed as the only production diff (`git log`); scoping regression-tested (WR-04). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Caller-supplied `host` header on `request.get(...)` | `resolveActiveDomainByHost` | Fastify `request.hostname` | WIRED | Live-verified: branded 404 with host echo vs. SPA fallback delta. |
| `createE2eLink` | `passwordHash` column | `derivePasswordHash` (bcryptjs) | WIRED | Live-verified: `bcrypt.compare` accepts stored hash in links-fixture.spec.ts. |
| `createE2eLink` | `expiresAt` column | `deriveExpiresAt` (UTC end-of-day) | WIRED | Live-verified: exact `2020-01-01T23:59:59.999Z` instant asserted. |
| `APIRequestContext {host, UA, maxRedirects:0}` | `GET /:slug` | 302 exact Location + Cache-Control | WIRED | Live-verified. |
| Expired fixture | `resolveLinkState` D-14 precedence | 410 `renderExpiredPage` | WIRED | Live-verified, including expiry-beats-password. |
| `BOT_UA` request | `renderBotOgPage` | `isBotRequest` branch | WIRED | Live-verified across normal/protected/expired links. |
| `applyUtmParams` → `mergeQuery` | Final redirect `Location` | Composition order in `routes/redirect.ts` | WIRED | Live-verified canonical ordering + override + forwardQuery-off. |
| Chromium `--host-resolver-rules` | `page.goto(http://e2e.kurzly.local:PORT/:slug)` | Redirect engine (not SPA fallback) | WIRED | Live-verified this session (see Environment Note). |
| Correct `POST /:slug/verify` | `issueUnlockCookie` | Next `page.goto` redirects without re-prompt | WIRED | Live-verified this session — full 4-step flow passed. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REDIRECT-E2E-01 | 12-03 | Slug → target happy path (3xx + Location) | ✓ SATISFIED | `redirect-slug-redirect.spec.ts` live-passing. |
| REDIRECT-E2E-02 | 12-05 | Password gate — wrong rejected, correct frees | ✓ SATISFIED | `redirect-password-gate.spec.ts` live-passing this session (resolves prior documented environment limitation). |
| REDIRECT-E2E-03 | 12-03 | Expiry gate — 410, distinct from 404, no leak | ✓ SATISFIED | `redirect-expiry.spec.ts` live-passing. |
| REDIRECT-E2E-04 | 12-04 | Bot/OG rendering — custom OG, never target | ✓ SATISFIED | `redirect-bot-og-render.spec.ts` live-passing. |
| REDIRECT-E2E-05 | 12-04 | UTM/query merge, canonical order | ✓ SATISFIED | `redirect-utm-merge.spec.ts` live-passing. |

No orphaned requirements — all 5 REDIRECT-E2E-* IDs declared across the 5 plan frontmatters match REQUIREMENTS.md's Phase 12 mapping exactly (REQUIREMENTS.md lines 31–35, 92–96, all marked Complete).

### Anti-Patterns Found

None. Scanned all 9 phase-modified files (`apps/e2e/src/links.ts`, all 6 `apps/e2e/tests/smoke/*.spec.ts` files this phase touched, `apps/api/src/routes/redirect.ts`, `apps/api/test/redirect.integration.test.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — zero matches.

### Code Review Findings (12-REVIEW.md / 12-REVIEW-FIX.md)

0 Critical, 4 Warning (WR-01 through WR-04), 2 Info. All 4 Warnings were fixed in a single fix iteration (commits `2ec16df`, `0ec3bb9`, `a4e09c0`, `8109765`) and independently confirmed present in the current codebase during this verification (`fetchWithFixtureRaceRetry` generalized + applied consistently in `redirect-password-gate.spec.ts`/`redirect-bot-og-render.spec.ts`; dedicated unit tests added in `links-fixture.spec.ts`; `console.warn`/`onDiscardedAttempt` diagnostic wired; WR-04 regression test present in `redirect.integration.test.ts` and passing). The 2 Info items (throwaway-spike-kept-permanently, duplicated constants) are non-blocking documentation notes, not defects.

### Behavioral Spot-Checks / Live Verification (This Session)

Unlike prior phase sessions (which relied on a previously-booted stack), this verification independently booted a fresh, isolated compose stack (`docker compose -p kurzly-e2e-verify`, remapped host ports for `db`/`mailpit`/`app` via a `!override`-merged temporary compose file, to avoid touching the two documented pre-existing, unrelated port occupants: `zbr-brain-postgres-1` on 5433 and a rogue `product-catalog` `tsx watch` dev server on 3000) and ran the actual Phase 12 specs against the built `kurzly-e2e-app:latest` image:

| Suite | Command | Result | Status |
|-------|---------|--------|--------|
| host-header spike + links-fixture + 4 API-only feature specs | `playwright test --project=smoke --no-deps ... --workers=4` | 23/23 passed | ✓ PASS |
| redirect-password-gate.spec.ts (real browser) | `playwright test --project=smoke --no-deps tests/smoke/redirect-password-gate.spec.ts --workers=2` | 2/2 passed | ✓ PASS |
| API integration suite (fastify.inject layer) | `vitest run test/redirect.integration.test.ts` | 33/33 passed | ✓ PASS |

**Environment note:** Remapping the app's host port to 13000 (to avoid the rogue port-3000 process) resolved the exact interference 12-REVIEW-FIX.md documented for `redirect-password-gate.spec.ts` — both of its tests passed live in this session, upgrading REDIRECT-E2E-02 from "statically verified + previously-live-verified-before-the-rogue-process" to **live-verified in this verification session**. The `smoke` project's declared `dependencies: ["setup"]` (a pre-existing Phase 11 magic-link-race guard, unrelated to Phase 12) was bypassed with Playwright's `--no-deps` flag since none of Phase 12's specs touch authenticated flows; this is a test-runner invocation choice for this verification pass only, not a codebase change. Stack was torn down cleanly (`down -v --remove-orphans`) and the temporary image (`kurzly-e2e-verify-app`) removed after verification; `git status` confirms a clean working tree with no residual changes from this verification session.

### Human Verification Required

None. All must-haves have automated, live-executed evidence from this verification session.

### Gaps Summary

No gaps. All 5 requirement IDs (REDIRECT-E2E-01 through -05) are satisfied with live-passing E2E evidence gathered in this session against the actual built compose image, not merely inferred from SUMMARY.md narrative. The one previously-flagged environment limitation (password-gate spec untestable in a sandbox with a rogue process on port 3000) was independently resolved this session via port remapping and no longer applies.

---

_Verified: 2026-07-25T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
