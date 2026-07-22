---
phase: 08-utm-builder-custom-og-metadata
plan: 02
subsystem: api
tags: [redirect-engine, og-metadata, utm, xss-prevention, ssrf-prevention, tdd]

# Dependency graph
requires:
  - phase: 08-utm-builder-custom-og-metadata
    provides: "plan 08-01's six nullable Link columns (utmSource/utmMedium/utmCampaign, ogTitle/ogDescription/ogImageUrl), all live, migrated, generated-client-typed and validated through lib/links.ts's single write path"
  - phase: 05-core-redirect-engine
    provides: "mergeQuery's target-wins query-merge pattern and the pure, Fastify/Prisma-free module discipline applyUtmParams mirrors; renderBotOgPage/escapeHtml's no-leak, always-escape rendering contract"
provides:
  - "applyUtmParams(targetUrl, utm) in lib/redirectEngine.ts — owner-wins UTM application with canonical source/medium/campaign ordering, URLSearchParams-delegated encoding, and a byte-identical no-op passthrough when no UTM value is set"
  - "LinkUtmParams standalone structural type, satisfied by any fetched Prisma Link row without a mapping step"
  - "BotOgPageCtx extended with optional ogTitle/ogDescription/ogImageUrl, each escaped and resolved per-field against the existing generic brand fallback in renderBotOgPage"
  - "Render-time absolute-http(s) guard on og:image (defence in depth over 08-01's write-time validation)"
affects: [08-03-utm-builder-ui, 08-04-og-preview-ui, redirect-route-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "applyUtmParams mirrors mergeQuery's URL/URLSearchParams-only mutation discipline (scheme/host/path never touched) but resolves conflicts in the opposite direction — owner-typed values override the target, not the reverse — documented directly in redirectEngine.ts's module header as the D-08-02 composition order for future route-layer wiring"
    - "Load-bearing early-return guard: applyUtmParams returns the raw input string unchanged (no new URL() round-trip) when no UTM value is set, preserving Phase 5's exact-target redirect guarantee"
    - "Per-field render-time fallback resolution in renderBotOgPage: each of the three OG fields independently resolves to its own generic brand default when unset, rather than an all-or-nothing custom/generic switch"

key-files:
  created: []
  modified:
    - apps/api/src/lib/redirectEngine.ts
    - apps/api/src/lib/publicHtml.ts
    - apps/api/test/redirectEngine.test.ts
    - apps/api/test/publicHtml.test.ts

key-decisions:
  - "LinkUtmParams declared as a standalone structural type (NOT Pick<Link, ...>) per the plan's explicit instruction, keeping redirectEngine.ts genuinely dependency-free of the generated Prisma client at the value level (the only import remains a type-only Link import, unchanged from before this plan)."
  - "applyUtmParams deletes then re-sets utm_source/utm_medium/utm_campaign in that fixed order on every apply (not a conditional reorder), so a target that already carries e.g. utm_campaign always renders the three keys in canonical order rather than pinning campaign to its original position."
  - "renderBotOgPage's og:image guard uses the same WHATWG URL-parser-in-try/catch idiom as lib/links.ts's write-time validateOgImageUrl (08-01), for a consistent 'try to parse, check protocol' pattern across the write and render paths."

requirements-completed: [META-01, META-02]

coverage:
  - id: D1
    description: "applyUtmParams overrides same-named target query keys with the owner's UTM values in canonical source/medium/campaign order, percent-encodes via URLSearchParams, and returns the input target string byte-for-byte unchanged (no URL round-trip) when no UTM value is set"
    requirement: "META-01"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts — 'applyUtmParams (D-08-02, owner-wins UTM application)' describe block (11 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "applyUtmParams never alters the target's scheme, host, or path, and composes with mergeQuery in the D-08-02 order (owner's utm_source survives a visitor-forwarded utm_source of the same name)"
    requirement: "META-01"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts — 'never alters the target's scheme, host, or path' + 'composes with mergeQuery in the D-08-02 order' (2 tests, both pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "renderBotOgPage emits the owner's custom og:title/og:description/og:image (and document title) when set, entity-escaped, falling back per-field to the existing generic brand copy when a field is null/unset; output is byte-identical to the pre-existing generic page when all three are null"
    requirement: "META-02"
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts — 'custom OG values (META-02, D-08-03)' describe block (9 tests, all pass)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A non-absolute-http(s) og:image value (javascript:, data:, relative path) is dropped in favour of the brand favicon fallback rather than emitted; the server never fetches the image URL anywhere on the render path; BotOgPageCtx still carries no targetUrl-shaped field"
    requirement: "META-02"
    verification:
      - kind: unit
        ref: "apps/api/test/publicHtml.test.ts — 'falls back to the brand image when ogImageUrl %s is not an absolute http/https URL' (3 cases) + 'still carries no targetUrl-shaped field...' (1 test), all pass"
        status: pass
      - kind: other
        ref: "grep -rn 'fetch\\|axios\\|http.request' apps/api/src/lib/publicHtml.ts — no matches (structural SSRF mitigation, T-08-SSRF-RENDER)"
        status: pass
    human_judgment: false

duration: ~9min
completed: 2026-07-22
status: complete
---

# Phase 08 Plan 02: UTM Application + Custom OG Rendering Summary

**Two pure, Fastify/Prisma-runtime-free helpers — `applyUtmParams` (owner-wins UTM query override with canonical ordering and a byte-identical no-op passthrough) in `lib/redirectEngine.ts`, and a three-field custom-OG extension of `renderBotOgPage` (per-field brand fallback, full escaping, render-time http(s)-only image guard) in `lib/publicHtml.ts` — both fully unit-tested with object-literal fixtures, no route wiring yet.**

## Performance

- **Duration:** ~9 min (two TDD cycles, full API suite + workspace type-check verification)
- **Started:** 2026-07-22T20:57:46Z
- **Completed:** 2026-07-22T21:06:08Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4

## Accomplishments
- Added `applyUtmParams(targetUrl, utm)` and the standalone `LinkUtmParams` structural type to `redirectEngine.ts`: deletes then re-sets `utm_source`/`utm_medium`/`utm_campaign` in that fixed canonical order so a pre-existing `utm_campaign` on the target never pins the campaign parameter ahead of source/medium; owner values override same-named target keys (opposite of `mergeQuery`'s target-wins rule, per D-08-02); encoding is delegated entirely to `URLSearchParams` (D-08-05).
- Made the "no UTM set → return input string unchanged" guard load-bearing per the plan's Blocker-2 correction: no `new URL()` round-trip occurs on that branch, so `https://example.com` stays `https://example.com` (no added trailing slash) and the Phase 5 exact-target redirect assertions stay intact.
- Documented the D-08-02 composition order (`targetUrl` → `applyUtmParams` (override) → conditionally `mergeQuery` (target-wins)) directly in `redirectEngine.ts`'s module header, including why the two functions resolve conflicts in opposite directions, for the future route-layer wiring plan to consume.
- Extended `BotOgPageCtx` in `publicHtml.ts` from a bare `BasePageCtx` alias to an interface with three optional owner-authored fields (`ogTitle`/`ogDescription`/`ogImageUrl`); `renderBotOgPage` resolves each independently against its existing generic fallback, escapes every resolved value through `escapeHtml`, and sets the document `<title>` to the resolved title too (crawlers that ignore `og:title` read it).
- Added a render-time absolute-`http(s)`-only guard on `og:image` (WHATWG `URL` constructor in try/catch, protocol check) as defence in depth over plan 08-01's write-time `validateOgImageUrl` — a `javascript:`/`data:`/relative value falls back to the brand favicon instead of being emitted. No fetch of the image URL was added anywhere (D-08-04).
- Verified the no-regression case explicitly: with all three custom fields `null`, `renderBotOgPage`'s output is byte-identical (`toBe`, not `toContain`) to calling it without those fields at all.

## Task Commits

Each task was committed atomically (TDD RED → GREEN per task):

1. **Task 1 RED: failing cases for owner-wins UTM application** - `52f455a` (test)
1. **Task 1 GREEN: applyUtmParams with owner-wins override and safe encoding** - `7af1600` (feat)
2. **Task 2 RED: failing cases for custom OG values on the bot page** - `0949e01` (test)
2. **Task 2 GREEN: serve owner-typed OG title/description/image to bots** - `968106e` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/src/lib/redirectEngine.ts` - `LinkUtmParams` type + `applyUtmParams` function; module header extended with the D-08-02 composition-order documentation
- `apps/api/test/redirectEngine.test.ts` - new `applyUtmParams` describe block (11 tests: single-set, existing-query, override, canonical ordering, percent-encoding round-trip, byte-identical no-op passthrough x2, empty/whitespace treated as unset, scheme/host/path untouched, `mergeQuery` composition)
- `apps/api/src/lib/publicHtml.ts` - `BotOgPageCtx` widened to an interface with three optional OG fields; `renderBotOgPage` extended with per-field resolution/escaping and the `isSetOgValue`/`isAbsoluteHttpUrl` helpers
- `apps/api/test/publicHtml.test.ts` - new nested "custom OG values (META-02, D-08-03)" describe block under `renderBotOgPage` (9 tests: no-regression byte-identity, per-field custom values, per-field fallback preservation, escaping, 3-case non-http(s) fallback, no-leak with custom fields set)

## Decisions Made
- `LinkUtmParams` is a standalone structural type per the plan's explicit instruction (not `Pick<Link, ...>`) — keeps `redirectEngine.ts`'s only Prisma touchpoint a type-only import, unchanged from before this plan.
- Canonical parameter re-ordering is unconditional (delete-then-set all three keys on every apply, not just when a conflict is detected) — simpler than conditionally reordering only when a pre-existing key is found, and produces the same locked ordering either way.
- Reused `lib/links.ts`'s write-time `validateOgImageUrl` try/catch-around-`new URL()` idiom for the render-time guard, for pattern consistency across the write and render paths (no new parsing approach introduced).

## Deviations from Plan

None - plan executed exactly as written, including the Blocker-2 no-round-trip correction called out in the execution notes.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Both functions are pure and unit-tested only; no route wiring, no database access, no new dependencies.

## Next Phase Readiness

- `applyUtmParams` and the extended `renderBotOgPage`/`BotOgPageCtx` are ready for the redirect-route and bot-detection call sites (`routes/redirect.ts`, `routes/qrRedirect.ts`) to wire in — neither call site was touched in this plan, so the two existing signature-unaware integration suites (redirect, qrRedirect) still pass unchanged, confirming no accidental behavior change leaked into the routes.
- Both `redirectEngine.ts` and `publicHtml.ts` remain Fastify/Prisma-runtime-free (grep-verified: `redirectEngine.ts`'s only import is a type-only `Link`; `publicHtml.ts` has zero external imports).
- The `LinkUtmParams` structural type and the `BotOgPageCtx` optional-field extension are additive-only — no existing call site's TypeScript shape was narrowed or broken (`pnpm -r exec tsc --noEmit` clean across api/web/shared).
- A later 08-xx wave (route wiring) will need to: (1) call `applyUtmParams(link.targetUrl, link)` before `mergeQuery` in `routes/redirect.ts`'s `state === "ok"` branch, since `Link` structurally satisfies `LinkUtmParams`; (2) pass `link.ogTitle`/`ogDescription`/`ogImageUrl` into the `BotOgPageCtx` object at both `renderBotOgPage` call sites (`routes/redirect.ts`, `routes/qrRedirect.ts`).

---
*Phase: 08-utm-builder-custom-og-metadata*
*Completed: 2026-07-22*

## Self-Check: PASSED

All 4 modified source/test files (`redirectEngine.ts`, `publicHtml.ts`, `redirectEngine.test.ts`, `publicHtml.test.ts`) confirmed present on disk. All 4 task commits (`52f455a`, `7af1600`, `0949e01`, `968106e`) confirmed present in `git log --oneline --all`.
