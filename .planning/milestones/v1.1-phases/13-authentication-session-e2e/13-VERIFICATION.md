---
phase: 13-authentication-session-e2e
verified: 2026-07-25T02:00:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 13: Authentication & Session E2E Verification Report

**Phase Goal:** Prove both login paths (magic-link primary, OIDC/SSO optional) and the full session lifecycle work end-to-end, unlocking every dashboard-authenticated suite that follows.
**Verified:** 2026-07-25T02:00:00Z
**Status:** passed
**Re-verification:** No — initial verification (incorporating a live re-run performed earlier this session, see Behavioral Spot-Checks)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Mock OIDC IdP (`oidc-provider@9.10.0` wrapped in a Koa server) boots as its own compose service and is reachable both from the `app` container (internal Docker network) and the host browser (discovery-document dual-reachability rewrite). | ✓ VERIFIED | `apps/e2e/oidc-mock/server.mjs` (189 lines), `docker-compose.e2e.yml` lines 27-48, 57 — `OIDC_MOCK_INTERNAL_URL`/`OIDC_MOCK_ISSUER`/redirect URI wiring present; live-booted this session (10/10 auth tests passed, includes 3 SSO tests that require the mock IdP to actually serve discovery/token/userinfo). |
| 2 | Magic-link round trip passes end-to-end (request → Mailpit → open link → active session), and a consumed/expired/malformed token is rejected with no session created. [AUTH-E2E-01, AUTH-E2E-02] | ✓ VERIFIED | `apps/e2e/tests/auth/magic-link-round-trip.spec.ts` (1 test) + `magic-link-token-rejection.spec.ts` (`test.describe.serial`, 3 tests: consumed-reuse, DB-expired, malformed/tampered) — live-passing this session. |
| 3 | A non-invited email address never receives a session — zero Mailpit message, zero session, through the real `sendMagicLink` D-01 neutral-response path. [AUTH-E2E-03] | ✓ VERIFIED | `apps/e2e/tests/auth/invite-only-denial.spec.ts` (1 test), matches `auth.ts`'s documented `isEmailAllowed` gate inside `sendMagicLink` (fire-and-forget email only after the allowlist check) — live-passing. |
| 4 | OIDC/SSO round trip against the mock IdP provisions a first-time user least-privilege (`accountRole: "member"`, zero `DomainMembership` rows), even when the IdP feeds admin-shaped claims (`role: "admin"`, `groups`, `admin: true`). [AUTH-E2E-04] | ✓ VERIFIED | `apps/e2e/tests/auth/sso.spec.ts` lines 46-97 — asserts server-verified session via `/api/auth/get-session` AND direct Prisma read of `accountRole`/`domainMembership`; `auth.ts` has no `mapProfileToUser`, `accountRole` is `input: false` — live-passing. |
| 5 | An admin-invited-but-not-yet-activated magic-link account that first signs in via SSO merges into ONE account, not a duplicate. [AUTH-E2E-05] | ✓ VERIFIED | `apps/e2e/tests/auth/sso.spec.ts` lines 115-160 (TDD RED→GREEN, `13-08-PLAN.md`) — requires `auth.ts`'s `account.accountLinking.requireLocalEmailVerified: false` (confirmed present, lines 200-205) — live-passing. |
| 6 | Logout ends the session; unauthenticated access to dashboard routes redirects to `/login`. [AUTH-E2E-06] | ✓ VERIFIED | `apps/e2e/tests/auth/logout-route-guard.spec.ts` (1 test, `test.describe`) — live-passing. |
| 7 | A magic-link resend that trips the REAL (non-bypassed) rate limit surfaces the exact German UI copy rather than failing silently. [AUTH-E2E-07] | ✓ VERIFIED | `apps/e2e/tests/auth/resend-rate-limit.spec.ts` — asserts `.error-inline` text equals `"Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst."`; string confirmed present verbatim in `apps/web/src/views/LoginView.vue:102` — live-passing. |
| 8 | CR-01 gap (SSO merge silently depending on the IdP's own `email_verified` claim, previously untested) is closed: the merge is correctly REJECTED when the IdP's claim is `false` or omitted — not weakened by adding `trustedProviders`. | ✓ VERIFIED | `apps/api/src/lib/auth.ts` header comment + inline config comment (lines 96-133, 192-199) confirm `trustedProviders` deliberately left unset; `apps/api/test/sso-auth.integration.test.ts` parameterized case; `apps/e2e/tests/auth/sso.spec.ts` lines 163-226 (CR-01 test) — live-passing (part of the 10/10 auth suite run). |

**Score:** 8/8 truths verified (0 present-but-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/e2e/oidc-mock/server.mjs` + `Dockerfile` | Mock IdP service | ✓ VERIFIED | 189 lines, wraps `oidc-provider@9.10.0`; `@koa/router` now an explicit direct dependency (WR-01 fixed). |
| `apps/e2e/src/oidc-mock.ts` | Test-control client (`setOidcProfile`/`resetOidcProfile`) | ✓ VERIFIED | 78 lines, imported by `sso.spec.ts`. |
| `apps/e2e/src/users.ts` | Prisma helper for invited-unverified `User` fixtures | ✓ VERIFIED | 90 lines, `createInvitedUnverifiedUser` used by AUTH-E2E-05/CR-01 tests. |
| `docker-compose.e2e.yml` OIDC wiring | `oidc-mock` service + env vars on `app` | ✓ VERIFIED | Lines 27-48 (internal/public discovery split), 57 (service def), 106-108 (app env); `E2E_RATE_LIMIT_BYPASS_SECRET` now has a required-variable guard (WR-03 fixed). |
| `apps/e2e/tests/auth/*.spec.ts` (6 files) | AUTH-E2E-01..07 coverage | ✓ VERIFIED | 10 tests total across 6 files, matches the live "10/10 passed" result exactly (1+3+1+1+1+3). |
| `apps/e2e/playwright.config.ts` `auth` project | Standalone, no `dependencies: ["setup"]` | ✓ VERIFIED | Lines 55-72 — confirmed no `dependencies` key, matching CONTEXT.md's discretion note that these specs prove login itself. |
| `apps/api/src/lib/auth.ts` (`account.accountLinking`) | CR-01-safe merge fix | ✓ VERIFIED | `requireLocalEmailVerified: false` present; `trustedProviders` deliberately absent (not `[SSO_PROVIDER_ID]`) — read the live source directly, matches REVIEW-FIX.md's narrative exactly, not just trusted from the summary. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `readSsoConfig()` (all-three-or-none) | `createAuth()`'s `plugins` array | conditional `genericOAuth` push | WIRED | `auth.ts` lines 182, 302-332 — magic-link-only install has `plugins: [magicLink()]` unchanged. |
| `genericOAuth` config | `scopes: ["openid","email","profile"]` | authorization request | WIRED | `auth.ts` line 327 — fixes the empty-scope `access_denied` bug found live in 13-07; comment documents the exact discovery process. |
| `account.accountLinking.requireLocalEmailVerified: false` | `handleOAuthUserInfo` (better-auth internal) | invited-row merge | WIRED | Confirmed against installed `better-auth@1.6.23` source per the header comment's reproduced conditional; `trustedProviders` left at safe `[]` default so the IdP's own `email_verified` claim remains an independent, untouched gate. |
| Mock IdP `DEFAULT_PROFILE.emailVerified` / `setOidcProfile({emailVerified:false})` | `sso.spec.ts`'s AUTH-E2E-05 vs. CR-01 tests | `userInfo.emailVerified` claim | WIRED | AUTH-E2E-05 test relies on the mock's default `true`; CR-01 test explicitly overrides to `false` and asserts rejection — both paths now covered, closing the gap REVIEW.md originally found. |
| `MAGIC_LINK_RATE_LIMIT` (Fastify, IP-keyed) | `resend-rate-limit.spec.ts`'s 6-request burst | `POST /api/auth/sign-in/magic-link` | WIRED | Verified WR-02's fix reasoning against installed `@fastify/rate-limit@11.1.0` source (documented in-file); bypass-header siblings excluded from the shared bucket count before any counting occurs. |
| `LoginView.vue`'s 429 branch | `.error-inline` element text | exact German string | WIRED | String match confirmed byte-for-byte between `LoginView.vue:102` and the E2E assertion. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUTH-E2E-01 | 13-03 | Magic-link round trip | ✓ SATISFIED | `magic-link-round-trip.spec.ts` live-passing. |
| AUTH-E2E-02 | 13-03 | Consumed/expired/malformed token rejection | ✓ SATISFIED | `magic-link-token-rejection.spec.ts` (3 tests) live-passing. |
| AUTH-E2E-03 | 13-04 | Non-invited email denial | ✓ SATISFIED | `invite-only-denial.spec.ts` live-passing. |
| AUTH-E2E-04 | 13-07 | OIDC/SSO round trip, least-privilege | ✓ SATISFIED | `sso.spec.ts` (AUTH-E2E-04 test) live-passing. |
| AUTH-E2E-05 | 13-08 | SSO-after-invite account merge | ✓ SATISFIED | `sso.spec.ts` (AUTH-E2E-05 + CR-01 tests) live-passing, includes the code-review-driven hardening. |
| AUTH-E2E-06 | 13-05 | Logout + route guard | ✓ SATISFIED | `logout-route-guard.spec.ts` live-passing. |
| AUTH-E2E-07 | 13-06 | Rate-limited resend UI copy | ✓ SATISFIED | `resend-rate-limit.spec.ts` live-passing. |

No orphaned requirements — all 7 AUTH-E2E-* IDs declared in `REQUIREMENTS.md` (lines 21-27, 97-103) are marked Complete and each maps to exactly one live-passing spec file, with the 8th (CR-01) test being additional hardening coverage discovered during code review, not a new requirement.

### Anti-Patterns Found

None. Scanned all phase-touched files (`apps/api/src/lib/auth.ts`, all 6 `apps/e2e/tests/auth/*.spec.ts`, `apps/e2e/src/oidc-mock.ts`, `apps/e2e/src/users.ts`, `apps/e2e/oidc-mock/server.mjs`, `apps/api/src/lib/ssoConfig.ts`) for `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` — zero matches.

One stale-but-harmless doc comment: `apps/e2e/tests/auth/sso.spec.ts` (lines 172-177, the CR-01 test's docblock) states the test "has NOT been run against a live docker compose stack in this session" — this was true when the REVIEW-FIX pass wrote it, but this verification session's live re-run (see below) has since executed it successfully as part of the 10/10 pass. Non-blocking (the claim in the comment is now outdated, not the code), but worth a follow-up comment update the next time this file is touched.

### Code Review Findings (13-REVIEW.md / 13-REVIEW-FIX.md)

1 Critical (CR-01), 3 Warnings (WR-01, WR-02, WR-03). All 4 fixed in one iteration (commits `bdf2ab4`, `e15bd22`, `654bc10`, `b9620f8`) and independently confirmed present in the current source during this verification:
- CR-01: `auth.ts`'s `account.accountLinking` still has `requireLocalEmailVerified: false` with `trustedProviders` deliberately unset (read directly, not inferred) — the header comment fully documents the two-gate model; new Vitest parameterized case + new Playwright CR-01 test both exist and both pass.
- WR-01: `apps/e2e/oidc-mock/package.json` now lists `@koa/router` as a direct dependency.
- WR-02: `resend-rate-limit.spec.ts` carries a verified, evidence-backed comment (not just an assumption) about the bypass header's bucket-exclusion behavior.
- WR-03: `docker-compose.e2e.yml`'s `E2E_RATE_LIMIT_BYPASS_SECRET` now uses the `:?` required-variable guard.

### Behavioral Spot-Checks / Live Verification (This Session)

A full live re-verification was independently performed earlier in this session (documented in the task's known-facts and re-confirmed here by inspecting the resulting source/test state rather than re-running the stack a second time): rebuilt the Docker image, booted the full compose stack under project name `kurzly-e2e-verify` (db/mailpit ports remapped, app port untouched since no Phase 13 spec uses `--host-resolver-rules`), and ran:

| Suite | Command | Result | Status |
|-------|---------|--------|--------|
| Full `tests/auth/` suite | `pnpm --filter @kurzly/e2e test tests/auth/` (default 6 workers) | 10/10 passed | ✓ PASS |
| Full `tests/auth/` suite, repeat | same, `--workers=1` (after one incidental app-container restart to clear stale rate-limit state from the prior run) | 10/10 passed | ✓ PASS |

This covers AUTH-E2E-01 through AUTH-E2E-07 and the CR-01 hardening test. Teardown was completed cleanly (containers/volumes/images removed, `.env` deleted, `git status` clean). This verification pass independently confirmed the source-level traceability from each requirement to its exact spec file and line range, and read `auth.ts` end-to-end directly rather than trusting the SUMMARY/REVIEW-FIX narrative — the file's actual `account.accountLinking` config and comment match the fix report exactly.

### Human Verification Required

None. All must-haves have live-executed evidence (10/10 twice, at two parallelism levels) plus independently-read source confirming the code genuinely implements what's claimed.

### Gaps Summary

No gaps. All 7 AUTH-E2E-* requirements plus the CR-01 hardening are satisfied with live-passing E2E evidence and source-level confirmation. One cosmetic doc-comment staleness noted above (non-blocking, does not affect behavior or test validity).

---

_Verified: 2026-07-25T02:00:00Z_
_Verifier: Claude (gsd-verifier)_
