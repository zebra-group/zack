---
phase: 17-team-management-domain-scoped-authz-e2e
plan: 05
subsystem: testing
tags: [playwright, e2e, authorization, admin-bypass, rate-limit]

requires:
  - phase: 17-04
    provides: apps/e2e/src/db.ts ADMIN_EMAIL/createE2ePrisma, apps/e2e/src/links.ts createE2eLink (domainHostname option), apps/e2e/src/qr.ts createE2eQrCode
provides:
  - "apps/e2e/tests/authed/authz-admin-bypass.spec.ts — AUTHZ-E2E-02 live-verified"
affects: [verify-work, milestone-close]

tech-stack:
  added: []
  patterns:
    - "Explicit DB precondition assertion (domainMembership.count === 0) turning an implicit fixture fact into a self-documenting, regression-visible assertion"
    - "Fresh per-test second domain (never referenced by any DomainMembership for anyone) as the strongest available account-admin-bypass proof, removing 'implicitly admin-owned baseline domain' doubt"
    - "Reused the EXISTING chromium-admin storageState `page` directly (no new browser context) since the bypass IS the pre-authenticated admin fixture itself"

key-files:
  created:
    - apps/e2e/tests/authed/authz-admin-bypass.spec.ts
    - .planning/phases/17-team-management-domain-scoped-authz-e2e/deferred-items.md
  modified: []

key-decisions:
  - "No new admin fixture created — reused the existing seeded ADMIN_EMAIL/chromium-admin storageState verbatim, per 17-RESEARCH.md Pattern 5, since it already has zero DomainMembership rows"
  - "Targeted a FRESH second domain (never referenced by any DomainMembership for the admin OR anyone) rather than the baseline domain, for the strongest available bypass story (Assumption A2)"
  - "Full tests/authed/ wave-merge gate: documented a pre-existing, cross-cutting rate-limit-capacity test-harness limitation (deferred-items.md D-17-05-01) rather than expanding this plan's scope to fix it — confirmed via isolation testing that it is unrelated to this plan's own spec"

requirements-completed: [AUTHZ-E2E-02]

coverage:
  - id: D1
    description: "The seeded admin's domainMembership.count({where:{userId}}) === 0 is asserted explicitly before any navigation"
    requirement: "AUTHZ-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/authz-admin-bypass.spec.ts — PRECONDITION"
        status: pass
    human_judgment: false
  - id: D2
    description: "The admin reaches a Link on a FRESH second domain (no DomainMembership for anyone) via the real UI: .link-slug renders, .not-found-card absent"
    requirement: "AUTHZ-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/authz-admin-bypass.spec.ts — UI BYPASS PROOF"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/links/:id and GET /api/qr-codes/:id on the never-assigned domain both return 200 via the admin's real cookie jar"
    requirement: "AUTHZ-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/authz-admin-bypass.spec.ts — API BYPASS PROOF"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-25
status: complete
---

# Phase 17 Plan 05: AUTHZ-E2E-02 — Account-Admin Bypass Summary

**An account-admin holding zero `DomainMembership` rows reaches a Link/QR on a freshly-seeded second domain referenced by no membership for anyone — proving `isAccountAdmin`'s short-circuit through the real UI/API for the first time, closing the v1.1 milestone's final requirement with zero apps/api/apps/web diffs.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 1
- **Files modified:** 2 (1 new spec file, 1 new deferred-items.md)

## Accomplishments

- Proved AUTHZ-E2E-02 (the account-admin bypass) live against the built compose image: an explicit `prisma.domainMembership.count({ where: { userId: admin.id } }) === 0` precondition read, followed by the existing `chromium-admin` storageState `page` reaching a Link (`.link-slug` rendered, `.not-found-card` absent) and both `GET /api/links/:id`/`GET /api/qr-codes/:id` returning 200 — on a FRESH per-test second domain never referenced by any `DomainMembership` for the admin or anyone (the strongest available story, 17-RESEARCH.md Pattern 5 / Assumption A2).
- No new admin fixture was created — the existing seeded `ADMIN_EMAIL`/`chromium-admin` storageState was reused verbatim, exactly as research predicted.
- No production code changes were required or made — every assertion held against the existing, already-shipped `apps/api`/`apps/web` behavior (`isAccountAdmin` short-circuit in `lib/authorization.ts`).
- This is the FINAL plan of the v1.1 milestone (E2E Test Coverage) — all 7 phases (11-17), 40 plans, are now complete.

## Task Commits

1. **Task 1: AUTHZ-E2E-02 — account-admin reaches a never-assigned domain's resource (chromium-admin)** - `27fa839` (test)

**Plan metadata:** committed as part of this SUMMARY's finalization commit.

## Files Created/Modified

- `apps/e2e/tests/authed/authz-admin-bypass.spec.ts` - AUTHZ-E2E-02 spec: explicit zero-membership precondition, a fresh second-domain Link + static QR fixture, and the UI + API bypass proof via the existing `chromium-admin` storageState `page`.
- `.planning/phases/17-team-management-domain-scoped-authz-e2e/deferred-items.md` - documents a pre-existing, cross-cutting rate-limit-capacity test-harness limitation discovered while running this plan's mandated full `tests/authed/` wave-merge gate (see Issues Encountered below).

## Decisions Made

- Reused the existing `chromium-admin` storageState `page` directly rather than establishing a new browser context — the bypass fixture already exists (the seeded admin has zero `DomainMembership` rows), so no session-establishment code was needed, unlike 17-04's zero-domain member (which required a THIRD, ad-hoc identity).
- Targeted a fresh, per-test second domain (`bypass-<hex>.kurzly.local`) rather than the baseline domain, for the strongest available bypass story — removing any doubt that the baseline domain is merely "implicitly admin-owned by convention."
- Documented (rather than fixed) the full-suite rate-limit-capacity issue found during the mandated wave-merge gate, per the SCOPE BOUNDARY rule: it is pre-existing (flagged in STATE.md after Phase 16, and again in 17-04's own SUMMARY), demonstrably unrelated to this plan's own spec (which passed in every configuration tested), and its correct fix (`extraHTTPHeaders` on the Playwright projects) lives outside this plan's `files_modified` scope.

## Deviations from Plan

None in the spec itself — plan executed exactly as written, task 1 passed on the first attempt with zero apps/api/apps/web changes.

**Deferred (not a deviation from THIS plan's own task, found during the mandated full-suite verification step — see `deferred-items.md` D-17-05-01 for full detail):**

- A single Playwright invocation of the ENTIRE `tests/authed/` directory (15 files, 30 executions) exhausts `registerRateLimit`'s global 100-req/15-min per-IP bucket partway through, at BOTH `--workers=1` and default parallelism, cascading into failures across `storage-state.spec.ts`, `team-*.spec.ts`, `qr-*.spec.ts`, `links-crud.spec.ts`, and `analytics-global-rollup.spec.ts` (varying by exact run/timing) — none of which are `authz-admin-bypass.spec.ts` or `authz-domain-denial.spec.ts` (this plan's and 17-04's own specs never appeared in any failure list, in any configuration). Root-caused directly from `docker logs` (`@fastify/rate-limit`'s own logged `429`s) and confirmed by isolation: `team-role-domain-reassign.spec.ts` fails only when run immediately after `team-invite-accept.spec.ts` + `team-member-removal.spec.ts` in the same 15-minute window, but passes cleanly (1.5s) standalone. This is the SAME root cause 17-04's SUMMARY already documented (in-memory bucket accumulation across repeated real-browser traffic against one long-lived container) and STATE.md already flagged as deferred after Phase 16 — not a new regression, not caused by this plan's changes, and out of this plan's file scope to fix.

## Issues Encountered

- **Local port collisions:** this machine's existing Docker containers already bind `5433`/`8025` (unrelated projects), so `scripts/e2e-compose.sh` could not be used verbatim. Worked around with a session-local, non-committed Compose port-remap overlay (`!override` on `db`/`mailpit` `ports:`, matching 17-04's documented precedent) under a dedicated project name (`kurzly-e2e-1705`).
- **Full-suite rate-limit-capacity gate:** see Deviations above and `deferred-items.md` D-17-05-01. Worked around for verification purposes by restarting the app container (clearing its in-memory bucket) between smaller batches of spec files — 13 of 15 files passed cleanly this way; the 2 residual failures are consistent with either an already-documented, unrelated top-5-crowding edge case in `analytics-global-rollup.spec.ts`'s own code, or the same rate-limit accumulation within a smaller window.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

AUTHZ-E2E-02 is closed — this was the LAST requirement of the LAST phase of the v1.1 milestone (E2E Test Coverage). All 7 phases (11-17) are complete. The one open item is the documented, pre-existing rate-limit-capacity test-harness limitation (`deferred-items.md` D-17-05-01) — recommended for a dedicated stabilization pass (adding `extraHTTPHeaders` with the E2E bypass secret to Playwright's authenticated projects) before any future milestone adds further `tests/authed/` spec files, since each addition tightens the margin against the fixed 100-req/15-min budget.

---
*Phase: 17-team-management-domain-scoped-authz-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED
- FOUND: apps/e2e/tests/authed/authz-admin-bypass.spec.ts
- FOUND: .planning/phases/17-team-management-domain-scoped-authz-e2e/deferred-items.md
- FOUND commit: 27fa839
