---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
plan: 06
subsystem: ui
tags: [vue3, vue-router, pinia, vitest, vue-test-utils, app-shell]

# Dependency graph
requires:
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "02-05: theme + authSession Pinia stores, LoginView/AuthErrorView, tokens.css"
provides:
  - "apps/web/src/layouts/AppShell.vue — LOCKED 212px sidebar (logo, 6-item nav, footer: theme toggle + version + user row + logout) beside scrollable content"
  - "apps/web/src/views/DashboardView.vue — post-login 'Übersicht' landing (D-03)"
  - "apps/web/src/views/ComingSoonView.vue — reusable placeholder reading route meta.label"
  - "apps/web/src/router/index.ts — 2 public + 6 protected routes, session-aware beforeEach guard (AUTH-03 client rehydration; documented as UX-only, not a security boundary)"
  - "apps/web/src/App.vue — layout switch (AppShell vs public auth views vs loading), replaces the Phase 1 walking-skeleton canary UI"
  - "apps/web/src/main.ts — Pinia + router + tokens.css + pre-paint theme, awaits router.isReady() before mount"
affects: [ui, auth, phase-3, phase-4, phase-6, phase-7, phase-9]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "main.ts awaits router.isReady() before app.mount() so the router's beforeEach auth guard has already rehydrated the session and resolved any redirect before App.vue ever renders — avoids a one-tick flash of a protected view for an unauthenticated user"
    - "Route meta.label carries the human-readable screen name for the shared ComingSoonView (one component, N routes) rather than deriving it from the route name string"

key-files:
  created:
    - apps/web/src/layouts/AppShell.vue
    - apps/web/src/views/DashboardView.vue
    - apps/web/src/views/ComingSoonView.vue
    - apps/web/src/router/index.ts
    - apps/web/test/AppShell.test.ts
  modified:
    - apps/web/src/App.vue
    - apps/web/src/main.ts
    - apps/web/test/App.test.ts

key-decisions:
  - "App.vue's own onMounted fetchSession() call is intentionally kept alongside the router guard's fetchSession() (redundant on first load since main.ts awaits router.isReady()) — it's a resilience refetch for cases outside the initial navigation (e.g. a future window-refocus revalidation), not the primary auth-gate mechanism, which is the router guard + main.ts's isReady() ordering"
  - "test/App.test.ts (which tested the Phase 1 walking-skeleton canary UI) was rewritten for App.vue's new layout-switching behavior rather than deleted, since App.vue's markup fundamentally changed and the old assertions (canary count/token rendering) no longer apply to any code path — not a new test file, a required update to an existing one whose subject under test changed shape"

requirements-completed: [UI-01, UI-03, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "AppShell renders the LOCKED 212px sidebar (logo, all 6 nav items: Dashboard/Links/QR-Codes/Analytics/Domains/Team, footer with theme toggle + version + user row + icon-only logout) beside a scrollable content area; nav active state uses --chip, not --accent"
    requirement: UI-01
    verification:
      - kind: other
        ref: "grep -q '212px' apps/web/src/layouts/AppShell.vue"
        status: pass
      - kind: unit
        ref: "apps/web/test/AppShell.test.ts#renders the 212px sidebar with all six nav labels"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/web exec tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dashboard is the post-login landing at / with the warm 'Übersicht' welcome copy; Links/QR-Codes/Analytics/Domains/Team route to the reusable ComingSoonView rendering '{label} — bald verfügbar' from route meta"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "apps/web/test/App.test.ts#renders the AppShell + Dashboard for an authenticated session"
        status: pass
    human_judgment: false
  - id: D3
    description: "Vue Router beforeEach rehydrates the session (authSession.fetchSession()) and redirects unauthenticated users on requiresAuth routes to /login; documented in-code as UX-only (API independently re-verifies server-side, T-02-14)"
    requirement: AUTH-03
    verification:
      - kind: unit
        ref: "apps/web/test/App.test.ts#redirects an unauthenticated session to /login and renders the full-screen LoginView (no shell)"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/web exec tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D4
    description: "The logout control (icon-only '⏻', title='Abmelden') in the sidebar's user row calls authSession.signOut() (POST /api/auth/sign-out, server clears the session) then routes to /login — reachable from every authenticated page since AppShell wraps all protected routes"
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "apps/web/test/AppShell.test.ts#calls authSession.signOut() and routes to login when the logout control is clicked"
        status: pass
    human_judgment: false
  - id: D5
    description: "The persisted theme is applied pre-paint in main.ts (localStorage kurzly-theme -> body[data-theme], before app.mount()) and the sidebar's theme-toggle switch flips Light/Dark via theme.toggle()"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "apps/web/test/AppShell.test.ts#calls theme.toggle() when the theme toggle is clicked"
        status: pass
    human_judgment: false
  - id: D6
    description: "UI-03 manual pixel-fidelity gate: the App Shell (212px sidebar + Dashboard + a Coming-soon screen) compared at 1440px Light+Dark against the design_handoff prototype"
    requirement: UI-03
    verification: []
    human_judgment: true
    rationale: "Component tests assert structure/behavior only, not pixel-level rendering. CSS values in AppShell.vue/DashboardView.vue/ComingSoonView.vue were cross-checked verbatim against design_handoff_url_shortener/Kurzly Prototyp.dc.html lines 24-54 (sidebar markup) and 02-UI-SPEC.md's LOCKED Layout Contract (Design-Fidelity Waiver) — but no browser screenshot comparison was performed during this execution. Required before /gsd-verify-work per the plan's own acceptance criteria (same open item already flagged by 02-05 for the Login/error views)."

# Metrics
duration: 7min
completed: 2026-07-11
status: complete
---

# Phase 2 Plan 6: App Shell, Dashboard, Router Guard & App Wiring Summary

**Pixel-referenced 212px App Shell (nav + theme toggle + logout) wired through a session-aware Vue Router guard into App.vue/main.ts, replacing the Phase 1 walking-skeleton canary UI**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-11T13:06:00Z (approx.)
- **Completed:** 2026-07-11T13:13:00Z
- **Tasks:** 3
- **Files modified:** 8 (5 new: AppShell.vue, DashboardView.vue, ComingSoonView.vue, router/index.ts, AppShell.test.ts; 3 modified: App.vue, main.ts, App.test.ts)

## Accomplishments

- Built `AppShell.vue`: the LOCKED 212px sidebar (22×22 logo mark, 6-item nav with `--chip`-not-`--accent` active state, footer with a 30×16 theme-toggle switch, version text, and a user row with an icon-only `⏻` logout button) beside a `flex:1; overflow-y:auto` content area — cross-checked verbatim against the design handoff's sidebar markup (`Kurzly Prototyp.dc.html` lines 24-54).
- Built `DashboardView.vue` (warm "Übersicht" landing, D-03) and `ComingSoonView.vue` (reusable placeholder reading `route.meta.label`, wired to Links/QR-Codes/Analytics/Domains/Team).
- Built `router/index.ts`: 2 public routes (`/login`, `/auth/error`) + 6 protected routes, with a `beforeEach` guard that rehydrates the session via `authSession.fetchSession()` and redirects unauthenticated users to `/login` — documented in-code as a UX convenience only (T-02-14; the API independently re-verifies the session on every request).
- Rewrote `App.vue` (replacing the Phase 1 walking-skeleton canary UI) to switch between `AppShell` (authenticated, non-public routes), a full-screen `RouterView` (public auth routes), and a loading fallback; rewrote `main.ts` to register Pinia + router, import `tokens.css`, apply the pre-paint theme snippet, and await `router.isReady()` before mounting (so the guard's redirect always resolves before first render).
- Wrote `AppShell.test.ts` (3 tests: sidebar/nav render, theme toggle fires `theme.toggle()`, logout fires `authSession.signOut()` + routes to login) and rewrote `App.test.ts` (2 tests: unauthenticated → `/login` + no shell; authenticated → AppShell + Dashboard) against the new layout-switching behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: AppShell layout + Dashboard + Coming-soon views** - `6ac5ab0` (feat)
2. **Task 2: Vue Router + session-aware auth guard** - `e0d5fd8` (feat)
3. **Task 3: App.vue + main.ts wiring + AppShell component test** - `efa5072` (feat)

**Plan metadata:** committed as part of this SUMMARY finalization

## Files Created/Modified

- `apps/web/src/layouts/AppShell.vue` - 212px sidebar (logo, 6-item nav, theme toggle, version, user row, logout) + scrollable `<RouterView>` content
- `apps/web/src/views/DashboardView.vue` - "Übersicht" post-login landing with warm welcome copy
- `apps/web/src/views/ComingSoonView.vue` - reusable "{label} — bald verfügbar" placeholder for not-yet-built nav destinations
- `apps/web/src/router/index.ts` - 2 public + 6 protected routes, session-aware `beforeEach` guard
- `apps/web/src/App.vue` - layout switch (AppShell / public auth views / loading), replaces the walking-skeleton canary UI
- `apps/web/src/main.ts` - Pinia + router + tokens.css + pre-paint theme + `router.isReady()` gate before mount
- `apps/web/test/AppShell.test.ts` - 3 tests for the shell's structure/theme-toggle/logout
- `apps/web/test/App.test.ts` - 2 tests for the new layout-switching behavior (replaces the old canary-UI assertions)

## Decisions Made

- `main.ts` awaits `router.isReady()` before `app.mount()` so the router's `beforeEach` guard has already rehydrated the session and resolved any redirect before `App.vue` ever renders — this avoids a one-tick flash of a protected view for an unauthenticated user, and made `App.vue`'s own `onMounted` `fetchSession()` call a secondary resilience refetch rather than the primary gate.
- `test/App.test.ts` was rewritten (not deleted) for the new layout-switching behavior — the Phase 1 walking-skeleton canary UI it tested no longer exists in `App.vue`'s markup after this plan's replacement, so its old assertions could never pass against the new component; the file's role in the suite (root-component coverage) is preserved with updated assertions matching D-03's actual scope.
- Test mocks for `getSession()`'s underlying `fetch` calls use `mockImplementation` (fresh `Response` per call) rather than `mockResolvedValue` (same `Response` instance reused) — a `Response` body can only be read once via `.json()`, and both the router guard and `App.vue`'s `onMounted` call `fetchSession()` on the same navigation, so a shared instance would throw on the second read.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rewrote test/App.test.ts's stale walking-skeleton assertions**
- **Found during:** Task 3 (App.vue/main.ts wiring)
- **Issue:** `test/App.test.ts` (pre-existing, not in this plan's `files_modified` list) tested the Phase 1 walking-skeleton canary UI (`getCanary`/`createCanary` mocks, "Write canary" button) that Task 3's `App.vue` replacement removes entirely — running the full test suite (`pnpm --filter @kurzly/web test -- --run`, this plan's own `<verification>` command) would have failed with the old assertions against the new markup, blocking the plan's "web typecheck + tests green" success criterion.
- **Fix:** Rewrote `test/App.test.ts` to assert the new layout-switching behavior (unauthenticated → `/login` + no shell; authenticated → AppShell + Dashboard), using the real router + a real Pinia instance with a mocked global `fetch`.
- **Files modified:** `apps/web/test/App.test.ts`
- **Verification:** `pnpm --filter @kurzly/web test -- --run` — 14/14 tests pass (4 files: App.test.ts, AppShell.test.ts, LoginView.test.ts, theme.test.ts).
- **Committed in:** `efa5072` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep the test suite green after App.vue's intentional full replacement; no scope creep beyond updating the one pre-existing test file whose subject under test changed shape.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required. Uses the `/api/auth/*` surface already live from 02-04 and the theme/authSession stores from 02-05.

## Next Phase Readiness

- The full client-side slice of Phase 2 is now wired: magic-link login (02-05) → session-aware router guard → themeable App Shell with Dashboard + Coming-soon placeholders → from-every-page logout. `pnpm --filter @kurzly/web exec tsc --noEmit`, `pnpm --filter @kurzly/web test -- --run` (14/14), and `pnpm --filter @kurzly/web build` all pass.
- **UI-03 manual pixel-fidelity gate is still open** for both this plan's App Shell (D6 above) and 02-05's Login/error views (carried over from that plan's summary): a real browser comparison at 1440px in Light + Dark against `design_handoff_url_shortener/Kurzly Prototyp.dc.html` has not been performed. CSS values were cross-checked textually against the prototype's markup for both plans. This should be done before `/gsd-verify-work` closes out Phase 2.
- `apps/web/src/api.ts`'s `getCanary`/`createCanary` exports are now unused by any component (the walking-skeleton canary UI they backed was removed from `App.vue`) but were left in place since `api.ts` was not in this plan's scope and the server-side `/api/canary` route + its own tests are unaffected — a later phase/cleanup pass can remove them if desired.
- No blockers for Phase 3.

---
*Phase: 02-magic-link-auth-app-shell-domain-authorization-core*
*Completed: 2026-07-11*
