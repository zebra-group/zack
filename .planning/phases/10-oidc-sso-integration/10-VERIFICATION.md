---
phase: 10-oidc-sso-integration
verified: 2026-07-23T21:16:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 10: OIDC/SSO Integration Verification Report

**Phase Goal:** Admins can optionally enable OIDC/SSO login, purely additive on top of magic-link auth, with new SSO-provisioned users safely defaulting to the least-privileged role.
**Verified:** 2026-07-23T21:16:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin enables OIDC/SSO by entering an Issuer URL, Client ID, and Client Secret | ✓ VERIFIED | Delivered via ENV per documented decision D-10-02 (`10-CONTEXT.md`). `apps/api/src/env.ts` registers `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` as optional, all-three-or-none (lines 108-115, 182-200). `apps/api/src/lib/ssoConfig.ts#readSsoConfig()` is the single reader both `auth.ts` and `routes/sso.ts` consume. `.env.example:102-113` documents the block + callback URL. `TeamView.vue`'s OIDC card is confirmed as a read-only status+guidance surface (not a live form) — matches the ratified deviation exactly. |
| 2 | A user signs in through the configured OIDC provider once SSO is active, while magic-link login keeps working unchanged | ✓ VERIFIED | `apps/api/src/lib/auth.ts` conditionally pushes `genericOAuth` onto `plugins` only when `readSsoConfig()` is non-null (lines 89-186); magic-link stays first/unchanged. `apps/api/test/sso-auth.integration.test.ts` drives the REAL `POST /api/auth/sign-in/oauth2` → `GET /api/auth/oauth2/callback/oidc` round trip against a hermetic in-process `node:http` OIDC stub (never a live IdP, never a hand-rolled DB insert) and separately proves (a) the endpoint is 404 when unset and (b) the magic-link request→verify→get-session round trip succeeds both when SSO is unset AND while SSO is active (coexistence). Frontend: `LoginView.vue` conditionally renders "Mit SSO anmelden" only when `GET /api/sso/status` reports `enabled:true` (fail-closed on fetch failure — `ssoEnabled` ref defaults `false`), and `signInWithSso()` POSTs the real `/api/auth/sign-in/oauth2` and navigates to the returned authorize URL — not a placeholder toast. Ran target test files: 540/540 API tests pass, 256/256 web tests pass, `pnpm -r exec tsc --noEmit` clean. |
| 3 | A user newly created via SSO automatically receives the "Member" role with zero domain assignments — verified by an automated test — never inheriting Admin by default | ✓ VERIFIED | `apps/api/test/sso-auth.integration.test.ts` "AUTH-07" and "AUTH-07 no-claim-elevation" tests drive the real `genericOAuth` callback (`ssoSignInAndCallback()`, app.inject through better-auth's own `oauth2/link-account.mjs#handleOAuthUserInfo` provisioning code) and assert `prisma.user.findUnique({email}).accountRole === "member"` with `prisma.domainMembership.findMany({userId}).length === 0` — even when the stub IdP's userinfo response carries `role: "admin"`, `groups: [...]`, `admin: true`. `auth.ts` has no `mapProfileToUser`; `additionalFields.accountRole` stays `input:false`. Both tests pass (confirmed via test run). |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/lib/ssoConfig.ts` | Single source of truth: readSsoConfig/ssoDiscoveryUrl/ssoCallbackPath/maskClientId/SSO_PROVIDER_ID | ✓ VERIFIED | Present, all five exports confirmed by direct read; callback path derives the verified real better-auth shape `{BASE_URL}/api/auth/oauth2/callback/oidc`, never the prototype `/api/auth/callback/oidc` guess. |
| `apps/api/src/env.ts` | Optional OIDC vars + all-three-or-none guard + CR-01 empty-string normalization | ✓ VERIFIED | Lines 108-116 (schema), 149-200 (`OPTIONAL_ENV_KEYS` normalization + guard). `parseEnv({...VALID, OIDC_*: ""})` now succeeds with SSO off (CR-01 fix confirmed in code, not just claimed). |
| `apps/api/src/lib/auth.ts` | Conditional genericOAuth registration, no mapProfileToUser | ✓ VERIFIED | Lines 89-186; `sso ? [genericOAuth(...)] : []` spread; no `mapProfileToUser`; WR-01 ratification comment present (lines 156-170). |
| `apps/api/src/routes/sso.ts` | Read-only `GET /api/sso/status`, no secret field | ✓ VERIFIED | Confirmed: handler never reads `sso.clientSecret`; `SsoStatusDTO` has no secret field structurally (`packages/shared/src/index.ts:489-494`). |
| `apps/api/src/app.ts` | ssoRoute registered before healthRoute/redirect/static | ✓ VERIFIED | Line 201, immediately after `teamRoute` (line 195) and before `healthRoute` (line 202)/`redirectRoute`/`registerStatic`. |
| `apps/web/src/views/TeamView.vue` | Authentifizierung section, two cards, read-only OIDC status | ✓ VERIFIED | `.magic-link-card` + `.oidc-card` present, positioned between `.team-table` and `.role-model-card` (test asserts DOM order); enabled/disabled/null-fallback branches present; no input/toggle elements. |
| `apps/web/src/views/LoginView.vue` | Conditional "Mit SSO anmelden", fail-closed, real OAuth initiation, errorCallbackURL | ✓ VERIFIED | `ssoEnabled` fail-closed ref; WR-02 fix (`errorCallbackURL: "/auth/error"`) present in the POST body; IN-02 fix (`getSsoStatus()` typed client) present, replacing the earlier hand-rolled fetch. |
| `apps/api/test/sso-auth.integration.test.ts` | Real callback-driven AUTH-06/AUTH-07 proofs | ✓ VERIFIED | Confirmed the test drives `app.inject` through the actual better-auth endpoints, hermetic `node:http` stub IdP, never a hand-rolled `prisma.user.create`. |
| `apps/api/test/sso-status.integration.test.ts` | Enabled/disabled/secret-excluded shapes | ✓ VERIFIED | Present per SUMMARY and passing in the full-suite run. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `env.ts` OIDC vars | `readSsoConfig()` | direct `process.env` read, all-three-or-none | ✓ WIRED | `ssoConfig.ts:37-47` reads the same three keys `env.ts` validates. |
| `readSsoConfig()` | `auth.ts` conditional plugin registration | `const sso = readSsoConfig(); ...(sso ? [genericOAuth(...)] : [])` | ✓ WIRED | `auth.ts:95, 171-184`. |
| `readSsoConfig()`/`ssoCallbackPath()`/`maskClientId()` | `routes/sso.ts` GET /api/sso/status | direct import from `lib/ssoConfig.js` | ✓ WIRED | `routes/sso.ts:31,36-51` — same module as `auth.ts`, no drift possible (T-10-CONFIG-DRIFT). |
| `GET /api/sso/status` | `TeamView.vue` ssoStatus ref | `getSsoStatus()` in `api.ts`, called on mount | ✓ WIRED | `TeamView.vue:264-270`. |
| `GET /api/sso/status` | `LoginView.vue` ssoEnabled ref | `getSsoStatus()` (post-IN-02 fix), called `onMounted` | ✓ WIRED | `LoginView.vue:12,33-49`. |
| LoginView "Mit SSO anmelden" click | `POST /api/auth/sign-in/oauth2` → `window.location.assign` | direct fetch + navigation | ✓ WIRED | `LoginView.vue:51-77`, includes `errorCallbackURL` (WR-02 fix). |
| `SSO_PROVIDER_ID` ("oidc") | genericOAuth registration AND callback-path derivation | shared constant from `ssoConfig.ts` | ✓ WIRED | Both `auth.ts` and `ssoConfig.ts#ssoCallbackPath` use the same constant. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUTH-05 | 10-01, 10-03, 10-04 | Admin enables OIDC/SSO by providing Issuer URL, Client ID, Client Secret | ✓ SATISFIED | ENV substrate + status route + TeamView status card, all verified above (per ratified D-10-02 deviation). |
| AUTH-06 | 10-02, 10-04, 10-05 | User signs in through configured OIDC provider; magic-link keeps working unchanged | ✓ SATISFIED | Conditional genericOAuth registration + structural/coexistence tests + LoginView SSO affordance, all verified above. |
| AUTH-07 | 10-02 | SSO-provisioned users default to least-privileged role | ✓ SATISFIED | `sso-auth.integration.test.ts` AUTH-07 + no-claim-elevation tests, verified above driving the real provisioning path. |

No orphaned requirements found — REQUIREMENTS.md maps exactly AUTH-05/06/07 to Phase 10 and all three are claimed by plans 10-01/10-02/10-03/10-04/10-05. (Note: REQUIREMENTS.md checkbox/table rows for AUTH-05/06/07 still show unchecked/"Pending" — this is a tracking-doc update that normally happens at ship time, not a code gap; flagged for the orchestrator to update post-verification.)

### Anti-Patterns Found

None. Scanned all phase-modified source files (`env.ts`, `ssoConfig.ts`, `auth.ts`, `routes/sso.ts`, `app.ts`, `packages/shared/src/index.ts`, `api.ts`, `TeamView.vue`, `LoginView.vue`, `router/index.ts`, `.env.example`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — zero blocker-shaped matches (all "placeholder" hits are benign doc comments or the email input's `placeholder` HTML attribute).

### Code Review Follow-up (10-REVIEW.md / 10-REVIEW-FIX.md)

- **CR-01 (blocker, empty-string OIDC vars bricking boot):** Fixed and verified in code — `env.ts`'s `OPTIONAL_ENV_KEYS` normalization (lines 149-176) deletes empty/whitespace-only optional keys before Zod validation, confirmed by direct read.
- **WR-01 (SSO self-provisioning bypasses invite-only allowlist):** Ratified as intentional/required by AUTH-07 — not a defect. Clarifying comment present in `auth.ts:156-170`. This finding is explicitly called out as expected in the verification brief and not treated as a gap.
- **WR-02 (missing errorCallbackURL on OAuth initiation):** Fixed and verified in code — `LoginView.vue:62-66` sends `errorCallbackURL: "/auth/error"`.
- IN-01/IN-03/IN-04 (info-level): explicitly skipped/accepted per 10-REVIEW-FIX.md, proportionate for INFO severity — not gaps.

### Test Execution

- `pnpm --filter @kurzly/api test` (full suite, run once): **44 files, 540 tests passed** — includes `sso-config.test.ts`, `sso-auth.integration.test.ts`, `sso-status.integration.test.ts`, `env.test.ts`, `env-example-drift.test.ts`.
- `pnpm --filter @kurzly/web test` (full suite, run once): **21 files, 256 tests passed** — includes `TeamView.test.ts`, `router/guard.test.ts`, `LoginView.test.ts`.
- `pnpm -r exec tsc --noEmit`: clean, no output.

### Secret-Never-Crosses Verification

- `SsoStatusDTO` (`packages/shared/src/index.ts:489-494`) has exactly `{ enabled, issuer, clientIdMasked, callbackPath }` — no secret field, structurally a compile error to add one without updating this file.
- `routes/sso.ts` handler reads only `sso.issuer` and `maskClientId(sso.clientId)` — `sso.clientSecret` is never referenced.
- `sso-status.integration.test.ts` (per SUMMARY, confirmed passing) asserts the raw response body never contains a sentinel secret value.

### Human Verification Required

None. All must-haves resolved to VERIFIED via direct code inspection, targeted test file reads, and executed test runs (not SUMMARY claims alone). The two `human_judgment: true` items noted in 10-04/10-05 SUMMARY.md (pixel-fidelity of the new cards against the locked UI-SPEC) are cosmetic-fidelity items already covered by the phase's dedicated `gsd-ui-checker` pass noted in the observation log ("Phase 10 UI-SPEC approved across all 6 quality dimensions") — not re-litigated here as they fall outside goal-backward functional verification.

### Gaps Summary

No gaps found. All three ROADMAP success criteria are observably true in the codebase: (1) OIDC is admin-configurable via ENV per the explicitly ratified D-10-02 deviation, with a correct read-only status surface; (2) a real OIDC sign-in round trip is proven end-to-end against a hermetic stub IdP through better-auth's actual endpoints, and magic-link is proven unchanged both before and during SSO activation; (3) SSO-provisioned users are proven, via the real provisioning code path, to always land on `accountRole=member` with zero DomainMemberships, even against adversarial admin-shaped IdP claims. The one code-review blocker (CR-01) has a verified fix in the codebase, not just a SUMMARY claim.

---

_Verified: 2026-07-23T21:16:00Z_
_Verifier: Claude (gsd-verifier)_
