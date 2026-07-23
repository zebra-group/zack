---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
plan: 04
subsystem: infra
tags: [zod, env-validation, fail-fast, config, secrets]

# Dependency graph
requires:
  - phase: 01-test-infrastructure-monorepo-deployment-scaffolding (plan 01-02)
    provides: apps/api pnpm workspace package scaffold (package.json, tsconfig, vitest config)
provides:
  - "apps/api/src/env.ts: parseEnv() + loadEnv() fail-fast ENV validation gate"
  - ".env.example documenting every ENV variable with placeholder values"
  - "env-example-drift.test.ts guarding schema/.env.example documentation parity"
affects: [01-05, 01-06, 01-07, 01-08, 01-09, "phase-2-auth (BETTER_AUTH_SECRET, SMTP consumers)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-fast boot validation: pure parseEnv() (unit-testable, discriminated result) wrapped by loadEnv() (prints formatted Zod issues to stderr, process.exit(1) on invalid config)"
    - "Schema-as-source-of-truth drift guard: .env.example key set is asserted equal to envSchema.shape keys via a dedicated test, preventing silent documentation rot"

key-files:
  created:
    - apps/api/src/env.ts
    - apps/api/test/env.test.ts
    - apps/api/test/env-example-drift.test.ts
    - .env.example
  modified: []

key-decisions:
  - "SMTP_FROM schema uses z.email() (bare email, not RFC5322 'Name <email>' header format) — RESEARCH.md's own .env.example example used the header format while its Pattern 2 code sample used z.email(); resolved in favor of the schema, since a display name is a mail-sending concern for Phase 2, not an env-validation concern here."
  - "loadEnv() is a boot wrapper callers invoke explicitly (loadEnv() / loadEnv(process.env)) rather than a top-level side-effecting module export — avoids process.exit(1) firing as an import-time side effect whenever env.ts is imported by other modules or tests."
  - "envSchema exported (not just parseEnv/loadEnv) so env-example-drift.test.ts can introspect envSchema.shape as the single source of truth for the documentation-parity check."

patterns-established:
  - "Pattern: every process entrypoint (server, migration runner, future CLI) must call loadEnv() before touching DB/SMTP — this is the single validation gate referenced in the plan's key_links."

requirements-completed: [INFRA-02]

coverage:
  - id: D1
    description: "Boot aborts with exit 1 and a clear message on any missing/invalid required env var; succeeds on valid env"
    requirement: "INFRA-02"
    verification:
      - kind: unit
        ref: "apps/api/test/env.test.ts#parseEnv() returns a typed object with coerced values on a complete valid source"
        status: pass
      - kind: unit
        ref: "apps/api/test/env.test.ts#parseEnv() fails with the offending key when DATABASE_URL is missing"
        status: pass
      - kind: unit
        ref: "apps/api/test/env.test.ts#parseEnv() rejects a BETTER_AUTH_SECRET shorter than 32 chars"
        status: pass
      - kind: unit
        ref: "apps/api/test/env.test.ts#parseEnv() rejects a non-URL DATABASE_URL and a non-email SMTP_FROM"
        status: pass
      - kind: unit
        ref: "apps/api/test/env.test.ts#loadEnv() calls process.exit(1) and prints formatted issues when parse fails"
        status: pass
      - kind: unit
        ref: "apps/api/test/env.test.ts#loadEnv() returns the typed env without calling process.exit on valid input"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every variable the schema requires is documented in .env.example (no drift)"
    requirement: "INFRA-02"
    verification:
      - kind: unit
        ref: "apps/api/test/env-example-drift.test.ts#.env.example / envSchema drift guard documents exactly the set of keys the schema requires"
        status: pass
      - kind: unit
        ref: "apps/api/test/env-example-drift.test.ts#.env.example / envSchema drift guard does not contain a real DATABASE_URL credential (placeholder only)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-10
status: complete
---

# Phase 1 Plan 4: Fail-fast ENV Validation Summary

**Zod-based `parseEnv()`/`loadEnv()` fail-fast ENV validator in `apps/api/src/env.ts` plus a fully documented, secret-free `.env.example` guarded by a schema-drift test.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-10T20:52:00Z
- **Completed:** 2026-07-10T20:57:41Z
- **Tasks:** 2
- **Files modified:** 4 (all new)

## Accomplishments
- Fail-fast ENV schema module: `parseEnv()` (pure, unit-testable) validates `NODE_ENV`, `PORT`, `DATABASE_URL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`, `BASE_URL`, `BETTER_AUTH_SECRET` (min 32 chars) against a Zod schema; `loadEnv()` boot wrapper prints formatted issues to stderr and calls `process.exit(1)` on invalid input (ASVS V5/V6).
- `.env.example` documents every schema variable with grouped explanatory comments (App/Database/SMTP), placeholder values only, `BETTER_AUTH_SECRET` generation hint (`openssl rand -base64 32`).
- `env-example-drift.test.ts` asserts `.env.example`'s documented key set is exactly `envSchema.shape`'s keys — fails the build the moment schema and documentation diverge in either direction.

## Task Commits

Each task was committed atomically (TDD RED → GREEN for Task 1):

1. **Task 1 RED: failing ENV validation tests** - `28648b1` (test)
2. **Task 1 GREEN: implement env.ts (parseEnv/loadEnv)** - `46f58e7` (feat)
3. **Task 2: .env.example + drift guard test** - `3b6a3fa` (feat)

_Task 1 followed TDD RED → GREEN. Task 2 (type="auto") committed once, since the drift test and the fixture it verifies (.env.example) are two halves of one deliverable — writing them as separate commits would leave an intermediate commit with a failing test._

## Files Created/Modified
- `apps/api/src/env.ts` - `parseEnv()` (pure Zod safeParse wrapper, discriminated result) + `loadEnv()` (boot wrapper: stderr + `process.exit(1)` on failure) + exported `envSchema` for drift-test introspection
- `apps/api/test/env.test.ts` - 6 tests covering valid-input coercion, missing-key failure, weak-secret rejection, invalid-URL/email rejection, and the `process.exit(1)` boot-wrapper contract (spied, not actually exiting the test runner)
- `apps/api/test/env-example-drift.test.ts` - 2 tests: documented-keys-equal-schema-keys, and DATABASE_URL placeholder-only guard
- `.env.example` - every ENV var the schema reads, grouped with comments, placeholders only

## Decisions Made
- **SMTP_FROM format:** RESEARCH.md's Pattern 2 code sample specifies `SMTP_FROM: z.email()` (bare email), but RESEARCH.md's own `.env.example` code example uses the RFC5322 `"Kurzly <no-reply@example.com>"` header format for the same variable — these two research artifacts conflict. Resolved in favor of the schema (`z.email()`): the validated `.env.example` uses a bare `no-reply@example.com`. A display name, if wanted, is a Phase 2 mail-sending concern (nodemailer's `from` field can still combine a name + this validated address at send time), not an env-validation concern.
- **`loadEnv()` is not a top-level side-effecting export.** The plan text says the boot function "exports the typed `env`" on success; implemented as a function callers invoke explicitly (`loadEnv()`) rather than a module-level `export const env = loadEnv()`. A top-level side effect would call `process.exit(1)` the instant any other module (including future tests) imports `env.ts` with an incomplete `process.env` — defeating the "pure, testable" goal from the plan's own acceptance criteria. Future entrypoints (server, migration runner — plan 01-06+) call `loadEnv()` explicitly at boot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected env.test.ts fixture: SMTP_FROM must be a bare email**
- **Found during:** Task 1 GREEN implementation — first `vitest run` after writing `env.ts` failed 2 of 6 tests
- **Issue:** The RED test's `VALID_SOURCE.SMTP_FROM` used `"Kurzly <no-reply@example.com>"` (copied from RESEARCH.md's `.env.example` example), but the schema (per RESEARCH.md Pattern 2 and the plan's own task description) validates `SMTP_FROM` with `z.email()`, which rejects the RFC5322 header format
- **Fix:** Changed the fixture to a bare `"no-reply@example.com"`; `.env.example` (Task 2) uses the same bare-email format, avoiding shipping a `.env.example` that itself fails the validator it documents
- **Files modified:** apps/api/test/env.test.ts
- **Verification:** `pnpm --filter @kurzly/api exec vitest run test/env.test.ts` — 6/6 pass
- **Committed in:** 46f58e7 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix — test fixture correction)
**Impact on plan:** No scope creep; resolves an internal inconsistency between two RESEARCH.md code examples in favor of the one the plan's task description explicitly specifies (`z.email()`).

## Issues Encountered
None beyond the fixture correction documented above.

## User Setup Required

None - no external service configuration required. Operators will need to populate a real `.env` from `.env.example` at deploy time (later phases wire the entrypoint/compose files that consume it), but no manual setup is required to complete this plan.

## Next Phase Readiness
- `loadEnv()` is ready to be called from the Fastify server entrypoint and the migration-runner entrypoint script in later plans (01-06+) — both must call it before constructing the Prisma client or the nodemailer transport.
- `apps/api/src/db.ts` (from plan 01-03) currently reads `process.env.DATABASE_URL` directly with a `?? ""` fallback; a future plan should route it through `loadEnv()`'s typed `env.DATABASE_URL` instead, so an invalid `DATABASE_URL` fails at boot rather than at first query. Flagging as a forward-looking integration point, not a blocker for this plan (01-03's `db.ts` was out of this plan's `files_modified` scope).
- No blockers for plan 01-05 (testcontainers/Vitest harness) or later infra plans.

---
*Phase: 01-test-infrastructure-monorepo-deployment-scaffolding*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: apps/api/src/env.ts
- FOUND: apps/api/test/env.test.ts
- FOUND: apps/api/test/env-example-drift.test.ts
- FOUND: .env.example
- FOUND: .planning/phases/01-test-infrastructure-monorepo-deployment-scaffolding/01-04-SUMMARY.md
- FOUND: commit 28648b1 (test RED)
- FOUND: commit 46f58e7 (feat GREEN — env.ts)
- FOUND: commit 3b6a3fa (feat — .env.example + drift test)
