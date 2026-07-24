---
phase: 12-redirect-handler-e2e-core-value
plan: 02
subsystem: testing
tags: [playwright, bcrypt, fixtures, prisma, e2e]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: apps/e2e harness (Prisma client subpath, baseline seed, compose stack, smoke Playwright project)
  - phase: 12-redirect-handler-e2e-core-value (plan 01)
    provides: Empirical proof that Playwright's APIRequestContext delivers a caller-supplied Host header unmodified to Fastify
provides:
  - "apps/e2e/src/links.ts — the shared raw-insert Link fixture helper (createE2eLink, derivePasswordHash, deriveExpiresAt) plus the shared redirect-test vocabulary (BROWSER_UA, BOT_UA, CANARY_TARGET, assertNoLeak) every feature spec in this phase consumes"
affects: [12-03-redirect-happy-path, 12-04-bot-og-branching, 12-05-utm-merge]

# Tech tracking
tech-stack:
  added: ["bcryptjs (devDependency, apps/e2e — already pinned/vetted at 3.0.3 via apps/api's own dependency, relinked not newly fetched)"]
  patterns:
    - "Raw-insert fixture helper mirroring a service module's pure derivation-function SHAPE (not its authorization/validation core) when the service module itself is structurally unreachable via a package's `exports` map"
    - "RED->GREEN TDD applied to test-infrastructure code (a fixture helper), not application code — genuine because the derivation contract (`expect(fn(input)).toBe(output)`) is testable before implementation"

key-files:
  created:
    - apps/e2e/tests/smoke/links-fixture.spec.ts
    - apps/e2e/src/links.ts
  modified:
    - apps/e2e/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Confirmed RESEARCH Q2's resolved finding empirically: @kurzly/api's exports map (`.` and `./prisma-client` only) makes lib/links.ts's createLink/updateLink unreachable from apps/e2e, so createE2eLink is a raw prisma.link.create that hand-reproduces derivePasswordHash/deriveExpiresAt's exact behavior."
  - "bcryptjs added as a devDependency to apps/e2e/package.json — it was NOT previously resolvable as a bare import from apps/e2e despite being a transitive dependency via @kurzly/api (pnpm's non-hoisted workspace layout means apps/api's node_modules/bcryptjs symlink is not visible from apps/e2e). This is a Rule 3 auto-fix, not a new supply-chain install: the exact package+version (bcryptjs@3.0.3) was already pinned in pnpm-lock.yaml and used elsewhere in the monorepo — `pnpm install` only relinked the existing store entry, it never fetched anything new from the registry."
  - "assertNoLeak uses Playwright's own `expect` (from @playwright/test) rather than a hand-rolled throw, since this helper is only ever called from within Playwright test files and gets Playwright's native assertion failure reporting for free."

patterns-established:
  - "Fixture-helper TDD: write the RED contract spec importing the not-yet-existing module first, confirm failure is 'module not found' (not a malformed assertion), then implement to GREEN — same discipline as application-code TDD, applied to test infrastructure."

requirements-completed: [REDIRECT-E2E-01, REDIRECT-E2E-02, REDIRECT-E2E-03, REDIRECT-E2E-04, REDIRECT-E2E-05]

coverage:
  - id: D1
    description: "derivePasswordHash produces a real bcrypt hash bcrypt.compare accepts, never the plaintext"
    requirement: "REDIRECT-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/links-fixture.spec.ts — 'derivePasswordHash > returns a real bcrypt hash bcrypt.compare accepts, never the plaintext', run live via pnpm --filter @kurzly/e2e test against the built compose image"
        status: pass
    human_judgment: false
  - id: D2
    description: "deriveExpiresAt returns the exact UTC end-of-day instant (2020-01-01T23:59:59.999Z) for a YYYY-MM-DD date"
    requirement: "REDIRECT-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/links-fixture.spec.ts — 'deriveExpiresAt > returns the exact UTC end-of-day instant for a YYYY-MM-DD date', run live"
        status: pass
    human_judgment: false
  - id: D3
    description: "createE2eLink round-trips a real bcrypt passwordHash and resolves createdBy to the seeded admin user id, on the baseline Domain"
    requirement: "REDIRECT-E2E-02"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/links-fixture.spec.ts — 'createE2eLink > stores a real bcrypt passwordHash ... and the seeded admin as createdBy', run live against the built compose image"
        status: pass
    human_judgment: false
  - id: D4
    description: "createE2eLink round-trips the exact UTC end-of-day expiresAt instant for a supplied expiresAt option"
    requirement: "REDIRECT-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/links-fixture.spec.ts — 'createE2eLink > stores the exact UTC end-of-day expiresAt instant ...', run live"
        status: pass
    human_judgment: false
  - id: D5
    description: "createE2eLink stores passwordHash: null and expiresAt: null when neither option is supplied (plain link)"
    requirement: "REDIRECT-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/links-fixture.spec.ts — 'createE2eLink > stores passwordHash: null and expiresAt: null ...', run live"
        status: pass
    human_judgment: false
  - id: D6
    description: "Shared redirect-test vocabulary (BROWSER_UA, BOT_UA, CANARY_TARGET, assertNoLeak) exported from apps/e2e/src/links.ts for the phase's five feature specs to consume verbatim"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck — clean; exports type-check and are importable"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-24
status: complete
---

# Phase 12 Plan 02: Fixture Helper (apps/e2e/src/links.ts) Summary

**Raw-insert Link fixture helper (`createE2eLink`) that hand-reproduces `lib/links.ts`'s bcrypt-hash and UTC-end-of-day-expiry invariants — plus the shared redirect-test vocabulary (`BROWSER_UA`/`BOT_UA`/`CANARY_TARGET`/`assertNoLeak`) — proven via a genuine RED→GREEN cycle against the live compose image.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-24T22:30:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Wrote `apps/e2e/tests/smoke/links-fixture.spec.ts` encoding five behaviors (password-hash derivation, expiry derivation, password round-trip, expiry round-trip, plain-link nulls) — confirmed RED (module-not-found) before any implementation existed.
- Implemented `apps/e2e/src/links.ts`: `derivePasswordHash`/`deriveExpiresAt` mirror `apps/api/src/lib/links.ts`'s derivation SHAPE exactly; `createE2eLink` resolves `domainId`/`createdBy` from the Phase 11 baseline seed and raw-inserts a Link with the correct invariants; exported the shared `BROWSER_UA`/`BOT_UA`/`CANARY_TARGET`/`assertNoLeak` vocabulary verbatim from `redirect.integration.test.ts`.
- Confirmed GREEN live: booted the built compose image (under a locally-remapped-port project, same environmental workaround 12-01-SUMMARY.md documents for this dev machine's pre-existing port conflicts on 3000/5433/8025) and ran the new spec — all 5 tests + the 2 `setup` auth round-trips passed.
- Ran the FULL existing suite as the per-wave-merge gate: 22/23 passed. The one failure (`boot.spec.ts`) is a pre-existing spec asserting the literal port `"3000"`, which only fails here because of this session's local port remap (`13000`) — not a regression introduced by this plan (same class of environmental artifact 12-01-SUMMARY.md already documented). Verified no other project's containers/data were touched; stack torn down and the throwaway override file + generated `.env` deleted, leaving the working tree as found.
- `pnpm --filter @kurzly/e2e typecheck` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing fixture-helper contract spec** - `ddca9f8` (test)
2. **Task 2 (GREEN): implement apps/e2e/src/links.ts** - `faa2555` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified
- `apps/e2e/tests/smoke/links-fixture.spec.ts` - RED→GREEN contract spec for the fixture helper's derivation correctness and create+read round-trips.
- `apps/e2e/src/links.ts` - Raw-insert `createE2eLink` fixture helper + `derivePasswordHash`/`deriveExpiresAt` + shared `BROWSER_UA`/`BOT_UA`/`CANARY_TARGET`/`assertNoLeak` vocabulary.
- `apps/e2e/package.json` - Added `bcryptjs` as a devDependency (already pinned in the lockfile via `apps/api`; needed because pnpm's non-hoisted layout doesn't expose a sibling workspace's transitive deps as bare imports).
- `pnpm-lock.yaml` - Relinked `bcryptjs@3.0.3` into `apps/e2e`'s importer entry (no new package fetched from the registry).

## Decisions Made
- `createE2eLink` deliberately mirrors only the SHAPE of `lib/links.ts`'s pure derivation functions (`derivePasswordHash`, `deriveExpiresAt`), not its authorization/validation core (`validateLinkInput`, slug-shape/reserved-word checks, UTM/OG length limits) — this phase's specs prove the public redirect handler, not Link-write authorization (out of scope per REQUIREMENTS.md, already covered by the v1.0 Denial-Suite).
- `bcryptjs` added as an explicit `apps/e2e` devDependency rather than relying on transitive resolution — pnpm's workspace isolation means a sibling package's (`@kurzly/api`) dependency is not resolvable as a bare import from `apps/e2e` without its own entry, even though the exact version was already vetted and pinned in the shared lockfile.
- `assertNoLeak` uses Playwright's own `expect` (not a hand-rolled throw) since it is only ever invoked from within Playwright test files, giving native assertion-failure reporting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `bcryptjs` as an explicit `apps/e2e` devDependency**
- **Found during:** Task 1 (writing the RED spec, which imports `bcryptjs` directly)
- **Issue:** The plan's `<action>` for Task 1 states `bcryptjs` is "available transitively via `@kurzly/api`" — empirically this was false in this pnpm workspace: `apps/e2e/node_modules` had no `bcryptjs` symlink (pnpm's non-hoisted, strict workspace layout only links a package's own declared dependencies, not a sibling workspace package's transitive deps), so `import bcrypt from "bcryptjs"` would fail to resolve at both typecheck and runtime.
- **Fix:** Added `"bcryptjs": "^3.0.3"` to `apps/e2e/package.json`'s `devDependencies` (matching the exact version already pinned via `apps/api`) and ran `pnpm install --filter @kurzly/e2e...`. This is a workspace relink, not a new supply-chain install — the package+version was already present and vetted in `pnpm-lock.yaml`; no new registry fetch occurred (confirmed via a minimal 4-line lockfile diff).
- **Files modified:** `apps/e2e/package.json`, `pnpm-lock.yaml`
- **Verification:** `apps/e2e/node_modules/bcryptjs` now symlinks to the shared `.pnpm` store entry; `pnpm --filter @kurzly/e2e typecheck` and the live spec run both succeed.
- **Committed in:** `ddca9f8` (Task 1/RED commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary correction to a plan assumption that didn't hold in this specific pnpm workspace configuration; no scope creep, no application code touched, no new external package introduced.

## Issues Encountered
- This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in `11-06-SUMMARY.md`/`12-01-SUMMARY.md` (unrelated projects: `product-catalog`, `zbr-brain-postgres-1`, `ddev-router`). Resolved identically to 12-01: booted the stack under an alternate project name (`kurzly-e2e-p12`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`), ran the suite, tore the stack down fully (`down -v --remove-orphans`), and deleted the override file + generated `.env` — confirmed via `git status`/`docker ps` that the working tree and every other project's containers were left exactly as found.
- Running the full existing suite under this port remap surfaced one pre-existing, out-of-scope failure (`boot.spec.ts` asserting the literal port `"3000"`) — expected local-environment noise from the remap itself, not a regression; the script's canonical `./scripts/e2e-compose.sh` (real port `3000`) would not hit this in CI.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
`apps/e2e/src/links.ts` is fully implemented, typechecked, and proven live against the built compose image. Plans 12-03/12-04/12-05 can now import `createE2eLink`, `derivePasswordHash`, `deriveExpiresAt`, `BROWSER_UA`, `BOT_UA`, `CANARY_TARGET`, and `assertNoLeak` directly — no further fixture-infrastructure work needed before writing the five feature specs. No blockers.

---
*Phase: 12-redirect-handler-e2e-core-value*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/smoke/links-fixture.spec.ts
- FOUND: apps/e2e/src/links.ts
- FOUND: apps/e2e/package.json
- FOUND: .planning/phases/12-redirect-handler-e2e-core-value/12-02-SUMMARY.md
- FOUND: commit ddca9f8
- FOUND: commit faa2555
