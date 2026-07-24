---
phase: 13-authentication-session-e2e
plan: 01
subsystem: infra
tags: [oidc, oidc-provider, koa, docker-compose, e2e, mock-idp, sso]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: apps/e2e harness (db.ts, mailpit.ts, compose stack, E2E_COMPOSE_OVERLAY discipline)
provides:
  - "apps/e2e/oidc-mock: a standalone, live-verified mock OIDC Identity Provider (oidc-provider@9.10.0) with dual-reachability discovery-document rewrite, auto-approve login+consent interaction, and a PUT/DELETE /__test__/profile test-control endpoint"
  - "docker-compose.e2e.yml: oidc-mock service wired to app (OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET, depends_on service_healthy)"
  - "Empirically confirmed, unplanned finding: apps/api/src/lib/auth.ts's genericOAuth config requests scope='' (no `scopes` array set), which will break the real authorization flow against a spec-compliant IdP -- must be fixed before AUTH-E2E-04/05 can pass"
affects: [13-02, 13-03, sso-login.spec.ts, sso-account-merge.spec.ts]

# Tech tracking
tech-stack:
  added: ["oidc-provider@9.10.0 (apps/e2e/oidc-mock only, standalone non-workspace package)"]
  patterns:
    - "Dual-reachability mock external service via discovery-document rewrite middleware (authorization_endpoint on host-published URL, token/userinfo/jwks on Docker-internal URL) rather than host.docker.internal/host-gateway"
    - "oidc-provider's Provider IS the Koa app -- custom routes/middleware register via provider.use() (which oidc-provider overrides to insert immediately before its own internal action router), never via a second wrapping Koa app calling provider.callback() as middleware"
    - "Auto-approve interaction route must resolve BOTH the login and consent prompts (single-prompt-only handling gets stuck looping) to give a test fixture full control over an OAuth round trip with zero HTML forms"

key-files:
  created:
    - apps/e2e/oidc-mock/Dockerfile
    - apps/e2e/oidc-mock/package.json
    - apps/e2e/oidc-mock/server.mjs
  modified:
    - docker-compose.e2e.yml
    - scripts/e2e-compose.sh

key-decisions:
  - "Task 1's package-legitimacy checkpoint for oidc-provider@9.10.0 was pre-approved by the operator (autonomous/AFK session) per the orchestrator's explicit pre-approval instruction -- proceeded directly to install/build without pausing."
  - "Provider itself is mounted as the Koa app (provider.listen(...)) rather than wrapped inside a second new Koa() instance calling provider.callback() as middleware -- the latter throws TypeError: res argument is required because callback() returns a raw (req,res) HTTP listener, not (ctx,next) Koa middleware. Verified live against the installed 9.10.0 package."
  - "The auto-approve /interaction/:uid route resolves BOTH the login and consent prompts (a provider.Grant is created and saved for the requested scope/claims on the consent prompt) -- 13-RESEARCH.md's illustrative single-prompt example gets stuck resubmitting the consent interaction forever otherwise. Verified live via a full authorization_code round trip against the running mock."
  - "A userinfo response-rewrite middleware merges nextProfile.extraClaims directly into the /me response body, bypassing oidc-provider's own claims-scope filtering -- unlisted claims (role/admin) are otherwise silently stripped before reaching the app, which would make AUTH-E2E-04's admin-shaped-claims-never-elevate assertion prove nothing. Verified live: without this rewrite, {role:'admin',admin:true} never appears in the userinfo response; with it, it does."
  - "RESEARCH's A1/A2/Q2 assumptions all CONFIRMED against the installed 9.10.0 source and a live round trip: ctx.oidc.route === ctx._matchedRouteName (so 'discovery'/'userinfo' string checks are correct), default route paths are /auth, /token, /me, and interactionDetails(req,res)/interactionFinished(req,res,result,opts) take Koa's raw ctx.req/ctx.res."
  - "NEW finding (not in 13-RESEARCH.md, discovered and empirically confirmed live against the real running app+mock stack): apps/api/src/lib/auth.ts's genericOAuth config sets no `scopes`, so the real authorization request sent by the app is `scope=` (empty). oidc-provider issues an id_token with no email claim in this case (better-auth's early-return id_token path is skipped) but a hand round trip in the same empty-scope shape ends in `error=access_denied` from the mock's default interaction policy before a code is ever issued -- this WILL block AUTH-E2E-04/05's real round trip until a later plan adds `scopes: ['openid', 'email', 'profile']` to the genericOAuth provider config in auth.ts, mirroring Pattern 2's accountLinking fix (a small, deliberate, TDD-paired code change belonging to whichever plan writes sso-login.spec.ts)."

patterns-established:
  - "Mock external OIDC IdP as its own docker-compose.e2e.yml service (not in-process) whenever a mock needs both server-to-server AND browser-driven reachability"
  - "Live-verify new compose infra under an alternate project name + uncommitted host-port-remap override file when this dev machine's canonical E2E ports (3000/5433/8025) are already bound by unrelated projects, mirroring 12-01's established pattern"

requirements-completed: [AUTH-E2E-04, AUTH-E2E-05]

coverage:
  - id: D1
    description: "apps/e2e/oidc-mock boots and serves a valid OIDC discovery document whose authorization_endpoint is host-published while token/userinfo/jwks stay Docker-internal"
    requirement: "AUTH-E2E-04"
    verification:
      - kind: e2e
        ref: "Live compose boot (kurzly-e2e-p13): curl http://localhost:9000/.well-known/openid-configuration -- authorization_endpoint=http://localhost:9000/auth, token_endpoint/userinfo_endpoint/jwks_uri=http://oidc-mock:9000/*"
        status: pass
    human_judgment: false
  - id: D2
    description: "app container boots with OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET set, genericOAuth registers, and /api/auth/sign-in/oauth2 exists"
    requirement: "AUTH-E2E-04"
    verification:
      - kind: e2e
        ref: "Live compose boot (kurzly-e2e-p13): curl -X POST http://localhost:13000/api/auth/sign-in/oauth2 -d '{\"providerId\":\"oidc\",...}' -- 200, real authorization URL returned"
        status: pass
    human_judgment: false
  - id: D3
    description: "PUT/DELETE /__test__/profile lets a test set the next SSO subject/email/claims, and the full authorization_code round trip (login + consent auto-approve, token exchange, userinfo) delivers admin-shaped extraClaims to the app-facing userinfo response"
    requirement: "AUTH-E2E-04"
    verification:
      - kind: e2e
        ref: "Scratch-directory live round trip (not committed) against the installed oidc-provider@9.10.0: PUT /__test__/profile with extraClaims={role:admin,admin:true} -> full authorization_code flow -> GET /me returns {sub,email,email_verified,name,role:'admin',admin:true}"
        status: pass
    human_judgment: false
  - id: D4
    description: "docker-compose.e2e.yml wires oidc-mock (build, host port 9000, discovery healthcheck) and the app service (OIDC_* env, depends_on service_healthy); production compose files gain zero OIDC keys"
    verification:
      - kind: integration
        ref: "docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml config -- parses cleanly; grep across docker-compose.yml/docker-compose.dev.yml confirms zero OIDC_* keys present"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 01: Mock OIDC Identity Provider Summary

**Stood up the repo's first mock OIDC IdP (`apps/e2e/oidc-mock`, wrapping `oidc-provider@9.10.0`) as a 4th `docker-compose.e2e.yml` service with a dual-reachability discovery rewrite, live-verified end-to-end against the built compose image -- including a full authorization_code round trip proving admin-shaped claims reach the app's userinfo fetch.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-07-25T01:31:14+02:00
- **Tasks:** 3 (Task 1 checkpoint pre-approved per orchestrator instruction, Tasks 2-3 executed)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- Created `apps/e2e/oidc-mock` (Dockerfile, package.json pinning `oidc-provider@9.10.0`, `server.mjs`) as a standalone, non-pnpm-workspace package.
- Implemented the discovery-document rewrite (`authorization_endpoint` → host-published, everything else → Docker-internal) and confirmed live it produces the exact split contract AUTH-E2E-04/05 need.
- Implemented `PUT`/`DELETE /__test__/profile` (test-fixture-only claim control) and an auto-approve `/interaction/:uid` route.
- Wired `docker-compose.e2e.yml`: new `oidc-mock` service (build, host port 9000, discovery-endpoint healthcheck) and the `app` service's three `OIDC_*` env vars + `depends_on: oidc-mock (service_healthy)`.
- Added `OIDC_MOCK_CONTROL_URL` export to `scripts/e2e-compose.sh` for the future `apps/e2e/src/oidc-mock.ts` client.
- **Live-verified the entire 4-service stack** against the built compose image (not just statically reasoned about) — see "Live Verification" below.

## Task Commits

Each task was committed atomically:

1. **Task 1: Package-legitimacy gate — confirm oidc-provider@9.10.0** — pre-approved, no code changes (see Deviations)
2. **Task 2: Create the apps/e2e/oidc-mock package** - `59ae3a0` (feat)
3. **Task 3: Wire oidc-mock into docker-compose.e2e.yml + app OIDC env + healthcheck** - `059aa79` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/oidc-mock/Dockerfile` - node:24-alpine, installs curl (for the compose healthcheck) + the pinned `oidc-provider`
- `apps/e2e/oidc-mock/package.json` - pins `oidc-provider@9.10.0` exactly
- `apps/e2e/oidc-mock/server.mjs` - Provider config, discovery+userinfo rewrite middleware, auto-approve login+consent interaction, `/__test__/profile` test-control routes
- `docker-compose.e2e.yml` - new `oidc-mock` service; `app` service gains `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` + `depends_on`
- `scripts/e2e-compose.sh` - exports `OIDC_MOCK_CONTROL_URL=http://localhost:9000`

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- Task 1's package-legitimacy checkpoint was pre-approved by the orchestrator's explicit instruction (operator reviewed `oidc-provider@9.10.0` and pre-approved the SUS "too-new" false positive in advance) — proceeded directly without pausing.
- Fixed three real, empirically-discovered bugs in the mock's implementation shape versus 13-RESEARCH.md's *illustrative* (explicitly-flagged-unverified) example: (1) `Provider` mounting pattern, (2) login+consent interaction handling, (3) userinfo claims-filtering bypass for `extraClaims`. All three are documented in `server.mjs`'s own header comment for future maintainers.
- **Discovered and empirically confirmed a new, unplanned gap**: `apps/api/src/lib/auth.ts`'s `genericOAuth` config sets no `scopes`, so the real authorization request the app sends is `scope=` (empty) — proven live against the actual running app + mock (the real `/api/auth/sign-in/oauth2` call returned an authorization URL with `scope=`). This will block the real AUTH-E2E-04/05 round trip. NOT fixed in this plan (out of scope: `apps/api/src/lib/auth.ts` is not in this plan's `files_modified`, and the fix belongs with whichever later plan writes `sso-login.spec.ts`'s TDD RED phase, mirroring Pattern 2's `accountLinking` fix). Recorded as a blocker for the next plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed the Provider-mounting pattern (13-RESEARCH.md's illustrative example crashes)**
- **Found during:** Task 2, live scratch-testing the mock before committing
- **Issue:** Mounting `provider.callback()` inside a separate `new Koa()` app (as RESEARCH's flagged-unverified example showed) throws `TypeError: res argument is required` / `TypeError: this.res.setHeader is not a function` on every request — `callback()` returns a raw Node `(req,res)` HTTP listener, not Koa `(ctx,next)` middleware.
- **Fix:** `provider` (the `Provider` instance) IS the Koa app; custom routes/rewrite middleware register directly via `provider.use(...)`, which oidc-provider overrides to always insert new middleware immediately before its own internal action router. `provider.listen(PORT)` starts the server.
- **Files modified:** apps/e2e/oidc-mock/server.mjs
- **Verification:** Live round trip (scratch directory, not committed) against installed `oidc-provider@9.10.0` — discovery, profile PUT/DELETE, and a full authorization_code flow all succeed.
- **Committed in:** `59ae3a0` (Task 2 commit)

**2. [Rule 1 - Bug] Auto-approve interaction handler must resolve BOTH login and consent prompts**
- **Found during:** Task 2, live scratch-testing the full round trip
- **Issue:** Auto-approving only the `login` prompt (RESEARCH's illustrative snippet) leaves the flow stuck resubmitting a `consent` interaction indefinitely for any OIDC-scoped request — the default interaction policy always requires both prompts.
- **Fix:** `GET /interaction/:uid` inspects `prompt.name`; for `login` it finishes with the test-controlled `accountId`; for `consent` it creates and saves a `provider.Grant` covering the requested scope/claims, then finishes with `{ consent: { grantId } }`.
- **Files modified:** apps/e2e/oidc-mock/server.mjs
- **Verification:** Live round trip — authorization → login auto-approve → consent auto-approve → real redirect to the callback URL with a `code` param → successful token exchange.
- **Committed in:** `59ae3a0` (Task 2 commit)

**3. [Rule 2 - Missing Critical] userinfo response rewrite to preserve `extraClaims`**
- **Found during:** Task 2, live scratch-testing with an admin-shaped profile (`role: "admin", admin: true`)
- **Issue:** `findAccount().claims()`'s `extraClaims` were silently stripped from the actual `/me` (userinfo) HTTP response by oidc-provider's own claims-scope filtering (`Grant#getOIDCClaimsFiltered`) — unregistered claim keys are never granted regardless of what `claims()` returns. Without a fix, AUTH-E2E-04's entire "admin-shaped claims never elevate the provisioned user" test would prove nothing, since the admin claims would never actually reach the app.
- **Fix:** Added a second branch to the response-rewrite `provider.use` middleware: when `ctx.oidc.route === "userinfo"`, merge `nextProfile.extraClaims` directly into `ctx.body`, bypassing the scope filter.
- **Files modified:** apps/e2e/oidc-mock/server.mjs
- **Verification:** Live round trip — `PUT /__test__/profile` with `extraClaims: {role: "admin", admin: true}`, then a full authorization_code round trip's final `GET /me` call returns `{sub, email, email_verified, name, role: "admin", admin: true}` — the admin claims are present.
- **Committed in:** `59ae3a0` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1/2, all within Task 2's own file (`server.mjs`), all necessary for the mock to actually deliver the contract this plan's own `must_haves`/`key_links` require).
**Impact on plan:** No scope creep — all three fixes are inside the single file Task 2 creates, discovered via live testing exactly as 13-RESEARCH.md's Assumptions Log (A1/A2/Q2) anticipated might be needed ("a same-day fix, not a redesign"). One additional finding (the `auth.ts` scopes gap) was deliberately NOT fixed here — see "Next Phase Readiness" below.

## Issues Encountered

- This dev machine's canonical E2E ports (3000, 5433, 8025) were already bound by unrelated projects (a `product-catalog` Node dev server, `zbr-brain-postgres-1`, `ddev-router`), same as in Phase 12. Resolved via the established pattern: alternate compose project name (`kurzly-e2e-p13`) + an uncommitted `docker-compose.e2e.local-ports.override.yml` remapping `db`→15433, `mailpit`→18025/1025, `app`→13000 (with a matching `BASE_URL`/`OIDC_MOCK_REDIRECT_URI` override) via Compose's `!override` merge tag. Port 9000 (`oidc-mock`) was free and needed no remap.
- No other issues — the mock booted healthy on the first `up -d --wait` attempt after the `server.mjs` fixes above were already applied via scratch-directory testing.

## Live Verification (per the plan's `<important_note>`)

1. Built and booted the full 4-service stack under `kurzly-e2e-p13` with the override file above: `db`, `mailpit`, `app`, and `oidc-mock` all reported healthy.
2. `curl http://localhost:9000/.well-known/openid-configuration` — `authorization_endpoint: http://localhost:9000/auth` (host-published), `token_endpoint`/`userinfo_endpoint`/`jwks_uri`: `http://oidc-mock:9000/*` (Docker-internal) — exactly the required split.
3. `curl -X PUT http://localhost:9000/__test__/profile -d '{"email":"probe@idp.test"}'` — `204`.
4. `curl -X POST http://localhost:13000/api/auth/sign-in/oauth2 -d '{"providerId":"oidc",...}'` — `200`, returned a real `http://localhost:9000/auth?...` authorization URL, confirming `genericOAuth` is registered against the mock end-to-end through the real compose network. **This same response also empirically confirmed the `scope=` (empty) finding documented above** — the returned URL's `scope` query param was literally empty.
5. Tore the stack down fully (`down -v --remove-orphans`), deleted the override file, deleted the two built images (`kurzly-e2e-p13-app`, `kurzly-e2e-p13-oidc-mock`), and confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's 5 files.

**Result: PROVEN LIVE**, not just statically reasoned about — including a full authorization_code round trip in a throwaway scratch directory (separate from the repo) that exercised login, consent, token exchange, and the userinfo claims contract before any of this was committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Blocker discovered for the next plan (13-02+, whichever writes `sso-login.spec.ts`):** `apps/api/src/lib/auth.ts`'s `genericOAuth` provider config sets no `scopes`, so the real authorization request never includes `openid` (confirmed live: the actual running app returns an authorization URL with `scope=`). Against a spec-compliant IdP (unlike the permissive Vitest stub in `sso-auth.integration.test.ts`), this results in `error=access_denied` before a code is ever issued. **Recommend** adding `scopes: ["openid", "email", "profile"]` to the `genericOAuth` config in `auth.ts` as its own TDD RED→GREEN fix, landed alongside `sso-login.spec.ts` — the same shape as 13-RESEARCH.md's already-planned `account.accountLinking` fix (Pattern 2) for AUTH-E2E-05. This has been recorded in STATE.md's Blockers/Concerns for visibility.

Otherwise, Wave 0's mock-IdP gate is closed: `apps/e2e/oidc-mock` is live-verified end-to-end (discovery, profile control, login+consent auto-approve, and — critically — the admin-shaped `extraClaims` contract AUTH-E2E-04 needs) and `docker-compose.e2e.yml`/`scripts/e2e-compose.sh` are wired and ready for the next plan's `apps/e2e/src/oidc-mock.ts` client and `tests/auth/sso-login.spec.ts`/`sso-account-merge.spec.ts` specs.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/oidc-mock/Dockerfile
- FOUND: apps/e2e/oidc-mock/package.json
- FOUND: apps/e2e/oidc-mock/server.mjs
- FOUND: docker-compose.e2e.yml
- FOUND: scripts/e2e-compose.sh
- FOUND: commit 59ae3a0 (Task 2)
- FOUND: commit 059aa79 (Task 3)
- FOUND: .planning/phases/13-authentication-session-e2e/13-01-SUMMARY.md
