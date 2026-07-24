---
phase: 11-playwright-e2e-infrastructure-fixtures
plan: 02
subsystem: infra
tags: [fastify, rate-limit, e2e, security, testing]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 01)
    provides: "@kurzly/e2e workspace scaffold + Prisma-client subpath export proof"
provides:
  - "Env-gated x-e2e-bypass rate-limit bypass mechanism in apps/api/src/plugins/rateLimit.ts (registerRateLimit)"
  - "Proof that E2E_RATE_LIMIT_BYPASS_SECRET is structurally absent from envSchema/.env.example"
affects: [11-03, 11-04, 11-05, 11-06, "Phase 12/13 E2E specs that will send the x-e2e-bypass header via Playwright fixtures"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@fastify/rate-limit's allowList function option set once at global plugin registration, covering both the global default bucket and every named per-route override (no per-route edits needed)"
    - "Env vars that must be structurally impossible to set in production are read directly from process.env, never added to env.ts's envSchema — proven by a dedicated schema-absence test rather than by convention alone"

key-files:
  created:
    - apps/api/test/rate-limit-bypass.test.ts
  modified:
    - apps/api/src/plugins/rateLimit.ts

key-decisions:
  - "allowList (not a custom keyGenerator hack) is the correct @fastify/rate-limit mechanism for full request exclusion — verified against the installed package's own README before implementing"
  - "E2E_RATE_LIMIT_BYPASS_SECRET is read directly from process.env inside registerRateLimit, never added to envSchema/.env.example, so it cannot be documented or accidentally shipped as a production config key"
  - "allowList option value is undefined (not a falsy function) when the secret is unset, keeping production/dev behavior byte-identical to before this change"

patterns-established:
  - "Security-sensitive test-only env vars: read from process.env directly + a dedicated test asserting absence from envSchema.shape, rather than adding to the schema with a 'do not use in prod' comment"

requirements-completed: [INFRA-06]

coverage:
  - id: D1
    description: "A request carrying the correct x-e2e-bypass header is fully excluded from the magic-link rate-limit bucket when E2E_RATE_LIMIT_BYPASS_SECRET is set"
    requirement: "INFRA-06"
    verification:
      - kind: integration
        ref: "apps/api/test/rate-limit-bypass.test.ts#Test A: a request carrying the correct x-e2e-bypass header is excluded from the magic-link limit"
        status: pass
    human_judgment: false
  - id: D2
    description: "With the secret set but no header, the real per-route limit still returns 429 (no leaky bypass)"
    requirement: "INFRA-06"
    verification:
      - kind: integration
        ref: "apps/api/test/rate-limit-bypass.test.ts#Test B: with the secret set but no header, the real per-route limit still returns 429"
        status: pass
    human_judgment: false
  - id: D3
    description: "With E2E_RATE_LIMIT_BYPASS_SECRET unset, a leaked x-e2e-bypass header does nothing — the real limit still bites"
    requirement: "INFRA-06"
    verification:
      - kind: integration
        ref: "apps/api/test/rate-limit-bypass.test.ts#Test C: with E2E_RATE_LIMIT_BYPASS_SECRET unset, a leaked x-e2e-bypass header does nothing (still 429)"
        status: pass
    human_judgment: false
  - id: D4
    description: "E2E_RATE_LIMIT_BYPASS_SECRET is provably absent from envSchema.shape and .env.example, so it can never be set through a documented production config surface"
    requirement: "INFRA-06"
    verification:
      - kind: unit
        ref: "apps/api/test/rate-limit-bypass.test.ts#E2E_RATE_LIMIT_BYPASS_SECRET is not a key of envSchema.shape"
        status: pass
      - kind: unit
        ref: "apps/api/test/env-example-drift.test.ts#documents exactly the set of keys the schema requires"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 02: Rate-Limit E2E Bypass Summary

**Env-gated `x-e2e-bypass` allowList added to `registerRateLimit` via `@fastify/rate-limit`'s built-in `allowList` option — real server-side gate, not a test-client cheat, proven by three integration tests plus a schema-absence guard.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-24T15:55:00Z (approx.)
- **Completed:** 2026-07-24T16:07:00Z (approx.)
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `registerRateLimit` now reads `process.env.E2E_RATE_LIMIT_BYPASS_SECRET` directly and passes it into `@fastify/rate-limit`'s `allowList` function option — omitted entirely (not just falsy) when unset, keeping production/dev behavior byte-identical to before this change.
- Three integration tests (`fastify.inject` against a real `buildApp({ prisma })` instance, matching `canary.integration.test.ts`'s established pattern) pin the three required behaviors: bypass-with-secret+header, real-429-with-secret-but-no-header, and no-op-when-secret-unset.
- A dedicated test proves `E2E_RATE_LIMIT_BYPASS_SECRET` is NOT a key of `envSchema.shape`, and the existing `.env.example`/`envSchema` drift guard (`env-example-drift.test.ts`) still passes unchanged — the secret is structurally confined to test-only config surfaces (it can only ever reach the process via the future e2e-compose overlay's inline `environment:` or a CI job's `env:` step, both later plans' scope).
- No file under `apps/api/src/routes/` was touched — the bypass covers the global bucket and every named per-route override (including `MAGIC_LINK_RATE_LIMIT`) purely via the single global-registration `allowList`, per `@fastify/rate-limit`'s own documented encapsulation-scope behavior (verified directly against the installed package's README before implementing).

## Task Commits

Each task was committed atomically (TDD RED→GREEN for Task 1):

1. **Task 1 RED: failing test for env-gated bypass** - `019d107` (test)
2. **Task 1 GREEN: extend registerRateLimit with allowList** - `a5d2f6e` (feat)

**Task 2** (env-schema-absence guard test) was written as part of the same test file in the Task 1 RED commit (`019d107`) — see Deviations below. Its acceptance criteria were independently re-verified after the GREEN commit.

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/test/rate-limit-bypass.test.ts` - Three integration tests (Test A/B/C) proving the bypass mechanism's three required behaviors, plus a unit test asserting `E2E_RATE_LIMIT_BYPASS_SECRET` is absent from `envSchema.shape`.
- `apps/api/src/plugins/rateLimit.ts` - `registerRateLimit` extended to read `process.env.E2E_RATE_LIMIT_BYPASS_SECRET` and conditionally pass an `allowList` function option to `@fastify/rate-limit`'s global registration.

## Decisions Made
- Verified `@fastify/rate-limit@11.1.0`'s actual installed README before implementing, confirming `allowList` set at global registration "will affect all endpoints within the encapsulation scope" (including route-level `config.rateLimit` overrides like `MAGIC_LINK_RATE_LIMIT`) — this is why no `routes/*.ts` edits were needed, matching the plan's acceptance criterion.
- Kept the probe email (`ratelimit-probe@example.com`) unseeded/non-allowlisted deliberately — rate-limiting is enforced at the `onRequest` hook, before better-auth's handler runs the allowlist check, so the neutral 200/429 status codes under test are independent of whether the email is a real seeded user.

## Deviations from Plan

### Auto-fixed Issues

None.

### Structural note (not a deviation from acceptance criteria, but worth flagging)

**Task 2's guard test was written together with Task 1's RED commit, not as a separate later commit.** The plan structures the env-schema-absence guard as Task 2, added to `apps/api/test/rate-limit-bypass.test.ts` after Task 1's GREEN. Since both tests belong in the same file and the schema-absence assertion is independent of the RED/GREEN implementation cycle (it passes whether or not the bypass mechanism exists), it was included in the file from the first (RED) commit rather than added in a distinct follow-up commit. All of Task 2's acceptance criteria were independently verified after the GREEN commit:
- `Object.keys(envSchema.shape)` does not include `"E2E_RATE_LIMIT_BYPASS_SECRET"` — confirmed by the dedicated test, passing.
- `test/env-example-drift.test.ts` still passes unchanged — confirmed via `pnpm --filter @kurzly/api exec vitest run test/rate-limit-bypass.test.ts test/env-example-drift.test.ts` (6/6 tests green).
- `.env.example` does not contain `E2E_RATE_LIMIT_BYPASS_SECRET` — confirmed via grep (0 matches).

No additional commit was made for Task 2 since no additional code changes were required beyond what Task 1's RED commit already delivered.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None — plan's stated behaviors and acceptance criteria fully satisfied; the only difference from the plan's literal task/commit sequencing is documented above.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. `E2E_RATE_LIMIT_BYPASS_SECRET` will be set only in the future e2e compose overlay/CI job (later plans in this phase), never requiring manual operator action for this plan.

## Next Phase Readiness
- The rate-limit bypass mechanism (INFRA-06) is complete and proven — downstream plans in this phase (Mailpit wiring, DB isolation, auth.setup.ts, CI wiring) can now send the `x-e2e-bypass` header via a shared Playwright `extraHTTPHeaders` default without tripping `MAGIC_LINK_RATE_LIMIT` or any other per-route limit.
- No blockers. The one dedicated rate-limit-proof spec that deliberately omits the header (Phase 13's AUTH-E2E-07 scope) can rely on this plan's Test B/C behavior already being proven at the unit/integration level.

---
*Phase: 11-playwright-e2e-infrastructure-fixtures*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/api/test/rate-limit-bypass.test.ts
- FOUND: apps/api/src/plugins/rateLimit.ts
- FOUND: .planning/phases/11-playwright-e2e-infrastructure-fixtures/11-02-SUMMARY.md
- FOUND: commit 019d107
- FOUND: commit a5d2f6e
