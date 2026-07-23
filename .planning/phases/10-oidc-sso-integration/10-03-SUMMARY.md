# 10-03 SUMMARY — Read-only GET /api/sso/status endpoint

**Plan:** 10-03
**Requirements:** AUTH-05
**Status:** complete
**Completed:** 2026-07-23 (finished after a mid-execution WSL `/mnt/c` filesystem fault; the RED commit had landed before the fault, the GREEN change survived on disk uncommitted and was verified + committed on recovery — see the recovery note below).

## What shipped

- `apps/api/src/routes/sso.ts` (new) — `ssoRoute()` Fastify-plugin factory serving `GET /api/sso/status`, returning the `SsoStatusDTO` from `@kurzly/shared`: `{ enabled, issuer, clientIdMasked, callbackPath }`. Derives everything through `lib/ssoConfig.ts`'s `readSsoConfig()` / `maskClientId()` / `ssoCallbackPath()` — the SAME module `createAuth` (10-02) reads, so the returned callback path can never drift from the one better-auth actually registered.
- `apps/api/src/app.ts` — registers `ssoRoute()` directly on `app`, immediately after `teamRoute` and BEFORE `healthRoute`/`redirectRoute`/`registerStatic` (Pitfall 5), so `/api/sso` is never shadowed by the `/:slug` redirect or the SPA fallback.

## Security properties (D-10-02, D-10-06)

- **No credential-entry endpoint.** Read-only GET only — no POST/PUT/PATCH accepting issuer/client-id/client-secret from the browser. OIDC config stays ENV-only (T-10-NO-CRED-FORM).
- **Secret never crosses the boundary.** The handler never reads or returns `OIDC_CLIENT_SECRET` in any branch; `SsoStatusDTO` structurally has no secret field (T-10-SECRET-LEAK). The client id is masked, never raw.
- **Anonymous by design (documented).** No session is read or required: the login screen (10-05) needs the `enabled` flag before the caller is authenticated, and `issuer`/`clientIdMasked`/`callbackPath` are non-secret OAuth-public values, so gating them behind a session would add complexity without closing any real disclosure gap (T-10-STATUS-ANON).

## Tests

`apps/api/test/sso-status.integration.test.ts` — 4 cases: disabled-shape, enabled-shape with the real callback path, secret-exclusion (asserts the response body has no secret and the client id is masked), and read-only (POST → 404). All green.

## Verification

- Target file: `sso-status.integration.test.ts` → 4/4 pass.
- Full `@kurzly/api` suite: 44 files / 535 tests pass (no regression).
- `pnpm -r exec tsc --noEmit`: clean across api/web/shared.
- No schema change (D-10-05 holds — status is derived, not stored).

## Recovery note (WSL filesystem fault)

The `/mnt/c` 9p/drvfs mount wedged (`Input/output error`) mid-execution, right after the RED commit `test(10-03): failing SSO-status enabled/disabled + secret-excluded shapes` (`06fcf2e`) landed. The GREEN `sso.ts`/`app.ts` edits were already written to disk and had passed the target test + `tsc` before the fault, but were not yet committed. After an operator `wsl --shutdown` restored the mount, the uncommitted files were confirmed intact, re-verified (4/4 target + 535/535 suite + clean tsc), and committed as `feat(10-03): add read-only GET /api/sso/status endpoint` (`2b2b7cd`). No work was lost or redone.
