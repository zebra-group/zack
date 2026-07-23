---
phase: 05-core-redirect-engine
plan: 01
subsystem: infra
tags: [env-config, supply-chain, bcryptjs, isbot, fastify-cookie, zod]

requires:
  - phase: 03-domain-management
    provides: "CNAME_TARGET/A_RECORD_IP optional-default env pattern in apps/api/src/env.ts (mirrored here)"
provides:
  - "bcryptjs, isbot, @fastify/cookie installed in @kurzly/api at pinned versions"
  - "BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST env schema keys with fail-safe defaults"
affects: [redirect-engine, public-html-render, password-gate, bot-detection]

tech-stack:
  added: [bcryptjs@3.0.3, isbot@5.2.0, "@fastify/cookie@11.1.1"]
  patterns: []

key-files:
  created: []
  modified:
    - apps/api/package.json
    - pnpm-lock.yaml
    - apps/api/src/env.ts
    - .env.example

key-decisions:
  - "Operator-approved supply-chain sign-off (T-05-SC) obtained for bcryptjs/isbot/@fastify/cookie before install — isbot and @fastify/cookie's SUS flags confirmed as 'too-new' heuristic false positives (official repos, no postinstall scripts, high download counts)"
  - "No pnpm-workspace.yaml allowBuilds entry added — none of the three packages requested a build/lifecycle script during install"
  - "BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST added as optional, fail-safe-defaulted env keys mirroring the CNAME_TARGET/A_RECORD_IP precedent, so a fresh instance boots unchanged with zero new config"

patterns-established: []

requirements-completed: [REDIR-04, REDIR-05, UI-04, UI-05]

coverage:
  - id: D1
    description: "bcryptjs, isbot, @fastify/cookie installed in @kurzly/api at RESEARCH-pinned versions after operator sign-off"
    requirement: "REDIR-04"
    verification:
      - kind: other
        ref: "pnpm --filter @kurzly/api ls bcryptjs isbot @fastify/cookie (confirms 3.0.3/5.2.0/11.1.1)"
        status: pass
    human_judgment: true
    rationale: "Supply-chain package legitimacy is a human sign-off gate (T-05-SC) by design — not something a test can substitute for."
  - id: D2
    description: "BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST env keys added, optional, fail-safe-defaulted; .env.example stays in lockstep"
    requirement: "UI-04"
    verification:
      - kind: unit
        ref: "apps/api/test/env-example-drift.test.ts"
        status: pass
      - kind: unit
        ref: "apps/api/test/env.test.ts"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-07-12
status: complete
---

# Phase 5 Plan 1: Dependency Installation and Configuration Foundation Summary

**Installed bcryptjs/isbot/@fastify/cookie behind a blocking-human supply-chain gate, then added fail-safe-defaulted BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST env keys mirroring the CNAME_TARGET pattern**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-12T14:30:02Z
- **Completed:** 2026-07-12T14:33:27Z
- **Tasks:** 3 (1 checkpoint, 2 auto)
- **Files modified:** 4

## Accomplishments

- Cleared the T-05-SC blocking-human supply-chain checkpoint: operator reviewed the package-legitimacy readout (bcryptjs ^3.0.3, isbot ^5.2.0, @fastify/cookie ^11.1.1 — official repos, no postinstall scripts, SUS flags are "too-new" heuristic only) and explicitly approved the install.
- Installed all three packages in `@kurzly/api` at the exact researched pinned versions with no new `pnpm-workspace.yaml` allowBuilds entry required.
- Extended `envSchema` with `BRAND_NAME` (default `"Kurzly"`), `BRAND_ACCENT` (default `"#d7ff01"`), and `PASSWORD_HASH_COST` (default `11`) — all optional and fail-safe-defaulted so a fresh deployment boots without any new configuration.
- Kept `.env.example` in lockstep with the schema; `env-example-drift.test.ts` and `env.test.ts` both pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Supply-chain sign-off for bcryptjs / isbot / @fastify/cookie (T-05-SC)** - checkpoint approved by operator prior to this executor run (no code change; approval recorded, no separate commit)
2. **Task 2: Install the three dependencies at pinned versions** - `ad81052` (chore)
3. **Task 3: Add BRAND_NAME / BRAND_ACCENT / PASSWORD_HASH_COST env keys** - `af5699d` (feat)

**Plan metadata:** commit created after this summary (docs: complete plan)

## Files Created/Modified

- `apps/api/package.json` - Adds bcryptjs^3.0.3, isbot^5.2.0, @fastify/cookie^11.1.1 to dependencies
- `pnpm-lock.yaml` - Lockfile updated for the three new packages and their transitive deps
- `apps/api/src/env.ts` - Adds BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST optional, defaulted schema keys
- `.env.example` - Documents the three new keys, keeping the drift test green

## Decisions Made

- Followed the plan exactly for the checkpoint pattern: presented the RESEARCH.md Package Legitimacy Audit readout, operator approved explicitly ("approved — install") before any `pnpm add` ran.
- Confirmed via `git diff --stat -- pnpm-workspace.yaml` that no allowBuilds entry was touched — install produced no ignored-build-script warnings for any of the three packages.
- `PASSWORD_HASH_COST` uses `z.coerce.number().int().positive().optional().default(11)`, matching the RESEARCH Pitfall 2 guidance (start at 10–11, not 12) and the existing `PORT`/`SMTP_PORT` numeric-coercion idiom already in the schema.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Operators may optionally set `BRAND_NAME`, `BRAND_ACCENT`, or `PASSWORD_HASH_COST` in their `.env`, but all three have safe defaults and no action is required.

## Next Phase Readiness

- `bcryptjs`, `isbot`, `@fastify/cookie` are installed and ready for 05-02+ to build password hashing, bot detection, and the link-unlock cookie session.
- `BRAND_NAME`/`BRAND_ACCENT` are available for the shared public HTML render layer; `PASSWORD_HASH_COST` is available for the password-gate implementation.
- No blockers for downstream Phase 5 plans (wave 1 of 4 complete for this plan).

---

*Phase: 05-core-redirect-engine*
*Completed: 2026-07-12*

## Self-Check: PASSED

All created/modified files confirmed on disk; task commits `ad81052` and `af5699d` confirmed in git log.
