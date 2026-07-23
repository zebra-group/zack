---
phase: 06-internal-tracking-analytics
plan: 05
subsystem: api
tags: [prisma, raw-sql, fastify, analytics, idor, tdd]

# Dependency graph
requires:
  - phase: 06-internal-tracking-analytics
    provides: "Link.lifetimeClicks/trackingEnabled + ClickEvent/DailySalt schema (06-02)"
provides:
  - "lib/analytics.ts: getLinkAnalytics + getGlobalAnalytics, parameterized Prisma.sql aggregation"
  - "GET /api/links/:id/analytics — IDOR-guarded per-link analytics endpoint"
  - "GET /api/analytics — session-gated, domain-scoped global overview endpoint"
  - "LinkAnalyticsDTO / GlobalAnalyticsDTO shared types"
affects: [06-06, 06-07, 06-08, phase-09-team-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First $queryRaw/Prisma.sql tagged-template usage in the codebase — parameterized date_trunc + generate_series zero-fill for a fixed 30-bucket daily series"
    - "Read-side aggregation service (lib/analytics.ts) mirrors lib/links.ts's DTO-shaping style but performs zero writes"
    - "Route-layer IDOR guard (resolveOwnedLink) duplicated verbatim from routes/links.ts rather than shared/imported — matches this codebase's existing per-route-file convention"

key-files:
  created:
    - apps/api/src/lib/analytics.ts
    - apps/api/src/routes/analytics.ts
    - apps/api/test/analytics.test.ts
  modified:
    - apps/api/src/app.ts
    - packages/shared/src/index.ts

key-decisions:
  - "Per-link/global daily series is generated in application code (emptyDailySeries) for the empty-domainIds short-circuit, avoiding an invalid Prisma.join([]) SQL call while still returning the UI's expected fixed 30-entry shape (T-06-EMPTY)."
  - "referrerHost/country stay null through the SQL layer (no COALESCE to 'Direkt'/'Unbekannt') — deviates from RESEARCH Pattern 5's own example, which does COALESCE in SQL, in favor of RESEARCH's own stated Anti-Pattern ('store null, translate only at the view boundary'); the two guidance sources in 06-RESEARCH.md conflicted and the Anti-Pattern rule was followed as authoritative."
  - "source = 'qr' compared via an explicit ::\"ScanSource\" cast on the bound parameter — a bare text parameter against a native Postgres enum column requires an explicit cast (implicit unknown-literal coercion only applies to unparameterized SQL literals)."

patterns-established:
  - "Parameterized raw SQL only (Prisma.sql/$queryRaw, never $queryRawUnsafe) for any query Prisma's typed DSL cannot express (date bucketing, generate_series zero-fill)"

requirements-completed: [TRACK-04, TRACK-05]

coverage:
  - id: D1
    description: "getLinkAnalytics returns a 30-bucket zero-filled daily series, lifetimeClicks-derived totalClicks, last7Days, and count-desc top referrers/countries with null preserved for unknown values"
    requirement: TRACK-04
    verification:
      - kind: integration
        ref: "apps/api/test/analytics.test.ts#lib/analytics.ts — getLinkAnalytics (TRACK-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "getGlobalAnalytics returns clicks30Days, COUNT(DISTINCT visitorHash) uniqueVisitors, activeLinks independent of clicks, qrScans read (not hardcoded) as 0, and domain-scoped topLinks/topReferrers; empty domainIds yields all-zero/empty results with no cross-tenant leak"
    requirement: TRACK-05
    verification:
      - kind: integration
        ref: "apps/api/test/analytics.test.ts#lib/analytics.ts — getGlobalAnalytics (TRACK-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/links/:id/analytics is 401 unauthenticated, 404 identical-body for both not-found and out-of-scope (no existence oracle), 200 + LinkAnalyticsDTO for an owned link"
    requirement: TRACK-04
    verification:
      - kind: integration
        ref: "apps/api/test/analytics.test.ts#GET /api/links/:id/analytics (route layer, IDOR guard — TRACK-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/analytics is 401 unauthenticated, 200 scoped to the caller's own domains only (a domain the caller has no membership on never leaks into the response)"
    requirement: TRACK-05
    verification:
      - kind: integration
        ref: "apps/api/test/analytics.test.ts#GET /api/analytics (route layer, session-gated + domain-scoped — TRACK-05)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every aggregation query in lib/analytics.ts is a parameterized tagged-template Prisma.sql call — no $queryRawUnsafe, no string-interpolated SQL"
    requirement: TRACK-04
    verification:
      - kind: other
        ref: "grep -c \"Prisma.sql\" apps/api/src/lib/analytics.ts (>=1, actual 9) + grep \"queryRawUnsafe\" (no real usage, only in a doc comment)"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-07-13
status: complete
---

# Phase 06 Plan 05: Analytics Read API Summary

**Parameterisiertes `lib/analytics.ts` (date_trunc + generate_series Zero-Fill) plus zwei IDOR-guarded/domain-scoped Fastify-Endpoints (`GET /api/links/:id/analytics`, `GET /api/analytics`) für Pro-Link- und Global-Analytics.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-13T11:03:00Z
- **Completed:** 2026-07-13T11:27:00Z
- **Tasks:** 2
- **Files modified:** 5 (2 created source, 1 created test, 2 modified)

## Accomplishments
- `lib/analytics.ts` liefert `getLinkAnalytics`/`getGlobalAnalytics` — beide ausschließlich über parameterisierte, tagged-template `Prisma.sql`/`$queryRaw`-Aufrufe (9 Vorkommen, kein `$queryRawUnsafe`), inklusive des `date_trunc`+`generate_series`-Zero-Fill-Musters für eine garantiert 30 Einträge lange Tagesreihe.
- `totalClicks` liest ausschließlich `Link.lifetimeClicks` (D-13), niemals ein Live-`COUNT` über `ClickEvent` — bleibt so auch nach künftigem Retention-Pruning korrekt.
- `GET /api/links/:id/analytics` übernimmt `routes/links.ts`s `resolveOwnedLink`-IDOR-Form wortwörtlich: identisches 404 für "nicht gefunden" und "kein Zugriff", kein Existenz-Orakel.
- `GET /api/analytics` ist session-gated und auf `scopedDomainIds(userId)` skaliert — niemals die gesamte Instanz; der volle rollenbasierte Sichtbarkeits-Enforcement bleibt bewusst Phase 9 (TEAM-06) vorbehalten und ist im Datei-Header dokumentiert.
- `LinkAnalyticsDTO`/`GlobalAnalyticsDTO` in `packages/shared` ergänzt, Shared-Package neu gebaut, `pnpm -r exec tsc --noEmit` grün.
- 16 neue Tests (11 lib-level + 5 route-level) in `apps/api/test/analytics.test.ts`, alle grün in Isolation.

## Task Commits

Each task was committed atomically (TDD: test → feat per task):

1. **Task 1: lib/analytics.ts — parameterized per-link + global aggregation** — RED `73f30ba` (test), GREEN `21e1340` (feat)
2. **Task 2: routes/analytics.ts — IDOR-guarded/session-gated endpoints + app.ts registration** — `f615e27` (feat, includes the endpoint-level test extensions + a test-fixture fix)

**Plan metadata:** commit pending (this docs commit)

_Note: This is a `type: tdd` plan — the full RED → GREEN gate sequence is present in git log (`test(06-05)` before `feat(06-05)`)._

## Files Created/Modified
- `apps/api/src/lib/analytics.ts` - Parameterized aggregation core: `getLinkAnalytics`, `getGlobalAnalytics`
- `apps/api/src/routes/analytics.ts` - `analyticsRoute(prisma, auth)` — the two new endpoints
- `apps/api/src/app.ts` - Registers `analyticsRoute` after `linksRoute`, before `redirectRoute`/`registerStatic`
- `packages/shared/src/index.ts` - `LinkAnalyticsDTO`, `GlobalAnalyticsDTO`
- `apps/api/test/analytics.test.ts` - 16 tests: lib-level aggregation (11) + route-level auth/IDOR/scoping (5)

## Decisions Made
- **Null vs. "Direkt"/"Unbekannt" in SQL:** 06-RESEARCH.md's Pattern 5 code example does `COALESCE("referrerHost", 'Direkt')` in SQL, but its own Anti-Patterns section says raw data must stay `null` and only get translated at the view boundary. Followed the Anti-Pattern rule (kept `null` all the way through `lib/analytics.ts`) since it is the more explicit, more recently-stated guidance and matches the plan's own `<behavior>` spec ("a null referrerHost surfaces as null").
- **Empty-domainIds short-circuit still returns 30 buckets:** rather than an empty array, `getGlobalAnalytics([])` returns a locally-computed 30-entry all-zero series (`emptyDailySeries()`) so the UI chart contract (fixed 30 bars) holds even for a brand-new user with zero domain memberships.
- **`source = 'qr'` requires an explicit cast:** `ce."source" = ${"qr"}::"ScanSource"` — a bound text parameter against a native Postgres enum column needs an explicit cast (unlike an unparameterized string literal, which Postgres would coerce implicitly).
- **Test fixture gap found and fixed inline (Rule 1):** the initial route-layer tests failed because `signInAs()` silently no-ops for a non-allowlisted email (D-01's invite-only allowlist + neutral non-error response) — added the same `seedInitialAdmin`/`user.upsert` `beforeEach` that `links.integration.test.ts` already establishes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing allowlist seeding in the new test file's sign-in helper**
- **Found during:** Task 2 (endpoint test extension)
- **Issue:** `analytics.test.ts`'s `signInAs()` was copied from `links.integration.test.ts` but the accompanying `beforeEach` that seeds `OWNER_EMAIL`/`OUTSIDER_EMAIL` into the invite-only allowlist (`User` table) was omitted. `sendMagicLink`'s allowlist check (`lib/auth.ts`) silently returns without calling the mailer for a non-allowlisted email (D-01's timing-safe neutral response) — 3 route-level tests failed with "sendMagicLinkEmail was not called".
- **Fix:** Added the identical `beforeEach` (mock clear + `seedInitialAdmin` + `user.upsert`) from `links.integration.test.ts`.
- **Files modified:** `apps/api/test/analytics.test.ts`
- **Verification:** All 16 tests pass in isolation (`pnpm exec vitest run test/analytics.test.ts`), re-confirmed twice.
- **Committed in:** `f615e27` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test-only fix, no production code change. No scope creep.

## Issues Encountered
- Running the FULL `apps/api` test suite (all 102 files) intermittently times out a small, non-deterministic subset of unrelated test files (different files fail on different runs — `domains.integration.test.ts`, `links-import.integration.test.ts`, `auth.integration.test.ts`, `canary.integration.test.ts`, `links.integration.test.ts`) under "Test timed out in 5000ms" — this matches the project's already-documented WSL2 testcontainer contention flake (see `06-internal-tracking-analytics/deferred-items.md` and this plan's critical_reminders). `test/analytics.test.ts` itself never appeared among the failing files across two full-suite runs and passes reliably (16/16) every time it is run in isolation — treated as environmental noise, not a real failure, per project convention.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `lib/analytics.ts` + both endpoints are ready for 06-06/06-07 (the `LinkDetailView`/`AnalyticsView` UI plans) to consume via `api.ts` client calls returning `LinkAnalyticsDTO`/`GlobalAnalyticsDTO`.
- The documented Phase-9 gap (full member-role domain-scoped visibility + denial-test suite for `GET /api/analytics`) is a known, intentional carry-forward — not a blocker for this milestone's UI work, since `scopedDomainIds` already prevents cross-tenant leaks at the domain-membership level.
- 06-04 (redirect-hook click recording) has not yet been executed in this run — `lib/analytics.ts` was validated entirely against directly-seeded `ClickEvent` rows, independent of that plan's write path, so no ordering dependency exists between 06-04 and 06-05.

---
*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

All created files verified on disk; all task commit hashes (`73f30ba`, `21e1340`, `f615e27`) verified in git log.
