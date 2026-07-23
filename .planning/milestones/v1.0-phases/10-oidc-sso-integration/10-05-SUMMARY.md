---
phase: 10-oidc-sso-integration
plan: 05
subsystem: ui
tags: [vue3, sso, oidc, generic-oauth, login-view, fail-closed]

requires:
  - phase: 10-oidc-sso-integration
    provides: "10-03's GET /api/sso/status endpoint + SsoStatusDTO (only the enabled boolean is read here) and 10-02's genericOAuth registration with SSO_PROVIDER_ID='oidc'"
provides:
  - "Conditional 'Mit SSO anmelden' secondary action on LoginView.vue, idle-state-only, fail-closed on status-fetch failure"
  - "Real better-auth genericOAuth sign-in initiation: POST /api/auth/sign-in/oauth2 { providerId: 'oidc', callbackURL: '/' } -> window.location.assign(response.url)"
affects: []

tech-stack:
  added: []
  patterns:
    - "URL-routed fetch mocking (fetchRouter helper) in LoginView.test.ts, replacing order-dependent mockResolvedValueOnce now that onMounted always fires an additional /api/sso/status call"
    - "window.location stub via Object.defineProperty(window, 'location', ...) for navigation assertions in jsdom, since window.location.assign is non-configurable and cannot be vi.spyOn'd directly"

key-files:
  created: []
  modified:
    - apps/web/src/views/LoginView.vue
    - apps/web/test/LoginView.test.ts

key-decisions:
  - "Verified the installed better-auth@1.6.23 generic-oauth route source directly (apps/api/node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs) rather than trusting the plan's stated endpoint: confirmed POST /sign-in/oauth2 (mounted under betterAuth's /api/auth base as /api/auth/sign-in/oauth2), body { providerId, callbackURL, ... }, response { url: string, redirect: boolean } — matches what the plan described, so no deviation needed."
  - "providerId 'oidc' matches apps/api/src/lib/ssoConfig.ts's exported SSO_PROVIDER_ID constant, confirmed by reading that file directly rather than assuming."
  - "signInWithSso() fails silently (try/catch, no placeholder toast) if the oauth2 POST itself fails post-click — consistent with the plan's 'no dead SSO path' framing without inventing new copy/error UI the UI-SPEC doesn't specify for this specific sub-case."

patterns-established:
  - "Fail-closed status read: a ref defaults to the safe/hidden state and is only flipped on an explicit successful+parsed positive response; any error path (network, non-ok, parse) leaves the default untouched and shows no error text."

requirements-completed: [AUTH-06]

coverage:
  - id: D1
    description: "The 'Mit SSO anmelden' affordance (oder divider + secondary button + decorative green --ok dot) renders in the idle state only when GET /api/sso/status resolves enabled: true"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/test/LoginView.test.ts#conditional SSO affordance (AUTH-06, 10-UI-SPEC Surface B, UI-10-07..10) renders the 'Mit SSO anmelden' affordance with the 'oder' divider and green dot when SSO is enabled"
        status: pass
    human_judgment: false
  - id: D2
    description: "The affordance stays hidden with no error text when the status fetch fails (network error or non-ok response) — fail-closed, magic-link remains the only visible path"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/test/LoginView.test.ts#conditional SSO affordance (AUTH-06, 10-UI-SPEC Surface B, UI-10-07..10) hides the affordance and shows no error when the status fetch fails (fail-closed, UI-10-08)"
        status: pass
      - kind: unit
        ref: "apps/web/test/LoginView.test.ts#conditional SSO affordance (AUTH-06, 10-UI-SPEC Surface B, UI-10-07..10) hides the affordance when the status fetch resolves not-ok (fail-closed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The SSO affordance renders only in the idle state; switching to the Sent state (after a magic-link send) hides it even when SSO is enabled"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/test/LoginView.test.ts#conditional SSO affordance (AUTH-06, 10-UI-SPEC Surface B, UI-10-07..10) does not render the SSO affordance in the Sent state even when SSO is enabled"
        status: pass
    human_judgment: false
  - id: D4
    description: "Clicking 'Mit SSO anmelden' POSTs to /api/auth/sign-in/oauth2 with providerId 'oidc' and callbackURL '/', then navigates the browser to the returned authorize URL (real genericOAuth redirect, not a placeholder toast)"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/test/LoginView.test.ts#conditional SSO affordance (AUTH-06, 10-UI-SPEC Surface B, UI-10-07..10) clicking 'Mit SSO anmelden' POSTs to /api/auth/sign-in/oauth2 and navigates to the returned authorize URL"
        status: pass
    human_judgment: false
  - id: D5
    description: "Pre-existing magic-link idle/sent flow, error handling, and rate-limit copy remain unchanged after the additive SSO wiring"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/web/test/LoginView.test.ts#LoginView (all 5 pre-existing magic-link cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full visual/pixel fidelity of the divider + SSO button against 10-UI-SPEC.md's locked Layout/Spacing/Typography/Color contracts"
    verification: []
    human_judgment: true
    rationale: "DOM-structure, class-name, and copy assertions confirm the correct elements/classes render, but exact rendered spacing/color fidelity to the locked prototype values needs a visual check (screenshot/UI review), which this unit-test suite cannot verify."

duration: ~20min
completed: 2026-07-23
status: complete
---

# Phase 10 Plan 05: LoginView Conditional SSO Affordance Summary

**Conditional "Mit SSO anmelden" secondary action on the real login screen, fail-closed on a failed /api/sso/status read, initiating the actual better-auth genericOAuth redirect via POST /api/auth/sign-in/oauth2.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-23T18:42:33Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added an `ssoEnabled` ref + `loadSsoStatus()` to `LoginView.vue`, fetched directly (no `api.ts` import, matching the view's existing direct-fetch style) on mount from `GET /api/sso/status`; any fetch/parse failure or non-ok response leaves it `false` with no error text (fail-closed, UI-10-08, T-10-FAILOPEN).
- Rendered the LOCKED Surface B affordance — the "oder" divider (two 1px `--border` lines) and a secondary `.sso-button` with a decorative 8x8 `var(--ok)` dot (`aria-hidden="true"`) followed by the exact copy "Mit SSO anmelden" — inside the idle template block only, `v-if="ssoEnabled"`, after the primary "Magic Link senden" button and its error text.
- Wired the button's click to `signInWithSso()`: `POST /api/auth/sign-in/oauth2` with `{ providerId: "oidc", callbackURL: "/" }` (provider id verified against `apps/api/src/lib/ssoConfig.ts`'s `SSO_PROVIDER_ID`), then `window.location.assign(response.url)` — the real better-auth redirect, not the prototype's placeholder toast.
- Verified the exact request/response shape against the installed `better-auth@1.6.23` source (`apps/api/node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs`): `POST /sign-in/oauth2` (mounted at `/api/auth/sign-in/oauth2`), body `{ providerId, callbackURL, ... }`, response `{ url: string, redirect: boolean }`.
- Extended `LoginView.test.ts` with a `fetchRouter` helper (URL-keyed mock routing) because `loadSsoStatus()` now fires an unconditional fetch on every mount, which would otherwise silently break the 5 pre-existing tests' single `mockResolvedValueOnce` assumption; added 6 new SSO-focused cases (visible-when-enabled, hidden-on-fetch-error, hidden-on-non-ok, absent-in-sent-state, click-initiates-and-navigates) plus kept all 5 pre-existing magic-link cases green.

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1: Conditional 'Mit SSO anmelden' login affordance (fail-closed) initiating genericOAuth**
   - `test(10-05): failing conditional SSO login affordance + fail-closed cases` - `d0f6e6c`
   - `feat(10-05): add conditional Mit-SSO-anmelden login affordance initiating genericOAuth` - `2e27c4d`

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `apps/web/src/views/LoginView.vue` - added `ssoEnabled` ref, `loadSsoStatus()`/`onMounted`, `signInWithSso()`, the idle-state-only affordance markup, and its scoped CSS (`.divider`, `.divider-line`, `.sso-button`, `.sso-dot`) using only already-locked tokens (`--mut`, `--border`, `--panel`, `--text`, `--hover`, `--ok`)
- `apps/web/test/LoginView.test.ts` - added `fetchRouter` URL-routing helper (replacing order-dependent `mockResolvedValueOnce` calls in the 5 pre-existing tests, now that mount always triggers an `/api/sso/status` fetch), plus a new `describe` block with 6 SSO-affordance cases including a `window.location` stub pattern for navigation assertions

## Decisions Made
- Confirmed the plan's stated endpoint/body/response shape against the installed `better-auth@1.6.23` package source directly rather than trusting the plan text alone — it matched exactly (`POST /sign-in/oauth2`, `{ providerId, callbackURL }`, `{ url, redirect }`), so no deviation was needed there.
- Rewrote the 5 pre-existing `LoginView.test.ts` tests' fetch stubbing from `mockResolvedValueOnce` to a URL-routed `fetchRouter` helper — this was necessary (not optional cleanup) because the new unconditional `onMounted` status fetch would otherwise consume the single queued mock value meant for the magic-link call, silently breaking those tests. The plan's task text anticipated this ("stub fetch for /api/sso/status and /api/auth/sign-in/oauth2 ... extend it").
- `window.location.assign` cannot be `vi.spyOn`'d directly in this project's jsdom version (`Cannot redefine property: assign`); used `Object.defineProperty(window, "location", { value: { ...originalLocation, assign: assignMock } })` instead, restoring the original afterward.

## Deviations from Plan

None - plan executed exactly as written. The endpoint/body/response verification step the plan required (`<read_first>` item 4) confirmed the plan's assumptions were already correct against the installed package, so no implementation changes were needed beyond what the plan specified.

## Issues Encountered

The pre-existing `LoginView.test.ts` tests' `mockResolvedValueOnce` pattern would have silently broken once `loadSsoStatus()`'s unconditional mount-time fetch was added (the queued mock value meant for the magic-link POST would have been consumed by the status GET instead, causing `response.json()` to be called on the wrong shape). Caught this during RED (all 3 new SSO tests failed as expected, but a review of the fetch mock plumbing showed the pre-existing 5 tests needed updating too) and resolved it by switching all fetch stubbing in the file to the URL-routed `fetchRouter` helper before writing the GREEN implementation, so both old and new tests pass deterministically regardless of call order.

## User Setup Required
None - no external service configuration required. Existing `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` ENV setup (documented on the Team screen since 10-04) is the only operator-facing configuration surface, unchanged by this plan.

## Next Phase Readiness
- AUTH-06's end-user login half is complete: a user can start a real OIDC sign-in when the operator has SSO enabled, with magic-link staying the untouched, always-present primary path.
- All phase 10 requirements (AUTH-05, AUTH-06, AUTH-07) now have their implementation plans executed (10-01 through 10-05).
- No blockers. Full `@kurzly/web` suite (256 tests) and workspace `tsc --noEmit` both green after this plan.

---
*Phase: 10-oidc-sso-integration*
*Completed: 2026-07-23*

## Self-Check: PASSED

Both modified files (`apps/web/src/views/LoginView.vue`, `apps/web/test/LoginView.test.ts`) found on disk; both task commits (`d0f6e6c`, `2e27c4d`) found in git history.
