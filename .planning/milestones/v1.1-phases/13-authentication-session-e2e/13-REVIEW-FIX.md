---
phase: 13-authentication-session-e2e
fixed_at: 2026-07-25T01:22:30Z
review_path: .planning/phases/13-authentication-session-e2e/13-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 13: Code Review Fix Report

**Fixed at:** 2026-07-25T01:22:30Z
**Source review:** .planning/phases/13-authentication-session-e2e/13-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (CR-01, WR-01, WR-02, WR-03)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: SSO-after-invite merge fix is incompletely gated and untested against its own real-world failure mode

**Files modified:** `apps/api/src/lib/auth.ts`, `apps/api/test/sso-auth.integration.test.ts`, `apps/e2e/tests/auth/sso.spec.ts`
**Commit:** `bdf2ab4`
**Applied fix:** Deliberately did NOT apply REVIEW.md's literal suggested patch (`trustedProviders: [SSO_PROVIDER_ID]`). Read `better-auth`'s `link-account.mjs` logic again and confirmed that setting `trustedProviders` would remove the second, independent `!userInfo.emailVerified` gate entirely — letting the merge (and first-time SSO provisioning, AUTH-07) succeed even against an IdP that never asserts (or explicitly denies) the user's email is verified. That is a real security weakening, not a fix, so `trustedProviders` was intentionally left at its safe `[]` default. Instead:
- Rewrote `auth.ts`'s header comment and the inline `account.accountLinking` comment to document the second gate explicitly — what it is, why `trustedProviders` is deliberately unset, and the operational consequence (a real IdP that omits `email_verified` will see this merge fail with `error=account_not_linked`, which is correct/secure behavior, not a bug).
- Extended `OidcStubOptions`/`startOidcStub` in `sso-auth.integration.test.ts` with an `emailVerified?: boolean | "omit"` control, defaulting to `true` (matching every pre-existing test's assumed shape).
- Added a parameterized Vitest case (`it.each`) proving the invited-SSO-merge scenario is REJECTED — no `User` duplication, no `oidc` `Account` row created, invited row's `emailVerified` stays `false` — both when the IdP's userinfo response sets `email_verified: false` explicitly and when the claim is omitted entirely.
- Added a matching Playwright test to `sso.spec.ts` (`CR-01` in the test title) using the mock IdP's existing `setOidcProfile({ emailVerified: false })` support, asserting the browser lands on `/auth/error`, no session is issued, and the invited row is untouched.

**Verification:** `pnpm --filter @kurzly/api exec tsc --noEmit` clean; `pnpm --filter @kurzly/api exec vitest run test/sso-auth.integration.test.ts test/sso-config.test.ts` — 20/20 passed, including both new CR-01 cases (`email_verified` false and omitted); `pnpm --filter @kurzly/e2e exec tsc --noEmit` clean.
**Needs live verification:** The new Playwright case in `sso.spec.ts` has NOT been run against a live `docker compose` stack in this session (out of scope per this fix pass's own instructions — documented port conflicts on this dev machine). It is flagged in-file with a `NOTE:` comment. Recommend a live `scripts/e2e-compose.sh` run before considering CR-01 fully closed end-to-end.

### WR-01: Mock OIDC IdP imports an undeclared direct dependency

**Files modified:** `apps/e2e/oidc-mock/package.json`
**Commit:** `e15bd22`
**Applied fix:** Added `"@koa/router": "^15.7.0"` as an explicit direct dependency, matching the exact version `oidc-provider@9.10.0` itself bundles (confirmed via `npm view oidc-provider@9.10.0 dependencies`).
**Verification:** Ran `npm install` inside `apps/e2e/oidc-mock` in isolation — resolved cleanly (49 packages), `node -e "require.resolve('@koa/router')"` succeeded, and `node --check server.mjs` passed. Removed the resulting `node_modules`/`package-lock.json` afterward so the "no lockfile for this isolated fixture" convention documented in the Dockerfile stays intact — only `package.json` is committed.

### WR-02: `resend-rate-limit.spec.ts` deliberately exhausts a bucket shared with concurrently-running sibling specs

**Files modified:** `apps/e2e/tests/auth/resend-rate-limit.spec.ts`
**Commit:** `654bc10`
**Applied fix:** Rather than serializing the spec (which would slow the suite for no benefit if the underlying concern is unfounded), verified the actual behavior by reading the installed `@fastify/rate-limit@11.1.0` source directly (`index.js`): a function-form `allowList` returning `true` causes an immediate `return { isAllowed: true, key }` BEFORE any bucket-counting (`store.incr`) logic runs. Since `apps/api/src/plugins/rateLimit.ts`'s `allowList` is exactly this kind of function (`request.headers["x-e2e-bypass"] === bypassSecret`), bypassed sibling requests are excluded from the shared IP bucket's count entirely — they can neither dilute this spec's own bucket-tripping burst nor get spuriously 429'd once it's tripped. Documented this verified guarantee in a comment on the spec so the fragility concern is resolved with evidence rather than assumption, and flagged what would have to change (`@fastify/rate-limit`'s short-circuit ordering) for the concern to resurface.
**Verification:** `pnpm --filter @kurzly/e2e exec tsc --noEmit` clean (comment-only change, no runtime behavior modified).

### WR-03: E2E compose overlay's rate-limit bypass secret has no required-variable guard

**Files modified:** `docker-compose.e2e.yml`
**Commit:** `b9620f8`
**Applied fix:** Changed `E2E_RATE_LIMIT_BYPASS_SECRET: ${E2E_RATE_LIMIT_BYPASS_SECRET}` to `${E2E_RATE_LIMIT_BYPASS_SECRET:?E2E_RATE_LIMIT_BYPASS_SECRET must be set — run via scripts/e2e-compose.sh}`, exactly as REVIEW.md suggested.
**Verification:** Ran `docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml config` twice: with `E2E_RATE_LIMIT_BYPASS_SECRET` set, it resolved successfully (exit 0); with it unset, Compose failed loudly with `error while interpolating services.app.environment.E2E_RATE_LIMIT_BYPASS_SECRET: required variable E2E_RATE_LIMIT_BYPASS_SECRET is missing a value: E2E_RATE_LIMIT_BYPASS_SECRET must be set — run via scripts/e2e-compose.sh` (exit 1) — confirms the guard fires exactly as intended.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-07-25T01:22:30Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
