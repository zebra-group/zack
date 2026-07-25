---
phase: 13-authentication-session-e2e
reviewed: 2026-07-25T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - apps/api/src/lib/auth.ts
  - apps/api/test/sso-auth.integration.test.ts
  - apps/e2e/oidc-mock/package.json
  - apps/e2e/oidc-mock/server.mjs
  - apps/e2e/playwright.config.ts
  - apps/e2e/src/oidc-mock.ts
  - apps/e2e/src/users.ts
  - apps/e2e/tests/auth/invite-only-denial.spec.ts
  - apps/e2e/tests/auth/logout-route-guard.spec.ts
  - apps/e2e/tests/auth/magic-link-round-trip.spec.ts
  - apps/e2e/tests/auth/magic-link-token-rejection.spec.ts
  - apps/e2e/tests/auth/resend-rate-limit.spec.ts
  - apps/e2e/tests/auth/sso.spec.ts
  - docker-compose.e2e.yml
  - scripts/e2e-compose.sh
findings:
  critical: 1
  warning: 3
  info: 0
  total: 4
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-07-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the OIDC/SSO E2E phase with `apps/api/src/lib/auth.ts` under the highest scrutiny as instructed, since it changed real production auth code twice: adding `scopes: ["openid","email","profile"]` to `genericOAuth`, and relaxing `account.accountLinking.requireLocalEmailVerified` to `false`.

Traced every `prisma.user.create`/`upsert` call site in `apps/api/src` (`admin-seed.ts`'s bootstrap upsert, `team.ts`'s admin-gated `inviteMember`) and confirmed `inviteMember` is the *only* code path that creates an unverified (`emailVerified: false`) `User` row, and it is gated behind `isAccountAdmin` in `routes/team.ts`. Magic-link's `disableSignUp: true` blocks any other unverified-row creation via login. So the specific attack this phase's header comment worries about — an attacker pre-creating an unverified `User` row for an email they don't control — is **not reachable** through any code path in this codebase today, matching the comment's claim on that narrow point.

However, tracing the actual `better-auth@1.6.23` source (`oauth2/link-account.mjs`, `plugins/generic-oauth/routes.mjs`) against the installed package in `node_modules` surfaced a real, previously-undocumented gap in the fix itself (CR-01 below): the new `requireLocalEmailVerified: false` override is **not** the only gate on the SSO-merge path — a second, independent condition keyed on the IdP's own `email_verified` claim (which better-auth defaults to `false` when the claim is absent from a userinfo response) still applies and is completely untested by both the new Vitest suite and the new Playwright suite, both of which hardcode `email_verified: true` in their stubs. This means the delivered "SSO-after-invite merge" feature may silently fail to work against real-world IdPs whose userinfo response doesn't assert `email_verified: true` — directly undermining this phase's stated purpose — and the code comment's "closed set" security argument for why the relaxation is safe doesn't account for SSO self-provisioning (AUTH-07) as a second source of unverified rows.

Verified the `scopes` addition does **not** newly leak PII into the `Account`/`User` tables in production: `parseAdditionalUserInputFromProviderProfile` still only persists the fields this codebase's `user.additionalFields` declares (`accountRole`, `input: false`), so broadening the requested scope only changes what fields are transiently available during login processing and what `Account.scope` records, not what lands in `User`. Also confirmed the mock IdP (`apps/e2e/oidc-mock`) and its `PUT`/`DELETE /__test__/profile` control surface are structurally absent from `docker-compose.yml`/`docker-compose.dev.yml` — grepped both files, no `oidc` references exist outside `docker-compose.e2e.yml`.

Three further warnings were found in the E2E infrastructure: an undeclared direct dependency in the mock IdP's `package.json` that currently only works via transitive npm hoisting, a fragile cross-file assumption in the deliberately-rate-limit-tripping Playwright spec, and a silent-degrade risk in the E2E compose overlay's bypass-secret interpolation.

## Critical Issues

### CR-01: SSO-after-invite merge fix is incompletely gated and untested against its own real-world failure mode

**File:** `apps/api/src/lib/auth.ts:141-150`
**Issue:**

The header comment (lines 72-110) and the `account.accountLinking` config added in this phase present `requireLocalEmailVerified: false` as *the* fix that lets an admin-invited-but-unverified `User` merge with a first SSO login. Tracing the installed `better-auth@1.6.23` source shows this is only half the story:

```js
// node_modules/.../better-auth/dist/oauth2/link-account.mjs (handleOAuthUserInfo)
const isTrustedProvider = opts.isTrustedProvider || opts.trustProviderByName !== false
  && c.context.trustedProviders.includes(account.providerId);
const requireLocalEmailVerified = accountLinking?.requireLocalEmailVerified ?? true;
if (!isTrustedProvider && !userInfo.emailVerified
    || requireLocalEmailVerified && !dbUser.user.emailVerified
    || accountLinking?.enabled === false
    || accountLinking?.disableImplicitLinking === true) {
  return { error: "account not linked", data: null };
}
```

`trustedProviders` comes from `options.account?.accountLinking?.trustedProviders`, which `auth.ts`'s config never sets — it defaults to `[]` (`context/helpers.mjs:151-154`). And `generic-oauth/routes.mjs` never passes `isTrustedProvider`/`trustProviderByName` into `handleOAuthUserInfo` either (line 270), so for the `"oidc"` provider `isTrustedProvider` is *always* `false`.

With `requireLocalEmailVerified: false` in place, the whole refusal condition collapses to effectively:

```
refuse if !userInfo.emailVerified || accountLinking.enabled === false || accountLinking.disableImplicitLinking === true
```

i.e. **the merge now depends entirely on the IdP's own `email_verified` claim being `true`** — a condition this phase's fix never mentions and never relaxes. Per `plugins/generic-oauth/routes.mjs:392-419` (`getUserInfo`), when the token response has no `id_token` (the exact code path this phase's own mock IdP and Vitest stub deliberately exercise, per `sso-auth.integration.test.ts`'s own comment at lines 152-157), `emailVerified` is derived as `profile?.email_verified ?? false` — i.e. it defaults to `false` for any real-world IdP whose userinfo response omits the (OIDC-optional) `email_verified` claim.

Both test doubles hardcode this claim to `true` and never exercise the omitted/false case:
- `sso-auth.integration.test.ts:180` — `email_verified: true` hardcoded in the stub's `/userinfo` handler.
- `apps/e2e/oidc-mock/server.mjs`'s `DEFAULT_PROFILE.emailVerified = true`, and `sso.spec.ts`'s AUTH-E2E-05 merge test (lines 115-160) never overrides `emailVerified` in its `setOidcProfile` call, so it silently inherits the default-`true` value.

So the one test (`AUTH-E2E-05` / the matching Vitest case) that is supposed to prove "SSO-after-invite merge works" never actually proves it works against a real IdP that doesn't assert `email_verified: true` — which is a realistic configuration (many IdPs only include `email_verified` when the `email` scope is combined with provider-side "verified email" enforcement, and self-hosted/enterprise IdPs commonly leave emails unverified for directory-synced accounts). Against such an IdP, this exact scenario redirects to `error=account_not_linked` — the identical failure this phase set out to fix — and nothing in the test suite would catch a regression or an unsupported-IdP configuration.

This also weakens the accepted-risk argument in the header comment itself: it states unverified-User-row and "admin-invited-not-yet-activated" are "the SAME closed set today" to justify the relaxation as safe. That framing omits that `genericOAuth`'s own first-time-SSO-signup path (AUTH-07, required by spec, `disableSignUp` unset here) creates *its own* `User` rows with `emailVerified: userInfo.emailVerified` — i.e., an unverified row can *already* originate from SSO self-provisioning too, not just admin-invite, if a real IdP ever reports `email_verified: false` for a genuinely new user. The "closed set" claim needs updating (or the provisioning path needs to force `emailVerified: true` given the IdP is the trust anchor being relied on everywhere else in this same design).

**Fix:** Make the trust relationship this file already asserts ("the IdP is operator-configured, admin-trusted infrastructure") explicit to better-auth itself, rather than leaving the merge conditional on an IdP claim never mentioned in the design rationale:

```ts
account: {
  accountLinking: {
    enabled: true,
    requireLocalEmailVerified: false,
    trustedProviders: [SSO_PROVIDER_ID], // "oidc" — see ssoConfig.ts
  },
},
```

This makes the merge (and first-time provisioning) succeed regardless of the IdP's `email_verified` claim, consistent with the trust model this file already documents, and closes the gap between the stated intent and the actual gate. Additionally, add a Vitest/E2E case that sets the stub/mock IdP's `email_verified: false` (or omits it) for the merge scenario, so a future regression or IdP-compatibility gap is caught rather than silently reintroduced.

## Warnings

### WR-01: Mock OIDC IdP imports an undeclared direct dependency

**File:** `apps/e2e/oidc-mock/package.json:5-7`, `apps/e2e/oidc-mock/server.mjs:64`
**Issue:** `server.mjs` does `import Router from "@koa/router"`, but `package.json`'s `dependencies` only lists `oidc-provider`. This currently resolves at container build time only because `oidc-provider@9.10.0` itself depends on `@koa/router@^15.7.0` and `npm install`'s default flat/hoisted layout happens to place it at the top-level `node_modules` (verified via `npm view oidc-provider@9.10.0 dependencies`). The Dockerfile explicitly notes "No lockfile for this isolated test fixture", so nothing pins this — a future `oidc-provider` patch/minor bump that nests `@koa/router` differently, or drops/renames it, would break `server.mjs` at container start with `ERR_MODULE_NOT_FOUND`, which fails the healthcheck, which (per `docker-compose.e2e.yml`'s `depends_on: oidc-mock: condition: service_healthy`) blocks the `app` service from ever starting — silently breaking the entire E2E suite, not just the SSO specs.
**Fix:** Declare it directly:
```json
"dependencies": {
  "oidc-provider": "9.10.0",
  "@koa/router": "^15.7.0"
}
```

### WR-02: `resend-rate-limit.spec.ts` deliberately exhausts a bucket shared with concurrently-running sibling specs

**File:** `apps/e2e/tests/auth/resend-rate-limit.spec.ts:43-47`, `apps/e2e/playwright.config.ts:23,70-72`
**Issue:** The `auth` Playwright project has no `dependencies` and inherits the top-level `fullyParallel: true`, so this spec — which intentionally fires 6 *unbypassed* requests at the IP-keyed `/api/auth/sign-in/magic-link` limiter to trip it — can run concurrently with every other magic-link-sending spec in the same project (`magic-link-round-trip.spec.ts`, `magic-link-token-rejection.spec.ts`, `invite-only-denial.spec.ts`, `logout-route-guard.spec.ts`), all of which send the `x-e2e-bypass` header and assume the limiter's IP bucket is shared but that the bypass fully exempts their own requests from it. Nothing in the reviewed files confirms whether the Fastify bypass mechanism skips *counting* the request or merely skips *enforcing* the 429 on it — if it's the latter, a concurrent run could make sibling specs spuriously fail with 429s once this spec's 6-request burst lands in the same window, or make this spec's own attempt to trip the bucket non-deterministic depending on scheduling.
**Fix:** Either verify (with a comment or a small assertion) that the bypass header excludes the request from the counter entirely, or isolate this spec from the shared bucket (e.g., run it in its own serialized project, or key the test against a distinguishable header/IP so it can't interact with concurrently-running siblings).

### WR-03: E2E compose overlay's rate-limit bypass secret has no required-variable guard

**File:** `docker-compose.e2e.yml:90`
**Issue:** `E2E_RATE_LIMIT_BYPASS_SECRET: ${E2E_RATE_LIMIT_BYPASS_SECRET}` has no `:?` guard. `scripts/e2e-compose.sh` (the documented canonical entrypoint) always exports a generated value first, but this same file's own header comment (lines 8-10) shows the stack being brought up directly via `docker compose -f ... up -d --wait` — if that's ever run without the wrapper script, Compose silently substitutes an empty string (with only a non-fatal stderr warning), handing the app an empty bypass secret rather than failing the boot.
**Fix:** `E2E_RATE_LIMIT_BYPASS_SECRET: ${E2E_RATE_LIMIT_BYPASS_SECRET:?E2E_RATE_LIMIT_BYPASS_SECRET must be set — run via scripts/e2e-compose.sh}`.

---

_Reviewed: 2026-07-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
