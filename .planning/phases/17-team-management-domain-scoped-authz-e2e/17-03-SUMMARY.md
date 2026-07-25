---
phase: 17-team-management-domain-scoped-authz-e2e
plan: 03
subsystem: testing
tags: [playwright, e2e, team-management, session-revocation, better-auth, prisma, vue]

requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: createE2ePrisma, findMagicLinkUrl/mailpit client, chromium-admin/chromium-member storageState projects
  - phase: 13-authentication-session-e2e
    provides: real magic-link session-establishment pattern (POST sign-in/magic-link + findMagicLinkUrl + page.goto)
  - phase: 17-team-management-domain-scoped-authz-e2e
    provides: 17-02's discovered "storageState:undefined + own-context .request" second-session pattern under a storageState-bearing project
provides:
  - TEAM-E2E-03 e2e proof — a real admin removal (Team UI) immediately revokes the removed member's active session on their VERY NEXT request, cross-checked by a direct-Prisma zero-User+zero-Session read
affects: [17-04, 17-05]

tech-stack:
  added: []
  patterns:
    - "The 'old-session-request' proof is simply the SAME memberPage/context making its next call/navigation AFTER the admin's DELETE 204 resolves — never a manual cookie extraction/re-injection, never a polling/retry loop (asserted on the FIRST subsequent request only)"

key-files:
  created:
    - apps/e2e/tests/authed/team-member-removal.spec.ts
  modified: []

key-decisions:
  - "Reused 17-02's discovered browser.newContext({ storageState: undefined }) + own-context .request fix verbatim for establishing the member's second session under chromium-admin — no new harness bug found this plan"
  - "Targeted a brand-new member (createAllowlistedUser, per-test crypto-unique email, default accountRole 'member') for removal — never the seeded ADMIN_EMAIL/MEMBER_EMAIL baseline fixtures or the sole admin (Pitfall 3, LAST_ADMIN lockout guard)"
  - "DELETE response matcher keys on the exact captured member.id path (/api/team/<id>) since the id is known upfront from createAllowlistedUser's own return value"

patterns-established: []

requirements-completed: [TEAM-E2E-03]

coverage:
  - id: D1
    description: "A brand-new active member (createAllowlistedUser, per-test crypto-unique email) establishes its OWN real session in a second browser context (magic-link round trip, storageState:undefined) with a live session BEFORE removal — GET /api/auth/get-session returns { user: { email } }"
    requirement: TEAM-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-member-removal.spec.ts#removing a member immediately revokes their active session on the very next request"
        status: pass
    human_judgment: false
  - id: D2
    description: "The admin removes that member through the REAL Team UI (.menu-cell -> .action-menu-item 'Mitglied entfernen' -> .delete-confirm-button 'Entfernen'), the awaited DELETE /api/team/:id response is 204, and the member row disappears from the admin roster"
    requirement: TEAM-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-member-removal.spec.ts#removing a member immediately revokes their active session on the very next request"
        status: pass
    human_judgment: false
  - id: D3
    description: "The member's OLD context, on its VERY NEXT request (no polling, no wait), observes GET /api/auth/get-session returning null AND a /links navigation redirecting to /login — immediate revocation, not eventual"
    requirement: TEAM-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-member-removal.spec.ts#removing a member immediately revokes their active session on the very next request"
        status: pass
    human_judgment: false
  - id: D4
    description: "A direct-Prisma cross-check confirms zero User rows for the removed member's id AND zero Session rows for that userId — the schema-level Session.user onDelete:Cascade IS the revocation mechanism"
    requirement: TEAM-E2E-03
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-member-removal.spec.ts#removing a member immediately revokes their active session on the very next request"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-25
status: complete
---

# Phase 17 Plan 03: TEAM-E2E-03 Member Removal Immediately Revokes Active Session Summary

**TEAM-E2E-03 proved live: an admin removing a brand-new member through the real Team UI (DELETE /api/team/:id -> 204) makes that member's OWN already-open browser context observe a null session AND a /login redirect on its VERY NEXT request — no polling — cross-checked by a direct-Prisma read confirming zero User and zero Session rows, zero application code changes.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-25T10:30:00Z
- **Completed:** 2026-07-25T11:05:00Z
- **Tasks:** 1 completed
- **Files modified:** 1 (new spec file)

## Accomplishments
- Authored `apps/e2e/tests/authed/team-member-removal.spec.ts`, proving TEAM-E2E-03 entirely through two real browser contexts: an admin (chromium-admin `page`) driving the real Team UI removal flow, and a brand-new member's own second context (magic-link round trip, never the chromium-member storageState).
- Confirmed 17-RESEARCH.md's strongest-evidence finding live: `Session.user onDelete: Cascade` + `removeMember`'s single `tx.user.delete()` transaction + better-auth's uncached `getSession` mean the removed member's very next `GET /api/auth/get-session` already returns `null` — no polling/retry loop was needed or used.
- Threefold revocation proof, all in one test: (1) API boundary — `get-session` returns `null`; (2) UI boundary — a `/links` navigation on the same context redirects to `/login`; (3) DB boundary — direct-Prisma reads confirm `prisma.user.count === 0` and `prisma.session.count === 0` for the removed member's id.
- Reused 17-02's discovered `storageState: undefined` + own-context `.request` fix verbatim for establishing the member's second session under the `chromium-admin` project — no new test-harness bug surfaced this plan.
- Zero `apps/api`/`apps/web` diffs — pure test-authoring against already-shipped Phase 9 behavior, exactly as 17-RESEARCH.md predicted.

## Task Commits

Each task was committed atomically:

1. **Task 1: TEAM-E2E-03 — member removal immediately revokes the active session (two contexts, chromium-admin)** - `461cd87` (test)

_No TDD RED→GREEN cycle was needed — no application bug was found; this is a pure proof of existing, already-correct Phase 9 behavior at the E2E layer, per 17-RESEARCH.md's Summary._

## Files Created/Modified
- `apps/e2e/tests/authed/team-member-removal.spec.ts` - TEAM-E2E-03 spec: two-context (admin + brand-new member) proof of immediate session revocation on removal, plus a direct-Prisma User/Session cross-check, scoped to `chromium-admin`

## Decisions Made
- Reused `createE2ePrisma`/`createAllowlistedUser`/`findMagicLinkUrl` verbatim — no new `apps/e2e/src/*.ts` fixture helper was needed; the optional `apps/e2e/src/team.ts` Wave 0 helper (17-RESEARCH.md) was not required since the removal action itself is entirely real-UI driven.
- Targeted a brand-new member (`createAllowlistedUser`, per-test crypto-unique email, default `accountRole: "member"`) for removal — never the seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` baseline fixtures other specs' `storageState` depends on, and never the sole admin (Pitfall 3, LAST_ADMIN lockout guard, T-17-03-LOCKOUT).
- Adopted `qr-dynamic-remap.spec.ts`'s/`team-invite-accept.spec.ts`'s/`team-role-domain-reassign.spec.ts`'s exact `test.describe.configure({ retries: 2 })` + `testInfo.project.name !== "chromium-admin"` skip + retry-attribution `console.warn` shape, since this spec's member fixture is created outside `withResetDbLock`, straddling the same documented `db-isolation.spec.ts` cross-file truncate race window.

## Deviations from Plan

None — plan executed exactly as written. No application code changes were needed; the plan's own acceptance criterion ("passes green against the built compose image; zero apps/api / apps/web diffs") held true on first live run, at both default parallelism and `--workers=1`, with zero retries observed.

## Issues Encountered

**Live-verification-only environment friction (not a code or spec defect):**
- Ports 3000 (app), 5433 (db), and 8025 (mailpit) were already occupied on this machine by unrelated local Docker services (`com.docke`-owned containers on 5433/8025, a local Node dev server on 3000). Resolved with the same session-scratch, non-committed `docker-compose.e2e.portremap.yml` overlay pattern documented in 16-01/17-01/17-02's summaries (Compose v5's `ports: !override` merge directive at the service-key level, remapped to 3001/5434/8035/9001, plus matching `BASE_URL`/`OIDC_MOCK_PUBLIC_URL`/`OIDC_MOCK_REDIRECT_URI` overrides on `app`/`oidc-mock`). Deleted after this session, never committed; `scripts/e2e-compose.sh` itself untouched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

TEAM-E2E-03 is closed — all three of Phase 17's Team requirements (TEAM-E2E-01/02/03) are now proven live. The E2E harness's `createAllowlistedUser`/`findMagicLinkUrl`/`createE2ePrisma` fixture vocabulary, and 17-02's "explicit `storageState: undefined` + own-context `.request`" second-session pattern, are confirmed sufficient for 17-04/17-05 (AUTHZ-E2E-01/02) — no blockers. The compose stack was fully torn down (containers, volumes, session-built images, scratch `.env`/port-remap override all removed, confirmed via `docker ps`/`git status --short`) before handoff; the next plan boots its own fresh stack. The seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` fixture rows were confirmed untouched by this spec's aggressive create/delete activity (direct-Prisma read post-run).

---
*Phase: 17-team-management-domain-scoped-authz-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/team-member-removal.spec.ts
- FOUND: commit 461cd87
