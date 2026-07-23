---
phase: 10-oidc-sso-integration
reviewed: 2026-07-23T18:50:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - apps/api/src/env.ts
  - apps/api/src/lib/ssoConfig.ts
  - apps/api/src/lib/auth.ts
  - apps/api/src/routes/sso.ts
  - apps/api/src/app.ts
  - packages/shared/src/index.ts
  - .env.example
  - apps/web/src/api.ts
  - apps/web/src/views/TeamView.vue
  - apps/web/src/views/LoginView.vue
  - apps/web/src/router/index.ts
  - apps/api/test/sso-config.test.ts
  - apps/api/test/sso-auth.integration.test.ts
  - apps/api/test/sso-status.integration.test.ts
  - apps/api/test/env.test.ts
  - apps/web/test/LoginView.test.ts
  - apps/web/src/views/TeamView.test.ts
findings:
  critical: 1
  warning: 2
  info: 4
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-23T18:50:00Z
**Depth:** standard
**Files Reviewed:** 14 source + tests
**Status:** issues_found

## Summary

Phase 10 adds an optional OIDC/SSO path (`genericOAuth`), a read-only
`GET /api/sso/status` surface, and the corresponding admin/login UI. I
reviewed the security-sensitive axes hardest.

**What holds up under adversarial review (verified, not just asserted):**

- **Secret handling is structurally sound.** `SsoStatusDTO` has no secret
  field; `routes/sso.ts` reads only `sso.issuer` and `maskClientId(sso.clientId)`,
  never `sso.clientSecret`. No `console.*`/`request.log`/`app.log` of the
  config object anywhere (grep-confirmed). The integration test asserts the
  raw payload never contains the secret sentinel and the key set is exactly
  `{enabled, issuer, clientIdMasked, callbackPath}`.
- **No claim-to-privilege elevation (D-10-04 / AUTH-07).** `auth.ts` has no
  `mapProfileToUser`; `accountRole` is `input:false`. The adversarial test
  drives the *real* better-auth callback path with `role/groups/admin`
  claims and confirms the user lands on `member` with zero DomainMemberships.
- **Callback path has a single source of truth (D-10-06).** No production
  code hardcodes the prototype `/api/auth/callback/oidc`; the only matches are
  the explanatory comment and tests. The real `{BASE_URL}/api/auth/oauth2/callback/oidc`
  is surfaced via `ssoCallbackPath()`, consumed by both the status route and
  the tests, and the live 302 round-trip proves it matches what better-auth
  registered.
- **Conditional registration (D-10-03 / AUTH-06).** `genericOAuth` is pushed
  only when `readSsoConfig()` is non-null; a test proves `/sign-in/oauth2` is
  404 when unset, and a second test proves magic-link still round-trips *with*
  SSO enabled.
- **Fail-closed login affordance.** `ssoEnabled` starts `false` and flips only
  on `data?.enabled === true`; both the throw path and the not-ok path leave it
  false with no error shown (tests cover both).

The issues below are the gaps that survived that pass.

## Critical Issues

### CR-01: Copying `.env.example` verbatim (its own documented workflow) bricks the entire boot — the "empty = SSO off" contract is false

**File:** `.env.example:100-113`, `apps/api/src/env.ts:113-115`

**Issue:** `.env.example` line 3 instructs "Copy this file to `.env` and fill
in real values", and the OIDC block explicitly promises: *"Leaving ALL THREE
empty disables SSO (magic-link keeps working unchanged)."* It ships the three
vars as bare, uncommented empty assignments:

```
OIDC_ISSUER_URL=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
```

`server.ts` runs `import "dotenv/config"` before `loadEnv()`. I confirmed that
`dotenv.parse("OIDC_ISSUER_URL=")` yields `OIDC_ISSUER_URL === ""` (empty
**string**, not `undefined`). But the schema uses `.optional()`, which only
admits `undefined` — an empty string flows into the inner validator:

- `OIDC_ISSUER_URL: z.url().optional()` → `z.url()` rejects `""`
- `OIDC_CLIENT_ID / _SECRET: z.string().min(1).optional()` → reject `""`

I ran the real `parseEnv` against a source with these three empty strings:

```
OIDC-EMPTY success: false
issues2:
  - 'OIDC_ISSUER_URL: Invalid URL'
  - 'OIDC_CLIENT_ID: Too small: expected string to have >=1 characters'
  - 'OIDC_CLIENT_SECRET: Too small: expected string to have >=1 characters'
```

`loadEnv()` therefore `process.exit(1)`s. A self-hosted operator (the entire
target audience) who follows the documented copy-the-template workflow and does
**not** want SSO cannot boot the app *at all* — not just SSO, magic-link too —
and the error ("Invalid URL") points at a var they never intended to set. The
all-three-or-none guard in `parseEnv` never even runs, because the object-level
`safeParse` fails first, so the "clear partial-config error" promised by the
comment is also never produced.

Note this is a *pre-existing* pattern: `GEOIP_DB_PATH=` (line 97) and
`CLICK_RETENTION_DAYS=` (line 100) have the identical latent defect
(`z.string().min(1).optional()` / `z.coerce.number().positive().optional()`
both reject `""`), confirmed in the same run. Phase 10 both extends the pattern
and, uniquely, ships a prominent explicit promise that contradicts it.

**Fix:** Two options — the second also repairs the older vars:

1. Ship the OIDC (and GeoIP/retention) lines commented so a verbatim copy
   leaves them truly unset:
   ```
   # OIDC_ISSUER_URL=
   # OIDC_CLIENT_ID=
   # OIDC_CLIENT_SECRET=
   ```
2. Preferred — normalize empty strings to `undefined` before validation, so
   `KEY=` behaves as absent everywhere (matches `readSsoConfig`'s own `!issuer`
   semantics and the documented contract):
   ```ts
   export function parseEnv(source: NodeJS.ProcessEnv): ParseEnvResult {
     const cleaned: NodeJS.ProcessEnv = {};
     for (const [k, v] of Object.entries(source)) {
       if (v !== "") cleaned[k] = v;
     }
     const result = envSchema.safeParse(cleaned);
     // ...unchanged
   }
   ```
   Add a regression test: `parseEnv({ ...VALID_SOURCE, OIDC_ISSUER_URL: "",
   OIDC_CLIENT_ID: "", OIDC_CLIENT_SECRET: "" })` must succeed with SSO off.

## Warnings

### WR-01: SSO self-provisions any IdP-authenticated user — it bypasses the invite-only allowlist (D-01)

**File:** `apps/api/src/lib/auth.ts:155-168`

**Issue:** Magic-link login is deliberately invite-only: `disableSignUp: true`
plus the in-callback `isEmailAllowed(prisma, email)` gate. The `genericOAuth`
registration has **neither** — no `disableImplicitSignUp`, no allowlist check.
Any user who can authenticate at the configured issuer gets a `User` row
auto-created (as `member`). The AUTH-07 test itself demonstrates this: the email
`sso.new-user@idp.test` is never seeded, invited, or allowlisted, yet
`ssoSignInAndCallback` provisions it successfully (`user` is non-null,
`accountRole === "member"`). The test frames this as least-privilege, but its
success silently proves the admission-control bypass.

This may be the intended trust model (the operator-configured IdP *is* the
gate). But it is a real divergence from the D-01 invite-only invariant that
magic-link enforces carefully, and it is nowhere stated as an accepted decision.
On an install whose IdP is a large directory (e.g. company-wide Azure AD),
enabling SSO silently converts "invite-only" into "anyone in the directory can
self-provision."

**Fix:** Make the decision explicit. Either document in `auth.ts` and the phase
decisions that SSO intentionally delegates admission to the IdP (and confirm the
product owner accepts this), or gate provisioning — e.g. a better-auth
`genericOAuth` hook that rejects/leaves-unprovisioned an email not present in the
same allowlist magic-link consults. Add a test asserting the chosen behavior for
a non-allowlisted IdP user (accept-and-member, or reject) so the contract is
pinned rather than incidental.

### WR-02: `signInWithSso` omits `errorCallbackURL` — reintroduces the exact failure CR-02 fixed for magic-link

**File:** `apps/web/src/views/LoginView.vue:47-63`

**Issue:** The magic-link send (same file, lines 80-84) carries the CR-02 fix:
it sends both `callbackURL` and `errorCallbackURL: "/auth/error"` because,
without the latter, better-auth routes a *failed* verification back to
`callbackURL` ("/"), where the router guard silently bounces to `/login` and the
dedicated no-leak error page is never reached. The OAuth initiation sends only
`{ providerId, callbackURL: "/" }` (asserted verbatim by
`LoginView.test.ts:261`), so an OAuth callback failure (IdP denies, state
mismatch, discovery/token error) falls back to "/" and produces the same silent
bounce CR-02 called out as unacceptable. The backend integration helper already
sends `errorCallbackURL` (`sso-auth.integration.test.ts:224`), so the real UI
diverges from what the tests exercise.

**Fix:**
```ts
body: JSON.stringify({
  providerId: SSO_PROVIDER_ID,
  callbackURL: "/",
  errorCallbackURL: "/auth/error",
}),
```
and update the `LoginView.test.ts` assertion to match.

## Info

### IN-01: `SSO_PROVIDER_ID` is duplicated as a magic string in the frontend

**File:** `apps/web/src/views/LoginView.vue:30`

**Issue:** `const SSO_PROVIDER_ID = "oidc"` re-declares, as a bare literal, the
server-side `ssoConfig.ts` `SSO_PROVIDER_ID`. If the provider id ever changes
server-side, the sign-in POST silently targets a non-existent provider. The
comment acknowledges "both sides must always agree" but relies on manual
discipline across the module boundary.

**Fix:** Export the id from `@kurzly/shared` and import it on both sides so a
single edit updates the frontend, the callback path derivation, and any tests.

### IN-02: `LoginView` bypasses the typed `getSsoStatus()` client

**File:** `apps/web/src/views/LoginView.vue:32-41`

**Issue:** `loadSsoStatus` hand-rolls `fetch("/api/sso/status")` + `.json()`
instead of the `getSsoStatus()` client added in `api.ts` (which `TeamView` uses).
This duplicates the endpoint URL and untyped parsing (`data?.enabled`), so the
two consumers can drift and the DTO type never guards the login read.

**Fix:** Use `getSsoStatus()` and read the typed `.enabled` (still fail-closed in
the `catch`).

### IN-03: `/api/sso/status` discloses issuer + masked client id to anonymous callers

**File:** `apps/api/src/routes/sso.ts:35-53`

**Issue:** The route is intentionally anonymous so the login screen can read
`enabled` pre-auth — reasonable. But it returns `issuer` and `clientIdMasked` to
*every* unauthenticated caller, while the only pre-auth consumer (LoginView)
reads just `enabled`. `issuer`/`client_id` are OAuth-public (they appear in the
authorize redirect), so impact is low, but the endpoint over-discloses relative
to need: it lets an anonymous scanner learn the internal IdP hostname and that
SSO is on, without ever initiating a flow.

**Fix (optional hardening):** Return `{ enabled, callbackPath }` for anonymous
callers and gate `issuer`/`clientIdMasked` behind an authenticated admin session
(TeamView already runs authenticated). Keeps the login affordance working while
narrowing disclosure.

### IN-04: `process.env.BASE_URL as string` type-assertion in the status handler

**File:** `apps/api/src/routes/sso.ts:37`

**Issue:** `ssoCallbackPath(process.env.BASE_URL as string)` would throw a
`TypeError` (→ unhandled 500 on this anonymous route) if `BASE_URL` were unset.
It is env-validated as required (`z.url()`), so this cannot happen on a normal
boot — but the route reads raw `process.env`, not the validated `Env`, so the
assertion hides the assumption rather than enforcing it.

**Fix:** Low priority; if touched, read from the validated env or add an explicit
guard rather than an `as string` cast.

---

_Reviewed: 2026-07-23T18:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
