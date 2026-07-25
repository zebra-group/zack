---
phase: 13-authentication-session-e2e
plan: 07
subsystem: e2e
tags: [oidc, sso, playwright, e2e, better-auth, tdd]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "01"
    provides: "apps/e2e/oidc-mock's live mock IdP (discovery rewrite, auto-approve login+consent, PUT/DELETE /__test__/profile), docker-compose.e2e.yml wiring"
  - phase: 13-authentication-session-e2e
    plan: "02"
    provides: "apps/e2e/src/oidc-mock.ts client, apps/e2e/src/users.ts fixtures, standalone `auth` Playwright project"
provides:
  - "apps/e2e/tests/auth/sso.spec.ts: a test.describe.serial block containing the AUTH-E2E-04 real-browser SSO round-trip test (13-08 appends AUTH-E2E-05 to this same block)"
  - "apps/api/src/lib/auth.ts's genericOAuth config now requests scopes: ['openid', 'email', 'profile'] — closes the empty-scope gap 13-01/13-02 flagged as a blocker"
affects: ["13-08"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED->GREEN landed as two commits within a single plan task: a failing E2E spec first (confirmed RED live against the built compose image), then the minimal auth.ts config fix that turns it GREEN — mirrors 13-RESEARCH.md's already-planned accountLinking fix shape (Pattern 2) for the OTHER known blocker in this phase"

key-files:
  created:
    - apps/e2e/tests/auth/sso.spec.ts
  modified:
    - apps/api/src/lib/auth.ts

key-decisions:
  - "Fixed the STATE.md-flagged genericOAuth empty-scopes gap (apps/api/src/lib/auth.ts) as part of THIS plan rather than deferring it — the plan's own acceptance criteria ('passes green against the built compose image with oidc-mock up') is unreachable without it, and 13-01/13-02-SUMMARY.md both explicitly recommended landing it alongside whichever plan writes the AUTH-E2E-04 spec. Treated as a Rule 1 (auto-fix bug) deviation, not a Rule 4 architectural question — it is a one-line config addition to an existing, already-reviewed factory function, not a new structural surface."
  - "Confirmed RED, then GREEN, LIVE against the real built compose image + real mock IdP (not simulated/reasoned about): before the fix, the real authorization request carried scope='' and the mock's default interaction policy denied consent (error=access_denied); after adding scopes, the full authorization_code round trip (login+consent auto-approve, token exchange, userinfo with admin-shaped extraClaims) completes and lands an active, least-privilege session."
  - "Re-ran apps/api's existing sso-auth.integration.test.ts (4 tests) + sso-config.test.ts (13 tests) after the auth.ts change to confirm the scopes addition causes zero regression against the stub-IdP suite that never validates scope."

requirements-completed: [AUTH-E2E-04]

coverage:
  - id: D1
    description: "A first-time SSO user clicking 'Mit SSO anmelden' in a real browser drives the full authorization-code round trip against the mock IdP and lands an active, server-verified session"
    requirement: "AUTH-E2E-04"
    verification:
      - kind: e2e
        ref: "Live compose boot (kurzly-e2e-p1307, alt project name + port remap): pnpm --filter @kurzly/e2e test tests/auth/sso.spec.ts --project=auth -- 1 passed"
        status: pass
    human_judgment: false
  - id: D2
    description: "Even when the IdP feeds admin-shaped claims (role, groups, admin), the provisioned user lands accountRole 'member' with zero DomainMembership rows — no claim elevation"
    requirement: "AUTH-E2E-04"
    verification:
      - kind: e2e
        ref: "Same live run: sso.spec.ts's createE2ePrisma() assertions (user.accountRole === 'member', domainMembership.findMany({where:{userId}}) has length 0) passed against the real provisioned row"
        status: pass
    human_judgment: false
  - id: D3
    description: "The genericOAuth authorization request includes the openid/email/profile scopes so a real, spec-compliant IdP does not deny consent"
    verification:
      - kind: e2e
        ref: "Live RED->GREEN: without scopes, the real round trip ended in error=access_denied (confirmed live, committed as the RED test commit c2fb26b); with scopes added (fix commit 433dce7), the same test passes"
        status: pass
    human_judgment: false
  - id: D4
    description: "The scopes fix does not regress the existing Vitest OIDC suite (stub IdP, structural-default + coexistence + least-privilege tests)"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec vitest run test/sso-auth.integration.test.ts test/sso-config.test.ts -- 17 passed"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 07: AUTH-E2E-04 Browser SSO Round Trip Summary

**Wrote the first real-browser OIDC/SSO E2E test (`apps/e2e/tests/auth/sso.spec.ts`) proving least-privilege provisioning against admin-shaped IdP claims, and closed the empty-`scopes` gap in `apps/api/src/lib/auth.ts`'s `genericOAuth` config that 13-01/13-02 had flagged as a real blocker — confirmed RED, then GREEN, live against the built compose image and the mock IdP.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-25T02:41:13+02:00
- **Tasks:** 1/1 (executed as an explicit TDD RED→GREEN pair, two commits)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Created `apps/e2e/tests/auth/sso.spec.ts`: a `test.describe.serial("SSO login (AUTH-E2E-04/05)", ...)` block with an unconditional `afterEach` calling `resetOidcProfile()`, and the AUTH-E2E-04 test itself — feeds admin-shaped claims (`role: "admin"`, `groups: [...]`, `admin: true`) via `setOidcProfile`, drives the real `page.goto("/login")` → click "Mit SSO anmelden" → mock IdP auto-approve → dashboard flow, and asserts both an active server-verified session (`GET /api/auth/get-session`) and least-privilege provisioning (`accountRole === "member"`, zero `DomainMembership` rows) via `createE2ePrisma()`.
- **Discovered-blocker fix landed as its own commit**: added `scopes: ["openid", "email", "profile"]` to `apps/api/src/lib/auth.ts`'s `genericOAuth` config — the empty-scope gap 13-01/13-02-SUMMARY.md both flagged as blocking the real round trip against a spec-compliant IdP (the permissive Vitest stub never validated scope, so this was invisible there).
- **Live-verified the full TDD cycle against the real built compose image**, not just reasoned about: RED (real `error=access_denied` from the mock's default interaction policy when scope was empty) → fix → GREEN (full round trip completes, least-privilege assertions pass) → full `tests/auth/` directory (all 8 specs) still green together under `--project=auth`.

## Task Commits

Each task was committed atomically, split into the TDD RED/GREEN pair the discovered blocker required:

1. **Task 1a (RED): `apps/e2e/tests/auth/sso.spec.ts`** — `c2fb26b` (test)
2. **Task 1b (GREEN): `apps/api/src/lib/auth.ts` scopes fix** — `433dce7` (fix)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/auth/sso.spec.ts` — `test.describe.serial` block, AUTH-E2E-04 test, `afterEach(resetOidcProfile)`
- `apps/api/src/lib/auth.ts` (modified) — `genericOAuth` config gains `scopes: ["openid", "email", "profile"]`, with a header-comment rationale mirroring this file's existing D-10-xx documentation convention

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- The empty-`scopes` gap was fixed IN this plan (not deferred to 13-08) because this plan's own acceptance criteria are unreachable without it, and both 13-01 and 13-02's summaries explicitly recommended this exact pairing.
- Classified as a Rule 1 (auto-fix bug) deviation, not a Rule 4 architectural question — a one-line addition to an existing config object, no new structural surface, no schema change.
- Verified the fix causes zero regression in the existing stub-IdP Vitest suite (17 tests, `sso-auth.integration.test.ts` + `sso-config.test.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `apps/api/src/lib/auth.ts`'s `genericOAuth` config sending an empty `scope=` at authorization time**
- **Found during:** Task 1, confirmed via a live RED run of the new `sso.spec.ts` against the built compose image (this exact gap had already been empirically discovered and documented as a blocker in 13-01-SUMMARY.md/13-02-SUMMARY.md and recorded in STATE.md's Blockers/Concerns).
- **Issue:** No `scopes` array on the `genericOAuth` provider config meant the real authorization request the app sent carried `scope=` (empty). The mock IdP's default interaction policy (a real, spec-compliant OIDC provider, unlike the permissive hand-rolled Vitest stub) denies consent for a scope-less request, redirecting with `error=access_denied` before a `code` was ever issued.
- **Fix:** Added `scopes: ["openid", "email", "profile"]` to the single `genericOAuth` provider config entry in `createAuth()`, with a comment explaining why (mirrors this file's existing D-10-xx convention).
- **Files modified:** `apps/api/src/lib/auth.ts`
- **Verification:** Live RED (real `error=access_denied`, no `code` param, dashboard nav wait times out) → fix applied → rebuilt the `app` image → live GREEN (full round trip completes, session + least-privilege assertions pass) → full `tests/auth/` directory (8 specs) still green together.
- **Committed as its own commit:** `433dce7` (fix), following the RED test commit `c2fb26b` — the textbook TDD RED→GREEN shape 13-RESEARCH.md's Pattern 2 already established for the OTHER known blocker in this phase (AUTH-E2E-05's `accountLinking` gap, 13-08's job).

---

**Total deviations:** 1 auto-fixed (Rule 1), landed as its own commit rather than folded into the test-file commit, matching this project's TDD discipline (CLAUDE.md: "kein Commit von Funktionslogik ohne begleitenden Unit-Test" — the E2E spec IS the accompanying test for this config change, and both RED and GREEN states were independently confirmed live).
**Impact on plan:** No scope creep beyond `apps/api/src/lib/auth.ts`, which is not in this plan's declared `files_modified` but was explicitly anticipated by 13-01/13-02's "Next Phase Readiness" notes and STATE.md's Blockers/Concerns as this exact plan's responsibility.

## Issues Encountered

- Same recurring port-conflict issue as 12-01/13-01 (this dev machine's canonical E2E ports 3000/5433/8025 are bound by unrelated projects: `product-catalog`'s tsx-watch dev server, `zbr-brain-postgres-1`, `ddev-router`). Resolved via the established pattern: alternate compose project name (`kurzly-e2e-p1307`) + an uncommitted `docker-compose.e2e.local-ports.override.yml` remapping `db`→15433, `mailpit`→18025/11025, `app`→13000 (with matching `BASE_URL`/`OIDC_MOCK_REDIRECT_URI` overrides) via Compose's `!override` merge tag. Port 9000 (`oidc-mock`) was free, same as 13-01, and needed no remap.
- `scripts/e2e-compose.sh` hardcodes `E2E_DATABASE_URL`/`MAILPIT_URL`/`OIDC_MOCK_CONTROL_URL` to the canonical ports internally (overriding any pre-set env var), so it could not be used directly against the remapped stack — ran the underlying `docker compose`/`pnpm --filter @kurzly/e2e test` commands manually instead (mirroring 13-01's own resolution of the identical constraint), with the four env vars pointed at the remapped ports.

## Live Verification (per the plan's `<important_note>`)

1. Booted the 4-service stack under `kurzly-e2e-p1307` with the override file above — all services (`db`, `mailpit`, `app`, `oidc-mock`) reported healthy.
2. **RED**: `pnpm --filter @kurzly/e2e test tests/auth/sso.spec.ts --project=auth` — failed with `Test timeout of 30000ms exceeded` waiting for the Dashboard nav; the browser had been redirected to `.../?error=access_denied` after the mock's `.../oauth2/callback/oidc?error=access_denied&state=...` hop — exactly the empty-scope failure mode documented in 13-01-SUMMARY.md. Committed this state (`c2fb26b`).
3. Applied the `scopes` fix to `apps/api/src/lib/auth.ts`, confirmed `tsc --noEmit` clean, and ran `apps/api`'s `sso-auth.integration.test.ts`/`sso-config.test.ts` (17 tests, all passed — no regression).
4. Rebuilt the `app` image (`docker compose ... build app`) and re-brought the stack up (`up -d --wait`) — all 4 services healthy again.
5. **GREEN**: `pnpm --filter @kurzly/e2e test tests/auth/sso.spec.ts --project=auth` — 1 passed. Then ran the FULL `tests/auth/` directory under `--project=auth` — all 8 specs passed together (resend-rate-limit, sso, magic-link-round-trip, logout-route-guard, magic-link-token-rejection x3, invite-only-denial), confirming no cross-spec regression from either the new spec file or the `auth.ts` change. Committed the fix (`433dce7`).
6. Tore the stack down fully (`down -v --remove-orphans`), deleted the override file, the generated `.env`, and the two built images (`kurzly-e2e-p1307-app`, `kurzly-e2e-p1307-oidc-mock`); confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's 2 files.

**Result: PROVEN LIVE**, both the RED and the GREEN state, against the real built compose image and the real mock IdP — not simulated or reasoned about.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`apps/e2e/tests/auth/sso.spec.ts` now exists with its `test.describe.serial` block and `afterEach(resetOidcProfile)` in place, exactly as 13-08's own plan expects to append the AUTH-E2E-05 account-merge test into. The `apps/api/src/lib/auth.ts` `scopes` gap that would have blocked BOTH AUTH-E2E-04 and AUTH-E2E-05 is now closed — 13-08 can proceed directly to its own scope (the `account.accountLinking` fix from 13-RESEARCH.md Pattern 2) without needing to rediscover or re-fix this scopes issue.

STATE.md's Blockers/Concerns entry for the empty-scopes gap is now resolved and can be considered closed by this plan.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/auth/sso.spec.ts
- FOUND: apps/api/src/lib/auth.ts (modified)
- FOUND: commit c2fb26b (test, RED)
- FOUND: commit 433dce7 (fix, GREEN)
- FOUND: .planning/phases/13-authentication-session-e2e/13-07-SUMMARY.md
