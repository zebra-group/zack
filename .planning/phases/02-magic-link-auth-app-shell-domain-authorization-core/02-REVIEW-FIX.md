---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
fixed_at: 2026-07-11T15:52:00Z
review_path: .planning/phases/02-magic-link-auth-app-shell-domain-authorization-core/02-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-07-11T15:52:00Z
**Source review:** .planning/phases/02-magic-link-auth-app-shell-domain-authorization-core/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (2 critical, 2 warning, 3 info)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: Authorization core fails open (grants access) on an invalid/unexpected role value

**Files modified:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260711133759_convert_domain_membership_role_to_enum/migration.sql` (new), `apps/api/src/lib/authorization.ts`, `apps/api/test/authorization.test.ts`
**Commit:** `5f68e26`
**Applied fix:**
- Code guard: `requireDomainAccess` now compares `membershipRank`/`requiredRank` (both explicitly checked for `undefined`) instead of relying on `undefined < n` evaluating falsy — an out-of-enum `membership.role` OR an out-of-enum `minRole` now throws `ForbiddenError` instead of silently resolving.
- Schema-level defense-in-depth: `DomainMembership.role` converted from a plain `TEXT` column to a native Postgres `enum Role { member admin owner }`. Verified empirically with a disposable local Postgres container (not the shared testcontainers harness, to avoid touching real dev/CI infra): applied all 3 migrations in order via `prisma migrate deploy`, confirmed the column type is `"Role"` via `\d "DomainMembership"`, then regenerated the Prisma client.
- Migration SQL uses `ALTER COLUMN ... TYPE "Role" USING "role"::"Role"` (in-place cast) rather than Prisma's auto-generated drop/recreate, since the DomainMembership table is guaranteed empty in this phase (zero callers exist yet) but an explicit cast is safer migration hygiene regardless.
- Regression test added to `authorization.test.ts`: `vi.spyOn(prisma.domainMembership, "findUnique").mockResolvedValueOnce({ ..., role: "not-a-real-role" })` proves the CODE-level guard alone denies an out-of-enum role, independent of the (now-enforced) schema constraint.
- LOCKED signatures `requireDomainAccess(prisma, userId, domainId, minRole)` / `scopedDomainIds(prisma, userId)` unchanged.

### CR-02: D-05 generic magic-link error page is unreachable

**Files modified:** `apps/web/src/views/LoginView.vue`, `apps/web/test/LoginView.test.ts`, `apps/api/test/auth.integration.test.ts`
**Commit:** `91c470e`
**Applied fix:**
- `LoginView.vue`'s `sendMagicLink()` now sends `callbackURL: "/"` and `errorCallbackURL: "/auth/error"` in the sign-in request body — `/auth/error` already existed and was wired in the router (`apps/web/src/router/index.ts`), rendering `AuthErrorView.vue`; it was simply never reached because the client never supplied the param.
- Updated `LoginView.test.ts`'s exact-body assertion to match the new request payload.
- Strengthened both AUTH-02 negative-path tests in `auth.integration.test.ts` to assert `new URL(location).pathname === "/auth/error"` (the actual redirect path) instead of a `.toContain("error=INVALID_TOKEN")` substring, which passed whether the redirect landed on `/auth/error` or on `/`. Updated the `requestMagicLinkUrl` test helper to send the same `callbackURL`/`errorCallbackURL` a real client now sends, and fixed the already-used-token test's "first" assertion: with `callbackURL` now supplied, a successful verify also 302-redirects to it rather than returning the session as JSON directly (this is better-auth's own documented behavior, not a bug).

### WR-01: Timing side-channel on the neutral-response magic-link path

**Files modified:** `apps/api/src/lib/auth.ts`
**Commit:** `14bf8e9`
**Applied fix:** `sendMagicLink`'s callback no longer `await`s `sendMagicLinkEmail(...)` before returning — changed to `void sendMagicLinkEmail({ to: email, url }).catch((error) => console.error(...))` (fire-and-forget with error logging, not a throw, so the response shape/timing stays identical to the non-allowlisted path). The D-01 byte-identical-response test and the neutral-response canary both still pass; the SMTP round-trip no longer adds latency to the allowlisted branch's HTTP response.

### WR-02: Rate limiting keys on request.ip with no trustProxy configured

**Files modified:** `.env.example`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts`, `apps/api/test/server.integration.test.ts`
**Commit:** `3051535`
**Applied fix:**
- Added `TRUST_PROXY: z.coerce.boolean().default(false)` to `envSchema` (fail-safe default: off unless explicitly enabled) and documented it in `.env.example` (kept the drift-guard test — `env-example-drift.test.ts` — green).
- Added `trustProxy?: boolean` to `BuildAppOptions`, wired into the `Fastify({...})` constructor's `trustProxy` option in `app.ts`.
- `server.ts` now passes `trustProxy: env.TRUST_PROXY` into `buildApp()`.
- Added two regression tests to `server.integration.test.ts` using a temporary `onRequest` hook to observe `request.ip`: with `trustProxy: true`, an `X-Forwarded-For` header is honored; with the default (`trustProxy` unset/false), it is ignored — proving the rate-limit key can no longer silently collapse into one shared proxy-IP bucket once an operator opts in via `TRUST_PROXY=true`.

### IN-01: Dead fallback in admin-seed's placeholder name derivation

**Files modified:** `apps/api/src/lib/admin-seed.ts`
**Commit:** `801f92e`
**Applied fix:** Adapted the review's suggested fix to the actual TypeScript configuration: `tsconfig.base.json` has `noUncheckedIndexedAccess: true`, so `.split("@")[0]` types as `string | undefined` regardless of the `z.email()` guarantee — dropping `?? email` is a compile error, not just a style choice (verified: removing it produces `TS2322: Type 'string | undefined' is not assignable to type 'string'`). Kept the fallback and expanded the comment to document both reasons it's kept (real-world unreachability given the env schema, AND the type-checker's `noUncheckedIndexedAccess` requirement).

### IN-02: Cookie Secure/SameSite attributes relied upon but never asserted in tests

**Files modified:** `apps/api/test/auth.integration.test.ts`
**Commit:** `f566038`
**Applied fix:** Extended the AUTH-02 cookie assertion to check for `SameSite=Lax` (unconditional in better-auth's cookie defaults, confirmed via source read of `dist/cookies/index.mjs`). Adapted the `Secure` assertion after empirically verifying the raw `Set-Cookie` header in this test suite's own environment: `BASE_URL` is `http://localhost:3000` (vitest.config.ts's test env, mirroring local dev) and better-auth derives `Secure` from whether `BASE_URL` starts with `https://` — so `Secure` is correctly ABSENT under this test's config (confirmed via a throwaway forced-failure assertion that printed the raw header: `...; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`, no `Secure` token). Asserting `Secure` present would have been a false claim about this test's own config rather than a regression guard, so the test instead asserts `Secure` is absent here (documenting why) and asserts `SameSite=Lax` is present — both now regression-tested rather than relying on an unconfigured third-party default.

### IN-03: Already-authenticated users can still land on the bare /login screen

**Files modified:** `apps/web/src/router/index.ts`, `apps/web/test/App.test.ts`
**Commit:** `e38d936`
**Applied fix:** Added the symmetric guard: the router now also rehydrates the session when navigating to `/login` (previously only done for `requiresAuth: true` routes), and if `to.name === "login"` and `authSession.isAuthenticated`, redirects to `{ name: "dashboard" }`. Added a regression test to `App.test.ts` (reusing the existing real-router + Pinia + mocked-`fetch` pattern) proving an authenticated session navigating to `/login` lands on the dashboard with the AppShell rendered, not the Idle login form.

## Skipped Issues

None — all 7 in-scope findings were fixed.

---

_Fixed: 2026-07-11T15:52:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
