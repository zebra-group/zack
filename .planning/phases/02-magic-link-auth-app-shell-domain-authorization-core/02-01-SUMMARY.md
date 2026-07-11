---
phase: 02-magic-link-auth-app-shell-domain-authorization-core
plan: 01
subsystem: auth
tags: [better-auth, fastify-rate-limit, fastify-helmet, zod, env-validation, supply-chain]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: apps/api/src/env.ts fail-fast ENV validator (parseEnv/loadEnv pattern), .env.example drift guard
provides:
  - better-auth, @fastify/rate-limit, @fastify/helmet as apps/api dependencies (pinned to CLAUDE.md versions)
  - @better-auth/cli as apps/api devDependency
  - required INITIAL_ADMIN_EMAIL ENV key (z.email()) documented and drift-guard-verified
  - operator supply-chain sign-off recorded for T-02-SC-Gate
affects: [02-02, 02-03, 02-04, 02-05, 02-06, auth, env-validation]

# Tech tracking
tech-stack:
  added: [better-auth@^1.6.23, "@fastify/rate-limit@^11.1.0", "@fastify/helmet@^13.1.0", "@better-auth/cli@^1.4.21"]
  patterns: [z.email() required-ENV pattern reused for INITIAL_ADMIN_EMAIL, mirrors existing SMTP_FROM key]

key-files:
  created: []
  modified:
    - apps/api/package.json
    - pnpm-lock.yaml
    - apps/api/src/env.ts
    - .env.example
    - apps/api/test/env.test.ts
    - pnpm-workspace.yaml

key-decisions:
  - "Operator-approved supply-chain sign-off for better-auth, @fastify/rate-limit, @fastify/helmet, @better-auth/cli at CLAUDE.md-pinned versions (2026-07-11), per RESEARCH.md Package Legitimacy Audit — no [SLOP] verdict, all four are too-new-only SUS"
  - "Used bundled better-auth/adapters/prisma import path — @better-auth/prisma-adapter is NOT an explicit apps/api/package.json dependency, per RESEARCH Open Question 2 / A1 and CLAUDE.md's locked guidance"
  - "better-sqlite3 (transitive optional dep pulled in because better-auth@1.6.x now bundles all its first-party adapter subpackages, including kysely/drizzle) set to allowBuilds: false in pnpm-workspace.yaml — this project is Postgres-only and never touches SQLite; same no-blanket-lifecycle-script rationale already established for cpu-features/protobufjs/ssh2 in Phase 1 (threat T-01-02)"

patterns-established:
  - "New required bootstrap ENV vars follow: add z.email()/appropriate zod validator to envSchema, add to VALID_SOURCE fixture in env.test.ts, document in .env.example under a topical section comment — env-example-drift.test.ts enforces the three stay in sync"

requirements-completed: [AUTH-01]

coverage:
  - id: D1
    description: "Supply-chain sign-off recorded for better-auth, @fastify/rate-limit, @fastify/helmet, @better-auth/cli before any install"
    requirement: AUTH-01
    verification:
      - kind: manual_procedural
        ref: "Operator approval recorded in plan prompt (2026-07-11) after reviewing 02-RESEARCH.md Package Legitimacy Audit + CLAUDE.md version matrix"
        status: pass
    human_judgment: true
    rationale: "Package legitimacy sign-off (T-02-SC-Gate) is a blocking-human checkpoint by design — never auto-approvable regardless of workflow.auto_advance."
  - id: D2
    description: "better-auth, @fastify/rate-limit, @fastify/helmet installed as apps/api dependencies and @better-auth/cli as devDependency, all at CLAUDE.md-pinned versions; @better-auth/prisma-adapter NOT installed as a direct dependency"
    requirement: AUTH-01
    verification:
      - kind: other
        ref: "apps/api/package.json shows better-auth@^1.6.23, @fastify/rate-limit@^11.1.0, @fastify/helmet@^13.1.0 (deps), @better-auth/cli@^1.4.21 (devDep); grep confirms no @better-auth/prisma-adapter entry"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/api exec tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "INITIAL_ADMIN_EMAIL is a required, z.email()-validated ENV key; parseEnv() rejects a source missing it; documented in .env.example; drift guard green"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "apps/api/test/env.test.ts (VALID_SOURCE now includes INITIAL_ADMIN_EMAIL; existing success-path assertions exercise the new required key)"
        status: pass
      - kind: unit
        ref: "apps/api/test/env-example-drift.test.ts#documents exactly the set of keys the schema requires"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-11
status: complete
---

# Phase 2 Plan 1: Auth Package Install + First-Admin Bootstrap ENV Summary

**better-auth/@fastify/rate-limit/@fastify/helmet installed post operator sign-off; INITIAL_ADMIN_EMAIL added as a required z.email() ENV key (D-01 first-admin bootstrap)**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-11T13:35:00+02:00 (approx.)
- **Completed:** 2026-07-11T13:53:38+02:00
- **Tasks:** 2
- **Files modified:** 6 (apps/api/package.json, pnpm-lock.yaml, apps/api/src/env.ts, .env.example, apps/api/test/env.test.ts, pnpm-workspace.yaml)

## Accomplishments

- Recorded the operator's explicit supply-chain sign-off (T-02-SC-Gate) for better-auth, @fastify/rate-limit, @fastify/helmet, and @better-auth/cli at the CLAUDE.md-pinned versions, per RESEARCH.md's Package Legitimacy Audit — no [SLOP] verdict on any of the four; all "too-new"-only SUS.
- Installed all four packages via `pnpm --filter @kurzly/api add`, confirmed the bundled `better-auth/adapters/prisma` import path is used (no separate `@better-auth/prisma-adapter` direct dependency added).
- Extended `envSchema` in `apps/api/src/env.ts` with a required `INITIAL_ADMIN_EMAIL: z.email()` field — a fresh deployment now fails fast at boot instead of shipping an un-loginable instance (D-01).
- Documented `INITIAL_ADMIN_EMAIL` in `.env.example` and kept `env-example-drift.test.ts` green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Supply-chain legitimacy sign-off (T-02-SC-Gate)** - operator-approved, 2026-07-11 (review-only gate, no code changes — approval recorded here per plan instruction)
2. **Task 2: Install packages + INITIAL_ADMIN_EMAIL ENV contract** - `235a2f5` (feat)

**Plan metadata:** committed as part of this SUMMARY finalization

_Note: Task 1 is a `checkpoint:human-verify` review gate with no file changes of its own; the approval decision is recorded here and in the plan's `<supply_chain_approval>` execution context._

## Files Created/Modified

- `apps/api/package.json` - Adds better-auth, @fastify/rate-limit, @fastify/helmet (dependencies) and @better-auth/cli (devDependency) at CLAUDE.md-pinned versions
- `pnpm-lock.yaml` - Lockfile updated for the four new packages and their transitive dependency tree
- `apps/api/src/env.ts` - `envSchema` gains required `INITIAL_ADMIN_EMAIL: z.email()` (D-01 first-admin bootstrap)
- `apps/api/test/env.test.ts` - `VALID_SOURCE` fixture gains `INITIAL_ADMIN_EMAIL` so existing success-path assertions keep passing
- `.env.example` - Documents `INITIAL_ADMIN_EMAIL` under a new "Auth (Phase 2 — better-auth magic-link)" section
- `pnpm-workspace.yaml` - `allowBuilds.better-sqlite3: false` (deviation — see below)

## Decisions Made

- Operator-approved supply-chain sign-off recorded for all four packages before any install ran (T-02-SC-Gate, never auto-approvable).
- Used the bundled `better-auth/adapters/prisma` import path; confirmed via `apps/api/node_modules/better-auth/package.json` that `@better-auth/prisma-adapter` now ships as a bundled dependency of `better-auth` core itself (installed transitively) — but it is deliberately NOT added as a direct/explicit dependency of `apps/api/package.json`, satisfying RESEARCH's Open Question 2 / A1 and the plan's acceptance criteria.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Resolved pnpm's `better-sqlite3` ignored-build-script placeholder**
- **Found during:** Task 2 (package install)
- **Issue:** Installing `@better-auth/cli` transitively pulled in `better-sqlite3` (an optional native dependency of better-auth's bundled kysely/drizzle adapter subpackages, which better-auth@1.6.x now ships as first-party dependencies even though this project never imports them). pnpm 11's default lifecycle-script blocking auto-appended an unresolved `better-sqlite3: set this to true or false` placeholder line to `pnpm-workspace.yaml`'s `allowBuilds` map, which is not a valid boolean and would keep surfacing an `[ERR_PNPM_IGNORED_BUILDS]` warning on every install.
- **Fix:** Set `better-sqlite3: false` with a comment explaining the rationale, mirroring the existing "no blanket lifecycle-script enablement" pattern already established for `cpu-features`/`protobufjs`/`ssh2` in Phase 1 (threat T-01-02) — this project is Postgres-only and never touches SQLite, so there is no reason to run this package's native build step.
- **Files modified:** `pnpm-workspace.yaml`
- **Verification:** Re-ran `pnpm install`; the ignored-builds warning is gone, install completes cleanly.
- **Committed in:** `235a2f5` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to get a clean, non-warning `pnpm install`; follows an existing, already-reviewed security precedent from Phase 1 rather than introducing a new pattern. No scope creep.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

**External configuration required before first boot.** The operator must set `INITIAL_ADMIN_EMAIL` in their `.env` file (see `.env.example`) to the email address of the first admin/owner account before starting the API — the invite-only allowlist (D-01) starts empty, so omitting this variable means nobody can ever log in. No dashboard/service-side configuration is required at this stage (the seeding logic itself is a later Phase 2 plan).

## Next Phase Readiness

- `better-auth`, `@fastify/rate-limit`, `@fastify/helmet` are installed and ready for the next plan to wire the actual `betterAuth()` instance, magic-link plugin, and security middleware.
- `INITIAL_ADMIN_EMAIL` is validated at boot and available for the admin-seed logic in a later Phase 2 plan.
- No blockers for downstream Phase 2 plans (02-02 through 02-06).

---
*Phase: 02-magic-link-auth-app-shell-domain-authorization-core*
*Completed: 2026-07-11*
