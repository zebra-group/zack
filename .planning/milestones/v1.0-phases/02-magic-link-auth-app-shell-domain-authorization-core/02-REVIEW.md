---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
reviewed: 2026-07-11T15:35:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - apps/api/prisma/schema.prisma
  - apps/api/src/app.ts
  - apps/api/src/env.ts
  - apps/api/src/server.ts
  - apps/api/src/lib/admin-seed.ts
  - apps/api/src/lib/allowlist.ts
  - apps/api/src/lib/authorization.ts
  - apps/api/src/lib/auth.ts
  - apps/api/src/lib/mailer.ts
  - apps/api/src/plugins/helmet.ts
  - apps/api/src/plugins/rateLimit.ts
  - apps/api/src/routes/auth.ts
  - apps/api/vitest.config.ts
  - .env.example
  - packages/shared/src/index.ts
  - apps/web/src/api.ts
  - apps/web/src/App.vue
  - apps/web/src/main.ts
  - apps/web/src/layouts/AppShell.vue
  - apps/web/src/router/index.ts
  - apps/web/src/stores/authSession.ts
  - apps/web/src/stores/theme.ts
  - apps/web/src/styles/tokens.css
  - apps/web/src/views/AuthErrorView.vue
  - apps/web/src/views/ComingSoonView.vue
  - apps/web/src/views/DashboardView.vue
  - apps/web/src/views/LoginView.vue
  - apps/api/test/auth.integration.test.ts
  - apps/api/test/authorization.test.ts
  - apps/api/test/schema-push.test.ts
  - apps/api/test/server.integration.test.ts
  - apps/web/test/AppShell.test.ts
  - apps/web/test/LoginView.test.ts
  - apps/web/test/theme.test.ts
findings:
  critical: 2
  warning: 2
  info: 3
  total: 7
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-11T15:35:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Reviewed the magic-link auth + domain-authorization-core + app-shell phase against the explicit
D-01/D-02/D-05/D-07 security requirements named in the review brief. `pnpm typecheck` is clean
across the monorepo, and both test suites pass (42/42 API, 14/14 web) against a real
testcontainers Postgres.

Most of the security-sensitive plumbing is solid: the single Prisma-client discipline is honored
(`createAuth` accepts the caller's client rather than instantiating a second one), the neutral
`sendMagicLink` response is empirically byte-identical for allowlisted vs. never-seen emails
(D-01), the magic-link `callbackURL`/`errorCallbackURL` fields are validated by better-auth's
built-in `trustedOrigins` origin-check middleware (confirmed by reading the installed
`better-auth@1.6.23` source), single-use/15-min token expiry is enforced and tested, session
cookies are `httpOnly` (confirmed by test) and get `secure`/`sameSite=lax` from better-auth's own
defaults (confirmed by reading `dist/cookies/index.mjs`), and the Vue router guard is correctly
documented and implemented as UX-only, not the security boundary.

However, two BLOCKER-level defects were found by tracing actual runtime behavior rather than
trusting the tests/comments at face value:

1. The domain-scoped authorization core (`requireDomainAccess`) **silently grants access instead
   of denying** when a `DomainMembership.role` value isn't one of the three known literals —
   the exact opposite of the "deny-by-default" guarantee its own docstring promises, and the
   single server-side authorization gate every future phase (3–9) is told to trust verbatim.
2. The D-05 "generic magic-link error page" (`AuthErrorView.vue` / `/auth/error`) is **dead
   code in the live flow** — the client never supplies `errorCallbackURL`, so every failed
   verification (expired/reused/bogus token) silently redirects to `/` → bounces through the
   router guard to `/login` with no error explanation, never touching the built error screen.
   The existing negative tests don't catch this because they assert only a query-string
   substring, not the actual redirect path.

Two further WARNING-level issues affect the stated D-01/D-07 goals under more specific/edge
conditions (a timing side-channel on the neutral-response path, and rate-limiting that will
silently collapse into one shared bucket for all users once the documented reverse-proxy
deployment topology is in place, because `trustProxy` is never configured).

## Critical Issues

### CR-01: Authorization core fails open (grants access) on an invalid/unexpected role value

**File:** `apps/api/src/lib/authorization.ts:29-44`
**Issue:**

```ts
export async function requireDomainAccess(
  prisma: PrismaClient,
  userId: string,
  domainId: string,
  minRole: Role,
): Promise<void> {
  const membership = await prisma.domainMembership.findUnique({
    where: { userId_domainId: { userId, domainId } },
  });

  if (!membership || ROLE_RANK[membership.role as Role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(...);
  }
}
```

`membership.role` is a plain `TEXT NOT NULL` column (confirmed in
`apps/api/prisma/migrations/20260711121129_add_auth_and_domain_models/migration.sql:71` — no
Postgres enum, no CHECK constraint) and the Prisma-generated type is `string`, not a literal
union — nothing at the schema or type layer stops a future caller (Phase 3-9, which this module
is explicitly frozen for) from persisting a typo'd or unexpected value (`"Owner"`, `"admin "`,
a future 4th role name introduced without updating `ROLE_RANK`, etc.).

When `membership.role` isn't a key of `ROLE_RANK`, `ROLE_RANK[membership.role as Role]` evaluates
to `undefined`. `undefined < ROLE_RANK[minRole]` is **always `false`** in JavaScript (not `true`,
not a thrown error) — reproduced directly:

```
$ node -e 'const R={member:0,admin:1,owner:2}; console.log(!{role:"Owner"}===false, R["Owner"] < R.admin)'
false false
```

So the guard condition `!membership || (false)` is `false`, `requireDomainAccess` **resolves
without throwing**, and the caller proceeds as if access were granted — the exact inverse of the
"deny-by-default: absence of proof of access is treated as denial, never as implicit access"
invariant documented three lines above in this same file. This is the single authorization
gate every domain-scoped route in Phases 3–9 is told to trust verbatim; a bypass here is silent
and will propagate everywhere.

**Fix:**
```ts
const rank = membership ? ROLE_RANK[membership.role as Role] : undefined;
if (rank === undefined || rank < ROLE_RANK[minRole]) {
  throw new ForbiddenError(
    `User ${userId} lacks ${minRole}+ access to domain ${domainId}`,
  );
}
```
Additionally, close the root cause at the schema layer so an invalid value can never be
persisted in the first place — either a Prisma `enum Role { member admin owner }` mapped column,
or a Postgres `CHECK (role IN ('member','admin','owner'))` constraint added in a follow-up
migration.

### CR-02: D-05 generic magic-link error page is unreachable — failed verification silently returns to /login instead

**File:** `apps/web/src/views/LoginView.vue:20-28` (root cause: missing `errorCallbackURL` in the
request body) — symptom observable via `apps/api/src/lib/auth.ts:73-86` and
`apps/web/src/router/index.ts:71-90`

**Issue:** `sendMagicLink()` in `LoginView.vue` POSTs only `{ email: email.value }` —
`callbackURL`/`errorCallbackURL` are never sent:

```ts
body: JSON.stringify({ email: email.value }),
```

Tracing better-auth's `magic-link` plugin (`node_modules/better-auth@1.6.23/dist/plugins/magic-link/index.mjs`):
when the sign-in endpoint builds the emailed verify URL, it only sets an `errorCallbackURL` query
param `if (ctx.body.errorCallbackURL)` — since that field is never sent, it's omitted entirely.
At verify time, the handler then falls back:

```js
const callbackURL = new URL(ctx.query.callbackURL ? ... : "/", ctx.context.baseURL).toString();
const errorCallbackURL = new URL(ctx.query.errorCallbackURL ? ... : callbackURL, ctx.context.baseURL);
```

With no `errorCallbackURL` query param present, `errorCallbackURL` collapses to the same value as
`callbackURL`, which itself defaults to `"/"`. So on ANY verification failure
(`INVALID_TOKEN`, reused token, expired token), the 302 redirect target is
`BASE_URL/?error=INVALID_TOKEN` — the dashboard route (`requiresAuth: true`), **not**
`/auth/error`. The unauthenticated user then hits the router's `beforeEach` guard
(`apps/web/src/router/index.ts:85-87`), which rewrites the navigation to
`{ name: "login" }` — a named-route redirect that does not forward the `?error=...` query string.
The end result: the user is silently bounced to a blank login form with **no error message at
all**, and `AuthErrorView.vue` — a fully-built, UI-SPEC-locked, D-05-mandated screen — is never
rendered by the real flow.

Confirmed by `grep -rn "errorCallbackURL\|callbackURL" apps/web/src apps/api/src` returning zero
matches outside the route definition itself — nothing in the codebase ever supplies these fields.

The existing negative tests (`apps/api/test/auth.integration.test.ts:139-152,154-170`) don't catch
this because they assert `res.headers.location` `.toContain("error=INVALID_TOKEN")` only — a
substring check that passes whether the redirect lands on `/auth/error` or on `/`.

**Fix:** Send `errorCallbackURL` (and, for symmetry, an explicit `callbackURL`) with the sign-in
request:

```ts
body: JSON.stringify({
  email: email.value,
  callbackURL: "/",
  errorCallbackURL: "/auth/error",
}),
```

and strengthen the negative-path tests to assert the actual redirect path
(`new URL(res.headers.location).pathname === "/auth/error"`), not just a substring of the query
string, so this class of regression can't slip through again.

## Warnings

### WR-01: Timing side-channel on the neutral-response magic-link path undermines the stated D-01 anti-enumeration goal

**File:** `apps/api/src/lib/auth.ts:76-85`
**Issue:** `lib/allowlist.ts`'s header comment explicitly states the allowlist check must live
inside `sendMagicLink` "never from a separate pre-check route, which would leak account
existence via response-shape/timing differences." The current implementation still has a
timing asymmetry, just folded into one route:

```ts
sendMagicLink: async ({ email, url }) => {
  const allowed = await isEmailAllowed(prisma, email);
  if (!allowed) return;
  await sendMagicLinkEmail({ to: email, url });
},
```

better-auth's `signInMagicLink` endpoint `await`s this callback directly before responding
(`await options.sendMagicLink(...); return ctx.json({ status: true });`
— confirmed in the installed package source). So an allowlisted email pays the cost of an
additional SMTP round-trip (`sendMagicLinkEmail`) before the HTTP response is sent, while a
non-allowlisted email returns immediately after one fast DB lookup. This latency delta is exactly
the kind of side-channel the code's own comments call out as unacceptable, and the D-01 test
(`auth.integration.test.ts`'s "byte-identical response" assertion) only checks status code +
body — it does not, and structurally cannot, catch a timing difference.

**Fix:** Decouple the response from the mail send, e.g. fire-and-forget without awaiting inside
the request path (`void sendMagicLinkEmail(...).catch(...)`), or pad the non-allowed branch with
an equivalent artificial delay so both paths take approximately the same wall-clock time before
returning.

### WR-02: Rate limiting keys on `request.ip` with no `trustProxy`, but the documented deployment sits behind an operator-supplied reverse proxy

**File:** `apps/api/src/app.ts:70-72` (Fastify instantiation), `apps/api/src/plugins/rateLimit.ts`
**Issue:** `@fastify/rate-limit`'s default `keyGenerator` is `req => req.ip`
(confirmed in `node_modules/@fastify/rate-limit/index.js:29`), and Fastify's `request.ip` is the
raw socket address unless `trustProxy` is configured. `docker-compose.yml`'s own header comment
states TLS/reverse-proxy termination is "the operator's own responsibility" — i.e. the documented
production topology puts a reverse proxy in front of this app. With no `trustProxy` option set on
the `Fastify({...})` constructor, every request in that topology will present the *same* IP (the
proxy's), collapsing both the global rate limit (100/15min) and, more importantly, the
`MAGIC_LINK_RATE_LIMIT` (5/15min, `apps/api/src/plugins/rateLimit.ts:24-27`) into a single shared
bucket across every user of the instance. A single actor sending 5 bogus magic-link requests
would lock out every legitimate user's ability to request a magic link for the following 15
minutes — inverting the control D-07/Pitfall 3 was built to provide into a trivial denial-of-service
against the login flow itself.

**Fix:** Add an env-driven `trustProxy` option (e.g. `TRUST_PROXY=true` or a specific hop count)
wired into the `Fastify({...})` constructor once a reverse proxy is the documented deployment
path, so `request.ip` reflects `X-Forwarded-For` from a trusted hop rather than the proxy's own
address.

## Info

### IN-01: Dead fallback in admin-seed's placeholder name derivation

**File:** `apps/api/src/lib/admin-seed.ts:35`
**Issue:** `name: email.split("@")[0] ?? email,` — `email` is validated by `z.email()` before
`seedInitialAdmin` is ever called (`env.ts`'s `INITIAL_ADMIN_EMAIL: z.email()`), which guarantees
an `"@"` is present, so `.split("@")[0]` can never return `undefined`; the `?? email` branch is
unreachable.
**Fix:** Either drop the `?? email` fallback, or add a code comment explaining it's deliberate
defense-in-depth against a hypothetical future caller that bypasses the env schema.

### IN-02: Cookie `Secure`/`SameSite` attributes are relied upon (correctly) but never asserted in tests

**File:** `apps/api/test/auth.integration.test.ts:114-137`
**Issue:** AUTH-02 only asserts the `HttpOnly` flag via regex (`/httponly/i`). The `Secure` and
`SameSite=Lax` attributes — confirmed present by reading better-auth's cookie defaults
(`dist/cookies/index.mjs`, derived from `BASE_URL`'s `https://` scheme) — are load-bearing for
CSRF/MITM protection but currently rely entirely on an unconfigured third-party default with no
regression coverage in this repo.
**Fix:** Extend the AUTH-02 assertion to also check for `secure` and `samesite=lax` in the raw
`Set-Cookie` header(s), so a future config change (or a better-auth major bump that changes
defaults) fails a test instead of silently shipping.

### IN-03: Already-authenticated users can still land on the bare `/login` screen

**File:** `apps/web/src/App.vue:29-38`, `apps/web/src/router/index.ts:71-90`
**Issue:** The router guard only redirects *unauthenticated* users away from `requiresAuth: true`
routes; there's no inverse guard redirecting an already-authenticated user away from `/login` (a
`requiresAuth: false` route). Manually navigating to `/login` while authenticated re-renders the
Idle login form (bypassing the `AppShell`) instead of redirecting to `/`. Not a security issue
(the session cookie/API access is unaffected), but a UX inconsistency worth a follow-up ticket.
**Fix:** Add a symmetric check in the `beforeEach` guard: if `to.name === "login"` and
`authSession.isAuthenticated`, redirect to `{ name: "dashboard" }`.

---

_Reviewed: 2026-07-11T15:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
