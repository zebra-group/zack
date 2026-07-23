---
phase: 10-oidc-sso-integration
plan: 04
subsystem: ui
tags: [vue3, vue-router, sso, oidc, team-view, read-only-status]

requires:
  - phase: 10-oidc-sso-integration
    provides: "10-03's GET /api/sso/status endpoint + SsoStatusDTO shape (enabled/issuer/clientIdMasked/callbackPath, never a secret)"
provides:
  - "getSsoStatus() typed client in apps/web/src/api.ts"
  - "TeamView.vue 'Authentifizierung' section: descriptive Magic Link card + read-only OIDC/SSO status card"
  - "/login?preview=1 router escape hatch so an authenticated admin can view the real login page"
affects: [10-05]

tech-stack:
  added: []
  patterns:
    - "Read-only status-card pattern (no credential inputs, no toggle) for server-ENV-derived config surfaces, reusing DomainsView's .dns-code-block/.copy-button idiom"
    - "Router redirect escape hatch via a query param (?preview=1) rather than a new route, kept as UX-only per T-02-14"

key-files:
  created: []
  modified:
    - apps/web/src/api.ts
    - apps/web/src/router/index.ts
    - apps/web/src/router/guard.test.ts
    - apps/web/src/views/TeamView.vue
    - apps/web/src/views/TeamView.test.ts

key-decisions:
  - "OIDC card uses a generic 'In Zwischenablage kopiert' copy-success toast (locked by 10-UI-SPEC Copywriting Contract), distinct from DomainsView's DNS-specific 'DNS-Eintrag kopiert' — these blocks aren't DNS records, so a local copyToClipboard() was added to TeamView.vue rather than importing DomainsView's."
  - "The router's authenticated-/login redirect gained a single query-param exception (preview=1) rather than a second guard or route — smallest change that satisfies UI-10-09 while leaving every other case (including plain /login) unchanged."

patterns-established:
  - "OIDC/SSO card: v-if/else-if/else on a nullable status DTO ref (null=loading/failed fallback, enabled=true/false branches) — no re-derivation of state, renders DTO fields verbatim (UI-10-02/06)."

requirements-completed: [AUTH-05]

coverage:
  - id: D1
    description: "getSsoStatus() typed client fetches GET /api/sso/status and resolves SsoStatusDTO verbatim"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView Authentifizierung section (10-04, UI-10-01..06) renders the enabled OIDC state"
        status: pass
    human_judgment: false
  - id: D2
    description: "/login?preview=1 renders LoginView for an authenticated admin; plain /login and unauthenticated cases unchanged"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/router/guard.test.ts#router /login preview escape hatch (UI-10-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TeamView 'Authentifizierung' section renders exactly two cards between .team-table and .role-model-card"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#renders exactly two cards under an Authentifizierung heading, positioned between .team-table and .role-model-card (UI-10-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "OIDC card is read-only: no inputs/selects, no client secret in the DOM, in any state (enabled/disabled/null-fallback)"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#never renders a client secret value or any credential input/toggle control in the OIDC card (D-10-02, UI-10-06)"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#shows the neutral fallback and neither Aktiv nor Deaktiviert while ssoStatus is still loading (UI-10-02)"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#renders the disabled OIDC state: Deaktiviert badge, ENV-var setup block, and the callback URL to register (UI-10-04)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full visual/pixel fidelity of the Authentifizierung section against 10-UI-SPEC.md's Layout/Spacing/Typography/Color contracts"
    verification: []
    human_judgment: true
    rationale: "DOM-structure and copy assertions confirm correctness, but exact spacing/color rendering fidelity to the locked prototype values needs a visual check (screenshot/UI review), which this unit-test suite cannot verify."

duration: ~25min
completed: 2026-07-23
status: complete
---

# Phase 10 Plan 04: TeamView Authentifizierung Section Summary

**Read-only "Authentifizierung" section on TeamView (Magic Link + OIDC/SSO status cards) driven by GET /api/sso/status, plus a /login?preview=1 router escape hatch.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-23T18:31:46Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `getSsoStatus()` to `apps/web/src/api.ts` — a typed same-origin fetch client mirroring the existing `listDomains`/`getSession` convention, resolving the `SsoStatusDTO` from `@kurzly/shared` verbatim.
- Relaxed the router's authenticated-`/login`-redirects-to-dashboard guard with a `?preview=1` escape hatch (UI-10-09), leaving every other case (plain `/login`, unauthenticated visitors) unchanged.
- Added the two-card "Authentifizierung" section to `TeamView.vue`, inserted between the roster table and the existing role-model card per the locked prototype order (UI-10-01): a descriptive Magic Link card and a fully read-only OIDC/SSO status card driven by `ssoStatus` (enabled/disabled/loading-fallback states, D-10-02).
- Verified structurally that the client secret never enters the DOM in any state and that the OIDC card has zero inputs/selects/toggles.

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1: getSsoStatus() api client + /login preview router escape hatch**
   - `test(10-04): failing getSsoStatus + /login preview guard cases` - `e1871b8`
   - `feat(10-04): add getSsoStatus client and /login preview escape hatch` - `7345223`
2. **Task 2: TeamView 'Authentifizierung' section — two read-only auth cards**
   - `test(10-04): failing Authentifizierung section states` - `770841d`
   - `feat(10-04): add read-only Authentifizierung section to TeamView` - `96aaed8`

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `apps/web/src/api.ts` - added `getSsoStatus()` (GET /api/sso/status -> SsoStatusDTO)
- `apps/web/src/router/index.ts` - added the `?preview=1` exception to the authenticated-`/login`-redirect guard
- `apps/web/src/router/guard.test.ts` - added the 4 preview-guard cases (UI-10-09) + mocked `../api`'s `getSession` for the unauthenticated cases
- `apps/web/src/views/TeamView.vue` - added `ssoStatus`/`loadSsoStatus`/`copyToClipboard`, the Authentifizierung section markup, and its scoped CSS (reusing `.status-badge` and DomainsView's `.dns-code-block`/`.copy-button` idiom)
- `apps/web/src/views/TeamView.test.ts` - added the `getSsoStatus` mock + a new describe block covering placement, both cards' copy/states, and the never-a-secret/never-a-form guarantee

## Decisions Made
- Used a **generic** copy-success toast ("In Zwischenablage kopiert") for the OIDC card's `.dns-code-block`s rather than reusing DomainsView's DNS-specific "DNS-Eintrag kopiert" — these blocks hold a callback URL and ENV-var names, not DNS records, and 10-UI-SPEC.md's Copywriting Contract locks the generic string. Implemented a small local `copyToClipboard()` in `TeamView.vue` rather than importing DomainsView's function (the two views don't share a composable for this yet — out of scope for this plan to introduce one).
- The disabled-OIDC ENV-var code block uses `<br />`-separated lines inside a single `<code>` (matching the one-`.dns-code-block`-with-one-copy-button pattern already established by DomainsView) rather than three separate blocks — the plan's spec shows all three ENV names in a single copyable block.

## Deviations from Plan

None - plan executed exactly as written. All four `must_haves.truths` verified structurally: (1) exactly two cards between `.team-table` and `.role-model-card`; (2) OIDC card fully read-only across all three states with the locked copy; (3) client secret never rendered, `clientIdMasked` shown verbatim; (4) "Login-Seite ansehen →" opens the real `/login?preview=1` in a new tab and actually renders for an authenticated admin.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (OIDC ENV var setup guidance is now visible in-app on the Team screen, matching D-10-07's naming.)

## Next Phase Readiness
- `getSsoStatus()` and the `SsoStatusDTO` boundary are established and test-covered; 10-05 (login-screen SSO affordance) can read the same `enabled` field without re-deriving anything.
- No blockers. Full `@kurzly/web` suite (251 tests) and workspace `tsc --noEmit` both green after this plan.

---
*Phase: 10-oidc-sso-integration*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 6 created/modified files found on disk; all 4 task commits (`e1871b8`, `7345223`, `770841d`, `96aaed8`) found in git history.
