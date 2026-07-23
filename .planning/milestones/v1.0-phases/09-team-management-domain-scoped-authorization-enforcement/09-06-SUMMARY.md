---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 06
subsystem: web
tags: [vue, vue-router, pinia, vitest, vue-test-utils]

# Dependency graph
requires:
  - phase: 09-04
    provides: "PATCH role / PUT domains / DELETE member routes (mutation surface consumed by 09-07)"
  - phase: 09-01
    provides: "SessionUser.accountRole, AccountRole enum"
  - phase: 09-03
    provides: "TeamMemberDTO/MemberStatus/InviteMemberInput shared DTOs, GET /api/team"
provides:
  - "Admin-only Team nav entry (AppShell.vue visibleNavItems computed)"
  - "requiresAdmin router guard branch (router/index.ts beforeEach) redirecting non-admins away from /team"
  - "listTeamMembers() client (api.ts team section)"
  - "TeamView.vue: read-only locked member table + role-model card, replacing ComingSoonView at /team"
affects: [09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nav-item admin-gating via a single computed filter over the existing navItems array (no second array) — UI-09-01"
    - "Router guard requiresAdmin branch placed AFTER the existing requiresAuth/isAuthenticated checks, redirecting to { name: 'dashboard' } (UX convenience only, T-02-14 precedent, D-09-02 server stays authoritative)"
    - "Status badge reads DTO status field verbatim, never re-derives from emailVerified (UI-09-08, T-09-STATUS-REDERIVE) — same discipline as LinkDTO.passwordProtected/QrCodeDTO.logoEnabled boundary-derivation precedent"
    - "Headless router-guard testing: push against the real default-exported router singleton + assert router.currentRoute.value.name, with authSession.user pre-seeded so fetchSession() never triggers a real network call — no component mount needed"

key-files:
  created:
    - apps/web/src/views/TeamView.vue
    - apps/web/src/layouts/AppShell.test.ts
    - apps/web/src/router/guard.test.ts
    - apps/web/src/views/TeamView.test.ts
  modified:
    - apps/web/src/api.ts
    - apps/web/src/layouts/AppShell.vue
    - apps/web/src/router/index.ts
    - apps/web/test/AppShell.test.ts

key-decisions:
  - "TeamView.vue was created as a minimal inert placeholder in Task 1 (to satisfy the router's TeamView import) and then fully implemented in Task 2's own RED/GREEN cycle — the plan explicitly permitted either sequencing, and this ordering let Task 2's failing test commit be genuine RED (asserting on real listTeamMembers-driven content against a stub that renders nothing)"
  - "Router guard test drives the actual default-exported router singleton headlessly via router.push() + router.currentRoute assertions, rather than constructing a parallel/duplicate router+guard for testing — a regression in the real router/index.ts guard is what the test actually catches"
  - "Role <select> and domain-access pills/chips render present but with no @change/@click handlers wired (genuinely inert, not disabled) — matches the plan's Task 2 must-have list precisely; lastAdmin disabling (UI-09-07) is explicitly out of scope for this plan"

patterns-established:
  - "listTeamMembers as the sole read this plan needs from the team API client — mutation clients (invite/role/domains/remove) are deliberately deferred to 09-07's own RED/GREEN cycle"

requirements-completed: [TEAM-02, TEAM-06]

coverage:
  - id: D1
    description: "The Team nav entry renders only for accountRole:'admin'; a member never sees it, while the other five entries always render"
    requirement: "TEAM-02"
    verification:
      - kind: unit
        ref: "apps/web/src/layouts/AppShell.test.ts#renders the Team nav entry for an admin session user"
        status: pass
      - kind: unit
        ref: "apps/web/src/layouts/AppShell.test.ts#hides the Team nav entry for a member session user"
        status: pass
      - kind: unit
        ref: "apps/web/src/layouts/AppShell.test.ts#always renders the other five nav entries regardless of role"
        status: pass
    human_judgment: false
  - id: D2
    description: "The /team route carries requiresAdmin and redirects a signed-in member to the dashboard while letting a signed-in admin through, resolving to TeamView"
    requirement: "TEAM-02"
    verification:
      - kind: unit
        ref: "apps/web/src/router/guard.test.ts#redirects a signed-in member navigating to /team to the dashboard"
        status: pass
      - kind: unit
        ref: "apps/web/src/router/guard.test.ts#lets a signed-in admin through to /team"
        status: pass
    human_judgment: false
  - id: D3
    description: "TeamView renders one row per member (avatar/name-or-pending-fallback/email, role, domain-access pills per accountRole, status badge read from the DTO status field verbatim), the locked header counter, and the dashed role-model note card"
    requirement: "TEAM-02"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#renders a row per member: avatar/name/email, role, domain access, status (UI-09-08/09)"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#shows the locked header counter copy"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#renders the title, invite button, table header, and dashed role-model card"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 6: Team Screen Access Plumbing + Read-Only Roster Summary

**Admin-only Team nav + requiresAdmin route guard wired to `SessionUser.accountRole`, plus a locked `TeamView.vue` rendering the full member roster (avatar/name/email, role, domain-access pills, status badge sourced strictly from the DTO's `status` field) and the role-model note card — mutations deferred to 09-07**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-07-23T10:12:37+02:00
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- `AppShell.vue`: added a `visibleNavItems` computed that filters the existing `navItems` array (no second array) so "Team" only renders for `authSession.user?.accountRole === "admin"` (UI-09-01).
- `router/index.ts`: swapped `/team`'s component from `ComingSoonView` to `TeamView`, added `requiresAdmin: true` to its meta, and extended `beforeEach` — after the existing `requiresAuth`/`isAuthenticated` checks — to redirect a non-admin to `{ name: "dashboard" }`. Removed the now-unused `ComingSoonView` import.
- `api.ts`: added a Team client section (mirroring the QR client's header-comment convention) exporting `listTeamMembers(): Promise<TeamMemberDTO[]>` against `GET /api/team`.
- `TeamView.vue`: full read-only implementation of 09-UI-SPEC.md Surface B — locked container/header/grid/avatar/pill/badge values reproduced 1:1, no new design tokens. Loads via `listTeamMembers()` on setup, computes UI-09-09 initials/pending-name fallback, branches domain-access rendering on `accountRole` (admin → accent "alle Domains" pill; member → monospace chips + dashed "+ zuweisen" pill), and renders the status badge purely from `member.status` (UI-09-08). The invite button, role `<select>`, domain-access pills, and "⋯" cell render present but inert — no mutation handlers wired (09-07's scope).
- Test coverage: `AppShell.test.ts` (nav visibility per role), `router/guard.test.ts` (headless navigation against the real router singleton), `TeamView.test.ts` (mixed admin/member/pending fixture asserting rows, header counter, role-model card).

## Task Commits

Both tasks followed genuine RED → GREEN:

1. **Task 1: Admin-only nav + requiresAdmin route guard + TeamView route swap + listTeamMembers client**
   - `ba9bbdb` test(09-06): failing admin-nav + requiresAdmin guard + team client cases
   - `1d5dc33` feat(09-06): admin-only Team nav, requiresAdmin guard, TeamView route swap, listTeamMembers
2. **Task 2: TeamView.vue read-only member table + role-model card**
   - `2c25ead` test(09-06): failing TeamView read-only render cases
   - `efbd0c3` feat(09-06): TeamView read-only member table + role-model card

RED was verified genuinely for both tasks: Task 1's tests failed against the pre-existing `AppShell.vue`/`router/index.ts` (Team entry always rendered, no `requiresAdmin` redirect); Task 2's test failed against Task 1's intentionally inert `TeamView.vue` placeholder (empty `<div>`, no rows/copy rendered).

## Files Created/Modified
- `apps/web/src/api.ts` - added `listTeamMembers()` team client section
- `apps/web/src/layouts/AppShell.vue` - `visibleNavItems` computed (admin-gated Team entry)
- `apps/web/src/router/index.ts` - `/team` → `TeamView` + `requiresAdmin` meta + guard branch; removed unused `ComingSoonView` import
- `apps/web/src/views/TeamView.vue` - full read-only Surface B implementation (created in Task 1 as an inert placeholder, replaced with real content in Task 2)
- `apps/web/src/layouts/AppShell.test.ts` - nav-visibility-per-role cases (new)
- `apps/web/src/router/guard.test.ts` - `requiresAdmin` redirect/passthrough cases against the real router (new)
- `apps/web/src/views/TeamView.test.ts` - mixed-fixture render cases (new)
- `apps/web/test/AppShell.test.ts` - fixed a pre-existing regression (see Deviations)

## Decisions Made
- Sequenced Task 2 after Task 1 with an intentional inert `TeamView.vue` placeholder in Task 1's GREEN commit (explicitly permitted by the plan's action text) — this let Task 2's TDD RED phase be genuine rather than needing a separate teardown step.
- `router/guard.test.ts` drives the real default-exported `router` singleton headlessly (`router.push()` + `router.currentRoute.value.name` assertions, no component mount) instead of constructing a parallel test router — ensures the test actually exercises `router/index.ts`'s real guard, and avoids triggering any view's data-loading side effects or real network calls.
- The role `<select>`, domain-access pills/chips, invite button, and "⋯" cell are rendered with no interactive handlers (genuinely inert) rather than `disabled` — matches the plan's Task 2 behavior list precisely; `lastAdmin` disabling and any handler wiring are explicitly 09-07's scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/regression] Pre-existing `apps/web/test/AppShell.test.ts` broke against the new admin-gated nav filter**
- **Found during:** Task 1, full web suite run after GREEN
- **Issue:** A Phase-2 structural test (`test/AppShell.test.ts`, distinct from this plan's new `src/layouts/AppShell.test.ts`) seeds `authSession.user` with a fixture predating `accountRole` (09-01), so its "all six nav labels render" assertion started failing once "Team" became admin-gated (the fixture's `accountRole` was `undefined`, not `"admin"`).
- **Fix:** Added `accountRole: "admin"` to that test's seeded fixture, preserving its original intent (a fully-visible shell for an admin) while remaining independent of the admin-gating behavior now covered by this plan's own `AppShell.test.ts`.
- **Files modified:** `apps/web/test/AppShell.test.ts`
- **Commit:** `1d5dc33`

## Issues Encountered

None beyond the regression above. `pnpm --filter @kurzly/web test` (213 tests) and `pnpm -r exec tsc --noEmit` were both clean after each task's GREEN commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `listTeamMembers()` (api.ts) and `TeamView.vue`'s row/domain-access/status rendering are in place for 09-07 to extend directly: the role `<select>`'s `@change`, the domain-chip/"+ zuweisen" click → `AssignDomainsModal`, the "⋯" action menu → delete-confirm dialog, and the invite button → `InviteMemberModal` all need their handlers wired against the existing `PATCH /api/team/:id/role` / `PUT /api/team/:id/domains` / `DELETE /api/team/:id` / `POST /api/team/invite` routes (09-03/09-04).
- No blockers or concerns for 09-07.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 8 created/modified files verified present on disk; all 4 task commit hashes (`ba9bbdb`, `1d5dc33`, `2c25ead`, `efbd0c3`) verified present in git history.
