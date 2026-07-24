# Phase 13: Authentication & Session E2E - Research

**Researched:** 2026-07-25
**Domain:** Playwright E2E coverage of better-auth's magic-link + genericOAuth(OIDC/SSO) login paths and session lifecycle, including standing up the first mock OIDC IdP this repo has ever had
**Confidence:** MEDIUM-HIGH for magic-link/session findings (all verified directly against installed source + this repo's own code); MEDIUM for the mock-IdP architecture (the core dual-reachability pattern is cross-checked against community sources, but exact `oidc-provider` 9.10.0 route/feature-flag names are flagged `[ASSUMED]` pending a doc check at implementation time)

## Summary

This phase has one genuinely new piece of infrastructure (a mock OIDC IdP — nothing like it exists in this repo) and one **code-verified defect** that changes the shape of the plan: better-auth's `genericOAuth` account-linking, under this app's current (unconfigured) defaults, will **reject** — not silently merge, not duplicate — the exact SSO-after-invite scenario AUTH-E2E-05 requires. This is not a hypothetical risk; it was traced line-by-line through the installed `better-auth@1.6.23` source. A one-line `account.accountLinking` config addition to `apps/api/src/lib/auth.ts` is required before AUTH-E2E-05 can pass — this is properly a TDD RED→GREEN pair (write the E2E test first, watch it fail against the current default, then add the config), not a pure test-only phase.

The mock IdP itself has a genuine architectural wrinkle CONTEXT.md correctly flagged as needing real research: `OIDC_ISSUER_URL` must be reachable from **two different network vantage points** — the `app` container (server-to-server discovery/token/userinfo fetches) and the host-run Playwright browser (the actual OAuth authorization redirect, which is browser-driven). The recommended solution is a dedicated `oidc-mock` compose service (not an in-process host script — `host.docker.internal`/`host-gateway` is documented as unreliable specifically inside GitHub Actions runners) with a one-route discovery-document rewrite so `authorization_endpoint` alone is advertised as host-reachable while `token_endpoint`/`userinfo_endpoint`/`jwks_uri` stay on the Docker-internal address `app` actually calls.

The remaining three questions (non-invited-email neutral response, rate-limited UI copy, and the Nyquist validation map) all resolved cleanly from direct source reads — no ambiguity, no `[ASSUMED]` tags needed there.

**Primary recommendation:** Add a new `oidc-mock` container (custom ~120-line Node/Koa script wrapping `oidc-provider@9.10.0`) as a 4th piece of `docker-compose.e2e.yml`, fix the `account.accountLinking` gap in `apps/api/src/lib/auth.ts` as a first-class plan task (not an afterthought), and drive AUTH-E2E-07 exactly against the frontend's real German 429 copy already present in `LoginView.vue`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-E2E-01 | Magic-link login round-trip (request → Mailpit → open link → active session) | Phase 11's `auth.setup.ts` already proves the happy path end-to-end; this phase's spec only needs to assert session state explicitly (see Validation Architecture) rather than re-derive the round trip |
| AUTH-E2E-02 | Invalid/expired/consumed magic-link token rejected, no session created | `magicLink({ expiresIn: 900 })` in `auth.ts` — three sub-cases (reuse, expiry, malformed token) mapped in Validation Architecture below; better-auth's own verify endpoint is the code under test, no app change needed |
| AUTH-E2E-03 | Non-invited email never gets a session | `isEmailAllowed`/`sendMagicLink` code-path confirms zero email is ever sent for a non-existent `User` row — see "sendMagicLink Neutral-Response, Confirmed" below |
| AUTH-E2E-04 | OIDC/SSO round-trip against a mock IdP, least-privilege "member" provisioning even against admin-shaped claims | Mock-IdP architecture (below) + `createAuth()`'s existing `input: false` / no-`mapProfileToUser` design (already proven server-side by `sso-auth.integration.test.ts`) — this phase's job is driving the SAME guarantee through a real browser against a real (mock) IdP, not re-proving the claim-blocking logic itself |
| AUTH-E2E-05 | SSO-after-magic-link-invite account merge | **Code-verified gap**: current `createAuth()` has no `account.accountLinking` config, so better-auth's default `requireLocalEmailVerified: true` blocks exactly this scenario (invited User row has `emailVerified: false` until first magic-link login). A code fix is required — see "better-auth Account-Linking, Code-Verified" below |
| AUTH-E2E-06 | Logout ends session; unauthenticated dashboard access redirects to login | `AppShell.vue`'s `handleLogout` (signOut + explicit `/login` push) + `router/index.ts`'s `beforeEach` guard — both read directly, exact assertions in Validation Architecture |
| AUTH-E2E-07 | Magic-link resend rate-limit shows a real UI message, not silent failure | `LoginView.vue`'s literal German copy quoted verbatim below — test asserts this string, not a placeholder |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Magic-link request/verify | API / Backend (better-auth) | Browser (form submit, redirect follow) | better-auth's Fastify-mounted handler owns token issuance/verification; the browser only submits the form and follows the resulting redirect |
| Invite-only allowlist enforcement | API / Backend | — | `isEmailAllowed` lives inside the `sendMagicLink` callback server-side; no client-visible signal distinguishes allowed vs. denied (by design, D-01) |
| OIDC/SSO authorization redirect | Browser | API / Backend (initiates + receives callback) | The browser is physically sent to the IdP's `authorization_endpoint`; `app` only initiates (returns the URL) and receives the callback — this is exactly why the mock IdP needs dual network reachability |
| OIDC/SSO token/userinfo exchange | API / Backend | — | Server-to-server only; the browser never talks to `token_endpoint`/`userinfo_endpoint` directly — this is why those can stay on a Docker-internal-only address |
| Least-privilege provisioning (accountRole, DomainMembership) | API / Backend | Database (schema defaults) | `accountRole`'s `input: false` and the column default are the actual enforcement point; no UI-tier control exists or should exist here |
| Session cookie lifecycle (issue/refresh/revoke) | API / Backend (better-auth) | Browser (httpOnly cookie storage only) | Session is a server-verified artifact (T-02-13); the client-side Pinia store is UX reflection only, never the security boundary |
| Route guarding (redirect to /login) | Frontend Server tier equivalent: Vue Router (client) | API / Backend (independent re-verification) | `router/index.ts`'s guard is UX convenience (T-02-14); every API route independently re-checks the session cookie regardless of what the client-side guard allowed |
| Rate-limit UX (429 message) | Browser (Vue component) | API / Backend (`@fastify/rate-limit` + `MAGIC_LINK_RATE_LIMIT`) | The limiter itself is backend-owned; the German copy asserted by AUTH-E2E-07 is a Vue component concern only |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `oidc-provider` | 9.10.0 [VERIFIED: npm registry — confirmed via `npm view oidc-provider version`, published 2026-07-20] | Standards-compliant OIDC Provider implementation used as the mock IdP for AUTH-E2E-04/05 | Maintained by `panva` (also maintainer of `jose`, `openid-client` — foundational OIDC/JWT ecosystem packages); 562,451 weekly downloads at time of check; the de facto reference implementation used by countless mock-IdP setups. **Note:** the package-legitimacy gate below flags this specific point-release as `SUS` purely because the *exact version* was published only 5 days before this research pass — see Package Legitimacy Audit for the full reasoning on why this is treated as a low-risk false positive, not a reason to avoid the package |
| `koa` | bundled transitively via `oidc-provider`'s own dependency tree (do not add as a separate direct dependency of the mock-IdP package unless the wrapper's own interaction routes need `koa-router`) | HTTP framework `oidc-provider`'s `Provider.callback()` returns as a mountable request handler | `oidc-provider` is Koa-based internally; the mock's own tiny interaction/test-control routes are most simply added as Koa middleware mounted alongside `provider.callback()`, avoiding a second framework in an already-minimal service |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@koa/router` | bundled transitively via `oidc-provider` | Routes the mock IdP's own non-OIDC test-control endpoint (`PUT /__test__/claims`) and the 2 auto-approve interaction routes | Only needed inside the new `apps/e2e/oidc-mock` package's `server.mjs` — never a workspace-wide dependency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `oidc-provider` in-process/containerized mock | Dex (`dexidp/dex`) or Keycloak container | Real IdP fidelity is unnecessary here — better-auth's `genericOAuth` only needs a spec-compliant discovery/token/userinfo contract, which `oidc-provider` gives with far less operational weight (no separate DB, no admin console, seconds not minutes to boot) |
| Dedicated `oidc-mock` compose service (this phase's recommendation) | In-process Node script inside `apps/e2e`'s own host process (Phase 11 STACK.md's original suggestion) | Superseded this pass: the in-process approach needs `host.docker.internal`/`extra_hosts: host-gateway` for the `app` container to reach it, and multiple independent community reports (see Sources) describe this as unreliable specifically inside GitHub Actions Ubuntu runners — the extra container avoids that dependency entirely at the cost of one more Dockerfile |
| Discovery-document rewrite (asymmetric `authorization_endpoint`) | `host.docker.internal` + single symmetric issuer URL | Simpler in principle (no middleware needed) but rests on a documented CI-reliability risk; the rewrite technique keeps the mock 100% inside Docker's own network model (Compose DNS, no host-gateway) |

**Installation:**
```bash
# New standalone (non-pnpm-workspace) package — deliberately NOT added to
# pnpm-workspace.yaml; it is built as its own Docker image at compose-up
# time via a plain `npm install`, decoupled from the monorepo's own
# dependency resolution so a workspace-wide `pnpm install` never needs to
# touch it.
mkdir -p apps/e2e/oidc-mock
cd apps/e2e/oidc-mock && npm init -y && npm install oidc-provider@9.10.0
```

```yaml
# docker-compose.e2e.yml addition (see Architecture Patterns, Pattern 1, for
# the full annotated example)
services:
  oidc-mock:
    build: ./apps/e2e/oidc-mock
    ports:
      - "9000:9000"          # host-reachable — the browser's authorization redirect target
    environment:
      OIDC_MOCK_PORT: "9000"
      OIDC_MOCK_INTERNAL_URL: "http://oidc-mock:9000"   # what `app` fetches discovery/token/userinfo from
      OIDC_MOCK_PUBLIC_URL: "http://localhost:9000"     # what the browser is redirected to
      OIDC_MOCK_CLIENT_ID: "kurzly-e2e-oidc-client"
      OIDC_MOCK_CLIENT_SECRET: "kurzly-e2e-oidc-secret"
      OIDC_MOCK_REDIRECT_URI: "http://localhost:3000/api/auth/oauth2/callback/oidc"

  app:
    environment:
      OIDC_ISSUER_URL: "http://oidc-mock:9000"          # app-container-facing — matches ssoDiscoveryUrl()'s fetch origin
      OIDC_CLIENT_ID: "kurzly-e2e-oidc-client"
      OIDC_CLIENT_SECRET: "kurzly-e2e-oidc-secret"
```

**Version verification:** `npm view oidc-provider version` → `9.10.0`, published 2026-07-20 [VERIFIED: npm registry, checked live this session]. No `postinstall` script [VERIFIED: `npm view oidc-provider scripts.postinstall` returned empty]. Dependencies are all pure JS (`eta`, `koa`, `jose`, `debug`, `jsesc`, `nanoid`, `raw-body`, `@koa/cors`, `quick-lru`, `@koa/router`) — no native compilation step, safe for a minimal `node:24-alpine` Dockerfile.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `oidc-provider` | npm | Package itself long-established (`panva/node-oidc-provider`, a well-known foundational OIDC library — this specific POINT RELEASE published 2026-07-20, ~5 days before this research pass) | 562,451/week | `github.com/panva/node-oidc-provider` | **SUS** (reason returned by the legitimacy gate: "too-new" — this is a recency check on the exact version string, not the package's history) | **Flagged, not removed** — approved for use, but the planner MUST add a `checkpoint:human-verify` task before this dependency is installed, per the package-legitimacy protocol. Rationale for approving despite the SUS verdict: 562K weekly downloads, a real GitHub source repo, and a maintainer (`panva`) who also owns `jose`/`openid-client` are all strong legitimacy signals the "too-new" heuristic doesn't capture — it is checking the *release date of 9.10.0* specifically, not whether `oidc-provider` as a package is new or suspicious. Still tag `[ASSUMED]` at the version-pinning level: confirm no supply-chain incident occurred between this research pass and actual install time |

**Packages removed due to `[SLOP]` verdict:** none
**Packages flagged as suspicious `[SUS]`:** `oidc-provider` — see disposition above; human should re-confirm the version string against npmjs.com immediately before running `npm install` in the new `apps/e2e/oidc-mock` Dockerfile, given the "too-new" trigger.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │   HOST (Playwright test runner + browser) │
                    │                                            │
                    │  APIRequestContext ──┐                     │
                    │  Chromium page  ──────┼──► localhost:3000  │  (app, published)
                    │                       │    localhost:9000  │  (oidc-mock, published — AUTHORIZATION hop only)
                    │                       │    localhost:8025  │  (mailpit REST API)
                    └───────────────────────┼─────────────────────┘
                                             │
   ┌─────────────────────────────────────────┼───────────────────────────────────────┐
   │              docker compose network (kurzly-e2e)                                │
   │                                                                                    │
   │  ┌──────────┐   1. sign-in/oauth2   ┌──────────┐                                   │
   │  │   app    │──────POST────────────►│  (self)  │  better-auth builds authorize URL │
   │  │ (better- │                        └──────────┘  from discovery doc's            │
   │  │  auth)   │   2. fetch discovery                  authorization_endpoint         │
   │  │          │───────────────────────►┌──────────┐  (already the PUBLIC :9000 URL,  │
   │  │          │   http://oidc-mock:9000│ oidc-mock│   see rewrite middleware below)  │
   │  │          │                        │(oidc-     │                                   │
   │  │          │◄──5. token+userinfo────│ provider) │◄─3. browser redirected to        │
   │  │          │   http://oidc-mock:9000│           │   http://localhost:9000/authorize │
   │  │          │                        └──────────┘  (host-published, same container) │
   │  │          │   4. auto-approved interaction (no login form — fixed test subject,   │
   │  │          │      claims toggled via PUT /__test__/claims)                          │
   │  │          │   6. redirect browser to :3000/... with session cookie set             │
   │  └────┬─────┘                                                                        │
   │       │ pg :5432 (internal)                                                          │
   │  ┌────┴─────┐          ┌──────────┐                                                  │
   │  │    db    │          │ mailpit  │                                                  │
   │  └──────────┘          └──────────┘                                                  │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/e2e/
├── oidc-mock/                      # NEW — standalone (not pnpm-workspace-member) mock IdP
│   ├── Dockerfile                  # FROM node:24-alpine; npm install oidc-provider; CMD node server.mjs
│   ├── package.json                # { "dependencies": { "oidc-provider": "9.10.0" } }
│   └── server.mjs                  # Provider config + discovery rewrite + 2 interaction routes + 1 test-control route
├── src/
│   └── oidc-mock.ts                # NEW — thin fetch wrapper: setClaims(role/groups/admin), resetClaims()
└── tests/
    └── auth/                       # NEW — this phase's 7 specs, standalone (no `dependencies: ["setup"]`)
        ├── magic-link-round-trip.spec.ts    # AUTH-E2E-01
        ├── magic-link-token-rejection.spec.ts # AUTH-E2E-02
        ├── invite-only-denial.spec.ts        # AUTH-E2E-03
        ├── sso-login.spec.ts                 # AUTH-E2E-04
        ├── sso-account-merge.spec.ts          # AUTH-E2E-05
        ├── logout-route-guard.spec.ts         # AUTH-E2E-06
        └── resend-rate-limit.spec.ts          # AUTH-E2E-07

docker-compose.e2e.yml               # MODIFIED — + oidc-mock service, + OIDC_* env on `app`
apps/api/src/lib/auth.ts             # MODIFIED — + account.accountLinking config (see below)
```

### Structure Rationale

- **`apps/e2e/oidc-mock` deliberately outside the pnpm workspace:** it has zero shared code with the rest of the monorepo (no Prisma client, no `@kurzly/shared` types) and its own dependency (`oidc-provider`) is irrelevant to every other package's install. Keeping it a plain Dockerfile-built service (like `db`/`mailpit` are plain image-pulled services) avoids workspace-resolution churn for a test-only fixture.
- **`tests/auth/` as standalone specs, not depending on the `setup` project:** these specs prove login itself — depending on `dependencies: ["setup"]` (which performs its own magic-link login) would make every spec in this phase implicitly depend on the exact mechanism half of them are testing the failure modes of. Matches CONTEXT.md's own discretion note.
- **A dedicated `apps/e2e/src/oidc-mock.ts` client, mirroring `mailpit.ts`'s shape:** every other E2E infra dependency (`db.ts`, `mailpit.ts`) already gets its own thin typed wrapper in `src/`; the mock IdP's one non-standard endpoint (`PUT /__test__/claims`) deserves the same treatment rather than ad hoc `fetch()` calls scattered across spec files.

### Pattern 1: Dual-reachability mock IdP via discovery-document rewrite, not `host.docker.internal`

**What:** Run the mock IdP as its own compose service on the shared Docker network. Set `OIDC_ISSUER_URL` (what `app` uses to build `ssoDiscoveryUrl()`) to the Docker-internal address (`http://oidc-mock:9000`). Inside the mock IdP's own Koa stack, register a post-middleware that intercepts ONLY the discovery response and rewrites `authorization_endpoint` to the host-published address (`http://localhost:9000/authorize`) — leaving `issuer`, `token_endpoint`, `userinfo_endpoint`, and `jwks_uri` on the internal address, since those are only ever called server-to-server by `app`.

**When to use:** Any time a mock external service needs to be reachable both by a containerized backend (server-to-server calls) and by a host-run browser (the one hop of an OAuth flow that is browser-driven — the authorization redirect).

**Trade-offs:** Requires ~10 extra lines of middleware versus a symmetric single-URL approach, but avoids a documented CI-reliability risk. Community reports on `host.docker.internal:host-gateway` inside GitHub Actions Ubuntu runners describe it as "conditionally functional... requires additional configuration steps" and not something to rely on for CI without dedicated testing [CITED: github.com/orgs/community/discussions/70257] — given this phase's CI job is the actual merge gate (per Phase 11/12's ARCHITECTURE.md precedent), the extra middleware is the safer default.

**Example:**
```javascript
// apps/e2e/oidc-mock/server.mjs (illustrative — verify oidc-provider 9.10.0's
// exact `interactionDetails`/`interactionFinished` signatures and default
// route names against its own docs at implementation time; the STRUCTURE
// below is the confirmed, cross-checked pattern — see Sources)
import Provider from "oidc-provider";
import Koa from "koa";
import Router from "@koa/router";

const INTERNAL_URL = process.env.OIDC_MOCK_INTERNAL_URL; // http://oidc-mock:9000
const PUBLIC_URL = process.env.OIDC_MOCK_PUBLIC_URL;     // http://localhost:9000

let currentClaims = {}; // toggled by PUT /__test__/claims — {} = "ordinary" user

const provider = new Provider(INTERNAL_URL, {
  clients: [{
    client_id: process.env.OIDC_MOCK_CLIENT_ID,
    client_secret: process.env.OIDC_MOCK_CLIENT_SECRET,
    redirect_uris: [process.env.OIDC_MOCK_REDIRECT_URI],
    grant_types: ["authorization_code"],
    response_types: ["code"],
  }],
  claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name"] },
  findAccount: async (ctx, id) => ({
    accountId: id,
    async claims() {
      return { sub: id, email: "sso.user@idp.test", email_verified: true, name: "SSO Test User", ...currentClaims };
    },
  }),
});

// [CITED, cross-checked via WebSearch]: post-middleware rewrite pattern for
// exposing a different public URL for one endpoint only.
provider.use(async (ctx, next) => {
  await next();
  if (ctx.oidc?.route === "discovery" && ctx.status === 200) {
    ctx.body.authorization_endpoint = ctx.body.authorization_endpoint.replace(INTERNAL_URL, PUBLIC_URL);
  }
});

const app = new Koa();
const router = new Router();

// Test-control endpoint — NOT part of the OIDC spec, apps/e2e's own fixture
// hook (called from Playwright's APIRequestContext before driving the
// browser through the SSO button) to toggle "ordinary" vs "admin-shaped"
// claims for AUTH-E2E-04's no-elevation proof.
router.put("/__test__/claims", async (ctx) => { currentClaims = ctx.request.body ?? {}; ctx.status = 204; });
router.delete("/__test__/claims", async (ctx) => { currentClaims = {}; ctx.status = 204; });

// Auto-approve interaction — no login form ever renders; the moment
// oidc-provider redirects here, immediately finish with a fixed subject.
router.get("/interaction/:uid", async (ctx) => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  const result = { login: { accountId: "sso-mock-subject" } };
  await provider.interactionFinished(ctx.req, ctx.res, result, { mergeWithLastSubmission: false });
});

app.use(router.routes());
app.use(provider.callback());
app.listen(process.env.OIDC_MOCK_PORT);
```

### Pattern 2: Fix `account.accountLinking` BEFORE writing the AUTH-E2E-05 spec (TDD ordering)

**What:** Add `account: { accountLinking: { enabled: true, requireLocalEmailVerified: false } }` to `createAuth()`'s `betterAuth({...})` config in `apps/api/src/lib/auth.ts`.
**When to use:** This specific phase, this specific requirement — see "better-auth Account-Linking, Code-Verified" below for the full reasoning.
**Trade-offs:** Documented in the Common Pitfalls section below (security tradeoff of trusting an unverified local email on link).

### Anti-Patterns to Avoid

- **Assuming AUTH-E2E-05 "just works" because the ROADMAP describes it as a success criterion:** the current code does not implement it; treat the E2E spec's first run as RED, not a bug in the test.
- **Weakening `requireLocalEmailVerified` globally without also scoping it to invite-created rows:** the fix should be understood (and documented in `auth.ts`'s own header comment, matching this file's existing D-10-xx convention) as "an admin-invited User row is inherently pre-vetted by the admin who created it" — not a blanket statement that email verification never matters.
- **Building the mock IdP's login UI as an actual HTML form Playwright fills in:** unnecessary flakiness surface for a fixture whose only job is proving the OAuth *contract*, not testing a third-party UI (explicitly out of scope per REQUIREMENTS.md's "Testen der IdP-eigenen Login-Seite" exclusion).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| OIDC discovery/token/userinfo contract | A bespoke `node:http` stub (as the existing Vitest `sso-auth.integration.test.ts` does) | `oidc-provider` for the E2E-level mock | The Vitest stub is fine for a fast, in-process integration test asserting better-auth's own request/response shape; a browser-driven E2E flow needs a REAL authorization-code redirect dance (state, PKCE if sent, real redirect_uri validation) that a 60-line hand stub would have to re-implement piecemeal and likely get subtly wrong |
| Magic-link email retrieval | A new Mailpit client | Reuse `apps/e2e/src/mailpit.ts`'s `findMagicLinkUrl`/`clearInbox` verbatim | Already recipient-scoped, already hardened against the cross-worker email-theft pitfall (Phase 11) |
| Fixture User/invite rows for this phase's specs | Hand-rolled `INSERT`/raw SQL | Direct Prisma writes via the reused `@kurzly/api/prisma-client` subpath export (`apps/e2e/src/db.ts`'s existing pattern) | Matches the established convention; a new `apps/e2e/src/users.ts` (or an extension of `db.ts`) for invite-fixture creation is the correct amount of new code, not a new data-access layer |

**Key insight:** The one thing this phase SHOULD hand-roll is the mock IdP's own claims/interaction routes — because that surface exists solely to give the test suite programmatic control over what a "real" IdP would otherwise require manual login-form interaction for. Everywhere else, reuse.

## Common Pitfalls

### Pitfall 1: better-auth's account-linking silently blocks the exact scenario AUTH-E2E-05 requires (code-verified, not assumed)

**What goes wrong:** An admin invites `user@example.com` via magic link (creates a `User` row with `emailVerified: false`, per `lib/team.ts`'s `inviteMember`). The invitee never completes the magic-link login. They instead click "Mit SSO anmelden" and authenticate via the configured OIDC IdP using the SAME email. Expectation (per ROADMAP success criterion 4): one merged account. Actual current behavior: better-auth's `handleOAuthUserInfo` (`node_modules/better-auth/dist/oauth2/link-account.mjs`) finds the existing `User` row by email via `findOAuthUser`, sees no `linkedAccount` for the `"oidc"` provider yet, and evaluates:

```js
if (!isTrustedProvider && !userInfo.emailVerified
    || requireLocalEmailVerified && !dbUser.user.emailVerified   // <-- this clause
    || accountLinking?.enabled === false
    || accountLinking?.disableImplicitLinking === true) {
  return { error: "account not linked" };
}
```

`requireLocalEmailVerified` defaults to `true` [VERIFIED: read directly, `link-account.mjs` line 22: `accountLinking?.requireLocalEmailVerified ?? true`] and this app's `createAuth()` sets no `account.accountLinking` config at all [VERIFIED: full read of `apps/api/src/lib/auth.ts`, no `account:` key present]. Since the invited-but-not-yet-activated User's `emailVerified` is `false`, this clause evaluates `true && true = true` regardless of the IdP's own `email_verified` claim — the whole condition is `true` — better-auth redirects to `errorCallbackURL` with `error=account_not_linked`. **No merge happens, and no duplicate account is created either** (the duplicate-creation branch is only reachable when `findOAuthUser` finds no `User` row at all by email — it always finds one here). The failure mode is a clean error redirect, not data corruption — but it is a hard failure of the stated requirement.

**Why it happens:** better-auth's default posture assumes "an unverified local email shouldn't be claimable by an OAuth login" — a sensible default for a general-purpose app where anyone can sign up with any email, but wrong for Kurzly's actual trust model, where a `User` row only ever exists because an **admin** already vetted and invited that exact address (there is no public signup at all — D-01).

**How to avoid:** Add to `createAuth()`'s `betterAuth({...})` call:
```typescript
account: {
  accountLinking: {
    enabled: true,
    requireLocalEmailVerified: false, // Kurzly's invite model already vets the email; see header comment
  },
},
```
This must land as its own reviewed code change (with a header-comment rationale matching this file's existing D-10-xx documentation convention), landed alongside — not instead of — the AUTH-E2E-05 spec. Write the spec first (it should fail against current `main`), then land this config change to turn it green — this is the textbook TDD RED→GREEN shape this project's CLAUDE.md mandates, not a deviation from it.

**Security tradeoff to document explicitly in the code comment:** this makes any admin-invited-but-unverified `User` row linkable via SSO by anyone who can authenticate to the configured IdP with that email address. Given Kurzly's own threat model (the IdP is operator-configured, admin-trusted infrastructure — not attacker-controlled — and the email itself was already chosen by an admin), this is an acceptable, deliberate tradeoff, not an oversight — but it must be written down, not left implicit.

**Warning signs:** AUTH-E2E-05's spec redirects to `/auth/error` instead of the dashboard; the `User` row's `emailVerified` stays `false` and no `Account` row for provider `"oidc"` appears against it.

**Phase to address:** This phase — both the failing spec and the fix are Phase 13's job.

---

### Pitfall 2: `host.docker.internal`/`host-gateway` is not reliably CI-portable for the mock IdP

**What goes wrong:** Teams reach for `extra_hosts: ["host.docker.internal:host-gateway"]` to let a containerized `app` talk to an in-process mock IdP running directly in the Playwright test runner's own host process (matching Phase 11 STACK.md's original suggestion). It works on a developer's Docker Desktop machine and then intermittently fails in GitHub Actions.

**Why it happens:** `host.docker.internal` is auto-injected by Docker Desktop (Mac/Windows) but requires the explicit `extra_hosts` mapping on Linux — and even with that mapping, multiple independent community reports describe needing additional non-obvious configuration inside GitHub Actions' Ubuntu runners specifically, with no comprehensive official documentation for the CI case [CITED: github.com/orgs/community/discussions/70257, oneuptime.com blog on `extra_hosts`].

**How to avoid:** Containerize the mock IdP itself (Pattern 1 above) rather than routing container→host traffic through `host-gateway`.

**Warning signs:** SSO E2E specs pass locally, fail in CI with a connection-refused/timeout against the OIDC issuer URL specifically (magic-link specs unaffected, since they don't touch this network path).

**Phase to address:** This phase, at initial infra setup — decide the compose topology before writing any SSO spec.

---

### Pitfall 3: Asserting only "an error appeared" for AUTH-E2E-02/03, not the specific no-session guarantee

**What goes wrong:** A spec checks that a stale/invalid magic-link click shows *some* error page and calls it done, without independently confirming via `GET /api/auth/get-session` that no session cookie was actually issued.

**How to avoid:** Every AUTH-E2E-02/03 assertion should include an explicit `GET /api/auth/get-session` (or equivalent UI check) returning unauthenticated, not just "an error UI rendered." This mirrors the project's own PITFALLS.md precedent (UX Pitfalls: "assert on the actual message/absence of leak, not just an error appeared").

**Phase to address:** This phase's spec-writing — bake this into every negative-path assertion from the start.

## Code Examples

### sendMagicLink Neutral-Response, Confirmed (AUTH-E2E-03)

```typescript
// apps/api/src/lib/auth.ts (existing, read in full this session)
sendMagicLink: async ({ email, url }) => {
  const allowed = await isEmailAllowed(prisma, email); // literally: does a User row exist?
  if (!allowed) return; // <-- sendMagicLinkEmail is NEVER called for this branch
  void sendMagicLinkEmail({ to: email, url }).catch(/* ... */);
},
```
`isEmailAllowed` (`apps/api/src/lib/allowlist.ts`) is `prisma.user.findUnique({ where: { email } }) !== null` — a plain existence check, nothing more [VERIFIED: full file read]. **Confirmed, not assumed:** for a genuinely non-existent `User` row, Mailpit receives **zero** messages — there is no email to "read and reject," the correct AUTH-E2E-03 assertion is that `findMagicLinkUrl(nonInvitedEmail, shortTimeout)` throws its own "no matching message found" timeout error, and that a `GET /api/auth/get-session` afterward is unauthenticated. The HTTP response to the initial `POST /api/auth/sign-in/magic-link` request itself is still 200/byte-identical either way (D-01's neutral-response contract) — do not assert on that response shape as the test's proof point; assert on the absence of the email and the absence of a session.

### Rate-Limited Resend UI Copy, Verbatim (AUTH-E2E-07)

```vue
<!-- apps/web/src/views/LoginView.vue (existing, read in full this session) -->
if (response.status === 429) {
  error.value = "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.";
  return;
}
```
Rendered via `<p v-if="error" class="error-inline">{{ error }}</p>` directly beneath the "Magic Link senden" button. **This exact German string is the assertion target** — not a translated/paraphrased placeholder. To actually trigger a real 429 (not the E2E rate-limit bypass, which must NOT be used for this one spec per CONTEXT.md), the spec needs its OWN dedicated, never-invited-elsewhere test email so this spec's 6 rapid requests (`MAGIC_LINK_RATE_LIMIT = { max: 5, timeWindow: "15 minutes" }`) don't collide with other specs' rate-limit budgets sharing the same IP — isolate this spec (own file, run it in a way that doesn't race other magic-link-sending specs against the same limiter bucket, since the limiter is keyed by IP per `rateLimit.ts`, not by email).

### AUTH-E2E-06 Logout, Exact UI Trigger

```typescript
// apps/web/src/layouts/AppShell.vue (existing, read in full this session)
async function handleLogout(): Promise<void> {
  await authSession.signOut();       // POST /api/auth/sign-out
  await router.push({ name: "login" });
}
```
Triggered by a button with `title="Abmelden"` in the sidebar footer. The spec should: click that button (`page.getByTitle("Abmelden")` or an equivalent role-based locator), assert final URL is `/login`, THEN independently confirm via `GET /api/auth/get-session` that the session is truly gone server-side (not just a client-side redirect) — and finally, in a SEPARATE assertion, load a fresh unauthenticated `APIRequestContext`/browser context with no `storageState` and confirm a direct visit to `/` (or any `requiresAuth` route) redirects to `/login` per `router/index.ts`'s guard, distinct from Phase 11's existing `storage-state.spec.ts` (which only proves the reverse — an authenticated session reaching an authenticated route).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| better-auth `sso` plugin (Phase 10's initial assumption) | `genericOAuth` plugin | Discovered Phase 10 — installed 1.6.23 doesn't ship `sso` | Already resolved before this phase; no new action needed, just confirmed still accurate |
| Assuming AUTH-E2E-05 is purely a test-writing task | Requires a small, deliberate `auth.ts` code change | This research pass | Changes this phase's plan shape — include an explicit code-fix task, not just spec tasks |

**Deprecated/outdated:** none newly identified this pass beyond the above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `oidc-provider@9.10.0`'s exact default route names (`/auth`, `/token`, `/me` vs `/userinfo`) and whether `pkce.required` defaults to a value compatible with better-auth's `genericOAuth` request shape | Architecture Patterns, Pattern 1 | Wrong assumption means the mock-IdP `server.mjs` needs a route-path or PKCE-config tweak at implementation time — a same-day fix, not a redesign, since the underlying dual-network architecture is unaffected |
| A2 | `oidc-provider`'s `interactionDetails`/`interactionFinished` method signatures shown in the code example match 9.10.0 exactly (verified against community blog posts and the library's own historical example app, not the live 9.10.0 docs directly) | Architecture Patterns, Pattern 1 | Same low blast radius as A1 — implementation-time doc check, isolated to `server.mjs` |
| A3 | `oidc-provider` will issue a real signed `id_token` by default for an `openid`-scoped authorization_code grant (not verified against 9.10.0's exact default `features`/`responseTypes` config) | Standard Stack / Code Examples | If false, better-auth would fall back to its userinfo-fetch path anyway (already proven compatible by the existing Vitest `sso-auth.integration.test.ts` stub, which deliberately omits `id_token`) — low risk either way |

**If this table is empty:** N/A — see rows above. Everything in the "Account-Linking, Code-Verified" and "sendMagicLink Neutral-Response" sections is `[VERIFIED]` against installed source, not assumed.

## Open Questions

1. **Should `requireLocalEmailVerified: false` be scoped narrowly (e.g., only for invite-originated rows) rather than globally on the `genericOAuth` config?**
   - What we know: better-auth's `account.accountLinking` config is a single global setting for the whole `betterAuth()` instance — there is no per-user-origin override surface in the installed 1.6.23 API.
   - What's unclear: whether a future requirement (e.g., allowing self-service local password reset for verified users) would ever need the stricter default back.
   - Recommendation: accept the global relaxation now (Kurzly has no signup path other than admin invite, so "unverified local User row" ⟺ "admin-invited, not yet activated" is a closed, fully understood set today) but document the equivalence explicitly in the code comment so a future contributor adding any other user-creation path re-evaluates this decision.

2. **Exact `oidc-provider` 9.10.0 discovery-route Koa context shape (`ctx.oidc.route === "discovery"`) — confirmed name?**
   - What we know: the pattern (`provider.use` post-middleware keyed on `ctx.oidc.route`) is a real, documented `oidc-provider` API surface used for exactly this per-deployment discovery-value override.
   - What's unclear: whether the discovery route's identifier string is literally `"discovery"` in 9.10.0 (older/newer versions have used this exact string historically; not independently reconfirmed against 9.10.0's changelog this pass).
   - Recommendation: verify with a one-line `console.log(ctx.oidc.route)` during implementation before relying on the string match in the shipped middleware.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Docker Engine | `oidc-mock` compose service | ✓ | 29.5.3 | — |
| Docker Compose | 4th overlay service addition | ✓ | v5.1.4 | — |
| `@playwright/test` | This phase's specs | ✓ | 1.61.1 (matches STACK.md's pinned version) | — |
| `oidc-provider` | Mock IdP | ✗ (not yet installed anywhere in the monorepo — confirmed via `grep` across all `package.json` files) | 9.10.0 available on npm | None needed — this phase installs it fresh in the new `apps/e2e/oidc-mock/package.json` |
| Node.js (host) | Local `pnpm --filter @kurzly/e2e test` runs | ✓ | v22.19.0 | Project targets Node 24 in Docker images (per root CLAUDE.md); host Node 22 is fine for running Playwright's own test runner locally, distinct from the containerized `app`'s Node 24 |

**Missing dependencies with no fallback:** none — `oidc-provider` is a net-new install this phase performs itself, not a pre-existing gap blocking work.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` 1.61.1 |
| Config file | `apps/e2e/playwright.config.ts` |
| Quick run command | `pnpm --filter @kurzly/e2e exec playwright test tests/auth/ --project=smoke` (adjust project name once this phase's specs are added as their own standalone project per CONTEXT.md's discretion note — likely a new `auth` project with no `dependencies`) |
| Full suite command | `scripts/e2e-compose.sh` (boots the 3-file compose stack + `oidc-mock`, runs `pnpm --filter @kurzly/e2e test`, always tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| AUTH-E2E-01 | Magic-link round trip reaches an active session | e2e (browser) | `playwright test tests/auth/magic-link-round-trip.spec.ts` | ❌ Wave 0 |
| AUTH-E2E-02 | Consumed/expired/malformed token rejected, no session | e2e (browser + `APIRequestContext`) | `playwright test tests/auth/magic-link-token-rejection.spec.ts` | ❌ Wave 0 |
| AUTH-E2E-03 | Non-invited email — zero email sent, zero session | e2e (`APIRequestContext` + Mailpit REST) | `playwright test tests/auth/invite-only-denial.spec.ts` | ❌ Wave 0 |
| AUTH-E2E-04 | OIDC round trip, least-privilege even against admin-shaped claims | e2e (browser + mock IdP) | `playwright test tests/auth/sso-login.spec.ts` | ❌ Wave 0 |
| AUTH-E2E-05 | SSO-after-invite merge | e2e (browser + mock IdP + Prisma fixture) | `playwright test tests/auth/sso-account-merge.spec.ts` | ❌ Wave 0 — expected RED until `auth.ts`'s `accountLinking` fix lands |
| AUTH-E2E-06 | Logout + route guard | e2e (browser) | `playwright test tests/auth/logout-route-guard.spec.ts` | ❌ Wave 0 |
| AUTH-E2E-07 | Rate-limited resend UI copy | e2e (browser, real limiter, own isolated file) | `playwright test tests/auth/resend-rate-limit.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted spec file only, e.g. `playwright test tests/auth/sso-account-merge.spec.ts` against a running local compose stack.
- **Per wave merge:** full `tests/auth/` directory at `--workers=1` then again at the CI's configured parallelism, to catch any new rate-limit/DB-isolation collision this phase's specs introduce.
- **Phase gate:** full E2E suite (`scripts/e2e-compose.sh`, all directories) green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/e2e/oidc-mock/Dockerfile` + `server.mjs` — the mock IdP itself; blocks AUTH-E2E-04/05 entirely until it exists.
- [ ] `apps/e2e/src/oidc-mock.ts` — thin fetch client for `PUT/DELETE /__test__/claims`, mirroring `mailpit.ts`'s shape.
- [ ] `apps/e2e/src/users.ts` (or an addition to `db.ts`) — Prisma helper to create an invited-but-unverified `User` row for AUTH-E2E-05's fixture, matching `inviteMember`'s own shape (`emailVerified: false`, no `Account` row).
- [ ] `account.accountLinking` config addition to `apps/api/src/lib/auth.ts` — REQUIRED before AUTH-E2E-05 can pass; write the failing spec first (TDD RED), then land this as the fix (GREEN).
- [ ] `docker-compose.e2e.yml` — new `oidc-mock` service + `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` on `app`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes | better-auth session cookie issuance/verification (existing, unchanged by this phase) |
| V3 Session Management | yes | httpOnly session cookie, 7-day sliding expiry (existing) — this phase adds test coverage, no new session mechanism |
| V4 Access Control | yes | `accountRole`'s `input: false` + zero-`DomainMembership` least-privilege default for SSO-provisioned users (existing, this phase drives it through a real browser flow) |
| V5 Input Validation | yes | Mock IdP's `/__test__/claims` endpoint accepts arbitrary JSON — acceptable ONLY because it is test-fixture-only, never reachable from the real `app` container's production code path, and only exists inside the E2E-only `oidc-mock` service |
| V6 Cryptography | n/a (no new crypto surface this phase) | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Unverified-email account takeover via relaxed `requireLocalEmailVerified` | Spoofing | Documented, deliberate tradeoff (Pitfall 1) scoped to Kurzly's closed invite-only user-creation model; must be commented in code, not silently relaxed |
| Mock IdP's test-control endpoint (`PUT /__test__/claims`) reachable outside intended test scope | Tampering | Only ever published on the `docker-compose.e2e.yml` overlay, never in `docker-compose.yml` (prod) — mirrors this project's own `E2E_COMPOSE_OVERLAY`/`E2E_RATE_LIMIT_BYPASS_SECRET` "structurally absent from prod config surface" discipline; add the SAME kind of guard (a marker only present in the E2E overlay) if this endpoint's existence is ever a concern in a shared/staging environment |
| Rate-limit bypass header leaking into a real 429 assertion | Denial of Service (inverse: masking DoS protection) | AUTH-E2E-07's spec must NOT send `x-e2e-bypass` — verified this is already CONTEXT.md's explicit instruction, reinforced here |

## Sources

### Primary (HIGH confidence)
- `apps/api/src/lib/auth.ts`, `apps/api/src/lib/ssoConfig.ts`, `apps/api/src/lib/team.ts`, `apps/api/src/lib/allowlist.ts`, `apps/api/src/env.ts`, `apps/api/src/plugins/rateLimit.ts` — full reads, this session
- `apps/web/src/views/LoginView.vue`, `apps/web/src/layouts/AppShell.vue`, `apps/web/src/router/index.ts`, `apps/web/src/stores/authSession.ts`, `apps/web/src/api.ts` — full/targeted reads, this session
- `node_modules/better-auth@1.6.23/dist/oauth2/link-account.mjs`, `dist/db/internal-adapter.mjs` (`findOAuthUser`), `dist/context/helpers.mjs` (`getTrustedProviders`), `dist/plugins/generic-oauth/routes.mjs` — installed source, read directly this session, not documentation
- `apps/api/test/sso-auth.integration.test.ts` — existing Vitest OIDC test precedent (stub IdP shape, admin-claims-no-elevation proof pattern)
- `apps/e2e/src/db.ts`, `apps/e2e/src/mailpit.ts`, `apps/e2e/tests/auth.setup.ts`, `apps/e2e/tests/authed/storage-state.spec.ts`, `apps/e2e/playwright.config.ts`, `docker-compose.e2e.yml`, `docker-compose.dev.yml` — full reads, this session
- `npm view oidc-provider version/scripts.postinstall/dependencies` — direct registry queries, this session

### Secondary (MEDIUM confidence)
- [How to override authorization_endpoint in .well-known/openid-configuration? · authelia/authelia Discussion #7717](https://github.com/authelia/authelia/discussions/7717) — cross-checked pattern for the discovery-document rewrite technique
- [Connect to host from docker compose service — GitHub community discussion #70257](https://github.com/orgs/community/discussions/70257) — `host.docker.internal`/`host-gateway` CI-reliability concern
- [How to Use Docker Compose extra_hosts Configuration](https://oneuptime.com/blog/post/2026-02-08-how-to-use-docker-compose-extrahosts-configuration/view) — Linux vs. Docker Desktop `host.docker.internal` behavior
- [Getting started with oidc-provider — Scott Brady](https://www.scottbrady.io/openid-connect/getting-started-with-oidc-provider) — general `oidc-provider` setup/interaction pattern reference

### Tertiary (LOW confidence)
- General `oidc-provider` route-name/feature-flag specifics not independently reconfirmed against 9.10.0's own docs this pass (see Assumptions Log A1-A3) — flagged for a quick implementation-time doc check, not treated as authoritative here

## Metadata

**Confidence breakdown:**
- better-auth account-linking finding: HIGH — read directly from installed source, cross-checked against this app's own `auth.ts`
- sendMagicLink neutral-response / rate-limit UI copy: HIGH — read directly from this repo's own current code
- Mock-IdP dual-reachability architecture: MEDIUM — the core pattern (containerize + discovery rewrite) is cross-checked against multiple independent sources; exact `oidc-provider` 9.10.0 API surface details are MEDIUM-LOW, flagged in Assumptions Log
- Package legitimacy (`oidc-provider`): MEDIUM — SUS verdict from the automated gate is understood and explained, not blindly overridden

**Research date:** 2026-07-25
**Valid until:** 30 days (stable domain — better-auth/Playwright/oidc-provider are all pinned versions; re-verify if any of the three receive a major/minor bump before this phase executes)

---
*Research for: Kurzly Phase 13 — Authentication & Session E2E (v1.1 milestone)*
*Researched: 2026-07-25*
