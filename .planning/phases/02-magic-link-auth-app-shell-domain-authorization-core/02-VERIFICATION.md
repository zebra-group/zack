---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
verified: 2026-07-11T16:10:00Z
status: human_needed
score: 8/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Visually compare LoginView (Idle + Sent states), AuthErrorView, and the App Shell (212px sidebar + Dashboard + a Coming-soon screen) at 1440px viewport width in both Light and Dark theme against design_handoff_url_shortener/Kurzly Prototyp.dc.html, per 02-VALIDATION.md's Manual-Only Verifications table"
    expected: "Spacing, typography (Geist/Geist Mono sizes+weights), colors/tokens, and layout dimensions match the prototype pixel-for-pixel in both themes; any drift is either fixed or explicitly accepted"
    why_human: "Visual pixel-fidelity is not reliably automatable. 02-05-SUMMARY.md and 02-06-SUMMARY.md both explicitly record that only a textual/line-by-line CSS cross-check against the prototype's markup was performed during execution — no browser screenshot comparison was done. 02-VALIDATION.md itself states this sign-off is 'required before the /gsd-verify-work gate' and lists 'Approval: pending'. Component tests (LoginView.test.ts, AppShell.test.ts) assert structure/behavior only, not pixel rendering, so they cannot close this gate."
---

# Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core — Verification Report

**Phase Goal:** Users can securely sign in via magic link and land in a pixel-accurate, theme-aware dashboard shell; the shared `requireDomainAccess`/`scopedDomainIds` server-side authorization helper is built and unit-tested here, ahead of any Links/QR/Analytics/Team route that must depend on it.
**Verified:** 2026-07-11T16:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User requests a magic link by entering email on the login page and receives a working, single-use, 15-min-valid link (ROADMAP SC1, AUTH-01/02) | ✓ VERIFIED | `apps/api/src/lib/auth.ts` configures `magicLink({ expiresIn: 900, disableSignUp: true, sendMagicLink })`; `apps/web/src/views/LoginView.vue` POSTs `/api/auth/sign-in/magic-link`. `auth.integration.test.ts` proves the full request round-trip. Full API suite run: **45/45 passed**. |
| 2 | Clicking a valid magic link signs the user in; an expired/already-used link fails safely with a clear message, not a raw error (ROADMAP SC2, AUTH-02, D-05) | ✓ VERIFIED | `AuthErrorView.vue` renders the generic D-05 card. **CR-02 fix confirmed in source**: `LoginView.vue`'s `sendMagicLink()` sends `callbackURL:"/"` + `errorCallbackURL:"/auth/error"` (lines 35-39) with an inline comment explaining why this was previously unreachable. `auth.integration.test.ts` asserts `new URL(location).pathname === "/auth/error"` for expired/invalid/reused-token cases (lines 183, 213). |
| 3 | The user's session survives a browser refresh, and the user can log out from any page (ROADMAP SC3, AUTH-03/04, D-06) | ✓ VERIFIED | `auth.ts`: 7-day sliding session (`expiresIn: 604800, updateAge: 86400`). `AppShell.vue`'s footer `⏻` logout button (title="Abmelden", present on every authenticated page since AppShell wraps all protected routes) calls `authSession.signOut()` → `POST /api/auth/sign-out`. `auth.integration.test.ts` proves session-survives-refresh + logout-clears-session server-side; `AppShell.test.ts` proves the client wiring. |
| 4 | Once signed in, the user navigates a persistent 212px sidebar + scrollable content shell with the prototype's design tokens (Geist, lime accent, spacing/radii) and can toggle Light/Dark (ROADMAP SC4, UI-01/UI-02) | ✓ VERIFIED | `AppShell.vue` line 104: `width: 212px` sidebar with all 6 nav items (Dashboard/Links/QR-Codes/Analytics/Domains/Team), footer with theme toggle + version text + user row + logout. `tokens.css` defines the LOCKED light/dark custom properties verbatim (`--accent:#d7ff01` etc.) applied via `body[data-theme]`. `theme.ts` store toggles + persists to `localStorage["kurzly-theme"]`. `main.ts` applies theme pre-paint. `AppShell.test.ts` + `theme.test.ts` pass (part of web's 15/15). |
| 5 | D-01 neutral response: byte-identical response for an allowlisted vs. never-seen email; mail sent only for the allowlisted one | ✓ VERIFIED | `isEmailAllowed()` (allowlist.ts) checked *inside* `sendMagicLink` callback (auth.ts lines 76-99), returns silently (no throw) when not allowed — same HTTP response shape either way. `auth.integration.test.ts`'s D-01 canary asserts byte-identical status+body and mail-spy invoked only for the allowlisted email; passing as part of the 45/45 API run. |
| 6 | `requireDomainAccess`/`scopedDomainIds` are built, unit-tested against real Postgres, and deny-by-default (incl. unknown user/domain and an out-of-enum role) | ✓ VERIFIED | **CR-01 fix confirmed in source**: `authorization.ts` lines 50-61 explicitly check `membershipRank === undefined \|\| requiredRank === undefined \|\| membershipRank < requiredRank` (closes the `undefined < n` fail-open bypass). Schema-level defense-in-depth confirmed: `schema.prisma` now defines `enum Role { member admin owner }` (native Postgres enum, not TEXT) and a committed migration `20260711133759_convert_domain_membership_role_to_enum` performs `ALTER COLUMN "role" TYPE "Role" USING "role"::"Role"`. `authorization.test.ts` has 6 real-Postgres test cases including the explicit CR-01 regression test (`vi.spyOn` stubbing an out-of-enum role, asserting `ForbiddenError`). All pass in the 45/45 API run. `tsc --noEmit` passes cleanly against the regenerated Prisma client (which now types `role` as the `Role` enum, not `string`). |
| 7 | Zero routes in Phase 2 consume `requireDomainAccess`/`scopedDomainIds` (foundation-only prohibition) | ✓ VERIFIED | `grep -rl "requireDomainAccess\|scopedDomainIds" apps/api/src/routes/ apps/api/src/plugins/` returns no matches — only `authorization.ts` (definition) and `authorization.test.ts` (tests) reference the helpers. |
| 8 | Security hardening: `@fastify/helmet` sets headers with a Google-Fonts-aware CSP; `@fastify/rate-limit` applies a materially tighter per-route limit on the magic-link endpoint (D-07) | ✓ VERIFIED | `helmet.ts` registers a CSP with `styleSrc`/`fontSrc` allowing `fonts.googleapis.com`/`fonts.gstatic.com`. `rateLimit.ts` registers a global default (100/15min) plus exports `MAGIC_LINK_RATE_LIMIT = {max:5, timeWindow:"15 minutes"}`; `routes/auth.ts` applies it via a static route registered ahead of the `/api/auth/*` wildcard so it takes rate-limit-router precedence for `POST /api/auth/sign-in/magic-link` only. |
| 9 | UI-03: all dashboard screens (Login, error page, App Shell, Dashboard, Coming-soon) match the Hi-Fi prototype's design tokens pixel-accurately at 1440px, Light + Dark | ⚠️ Manual gate not performed — see Human Verification | CSS values were cross-checked textually/line-by-line against the prototype's markup (confirmed in 02-05-SUMMARY.md and 02-06-SUMMARY.md, both explicitly flag this as an open item), but no live browser screenshot comparison was done. `02-VALIDATION.md` states this sign-off is required before `/gsd-verify-work` and lists "Approval: pending." |

**Score:** 8/9 truths verified (0 present-but-behavior-unverified; 1 routed to human visual verification)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/lib/authorization.ts` | `requireDomainAccess`/`scopedDomainIds`, deny-by-default, CR-01 fixed | ✓ VERIFIED | Present, substantive, fail-closed guard confirmed; wired only by its own test suite (by design) |
| `apps/api/test/authorization.test.ts` | 6 real-Postgres behavior cases incl. CR-01 regression | ✓ VERIFIED | All 6 present and passing |
| `apps/api/prisma/schema.prisma` | User/Session/Account/Verification + Domain + DomainMembership(role: native enum) | ✓ VERIFIED | All models present; `Role` is a native Postgres enum (CR-01 schema-level fix) |
| `apps/api/prisma/migrations/*` | Migrations applying auth+domain schema and the enum conversion | ✓ VERIFIED | 3 migrations present: `..._init`, `..._add_auth_and_domain_models`, `..._convert_domain_membership_role_to_enum` — all applied cleanly during the real test run |
| `apps/api/src/lib/auth.ts` | betterAuth instance, magicLink-only, single shared Prisma client | ✓ VERIFIED | `createAuth(prisma)` factory imports `db.ts`'s singleton by default; no second `PrismaClient` |
| `apps/api/src/lib/allowlist.ts` | `isEmailAllowed` invite-only check | ✓ VERIFIED | Simple User-row lookup, called only from inside `sendMagicLink` |
| `apps/api/src/routes/auth.ts` | `/api/auth/*` catch-all → `auth.handler`, tight rate-limit on magic-link | ✓ VERIFIED | Fetch-API-based forwarding (no `reply.hijack`), route-order confirmed via `server.integration.test.ts` |
| `apps/api/src/lib/admin-seed.ts` | Idempotent `INITIAL_ADMIN_EMAIL` seed bypassing `disableSignUp` | ✓ VERIFIED | `upsert` on email, `emailVerified:true` |
| `apps/api/src/plugins/helmet.ts` / `rateLimit.ts` | D-07 hardening | ✓ VERIFIED | Both present, registered before routes in `app.ts` |
| `apps/web/src/styles/tokens.css` | LOCKED light/dark tokens | ✓ VERIFIED | Verbatim `--accent:#d7ff01` etc., `body[data-theme="dark"]` block present |
| `apps/web/src/stores/theme.ts` / `authSession.ts` | Theme + session Pinia stores | ✓ VERIFIED | Both present, substantive, tested |
| `apps/web/src/views/LoginView.vue` / `AuthErrorView.vue` | Idle/Sent + generic error card | ✓ VERIFIED | Present, CR-02 fix confirmed in `LoginView.vue` |
| `apps/web/src/layouts/AppShell.vue` | 212px sidebar shell | ✓ VERIFIED | Present, `width: 212px`, all 6 nav items, footer controls |
| `apps/web/src/views/DashboardView.vue` / `ComingSoonView.vue` | Post-login landing + reusable placeholder | ✓ VERIFIED | Both present, correct copy per D-03 |
| `apps/web/src/router/index.ts` | Session-aware `beforeEach` guard | ✓ VERIFIED | Rehydrates session, redirects unauthenticated → `/login`, IN-03 symmetric redirect for already-authenticated → `/login` implemented |
| `apps/web/src/App.vue` / `main.ts` | Layout switch + Pinia/router/pre-paint-theme wiring | ✓ VERIFIED | Pre-paint theme snippet before mount; `router.isReady()` awaited before mount |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `auth.ts` | `db.ts` prisma singleton | `import { prisma as defaultPrisma } from "../db.js"` | ✓ WIRED | No second `PrismaClient`; confirmed by grep and by `tsc` |
| `LoginView.vue` | `/api/auth/sign-in/magic-link` | `fetch(...)` with `callbackURL`/`errorCallbackURL` | ✓ WIRED | CR-02 fix confirmed; integration test asserts the redirect target |
| `app.ts` route order | `authRoute` before `registerStatic`/`setNotFoundHandler` | Explicit registration order | ✓ WIRED | Confirmed in `app.ts` source; `server.integration.test.ts` proves `/api/auth/*` reaches the handler, not the SPA shell |
| `AppShell.vue` logout | `authSession.signOut()` → `/api/auth/sign-out` | Button `@click="handleLogout"` | ✓ WIRED | `AppShell.test.ts` asserts the click calls `signOut()`; server-side clearing proven in `auth.integration.test.ts` |
| `router/index.ts` guard | `authSession.fetchSession()` | `beforeEach` | ✓ WIRED | Rehydrates on both protected routes and `/login` (IN-03 fix) |
| `main.ts` | `theme` pre-paint | `document.body.dataset.theme` set before `app.mount()` | ✓ WIRED | Confirmed in source; `router.isReady()` gate additionally prevents a flash of protected content |
| `routes/auth.ts` | `MAGIC_LINK_RATE_LIMIT` | `config: { rateLimit: ... }` on the static route | ✓ WIRED | Static route registered ahead of the wildcard so find-my-way prefers it |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| AUTH-01 | 02-01, 02-02, 02-04, 02-05 | Nutzer kann per E-Mail einen Magic Link anfordern | ✓ SATISFIED | LoginView + auth.ts + auth.integration.test.ts |
| AUTH-02 | 02-02, 02-04 | Login via gültigem, einmaligem, 15-Min-Link; sicherer Fehlschlag | ✓ SATISFIED | `expiresIn:900`; CR-02-fixed error routing; integration tests |
| AUTH-03 | 02-02, 02-04, 02-06 | Session übersteht Browser-Refresh | ✓ SATISFIED | 7-day sliding session; router rehydration; integration test |
| AUTH-04 | 02-02, 02-04, 02-06 | Logout von jeder Seite | ✓ SATISFIED | AppShell footer logout (present on every authenticated page); server-side sign-out test |
| UI-01 | 02-06 | Persistenter 212px-Sidebar-Shell | ✓ SATISFIED | AppShell.vue `width:212px` + AppShell.test.ts |
| UI-02 | 02-05 | Light/Dark-Theme-Umschaltung | ✓ SATISFIED | theme.ts store + tokens.css + theme.test.ts |
| UI-03 | 02-05, 02-06 | Pixelgenaue Design-Tokens | ⚠️ NEEDS HUMAN | CSS textually cross-checked only; live 1440px Light+Dark browser comparison not yet performed (see Human Verification) |
| foundational-infrastructure (D-02, not a v1 REQ ID) | 02-03 | `requireDomainAccess`/`scopedDomainIds` authorization core | ✓ SATISFIED | 6/6 real-Postgres unit tests incl. CR-01 regression; zero callers (by design) |

No orphaned requirements: REQUIREMENTS.md maps exactly AUTH-01..04 + UI-01..03 to Phase 2, and every one of those 7 IDs appears in at least one plan's `requirements` frontmatter field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/src/api.ts` | 30, 35 | `getCanary`/`createCanary` exports now unused by any component (walking-skeleton UI removed) | ℹ️ Info | No functional impact; explicitly flagged as a known leftover in 02-06-SUMMARY.md, out of that plan's scope, server-side `/api/canary` route unaffected |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` debt markers found in any file modified by this phase. No stub returns (`return null`/`{}`/`[]` backing rendered data), no empty handlers, no hardcoded-empty props found in the reviewed source.

### Code Review Fix Verification (explicit re-check per task instructions)

- **CR-01** (authorization fails open on invalid role): **CONFIRMED FIXED.** `authorization.ts` lines 50-61 independently check `membershipRank === undefined` and `requiredRank === undefined` before the rank comparison (closes the JS `undefined < n === false` fail-open bypass). Schema-level defense-in-depth also confirmed: `DomainMembership.role` is now a native Postgres `enum Role`, applied via a committed migration. The CR-01 regression test (`authorization.test.ts`, stubbing `findUnique` to return an out-of-enum role) passes.
- **CR-02** (D-05 error page unreachable): **CONFIRMED FIXED.** `LoginView.vue`'s `sendMagicLink()` now sends both `callbackURL:"/"` and `errorCallbackURL:"/auth/error"`; `auth.integration.test.ts` asserts the redirect `pathname` is `/auth/error` for expired/invalid/reused-token verification attempts.

### Regression Check

- `pnpm --filter @kurzly/api test` → **45/45 passed** (real testcontainers Postgres, all 3 migrations applied cleanly, including the CR-01 enum migration).
- `pnpm --filter @kurzly/web test` → **15/15 passed**.
- `pnpm --filter @kurzly/api exec tsc --noEmit` → clean (after regenerating the gitignored Prisma client locally — the checked-out generated client was stale and briefly showed `role: string`; after `prisma generate` the enum type flowed through and `tsc` passed cleanly, confirming this is a local-environment artifact, not a codebase defect).
- `pnpm --filter @kurzly/web exec tsc --noEmit` → clean.
- `pnpm --filter @kurzly/shared build` → clean.
- HEAD confirmed at `6aeafb1` (docs(02): add code review fix report), matching the reviewed fix set.

### Human Verification Required

### 1. UI-03 pixel-fidelity gate (App Shell, Dashboard, Coming-soon, LoginView, AuthErrorView)

**Test:** Render the app in a browser at 1440px viewport width. Compare, in both Light and Dark theme: the App Shell (212px sidebar + Dashboard "Übersicht" screen + one Coming-soon screen) and the auth views (LoginView Idle + Sent states, AuthErrorView) against `design_handoff_url_shortener/Kurzly Prototyp.dc.html`.
**Expected:** Typography (Geist/Geist Mono sizes and weights), spacing, colors/tokens, and component dimensions match the prototype pixel-for-pixel; any drift is either fixed or explicitly accepted and documented.
**Why human:** Not automatable — component tests only assert structure/behavior. Both 02-05-SUMMARY.md and 02-06-SUMMARY.md explicitly record that only a textual CSS cross-check (not a live browser/screenshot comparison) was performed during execution, and 02-VALIDATION.md lists this sign-off as required before `/gsd-verify-work`, with "Approval: pending."

### Gaps Summary

No blocking gaps. All server-side and client-side behavioral, security, and structural must-haves are implemented, wired, and covered by passing automated tests (45/45 API, 15/15 web). Both code-review fixes (CR-01 authorization fail-open, CR-02 unreachable error page) are confirmed present and regression-tested in the source. The sole open item is the UI-03 manual pixel-fidelity visual comparison, which was deliberately deferred to a human check per the phase's own validation contract (02-VALIDATION.md) and is not something static analysis can close — it routes to human_needed rather than blocking phase completion.

---

*Verified: 2026-07-11T16:10:00Z*
*Verifier: Claude (gsd-verifier)*
