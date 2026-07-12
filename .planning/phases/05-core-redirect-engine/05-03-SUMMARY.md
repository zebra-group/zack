---
phase: 05-core-redirect-engine
plan: 03
subsystem: api
tags: [xss, html-escaping, server-rendered-html, redirect-engine, no-leak]

requires:
  - phase: 05-core-redirect-engine (plan 01)
    provides: BRAND_NAME/BRAND_ACCENT ENV keys with fail-safe defaults (env.ts)
provides:
  - "escapeHtml() reflected-XSS guard (& first, then <, >, \", ')"
  - "renderPasswordPage/renderExpiredPage/renderNotFoundPage/renderBotOgPage — one shared document shell"
  - "No-Leak-by-construction render ctx types (no target/targetUrl field on any of the four)"
affects: [05-06 (redirect route handler consumes these four renderers)]

tech-stack:
  added: []
  patterns:
    - "Pure, dependency-free tagged-template-string HTML rendering (no view engine)"
    - "Shared document shell (renderDocumentShell) + per-page body assembler, all four pages share one inline <style> block"

key-files:
  created:
    - apps/api/src/lib/publicHtml.ts
    - apps/api/test/publicHtml.test.ts
  modified: []

key-decisions:
  - "formatExpiryDate uses UTC getters (getUTCDate/getUTCMonth/getUTCFullYear), not local-time, matching 05-02's UTC end-of-day expiresAt persistence convention — server-local time would drift from the persisted value depending on host timezone"
  - "accent (BRAND_ACCENT) is interpolated raw into the inline <style> block, NOT passed through escapeHtml — it's operator ENV config (not part of the incoming-request trust boundary) and HTML-entity-escaping would corrupt the CSS custom-property value"
  - "brand (BRAND_NAME) IS passed through escapeHtml even though it's also ENV-controlled, not request-controlled — free defensive consistency with the escaping discipline, no downside since it's plain text content (title/brand-name/footer), not a CSS value"
  - "bot-OG page (renderBotOgPage) builds its own minimal <head>/<body> directly rather than reusing renderDocumentShell/wrapper markup — 05-UI-SPEC.md section 4 explicitly says this path is structural, not a fourth visual screen, and crawlers read primarily <head>"

requirements-completed: [UI-04, UI-05, REDIR-03, REDIR-05]

coverage:
  - id: D1
    description: "escapeHtml() escapes all five HTML-significant characters (& first) and neutralizes a script-injection payload with no raw angle brackets"
    requirement: REDIR-05
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts#escapeHtml (Pitfall 1, reflected-XSS guard)"
        status: pass
    human_judgment: false
  - id: D2
    description: "renderPasswordPage produces the LOCKED copy (title/body/url-chip/form action/CTA), the errorState inline-error + destructive border branch, and escapes slug/domain injection payloads"
    requirement: UI-04
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts#renderPasswordPage (UI-04, REDIR-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "renderExpiredPage produces the LOCKED title/body/status-footer with the TT.MM.JJJJ UTC-formatted expiry date"
    requirement: REDIR-03
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts#renderExpiredPage (UI-05, REDIR-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "renderNotFoundPage produces the LOCKED 404 display digit/title/body/CTA-href/status-footer"
    requirement: REDIR-03
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts#renderNotFoundPage (D-11)"
        status: pass
    human_judgment: false
  - id: D5
    description: "renderBotOgPage carries generic brand-only og:title/og:description/og:image/og:url meta tags and noindex, escapes slug/domain"
    requirement: REDIR-05
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts#renderBotOgPage (REDIR-05, D-05/D-06)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No-Leak: none of the four renderers ever emits a distinctive target-URL canary string, and none of the four ctx TS types has a target field"
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts — 'never contains a distinctive target-URL canary string (No-Leak)' assertions on all four renderers"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-07-12
status: complete
---

# Phase 05 Plan 03: Public HTML Render Layer Summary

**Dependency-free `escapeHtml()` + four tagged-template-string renderers (password/expiry/404/bot-OG) sharing one document shell, with No-Leak enforced structurally via ctx types that have no target field**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-12T15:00:00Z
- **Completed:** 2026-07-12T15:13:01Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- `escapeHtml()` — the reflected-XSS guard for the incoming (unvalidated-on-404) URL slug, entity-escaping `&<>"'` with `&` replaced first to avoid double-escaping
- Four render functions (`renderPasswordPage`, `renderExpiredPage`, `renderNotFoundPage`, `renderBotOgPage`) sharing one document shell + inline `<style>` block, tokens copied 1:1 from `apps/web/src/styles/tokens.css`, with `@media (prefers-color-scheme: dark)` support and no client JS/session
- LOCKED German copy from 05-UI-SPEC.md reproduced exactly (titles, body text, inline error, CTAs, status footers)
- No-Leak enforced by construction: all four render-context TypeScript types (`PasswordPageCtx`, `ExpiredPageCtx`, `NotFoundPageCtx`, `BotOgPageCtx`) have no `target`/`targetUrl` field, and tests additionally assert at runtime that a canary target string smuggled in via `as never` never appears in any rendered output

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1+2 (combined RED): failing tests for escapeHtml + all four renderers** - `72abe1b` (test)
2. **Task 1+2 (combined GREEN): implement publicHtml.ts** - `e13a9c0` (feat)

**Plan metadata:** (this commit)

_Note: Tasks 1 and 2 were implemented together in a single RED→GREEN cycle since the escapeHtml tests and the four-renderer tests were authored in the same test file and the renderers directly depend on escapeHtml — splitting into two separate RED/GREEN cycles would have required a throwaway intermediate escapeHtml-only implementation with no renderers, then discarding/rewriting the same file moments later for no test-isolation benefit. Both tasks' acceptance criteria (character-mapping/injection tests green + escapeHtml exported; copy-contract/no-leak/bot-OG tests green + typecheck clean) are independently verified in the final GREEN commit._

## Files Created/Modified
- `apps/api/src/lib/publicHtml.ts` - `escapeHtml` + `renderPasswordPage`/`renderExpiredPage`/`renderNotFoundPage`/`renderBotOgPage`, shared document shell/style/brand-row/footer helpers, `formatExpiryDate` (UTC)
- `apps/api/test/publicHtml.test.ts` - 24 unit tests: escaping character-mapping + injection payload, per-page copy contract, errorState branch, UTC date formatting, No-Leak canary assertions, bot-OG meta-tag structure, dark-mode/fonts/noindex presence

## Decisions Made
- `formatExpiryDate` uses UTC getters, not local time, to stay consistent with 05-02's UTC end-of-day `expiresAt` persistence convention (avoids server-timezone-dependent date drift)
- `accent` (`BRAND_ACCENT`) is interpolated raw into the CSS custom property — NOT escaped, since it's operator ENV config outside the request trust boundary and HTML-entity-escaping would corrupt the CSS value; `brand` (`BRAND_NAME`) IS escaped anyway as a free, uniform defensive habit even though it's likewise ENV-controlled
- `renderBotOgPage` builds its own minimal `<head>`/`<body>` document directly rather than reusing the visitor-page wrapper/card markup, per 05-UI-SPEC.md section 4's explicit "structural, not a fourth visual screen" framing

## Deviations from Plan

None - plan executed exactly as written. Tasks 1 and 2 were combined into a single RED→GREEN cycle (see Task Commits note above) rather than two sequential ones; both tasks' individual acceptance criteria are fully met and independently verifiable in the resulting test file/commits.

## Issues Encountered

- `pnpm --filter @kurzly/api test -- publicHtml` (the plan's literal verify command) does not reliably filter to only `publicHtml.test.ts` in this monorepo's pnpm/vitest passthrough setup — it runs the full 19-file suite instead. Running `test/publicHtml.test.ts` directly via `vitest run test/publicHtml.test.ts` confirmed all 24 tests pass in isolation. The full-suite runs additionally surfaced pre-existing, intermittent testcontainers-related timeouts in unrelated integration test files (`domains.integration.test.ts`, `links-auto-slug-reserved.test.ts`, `tlsCheck.integration.test.ts` — a different file failed on each of three separate full-suite runs), consistent with test-resource contention rather than a regression from this plan's changes (this plan's files are pure/no-DB and are not imported by any of those failing files). Out of scope per the executor's scope-boundary rule (pre-existing, unrelated, and not caused by this plan's changes) — not fixed here.
- `pnpm --filter @kurzly/api typecheck` (`tsc --noEmit`) is clean; note `apps/api/tsconfig.json`'s `include` is `["src"]` only, so this typecheck does not structurally type-check `test/publicHtml.test.ts`'s `as never` No-Leak-canary casts — the No-Leak guarantee is instead proven at runtime (canary-string-absence assertions) in that test file, which is the meaningful check regardless of test-file type-checking scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `apps/api/src/lib/publicHtml.ts`'s four exported renderers (`renderPasswordPage`, `renderExpiredPage`, `renderNotFoundPage`, `renderBotOgPage`) are ready for 05-06's redirect route handler to import and call directly with `{ brand, accent, domain, slug, ... }` contexts built from `loadEnv()`'s `BRAND_NAME`/`BRAND_ACCENT` and the resolved domain/slug — no further plumbing needed in this module.
- No blockers for 05-04/05-05/05-06.

---
*Phase: 05-core-redirect-engine*
*Completed: 2026-07-12*

## Self-Check: PASSED

- FOUND: apps/api/src/lib/publicHtml.ts
- FOUND: apps/api/test/publicHtml.test.ts
- FOUND: 05-03-SUMMARY.md
- FOUND commit: 72abe1b (test)
- FOUND commit: e13a9c0 (feat)
