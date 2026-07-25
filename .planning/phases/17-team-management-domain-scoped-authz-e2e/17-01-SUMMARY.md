---
phase: 17-team-management-domain-scoped-authz-e2e
plan: 01
subsystem: testing
tags: [playwright, e2e, team-management, magic-link, mailpit, better-auth, prisma, vue]

requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: findMagicLinkUrl/clearInbox Mailpit client, createE2ePrisma, chromium-admin/chromium-member storageState projects
  - phase: 13-authentication-session-e2e
    provides: real magic-link acceptance pattern (browser.newContext -> page.goto(magicLinkUrl) -> Dashboard nav wait)
provides:
  - TEAM-E2E-01 e2e proof — real-UI admin invite delivered via Mailpit, accepted in a fresh context, flips the Team roster status badge
affects: [17-02, 17-03, 17-04, 17-05, 17-06]

tech-stack:
  added: []
  patterns:
    - "Fresh browser.newContext acceptance fully awaited (Dashboard nav rendered) BEFORE the admin's re-fetch — never race two independent browser contexts"
    - ".table-row scoped by a nested .user-email hasText locator, never a bare positional .status-badge"

key-files:
  created:
    - apps/e2e/tests/authed/team-invite-accept.spec.ts
  modified: []

key-decisions:
  - "Invite reuses better-auth's signInMagicLink verbatim (17-RESEARCH.md Pattern 1, confirmed against lib/team.ts) — findMagicLinkUrl needed zero changes to retrieve the invite email"
  - "Role stays the modal's default 'member' with zero domains selected — keeps the assertion focused purely on the Ausstehend->Aktiv status flip, per plan scope"
  - "Whole-test test.describe.configure({ retries: 2 }) + testInfo.project.name !== 'chromium-admin' skip, mirroring qr-dynamic-remap.spec.ts's precedent exactly"

patterns-established: []

requirements-completed: [TEAM-E2E-01]

coverage:
  - id: D1
    description: "An admin, via the real InviteMemberModal UI (.invite-button -> .field-input -> .btn-primary), sends an invite (POST /api/team/invite -> 201) and the new roster row appears immediately with .status-badge text 'Ausstehend' (no .active class)"
    requirement: TEAM-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-invite-accept.spec.ts#admin invites a new member; acceptance via magic link flips the roster status Ausstehend -> Aktiv"
        status: pass
    human_judgment: false
  - id: D2
    description: "A separate, fresh unauthenticated browser context retrieves the invite email via findMagicLinkUrl and fully navigates the magic link, completing better-auth's verify handler (emailVerified: true write + Session creation) before the admin re-fetches /team"
    requirement: TEAM-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-invite-accept.spec.ts#admin invites a new member; acceptance via magic link flips the roster status Ausstehend -> Aktiv"
        status: pass
    human_judgment: false
  - id: D3
    description: "After acceptance, the admin's re-navigated /team shows the SAME roster row's .status-badge now reading 'Aktiv' (.active class present), cross-checked against a direct-Prisma read confirming User.emailVerified === true"
    requirement: TEAM-E2E-01
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-invite-accept.spec.ts#admin invites a new member; acceptance via magic link flips the roster status Ausstehend -> Aktiv"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-25
status: complete
---

# Phase 17 Plan 01: Team Invite → Mailpit → Accept → Status Flip Summary

**TEAM-E2E-01 proved live: a real InviteMemberModal invite (POST /api/team/invite -> 201) appends an "Ausstehend" roster row immediately, and a fresh browser context accepting the emailed magic link flips it to "Aktiv" via better-auth's `emailVerified` write — zero application code changes.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-25T08:20:00Z
- **Completed:** 2026-07-25T09:00:00Z
- **Tasks:** 1 completed
- **Files modified:** 1 (new spec file)

## Accomplishments
- Authored `apps/e2e/tests/authed/team-invite-accept.spec.ts`, proving TEAM-E2E-01 entirely through the real Team management UI: `.invite-button` -> `InviteMemberModal`'s `.field-input`/`.btn-primary`, awaiting the real `POST /api/team/invite` 201 response for deterministic sequencing.
- Confirmed live (built compose image) that the invite email is an ordinary, unmodified better-auth magic-link email — `findMagicLinkUrl` (Phase 11) retrieved it with zero changes, exactly as 17-RESEARCH.md's Pattern 1 predicted.
- Confirmed the acceptance-before-refetch sequencing (Pitfall 2) by fully awaiting the fresh context's navigation to the "Dashboard" nav render before the admin's `/team` re-navigation — no flakiness observed across two independent full runs.
- Cross-checked the UI assertion (`.status-badge` "Ausstehend" -> "Aktiv") against a direct-Prisma read (`emailVerified === true`) — both independently confirm the same real acceptance write.
- Zero `apps/api`/`apps/web` diffs — pure test-authoring against already-shipped Phase 9 behavior, as 17-RESEARCH.md anticipated.

## Task Commits

Each task was committed atomically:

1. **Task 1: TEAM-E2E-01 — real UI invite -> Mailpit -> accept -> Team-list status flip (chromium-admin)** - `7dbbc38` (feat)

_No TDD RED→GREEN cycle was needed — no application bug was found; this is a pure proof of existing, already-correct Phase 9 behavior at the E2E layer, per 17-RESEARCH.md's Summary._

## Files Created/Modified
- `apps/e2e/tests/authed/team-invite-accept.spec.ts` - TEAM-E2E-01 spec: real-UI invite → Mailpit retrieval → fresh-context acceptance → Team-list status flip → DB cross-check, scoped to `chromium-admin`

## Decisions Made
- Reused `findMagicLinkUrl`/`createE2ePrisma` verbatim — no new `apps/e2e/src/*.ts` fixture helper was needed for this plan; the optional `apps/e2e/src/team.ts` Wave 0 helper (17-RESEARCH.md) was not required since this plan's own subject is entirely real-UI driven.
- Kept the invitee's role at the modal's default "member" with zero domains selected, per the plan's explicit scoping ("a pending member with zero domains is a valid invitee and keeps the assertion focused on the status flip").
- Adopted `qr-dynamic-remap.spec.ts`'s exact `test.describe.configure({ retries: 2 })` + `testInfo.project.name !== "chromium-admin"` skip + retry-attribution `console.warn` shape, since this spec straddles the same documented `db-isolation.spec.ts` cross-file truncate race window.

## Deviations from Plan

None — plan executed exactly as written. No application code changes were needed; the plan's own acceptance criterion ("passes green against the built compose image; zero apps/api / apps/web diffs") held true on first live run, at both default parallelism and `--workers=1`.

## Issues Encountered

**Live-verification-only environment friction (not a code or spec defect):**
- Ports 3000 (app), 5433 (db), and 8025 (mailpit) were already occupied on this machine by unrelated local Docker services (`zbr-brain-postgres-1`, another `com.docke` process). Resolved with the same session-scratch, non-committed `docker-compose.e2e.portremap.yml` overlay pattern Phase 16 documented (Compose v5's `ports: !override` merge directive at the service-key level, remapped to 3001/5434/8035/9001, plus a matching `BASE_URL`/`OIDC_MOCK_PUBLIC_URL`/`OIDC_MOCK_REDIRECT_URI` override on `app`/`oidc-mock`). Deleted after this session, never committed; `scripts/e2e-compose.sh` itself untouched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

TEAM-E2E-01 is closed. The E2E harness's `findMagicLinkUrl`/`createE2ePrisma`/fresh-context-acceptance vocabulary is confirmed sufficient for the remaining Phase 17 plans (17-02 TEAM-E2E-02 role/domain reassignment, 17-03 TEAM-E2E-03 immediate revocation, 17-04/05 AUTHZ-E2E-01/02) — no blockers. The compose stack was fully torn down (containers, volumes, session-built images, scratch `.env`/port-remap override all removed, confirmed via `docker ps`/`git status --short`) before handoff; the next plan boots its own fresh stack.

---
*Phase: 17-team-management-domain-scoped-authz-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/team-invite-accept.spec.ts
- FOUND: commit 7dbbc38
