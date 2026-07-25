---
phase: 17-team-management-domain-scoped-authz-e2e
plan: 02
subsystem: testing
tags: [playwright, e2e, team-management, domain-authorization, better-auth, prisma, vue]

requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: createE2ePrisma, findMagicLinkUrl/mailpit client, chromium-admin/chromium-member storageState projects
  - phase: 13-authentication-session-e2e
    provides: real magic-link session-establishment pattern (POST sign-in/magic-link + findMagicLinkUrl + page.goto)
  - phase: 17-team-management-domain-scoped-authz-e2e
    provides: 17-01's createAllowlistedUser/createE2eLink fixture reuse and test.describe.configure({retries:2}) precedent
provides:
  - TEAM-E2E-02 e2e proof — a real admin domain assignment (AssignDomainsModal) and role promotion (.role-select) both take effect in the affected member's OWN already-open, never-re-authenticated browser session on its very next navigation
affects: [17-03, 17-04, 17-05]

tech-stack:
  added: []
  patterns:
    - "A member's own session context must be created with explicit `storageState: undefined` when the calling test runs under a storageState-bearing project (chromium-admin/chromium-member) — `browser.newContext()` otherwise silently inherits the project's default storageState cookie into what looks like a fresh context"
    - "The member's magic-link sign-in POST must be issued from that member's own cookie-less context (`memberCtx.request.post`), never the test's top-level `request` fixture, when the top-level fixture belongs to a storageState-bearing project"

key-files:
  created:
    - apps/e2e/tests/authed/team-role-domain-reassign.spec.ts
  modified: []

key-decisions:
  - "Discovered (Rule 1, harness-level bug, not app-level): under chromium-admin/chromium-member, `browser.newContext({baseURL})` inherits the project's `use.storageState` default unless explicitly overridden — the admin's session cookie was silently attached to what was meant to be the member's fresh context, tripping better-auth's CSRF `MISSING_OR_NULL_ORIGIN` guard (a cookie-bearing, Origin-less POST is rejected). Fixed by passing `storageState: undefined` explicitly on the member's `browser.newContext()` call and issuing the magic-link POST via that context's own `.request`, never the top-level `request` fixture."
  - "The PUT/PATCH response matchers key on `pathname.startsWith('/api/team/') && pathname.endsWith('/domains'|'/role')` rather than embedding the member's id, since the member id is only known after the fixture write and no other admin action fires a matching request in the same await window."
  - "Verified the plan's two required passes (default parallelism + --workers=1) each against their OWN freshly booted compose stack — the shared-stack global 100-req/15-min rate-limit bucket (already documented in STATE.md for Phases 13/16/17-01) exhausts quickly across repeated debug/verification invocations and produces indistinguishable 429s if reused; this is a harness/environment characteristic, not a spec or app defect."

patterns-established: []

requirements-completed: [TEAM-E2E-02]

coverage:
  - id: D1
    description: "A brand-new, zero-domain member (createAllowlistedUser) establishes its OWN real session in a second browser context (magic-link round trip); a baseline-domain /links/:id initially renders .not-found-card (404 IDOR guard) — the BEFORE state"
    requirement: TEAM-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-role-domain-reassign.spec.ts#admin's domain then role reassignment takes effect in the member's own re-navigated session"
        status: pass
    human_judgment: false
  - id: D2
    description: "The admin, via the real AssignDomainsModal (.assign-pill -> .domain-pill -> .btn-primary Speichern, PUT /api/team/:id/domains asserted ok), assigns the baseline domain; the SAME member context, with NO re-login, re-navigates the SAME /links/:id and now sees the full link detail (.link-slug, no .not-found-card) — the AFTER state, proving scopedDomainIds is re-derived from Postgres on the very next request"
    requirement: TEAM-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-role-domain-reassign.spec.ts#admin's domain then role reassignment takes effect in the member's own re-navigated session"
        status: pass
    human_judgment: false
  - id: D3
    description: "A subsequent admin role promotion member->admin via the roster .role-select (PATCH /api/team/:id/role asserted ok) makes the member's already-open context reach /team (no bounce to /login or /dashboard) and independently GET /api/team 200s on its next navigation — proving accountRole is also re-derived per-request, with no re-login"
    requirement: TEAM-E2E-02
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/team-role-domain-reassign.spec.ts#admin's domain then role reassignment takes effect in the member's own re-navigated session"
        status: pass
    human_judgment: false

duration: 75min
completed: 2026-07-25
status: complete
---

# Phase 17 Plan 02: TEAM-E2E-02 Role/Domain Reassignment Reaches Member's Own Session Summary

**TEAM-E2E-02 proved live: a real admin domain assignment (AssignDomainsModal) and role promotion (.role-select) both take effect in a brand-new member's OWN already-open, never-re-authenticated browser session on its very next navigation — a concrete /links/:id 404->detail transition plus a /team reachability + GET /api/team 200 flip, zero application code changes.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-07-25T09:10:00Z
- **Completed:** 2026-07-25T10:25:00Z
- **Tasks:** 1 completed
- **Files modified:** 1 (new spec file)

## Accomplishments
- Authored `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts`, proving TEAM-E2E-02 entirely through two real browser contexts: an admin (chromium-admin `page`) driving the real Team management UI, and a brand-new member's own second context (magic-link round trip, never the chromium-member storageState).
- Part A: a baseline-domain `/links/:id` flips from `.not-found-card` (404 IDOR guard, `resolveOwnedLink`) to the full link detail on the member's SAME context after the admin's real `AssignDomainsModal` save (`PUT /api/team/:id/domains`), with zero re-login.
- Part B: the same member's same context reaches `/team` and independently gets a `GET /api/team` 200 after the admin's real `.role-select` promotion (`PATCH /api/team/:id/role`), again with zero re-login.
- Confirmed 17-RESEARCH.md's Pattern 2 live: `createAuth()` has no `cookieCache`, so `scopedDomainIds`/`accountRole` are re-derived fresh from Postgres on every request — a page reload/re-navigation is structurally sufficient, no explicit session refresh exists or is needed.
- Zero `apps/api`/`apps/web` diffs — pure test-authoring against already-shipped Phase 9 behavior, exactly as 17-RESEARCH.md predicted.

## Task Commits

Each task was committed atomically:

1. **Task 1: TEAM-E2E-02 — role/domain reassignment reaches the member's own re-navigated session (two contexts, chromium-admin)** - `dcf0929` (feat)

_No TDD RED→GREEN cycle was needed — no application bug was found; this is a pure proof of existing, already-correct Phase 9 behavior at the E2E layer, per 17-RESEARCH.md's Summary._

## Files Created/Modified
- `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts` - TEAM-E2E-02 spec: two-context (admin + brand-new member) proof of domain assignment + role promotion reaching an already-open session, scoped to `chromium-admin`

## Decisions Made
- Reused `createE2ePrisma`/`createAllowlistedUser`/`createE2eLink`/`findMagicLinkUrl` verbatim — no new `apps/e2e/src/*.ts` fixture helper was needed; the optional `apps/e2e/src/team.ts` Wave 0 helper (17-RESEARCH.md) was not required since every team mutation this plan's own subject covers goes through the real UI.
- Targeted a brand-new member (`createAllowlistedUser`, per-test crypto-unique email, zero `DomainMembership` rows) for both the domain assignment and the role promotion — never the seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` baseline fixtures other specs' `storageState` depends on (Pitfall 3, LAST_ADMIN lockout guard risk).
- Adopted `qr-dynamic-remap.spec.ts`'s/`team-invite-accept.spec.ts`'s exact `test.describe.configure({ retries: 2 })` + `testInfo.project.name !== "chromium-admin"` skip + retry-attribution `console.warn` shape, since this spec's fixtures (a fresh member + a fixture Link) are created outside `withResetDbLock`, straddling the same documented `db-isolation.spec.ts` cross-file truncate race window.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, test-harness-level] `browser.newContext()` silently inherited the project's default `storageState` under a storageState-bearing project**
- **Found during:** Task 1, live verification against the built compose image
- **Issue:** The member's "fresh" second browser context (`await browser.newContext({ baseURL })`) — created inside a test running under the `chromium-admin` project (which declares `use.storageState: "playwright/.auth/admin.json"`) — silently carried the ADMIN's session cookie. Sending the member's magic-link sign-in POST through this context (or the test's top-level `request` fixture, which is likewise storageState-bound for this project) attached the admin's cookie to a bare state-changing request with no `Origin` header, tripping better-auth's CSRF guard (`origin-check.mjs`'s `validateOrigin`): any cookie-bearing POST/PUT/PATCH/DELETE without an `Origin`/`Referer` header is rejected with `403 MISSING_OR_NULL_ORIGIN`. Confirmed via a minimal reproduction (`browser.newContext()` under `chromium-admin` vs. under `smoke`, cookie state printed before the request) that this is Playwright test-runner behavior (project `use` defaults apply to test-body `browser.newContext()` calls), not an app-level bug — `lib/auth.ts`/`origin-check.mjs` behave exactly as documented.
- **Fix:** Explicitly pass `storageState: undefined` on the member's `browser.newContext({ baseURL, storageState: undefined })` call, and issue the magic-link sign-in POST via that context's own `memberCtx.request.post(...)` (never the top-level `request` fixture) — a genuinely cookie-less context never triggers the CSRF guard.
- **Files modified:** apps/e2e/tests/authed/team-role-domain-reassign.spec.ts (test-only; no `apps/api`/`apps/web` changes)
- **Verification:** Confirmed live: without the fix, the magic-link POST 403s (`MISSING_OR_NULL_ORIGIN`) under `chromium-admin`; with the fix, it 200s identically to every prior phase's magic-link-establishment pattern (none of which ran under a storageState-bearing project).
- **Committed in:** `dcf0929` (Task 1 commit, folded in before the first passing verification run — no separate commit needed)

---

**Total deviations:** 1 auto-fixed (1 test-harness-level bug, Rule 1)
**Impact on plan:** Necessary for the spec to establish a genuinely independent member session under an admin-scoped project; no application code changes, no scope creep. Worth flagging for future Phase 17 plans (17-03/17-04/17-05) that also establish a second session inline under `chromium-admin`.

## Issues Encountered

**Live-verification-only environment friction (not a code or spec defect):**
- Ports 3000 (app), 5433 (db), and 8025 (mailpit) were already occupied on this machine by unrelated local services (a node dev server on 3000, Docker-published ports for other local projects on 5433/8025). Resolved with the same session-scratch, non-committed `docker-compose.e2e.portremap.yml` overlay pattern documented in 16-01/17-01's summaries (Compose v5's `ports: !override` merge directive, remapped to 3001/5434/8035/9001, plus matching `BASE_URL`/`OIDC_MOCK_PUBLIC_URL`/`OIDC_MOCK_REDIRECT_URI` overrides). Deleted after this session, never committed; `scripts/e2e-compose.sh` itself untouched.
- The test-harness bug above (CSRF-guard trip from an inherited admin session cookie) initially manifested as a confusing `expect(magicLinkResponse.ok()).toBeTruthy()` failure with no context; diagnosing it required reading better-auth's installed `origin-check.mjs` source directly and reproducing the cookie-inheritance behavior in isolation.
- Repeated debug/verification invocations against the SAME long-lived compose stack exhausted the global 100-req/15-min rate-limit bucket (identical accumulated-state flake already documented in STATE.md for Phases 13/16/17-01 — the `x-e2e-bypass` header only exempts requests that carry it; every real browser navigation's SPA asset/API fetch does not, and counts against the shared per-IP bucket). Resolved by booting a dedicated fresh stack for each of the plan's two required verification passes (default parallelism + `--workers=1`), both of which then passed cleanly with zero retries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

TEAM-E2E-02 is closed. The E2E harness's `createAllowlistedUser`/`createE2eLink`/`findMagicLinkUrl`/`createE2ePrisma` fixture vocabulary is confirmed sufficient for 17-03 (TEAM-E2E-03, immediate revocation) and 17-04/17-05 (AUTHZ-E2E-01/02) — no blockers. The newly-discovered "explicit `storageState: undefined` + own-context `.request`" pattern for establishing a second, genuinely independent session under a storageState-bearing project should be reused by any subsequent plan in this phase that similarly needs a second live session alongside `chromium-admin`. The compose stack was fully torn down (containers, volumes, session-built images, scratch `.env`/port-remap override all removed, confirmed via `docker ps`/`git status --short`) before handoff; the next plan boots its own fresh stack.

---
*Phase: 17-team-management-domain-scoped-authz-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/authed/team-role-domain-reassign.spec.ts
- FOUND: commit dcf0929
