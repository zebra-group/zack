---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
plan: 04
subsystem: auth
tags: [better-auth, magic-link, fastify, helmet, rate-limit, prisma, vitest]

# Dependency graph
requires:
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "02-02: betterAuth() config (magicLink-only, disableSignUp, allowlist gate), lib/mailer.ts, lib/allowlist.ts, User/Session/Account/Verification schema"
provides:
  - "@fastify/helmet registered globally (CSP tuned for Google Fonts) and @fastify/rate-limit (permissive global default + MAGIC_LINK_RATE_LIMIT tight per-route override) — D-07"
  - "/api/auth/* mounted into buildApp() ahead of the SPA fallback via a Fetch Request/Response bridge (no reply.hijack) — AUTH-01..04 API surface live"
  - "lib/auth.ts refactored to createAuth(prisma) factory (auth = createAuth(defaultPrisma) kept as the production default) so tests can bind a fresh instance to the transaction-wrapped test Prisma client"
  - "routes/auth.ts's authRoute(auth) factory mirrors routes/canary.ts's canaryRoute(prisma) convention"
  - "lib/admin-seed.ts's seedInitialAdmin(prisma, email) — idempotent upsert of the INITIAL_ADMIN_EMAIL User row, wired into server.ts's boot sequence after loadEnv()"
  - "auth.integration.test.ts — real-Postgres proof of AUTH-01..04 and the D-01 neutral-response canary (7 tests)"
affects: [02-05, 02-06, auth, security]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "authRoute(auth) / createAuth(prisma) factory pattern — mirrors the existing canaryRoute(prisma) convention so a Fastify-plugin-producing module can be bound to a caller-supplied dependency (prisma, or here an auth instance built from prisma) instead of a hardcoded module-level singleton"
    - "A more specific static Fastify route (POST /api/auth/sign-in/magic-link) registered ahead of a wildcard catch-all (/api/auth/*) to scope a tight rate-limit override to one sub-path without touching every other endpoint sharing the catch-all"
    - "lib/mailer.ts fully mocked via vi.mock in integration tests (not a real Mailpit container) to capture the magic-link URL/token without an SMTP dependency in CI"

key-files:
  created:
    - apps/api/src/plugins/helmet.ts
    - apps/api/src/plugins/rateLimit.ts
    - apps/api/src/routes/auth.ts
    - apps/api/src/lib/admin-seed.ts
    - apps/api/test/auth.integration.test.ts
  modified:
    - apps/api/src/app.ts
    - apps/api/src/server.ts
    - apps/api/src/lib/auth.ts
    - apps/api/test/server.integration.test.ts
    - apps/api/vitest.config.ts

key-decisions:
  - "Refactored lib/auth.ts from a module-level `auth` singleton hardcoded to db.ts's default Prisma client into a `createAuth(prisma)` factory (auth = createAuth(defaultPrisma) preserved for production) — required for tests to bind an auth instance to the SAME transaction-wrapped Prisma client used elsewhere in a test (D-09); the singleton form made auth.integration.test.ts's writes either hit an unreachable placeholder DATABASE_URL or, even if repointed, run on a separate connection invisible to the test's BEGIN/ROLLBACK"
  - "routes/auth.ts's authRoute is a factory (authRoute(auth)) taking the auth instance as a parameter, matching routes/canary.ts's canaryRoute(prisma) convention already established in this codebase"
  - "The tight magic-link rate limit is applied via a SEPARATE, more specific static route (POST /api/auth/sign-in/magic-link) registered ahead of the general /api/auth/* wildcard, rather than trying to special-case one sub-path inside the wildcard handler — Fastify's router prefers the static match, so this cleanly scopes config.rateLimit to only that endpoint"
  - "vitest.config.ts's test env extended with BASE_URL/BETTER_AUTH_SECRET/SMTP_HOST/SMTP_PORT/SMTP_FROM placeholders — app.ts now transitively imports lib/auth.ts (and lib/mailer.ts) for every test file that calls buildApp(), not just auth-specific ones, and those modules read these directly from process.env at import time"
  - "No callbackURL is supplied when constructing the verify test requests — better-auth's magic-link/verify endpoint then returns the session as JSON directly (still setting the Set-Cookie header) instead of issuing a redirect, which is what auth.integration.test.ts's AUTH-02 happy-path test asserts against"

patterns-established:
  - "Any module built as a Fastify-route-producing singleton bound to db.ts's default Prisma client should instead be a factory taking prisma as a parameter (or take the already-constructed dependent object, as authRoute(auth) does) — the established convention going forward, not just for canary/auth"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "@fastify/helmet (Google-Fonts-aware CSP) and @fastify/rate-limit (global default + tight magic-link override) registered in buildApp() ahead of the auth/canary routes"
    requirement: null
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
      - kind: other
        ref: "grep -qE 'fonts.googleapis.com' apps/api/src/plugins/helmet.ts; grep -qE 'fonts.gstatic.com' apps/api/src/plugins/helmet.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUTH-01: requesting a magic link for the allowlisted admin email triggers sendMagicLinkEmail with a magic-link/verify URL"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#AUTH-01: requesting a magic link for the allowlisted admin email sends mail"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-01 neutral response: allowlisted vs never-seen email return a byte-identical status+body response; sendMagicLinkEmail is called only for the allowlisted one"
    requirement: null
    verification:
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#D-01: allowlisted vs never-seen email return a byte-identical response; mail sent only for the allowlisted one"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUTH-02: a valid, unused token signs the seeded INITIAL_ADMIN_EMAIL admin in (proving Pitfall 1's disableSignUp bootstrap works) and sets an httpOnly session cookie; invalid and already-used tokens are rejected with a generic error redirect and no session cookie"
    requirement: AUTH-02
    verification:
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#AUTH-02: a valid, unused token signs the seeded admin in (Pitfall 1 proven) and sets an httpOnly session cookie"
        status: pass
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#AUTH-02 negative: an invalid/never-issued token does not sign in and leaks nothing (redirect to error, no session cookie)"
        status: pass
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#AUTH-02 negative: an already-used token cannot sign in a second time (single-use enforcement)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUTH-03: session survives repeated getSession() calls (simulated browser refresh)"
    requirement: AUTH-03
    verification:
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#AUTH-03: session survives repeated getSession() calls (simulated browser refresh)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUTH-04: sign-out clears the session server-side; a subsequent getSession is unauthenticated"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "apps/api/test/auth.integration.test.ts#AUTH-04: sign-out clears the session; a subsequent getSession is unauthenticated"
        status: pass
    human_judgment: false
  - id: D7
    description: "/api/auth/* is registered ahead of the SPA fallback in buildApp() and is never shadowed by it (route-order regression guard, Pitfall 5)"
    requirement: null
    verification:
      - kind: integration
        ref: "apps/api/test/server.integration.test.ts#GET /api/auth/get-session reaches the better-auth handler (JSON response), never the SPA shell (Pitfall 5)"
        status: pass
    human_judgment: false
  - id: D8
    description: "seedInitialAdmin(prisma, email) idempotently upserts the INITIAL_ADMIN_EMAIL User row with emailVerified: true, wired into server.ts's boot sequence after loadEnv() and before buildApp()"
    requirement: null
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
      - kind: other
        ref: "AUTH-02's seeded-admin round-trip test (D4) exercises seedInitialAdmin directly via beforeEach"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-07-11
status: complete
---

# Phase 2 Plan 4: Magic-Link Auth Mount, Security Baseline & Admin Bootstrap Summary

**better-auth's `/api/auth/*` mounted into Fastify behind `@fastify/helmet`/`@fastify/rate-limit`, with an idempotent admin seed and a real-Postgres integration suite proving AUTH-01..04 and the D-01 neutral-response canary**

## Performance

- **Duration:** 23 min
- **Started:** 2026-07-11T12:27:00Z (approx.)
- **Completed:** 2026-07-11T12:50:00Z
- **Tasks:** 3
- **Files modified:** 10 (5 new: helmet.ts, rateLimit.ts, routes/auth.ts, admin-seed.ts, auth.integration.test.ts; 5 modified: app.ts, server.ts, lib/auth.ts, server.integration.test.ts, vitest.config.ts)

## Accomplishments

- Registered `@fastify/helmet` (CSP allowing `fonts.googleapis.com`/`fonts.gstatic.com` for Geist fonts, Pitfall 4) and `@fastify/rate-limit` (permissive global default + `MAGIC_LINK_RATE_LIMIT` — 5 req/15 min — applied only to `POST /api/auth/sign-in/magic-link` via a more specific static route, Pitfall 3).
- Mounted better-auth's `/api/auth/*` catch-all into `buildApp()` via the Fetch Request/Response bridge (`fromNodeHeaders`, no `reply.hijack()`), registered ahead of `registerStatic()`/`setNotFoundHandler` (Pitfall 5) and outside the `/api`-prefixed scope (its own route urls already include `/api/auth`, avoiding double-prefixing).
- Built `lib/admin-seed.ts`'s `seedInitialAdmin(prisma, email)` — idempotent `User` upsert (`emailVerified: true`) — wired into `server.ts`'s boot sequence after `loadEnv()`, so `disableSignUp: true` never locks out the first admin (Pitfall 1/A3, RESEARCH OQ-3 resolved with no schema-level global-admin flag).
- [BLOCKING] Discovered mid-execution that `lib/auth.ts`'s `auth` singleton was hardcoded to `db.ts`'s default Prisma client, making it impossible for tests to bind auth writes to the same transaction-wrapped client the rest of the test harness uses — refactored to a `createAuth(prisma)` factory (`auth = createAuth(defaultPrisma)` kept as the production default) and made `routes/auth.ts`'s `authRoute` a matching `authRoute(auth)` factory, mirroring the codebase's existing `canaryRoute(prisma)` convention.
- Wrote `auth.integration.test.ts` (7 tests, real Postgres via `setupFileEach.ts`, `lib/mailer.ts` mocked): AUTH-01 (mail sent for allowlisted email), the D-01 neutral-response canary (byte-identical response for allowlisted vs. never-seen email, mail sent only for the former), AUTH-02 happy path (seeded-admin round-trip → httpOnly session cookie) and two negatives (invalid token, already-used token), AUTH-03 (session survives repeated `getSession()`), and AUTH-04 (sign-out clears the session). Extended `server.integration.test.ts` with a route-order regression guard proving `/api/auth/get-session` reaches `auth.handler()`, never the SPA shell.

## Task Commits

Each task was committed atomically:

1. **Task 1: @fastify/helmet + @fastify/rate-limit plugins (D-07)** - `ba01c7a` (feat)
2. **Task 2: Mount /api/auth/* + admin seed + extend app.ts/server.ts registration order** - `ec67814` (feat)
3. **Task 3: Auth integration suite — neutral response canary + seeded-admin login + session + logout** - `094f95f` (test)

**Plan metadata:** committed as part of this SUMMARY finalization

## Files Created/Modified

- `apps/api/src/plugins/helmet.ts` - `registerHelmet(app)` — CSP allowing Google Fonts, inline styles, `data:` images
- `apps/api/src/plugins/rateLimit.ts` - `registerRateLimit(app)` (global 100/15min) + exported `MAGIC_LINK_RATE_LIMIT` (5/15min) for per-route use
- `apps/api/src/routes/auth.ts` - `authRoute(auth)` factory: `/api/auth/*` catch-all + a more specific tight-rate-limited `POST /api/auth/sign-in/magic-link` route
- `apps/api/src/lib/admin-seed.ts` - `seedInitialAdmin(prisma, email)` — idempotent User upsert for `INITIAL_ADMIN_EMAIL`
- `apps/api/src/lib/auth.ts` - Refactored `auth` singleton into `createAuth(prisma)` factory (`auth = createAuth(defaultPrisma)` kept as the production default)
- `apps/api/src/app.ts` - Registers helmet, rate-limit, then `authRoute(auth)` (auth bound to whichever `prisma` `buildApp()` receives) before `registerStatic`
- `apps/api/src/server.ts` - Seeds the admin (`await seedInitialAdmin(prisma, env.INITIAL_ADMIN_EMAIL)`) after `loadEnv()`, before `buildApp()`/`.listen()`
- `apps/api/test/auth.integration.test.ts` - 7 integration tests: AUTH-01, D-01 canary, AUTH-02 (+2 negatives), AUTH-03, AUTH-04
- `apps/api/test/server.integration.test.ts` - Adds the `/api/auth/get-session` route-order regression guard
- `apps/api/vitest.config.ts` - Adds `BASE_URL`/`BETTER_AUTH_SECRET`/`SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM` test-env placeholders

## Decisions Made

- `lib/auth.ts` is now a `createAuth(prisma)` factory rather than a bare singleton — the production import path (`auth = createAuth(defaultPrisma)`) is unchanged in behavior, but tests can now build a second instance bound to the transaction-wrapped Prisma client, keeping better-auth's own `User`/`Session`/`Verification` writes inside the same rolled-back transaction as the rest of a given test (D-09).
- The tight magic-link rate limit is scoped via a separate, more specific static route rather than branching inside the wildcard catch-all handler — cleaner separation, and it means every other better-auth endpoint (get-session, sign-out, etc.) stays on the permissive global default without any extra logic.
- `auth.integration.test.ts` deliberately omits `callbackURL` on verify requests so better-auth returns the session as JSON (asserting on `res.json().user.email` directly) rather than following a redirect — simpler and equally valid proof of AUTH-02, and it still asserts the `Set-Cookie`/`HttpOnly` header regardless of response mode.
- `lib/mailer.ts` is mocked wholesale (`vi.mock`) in the integration suite rather than routed through a real Mailpit container, per the plan's own stated preference to avoid a container dependency in unit CI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `vitest.config.ts`'s test env with `BASE_URL`/`BETTER_AUTH_SECRET`/`SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM`**
- **Found during:** Task 2 (mounting `authRoute` into `app.ts`)
- **Issue:** `app.ts` now transitively imports `lib/auth.ts` (and, through it, `lib/mailer.ts`) for EVERY test file that calls `buildApp()`, not just auth-specific ones. Those modules read `BASE_URL`/`BETTER_AUTH_SECRET`/`SMTP_*` directly from `process.env` at module-import time (by design, per their own header comments — `loadEnv()` would crash tests missing unrelated ENV keys). `vitest.config.ts`'s test env previously only set `DATABASE_URL`, so importing `app.ts` in ANY test would throw at import time.
- **Fix:** Added test-only placeholder values for the five missing keys to `vitest.config.ts`'s `test.env` block.
- **Files modified:** `apps/api/vitest.config.ts`
- **Verification:** Full suite run (`pnpm --filter @kurzly/api test -- --run`) — 34/34 passing after this fix, before Task 3's new tests existed.
- **Committed in:** `ec67814` (Task 2)

**2. [Rule 3 - Blocking] Refactored `lib/auth.ts`'s `auth` singleton into a `createAuth(prisma)` factory**
- **Found during:** Task 3 (writing/running `auth.integration.test.ts`)
- **Issue:** The `auth` instance built in `lib/auth.ts` was a module-level singleton whose `prismaAdapter` was permanently bound to `db.ts`'s DEFAULT Prisma client. Under Vitest that client points at a placeholder, unreachable `DATABASE_URL` (`localhost:5432/placeholder`), so the very first test (`AUTH-01`) failed with `DriverAdapterError: DatabaseNotReachable`. Simply repointing `db.ts`'s client at the real testcontainers URL would only trade one bug for another: it would run on a SEPARATE physical connection from `setupFileEach.ts`'s transaction-wrapped `prisma`, so writes made by `seedInitialAdmin(prisma, email)` inside that test's `BEGIN` block would be invisible to better-auth's own queries on the other connection, and better-auth's own `Verification`/`Session` writes would never be rolled back — breaking the D-09 test-isolation guarantee for every future test touching auth tables.
- **Fix:** Refactored `lib/auth.ts` to export `createAuth(prisma)` (mirrors `routes/canary.ts`'s existing `canaryRoute(prisma)` factory convention already established in this codebase) with `export const auth = createAuth(defaultPrisma)` kept for production use. `routes/auth.ts`'s `authRoute` became a matching `authRoute(auth)` factory. `app.ts`'s `buildApp({ prisma })` now builds `createAuth(options.prisma)` whenever a caller overrides `prisma` (tests), and otherwise uses the default `auth` singleton (no behavior change for production/`server.ts`).
- **Files modified:** `apps/api/src/lib/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/app.ts`
- **Verification:** Full suite green after this change — `pnpm --filter @kurzly/api test -- --run` → 42/42 passing (11 test files); `tsc --noEmit` clean.
- **Committed in:** `094f95f` (Task 3, bundled with the test file it was required to make pass)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues that prevented the plan's own stated verification commands from passing; no scope creep beyond what was strictly necessary to make the plan's declared behaviors true)
**Impact on plan:** Both fixes were prerequisites for Task 3's own `<verify>` command to succeed at all — no architectural surprise for future phases; the `createAuth(prisma)`/`authRoute(auth)` factory shape is a direct, minimal extension of a pattern (`canaryRoute(prisma)`) this codebase already used.

## Issues Encountered

- Confirmed empirically (reading better-auth 1.6.23's own `dist/plugins/magic-link/index.mjs` source, not assumed) that `sendMagicLink` fires unconditionally for every `POST /sign-in/magic-link` request regardless of user existence, and the endpoint always returns `ctx.json({status: true})` — this resolves RESEARCH.md's Open Question 1 empirically in addition to the plan's own canary test asserting it at the HTTP level.
- Confirmed the verify endpoint's redirect responses use HTTP 302 (`APIError.fromStatus("FOUND", ...)` in the underlying `better-call` router) and that omitting `callbackURL` on a verify request yields a direct JSON `{token, user, session}` response instead of a redirect — used this to simplify the AUTH-02 happy-path assertion.
- Confirmed no origin/CSRF middleware is attached to `sign-in/magic-link`, `sign-out`, or `get-session` (only `magic-link/verify`'s redirect-target URLs go through `originCheck`, and only for relative-path validation, not an `Origin` header check) — `fastify.inject()` requests (which don't set an `Origin` header) work without additional configuration.

## User Setup Required

None - no external service configuration required. `SMTP_*`/`BASE_URL`/`BETTER_AUTH_SECRET`/`INITIAL_ADMIN_EMAIL` were already established as required boot-time ENV in 02-01; this plan adds no new required ENV keys (the vitest.config.ts additions are test-only placeholders, not production config).

## Next Phase Readiness

- `POST /api/auth/sign-in/magic-link`, `GET /api/auth/magic-link/verify`, `GET /api/auth/get-session`, and `POST /api/auth/sign-out` are all live and proven end-to-end; the seeded admin can complete a full login round-trip on a fresh boot.
- `createAuth(prisma)`/`authRoute(auth)`'s factory shape is available for 02-05/02-06 (App Shell, auth-gated routes) to reuse if any future backend route needs a request-scoped auth instance; the default `auth`/`authRoute(auth)` wiring in `app.ts` needs no changes for those plans' frontend-focused work.
- `requireDomainAccess`/`scopedDomainIds` (02-03) remain unconsumed by any route — still correctly deferred to Phase 3+ per D-02's scope.
- No blockers for 02-05/02-06.

---
*Phase: 02-magic-link-auth-app-shell-domain-authorization-core*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 10 declared created/modified files found on disk; all 3 task commit hashes (`ba01c7a`, `ec67814`, `094f95f`) found in git log.
