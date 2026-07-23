---
phase: 10-oidc-sso-integration
plan: 02
subsystem: auth
tags: [oidc, sso, better-auth, generic-oauth, least-privilege, oauth2, security]

# Dependency graph
requires:
  - phase: 10-oidc-sso-integration
    provides: "10-01's lib/ssoConfig.ts (readSsoConfig/ssoDiscoveryUrl/ssoCallbackPath/SSO_PROVIDER_ID) and the OIDC env substrate"
  - phase: 09-team-management-role-based-access
    provides: "User.accountRole (default member, input:false in better-auth's additionalFields) and DomainMembership — the least-privilege primitives this plan proves hold for OIDC-provisioned users"
provides:
  - "createAuth(prisma) conditionally registers genericOAuth (from better-auth/plugins) ONLY when readSsoConfig() is non-null — magic-link-only installs keep plugins: [magicLink()] unchanged (D-10-03)"
  - "apps/api/test/sso-auth.integration.test.ts — the two headline safety proofs: AUTH-06 structural (oauth2 endpoints absent when unset) + coexistence (magic-link unchanged while SSO active), and AUTH-07 least-privilege + no-claim-elevation (SSO users always accountRole=member, zero DomainMemberships)"
  - "Hermetic in-process OIDC provider stub pattern (node:http loopback server serving discovery+token+userinfo) for driving the REAL genericOAuth sign-in->callback round trip in tests without a live external IdP"
affects: [10-oidc-sso-integration plans 03-05 (SSO status route, admin UI, login-page SSO affordance) — all read auth.ts's now-registered genericOAuth via the same readSsoConfig()/SSO_PROVIDER_ID/ssoCallbackPath() primitives]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional plugin registration: `const sso = readSsoConfig(); ...(sso ? [genericOAuth({...})] : [])` spread into the plugins array — the presence/absence of an entire plugin (and its endpoints) is derived from config at construction time, not from a runtime feature flag inside the plugin"
    - "Hermetic OIDC IdP stub for integration tests: a node:http server on a loopback port (port 0, OS-assigned) serving /.well-known/openid-configuration + /token + /userinfo, driven through the real better-auth sign-in (POST /sign-in/oauth2) -> callback (GET /oauth2/callback/:providerId) round trip by capturing the `state` query param and the state-verification cookie from the sign-in response — never a hand-rolled prisma.user.create for provisioning proofs"

key-files:
  created:
    - apps/api/test/sso-auth.integration.test.ts
  modified:
    - apps/api/src/lib/auth.ts

key-decisions:
  - "genericOAuth config uses discoveryUrl as the ONLY endpoint source (no authorizationUrl/tokenUrl/userInfoUrl overrides) and no mapProfileToUser — verified against the installed better-auth@1.6.23 source that this is sufficient for issuer-only discovery (D-10-01) and that omitting mapProfileToUser is what keeps IdP claims from ever reaching accountRole (D-10-04)"
  - "Verified against the installed better-auth@1.6.23 source (db/schema.mjs's parseAdditionalUserInputFromProviderProfile) that additionalFields.accountRole's existing input:false (Phase 9) is ALSO honored for OAuth provider-profile fields, not just the HTTP update-user API — so even a hypothetical IdP claim literally named accountRole would be silently dropped before user creation. This is defense-in-depth on top of D-10-04's 'never map any claim to accountRole' rule, not a substitute for it."
  - "Confirmed against the installed better-auth@1.6.23 source that genericOAuth persists only fields the existing Account model already has (providerId, accountId, accessToken, refreshToken, idToken, scope) — no schema migration needed (D-10-05); git status after Task 2 shows zero changes under prisma/migrations or schema.prisma"
  - "Test's OIDC stub deliberately omits id_token from the token response, forcing better-auth's callback handler down the userinfo_endpoint fetch path (not the decodeJwt(id_token) shortcut) — the more representative path for a provider whose token response doesn't include an ID token, and avoids needing to hand-construct a JWT-shaped string in the test"

requirements-completed: [AUTH-06, AUTH-07]

coverage:
  - id: D1
    description: "With OIDC env unset, createAuth registers ONLY magic-link: POST /api/auth/sign-in/oauth2 returns 404 and magic-link sign-in works exactly as before (AUTH-06, D-10-03)"
    requirement: "AUTH-06"
    verification:
      - kind: integration
        ref: "apps/api/test/sso-auth.integration.test.ts#POST /api/auth/sign-in/oauth2 is 404 — no genericOAuth endpoints exist when OIDC env is unset"
        status: pass
      - kind: integration
        ref: "apps/api/test/sso-auth.integration.test.ts#magic-link sign-in still works exactly as before when OIDC env is unset"
        status: pass
    human_judgment: false
  - id: D2
    description: "With OIDC env SET (genericOAuth registered), a full magic-link round-trip (request -> verify -> get-session) still succeeds unchanged — 'magic-link keeps working unchanged once SSO is active' (AUTH-06, ROADMAP success criterion 2)"
    requirement: "AUTH-06"
    verification:
      - kind: integration
        ref: "apps/api/test/sso-auth.integration.test.ts#AUTH-06 coexistence: magic-link round trip still succeeds while genericOAuth is registered"
        status: pass
    human_judgment: false
  - id: D3
    description: "A user provisioned through the REAL genericOAuth sign-in->callback path (hermetic in-test OIDC stub, no live IdP) receives accountRole=member and ZERO DomainMemberships, even when the IdP's userinfo response carries deliberately admin-shaped claims (role/groups/admin) — AUTH-07, D-10-04, ROADMAP success criterion 3"
    requirement: "AUTH-07"
    verification:
      - kind: integration
        ref: "apps/api/test/sso-auth.integration.test.ts#AUTH-07: a user provisioned through the real OIDC callback path gets accountRole member and zero DomainMemberships"
        status: pass
      - kind: integration
        ref: "apps/api/test/sso-auth.integration.test.ts#AUTH-07 no-claim-elevation: admin-shaped IdP claims (role/groups/admin) never elevate the provisioned user"
        status: pass
    human_judgment: false
  - id: D4
    description: "genericOAuth stores the provider link in the existing Account table with no new columns and no migration against better-auth 1.6.23 (D-10-05)"
    requirement: "AUTH-07"
    verification:
      - kind: other
        ref: "git status apps/api/prisma/migrations apps/api/prisma/schema.prisma after Task 2 — no changes; installed better-auth@1.6.23 source inspection (oauth2/link-account.mjs) confirms only existing Account columns are written"
        status: pass
    human_judgment: false
  - id: D5
    description: "pnpm -r exec tsc --noEmit clean and full API suite has no regression from the conditional genericOAuth wiring"
    verification:
      - kind: other
        ref: "pnpm -r exec tsc --noEmit — clean"
        status: pass
      - kind: integration
        ref: "pnpm --filter @kurzly/api test (vitest run, all files) — 43 test files, 531 tests passed"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-23
status: complete
---

# Phase 10 Plan 02: Conditional genericOAuth Registration & Least-Privilege Proof Summary

**`createAuth` registers better-auth's `genericOAuth` plugin only when `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` are all set, proven by a hermetic in-process OIDC stub that drives the real sign-in→callback flow and asserts SSO-provisioned users always land at `accountRole=member` with zero domain memberships, even against admin-shaped IdP claims.**

## Performance

- **Duration:** 8 min (commit-to-commit, RED `9df709e` → GREEN `0e17114`)
- **Started:** 2026-07-23T12:20:20+02:00
- **Completed:** 2026-07-23T12:28:10+02:00
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `apps/api/test/sso-auth.integration.test.ts` created — two describe blocks proving the phase's two headline safety guarantees:
  - **OIDC unset (structural default, D-10-03):** `POST /api/auth/sign-in/oauth2` returns 404 (no `genericOAuth` endpoints registered at all) and the magic-link round trip is unaffected.
  - **OIDC set (D-10-04):** magic-link still works while SSO is active (the "unchanged" half the unset block can't cover), plus two provisioning proofs driven through the REAL `genericOAuth` sign-in→callback flow against a hermetic in-process OIDC stub — the resulting `User` is always `accountRole=member` with zero `DomainMembership` rows, both with plain claims and with deliberately admin-shaped claims (`role: "admin"`, `groups: [...]`, `admin: true`).
- `apps/api/src/lib/auth.ts` now imports `genericOAuth` from `better-auth/plugins` and `readSsoConfig`/`ssoDiscoveryUrl`/`SSO_PROVIDER_ID` from `./ssoConfig.js`; `createAuth` reads `const sso = readSsoConfig()` once at construction and spreads a single-provider `genericOAuth({ config: [...] })` entry into `plugins` only when `sso` is non-null. `magicLink()` stays first/unchanged. No `mapProfileToUser` is configured — the deliberate absence is what keeps IdP claims (`role`, `groups`, `admin`, or even a claim literally named `accountRole`) from ever reaching the provisioned `User` row.
- Verified against the installed `better-auth@1.6.23` source (not assumed) three separate facts load-bearing for this plan: (1) the sign-in endpoint is `POST /sign-in/oauth2` with body `{providerId, callbackURL, errorCallbackURL, ...}`, confirming the 404-when-absent test is exercising the right surface; (2) `db/schema.mjs#parseAdditionalUserInputFromProviderProfile` drops any provider-profile field whose `additionalFields` entry has `input: false` — so Phase 9's existing `accountRole: {input:false}` is *also* enforced against OAuth claims, not just the HTTP update-user API; (3) `oauth2/link-account.mjs#handleOAuthUserInfo`'s new-user branch writes only `name`/`image`/parsed-additional-fields/`email`/`emailVerified` to `internalAdapter.createOAuthUser` — no code path exists for a claim to set `accountRole` even indirectly.
- Full `pnpm --filter @kurzly/api test` run: 43 test files, 531 tests, all green — no regression from the conditional plugin wiring. `pnpm -r exec tsc --noEmit` clean.

## Task Commits

Each task followed the RED → GREEN TDD cycle:

1. **Task 1: sso-auth integration suite — structural + least-privilege proofs, RED first** - `9df709e` (test)
2. **Task 2: Conditional genericOAuth registration in createAuth (GREEN)** - `0e17114` (feat)

_This SUMMARY and STATE/ROADMAP updates are committed by the orchestrator per this plan's execution contract (STATE.md/ROADMAP.md are NOT owned by this executor run)._

## Files Created/Modified
- `apps/api/test/sso-auth.integration.test.ts` - hermetic OIDC-stub-driven integration suite: 2 describe blocks, 5 tests, covering AUTH-06 structural/coexistence and AUTH-07 least-privilege/no-claim-elevation
- `apps/api/src/lib/auth.ts` - `createAuth` now conditionally registers `genericOAuth` via `readSsoConfig()`; header comment extended to document the D-10-01/03/04/05 rationale inline

## Decisions Made
- **discoveryUrl-only config, no endpoint overrides:** matches D-10-01's issuer-only ergonomics exactly — the admin supplies only `OIDC_ISSUER_URL`, and better-auth's own discovery fetch resolves authorization/token/userinfo endpoints. No `authorizationUrl`/`tokenUrl`/`userInfoUrl` are set in `createAuth`.
- **No `mapProfileToUser` under any circumstance:** this is the single most load-bearing line (or rather, absent line) in the implementation for D-10-04 — its absence is what the no-claim-elevation test proves holds.
- **Test provisioning goes through the real callback handler, not a hand-rolled insert:** per the plan's explicit instruction, `ssoSignInAndCallback()` calls the actual `POST /api/auth/sign-in/oauth2` then `GET /api/auth/oauth2/callback/oidc`, carrying forward the `state` param and better-auth's own state-verification cookie — so `better-auth`'s own `handleOAuthUserInfo` code is what creates the `User` row in every assertion.
- **Stub token response omits `id_token`:** forces the callback handler's `getUserInfo` to fetch the discovery `userinfo_endpoint` (the realistic path for many OIDC providers) rather than decoding a JWT — simpler and more representative than fabricating a signed-looking JWT string.

## Deviations from Plan

None — plan executed exactly as written, including the two "VERIFY the exact ... against the installed typings" instructions (Task 1's sign-in/callback endpoint shapes, Task 2's `genericOAuth` config option names), both confirmed directly against the installed `better-auth@1.6.23`/`@better-auth/core@1.6.23` source before wiring anything, per the plan's stated discipline.

## Issues Encountered
None. The full sign-in→callback round trip against the hermetic stub worked on the first implementation attempt — no state-cookie or discovery-shape surprises relative to what the source inspection predicted.

## User Setup Required
None - no external service configuration required. (Operators still set `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` themselves per D-10-02; this plan is what makes those variables actually activate `genericOAuth`.)

## Next Phase Readiness
- 10-03 (SSO status route) can rely on `createAuth`'s registration now matching exactly what `readSsoConfig()`/`ssoCallbackPath()` report — no drift between "what's registered" and "what the admin UI shows."
- 10-04/10-05 (admin UI, login-page SSO affordance) can assume `POST /api/auth/sign-in/oauth2` and `GET /api/auth/oauth2/callback/oidc` are live whenever the SSO status route reports `enabled: true`.
- No blockers. `pnpm --filter @kurzly/api test` (531 tests, 43 files) and `pnpm -r exec tsc --noEmit` both clean.

---
*Phase: 10-oidc-sso-integration*
*Completed: 2026-07-23*

## Self-Check: PASSED

All created/modified files found on disk (`apps/api/test/sso-auth.integration.test.ts`, `apps/api/src/lib/auth.ts`, this SUMMARY.md); both task commits (`9df709e`, `0e17114`) verified present in `git log`.
