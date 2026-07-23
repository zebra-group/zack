---
phase: 08-utm-builder-custom-og-metadata
plan: 03
subsystem: api
tags: [redirect-routes, og-metadata, utm, tdd]

# Dependency graph
requires:
  - phase: 08-utm-builder-custom-og-metadata
    provides: "plan 08-01's six nullable Link columns (utmSource/utmMedium/utmCampaign, ogTitle/ogDescription/ogImageUrl), live and validated through lib/links.ts's single write path"
  - phase: 08-utm-builder-custom-og-metadata
    provides: "plan 08-02's applyUtmParams(targetUrl, utm) and the BotOgPageCtx-extended renderBotOgPage — both pure, unit-tested, unwired helpers"
provides:
  - "GET /:slug and GET /q/:code both compose applyUtmParams(link.targetUrl, link) ahead of the existing forwardQuery mergeQuery call, in the D-08-02 order — a visitor can no longer displace an owner's UTM parameter of the same name"
  - "Both bot branches (routes/redirect.ts, routes/qrRedirect.ts) pass the resolved Link's ogTitle/ogDescription/ogImageUrl into renderBotOgPage, for every link state (ok/expired/protected)"
affects: [08-04-utm-og-form-ui, redirect-route-wiring-complete]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Target-assembly composition lives strictly inside the existing state==='ok' branch, after the expired/protected branches have already returned — the ordering itself is the security property (T-08-PRECEDENCE), not a runtime check"
    - "Both public redirect handlers (/:slug and /q/:code) receive byte-identical target-assembly and bot-context-extension edits in the same commit, to keep T-08-HANDLER-DRIFT from ever reappearing"

key-files:
  created: []
  modified:
    - apps/api/src/routes/redirect.ts
    - apps/api/src/routes/qrRedirect.ts
    - apps/api/test/redirect.integration.test.ts
    - apps/api/test/qrRedirect.integration.test.ts

key-decisions:
  - "applyUtmParams(link.targetUrl, link) is called with the fetched Link row directly as the second argument — Link structurally satisfies LinkUtmParams (08-02's design intent), so no mapping/DTO step was needed at the route layer."
  - "The QR scan marker strip in routes/redirect.ts stays exactly where it was, ahead of target assembly — verified with a dedicated regression test combining forwardQuery, a UTM parameter, and the ?qr= marker in the same request."
  - "renderBotOgPage's three OG fields are spread onto ctx using the same shape the pre-existing expired branch already uses for expiresAt (...ctx, ogTitle, ogDescription, ogImageUrl) — no new pattern introduced."

requirements-completed: [META-01, META-02]

coverage:
  - id: D1
    description: "GET /:slug for a link with UTM fields set redirects 302 to a Location carrying those parameters, whether or not the stored target already has a query string; a link with all three UTM fields null redirects to exactly the stored target, unchanged from Phase 5"
    requirement: "META-01"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect.integration.test.ts — 'UTM application (D-08-02, META-01)' describe block (7 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "With forwardQuery on, the owner's UTM parameter survives a visitor-supplied parameter of the same name (D-08-02 ordering); an unrelated visitor parameter still forwards alongside the owner's UTM values; the QR scan marker is stripped before UTM application and never reaches the destination"
    requirement: "META-01"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect.integration.test.ts — hijack/unrelated-param/marker-strip cases in the same describe block"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /q/:code for a dynamic QR whose bound Link carries UTM parameters behaves identically to /:slug, including the visitor-override ordering"
    requirement: "META-01"
    verification:
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts — 'UTM application on GET /q/:code (D-08-02, META-01)' describe block (2 tests, both pass)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A detected bot receives the owner's custom OG title/description/image for a normal link, a link with only one custom field (fallback for the rest), a PASSWORD-PROTECTED link, and an EXPIRED link — always as a 200, never a redirect, never the target string, never the human error page"
    requirement: "META-02"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect.integration.test.ts — 4 new cases in the 'REDIR-05: bot/crawler branch' describe block, all pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "A bot scanning a dynamic /q/:code behaves identically: custom OG values render for a normal target and for protected/expired targets, with no redirect and no destination leak"
    requirement: "META-02"
    verification:
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts — 'Bot/crawler branch on GET /q/:code (D-08-03, META-02)' describe block (2 tests, both pass)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Both public handlers use the identical helper composition — no drift between /:slug and /q/:code"
    requirement: "META-01, META-02"
    verification:
      - kind: other
        ref: "Manual side-by-side read of both routes' state==='ok' and bot branches (see 'Deviations from Plan' — none) plus pnpm --filter @kurzly/api test (448/448) and pnpm -r exec tsc --noEmit (clean)"
        status: pass
    human_judgment: false

duration: ~11min
completed: 2026-07-22
status: complete
---

# Phase 08 Plan 03: Redirect + Bot-OG Route Wiring Summary

**Wired 08-02's pure `applyUtmParams`/`renderBotOgPage` helpers into the two public redirect handlers — `GET /:slug` and `GET /q/:code` now append the owner's UTM parameters ahead of any visitor-query merge, and both bot branches now serve the resolved Link's custom OG title/description/image for every link state — turning META-01/META-02 from unwired library code into observable visitor/crawler behavior.**

## Performance

- **Duration:** ~11 min (two TDD cycles: UTM wiring, then bot-OG wiring)
- **Started:** 2026-07-22T21:13:34Z (RED commit)
- **Completed:** 2026-07-22T21:19:12Z (final GREEN commit)
- **Tasks:** 2 (both TDD)
- **Files modified:** 4

## Accomplishments
- `routes/redirect.ts`'s `GET /:slug` `state==='ok'` branch now composes the redirect target as `targetUrl -> applyUtmParams(link) -> [optional] mergeQuery(visitor query)` (D-08-02 order), imported directly from `lib/redirectEngine.js` alongside the existing `mergeQuery`/`QR_SCAN_PARAM` imports. The QR scan marker strip and `recordClickHook` call stay exactly where they were — only the final two lines assembling `target` changed, with a comment citing D-08-02 explaining the deliberate asymmetry between the owner-wins UTM step and the target-wins visitor-merge step.
- `routes/qrRedirect.ts`'s `GET /q/:code` `state==='ok'` branch received the byte-identical composition change (same helper, same order, same import), so `/:slug` and `/q/:code` cannot drift (T-08-HANDLER-DRIFT).
- Both bot branches (`routes/redirect.ts`, `routes/qrRedirect.ts`) now spread `ogTitle`/`ogDescription`/`ogImageUrl` from the resolved `link` row into the `renderBotOgPage` context, mirroring the existing expired branch's `...ctx, expiresAt` shape. The branch's position (ahead of the expired/protected checks), status code (200), and no-redirect behavior are all unchanged — only the context object gained three fields.
- 13 new integration tests across both suites cover: UTM append with/without an existing query string, the owner-wins hijack case, an unrelated visitor param forwarding alongside UTM, the no-UTM byte-identical-target regression, expired/protected links never carrying a Location header even with UTM set, the QR-marker-strip-plus-UTM regression, and the dynamic-QR twin of the append/hijack cases; plus custom-OG-for-normal-link, partial-custom-field-fallback, protected-link-OG, expired-link-OG, and the dynamic-QR bot-OG twin (normal + gated).
- Full API suite (448/448) and `pnpm -r exec tsc --noEmit` (clean) both pass after the change — no regression in any Phase 5/6/7 assertion.

## Task Commits

Each task was committed atomically (TDD RED → GREEN per task):

1. **Task 1+2 RED: failing redirect cases for owner UTM application and bot OG values** - `7225a4e` (test)
1. **Task 1 GREEN: append owner UTM parameters when building the redirect target** - `bbbd46d` (feat)
2. **Task 2 GREEN: serve custom OG values to bots on both redirect handlers** - `908080e` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/src/routes/redirect.ts` - imports `applyUtmParams`; `GET /:slug`'s target assembly now runs `applyUtmParams` before the `forwardQuery` `mergeQuery` call; the bot branch's `renderBotOgPage` call now spreads the link's three OG fields
- `apps/api/src/routes/qrRedirect.ts` - identical two changes (import + composition + bot-context extension), mirroring `redirect.ts` exactly
- `apps/api/test/redirect.integration.test.ts` - new "UTM application (D-08-02, META-01)" describe block (7 tests) plus 4 new cases appended to the existing "REDIR-05: bot/crawler branch" describe block
- `apps/api/test/qrRedirect.integration.test.ts` - new `BOT_UA` constant, new "UTM application on GET /q/:code (D-08-02, META-01)" describe block (2 tests), new "Bot/crawler branch on GET /q/:code (D-08-03, META-02)" describe block (2 tests)

## Decisions Made
- Both tasks' RED tests were written and committed together in a single `test(08-03)` commit (rather than two separate RED commits) since both task's test cases were straightforward to write up front and running the full suite once confirmed both failure sets independently — Task 1's GREEN commit made only the UTM assertions pass while the OG assertions remained red, confirmed before proceeding to Task 2's implementation, preserving the RED→GREEN evidence per task even though the test-authoring commit was combined.
- `applyUtmParams(link.targetUrl, link)` passes the fetched Prisma `Link` row straight through as `LinkUtmParams` with no mapping step, per 08-02's stated design intent (structural typing, not `Pick<Link,...>`).

## Deviations from Plan

None — plan executed exactly as written, including the "read the current code before editing" instruction (the QR marker strip position, the expired/protected precedence, and the `renderBotOgPage` call sites all matched the plan's line-number hints closely enough to locate directly).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration, no new dependencies, no auth gates.

## Next Phase Readiness

- Both public redirect handlers now fully honor a link's UTM parameters and custom OG metadata end to end (write path from 08-01, pure helpers from 08-02, route wiring from this plan) — META-01 and META-02's backend behavior is complete and integration-tested.
- The frontend UTM/OG accordion sections, live URL preview, and social-card preview (08-CONTEXT.md's "Prototype Contract") are not part of this plan and remain for a subsequent UI-focused plan in this phase.
- `pnpm --filter @kurzly/api test` (448/448) and `pnpm -r exec tsc --noEmit` (clean) both verified before the final commit.

---
*Phase: 08-utm-builder-custom-og-metadata*
*Completed: 2026-07-22*

## Self-Check: PASSED

All 4 modified files (`redirect.ts`, `qrRedirect.ts`, `redirect.integration.test.ts`, `qrRedirect.integration.test.ts`) confirmed present on disk. All 3 task commits (`7225a4e`, `bbbd46d`, `908080e`) confirmed present in `git log --oneline --all`.
