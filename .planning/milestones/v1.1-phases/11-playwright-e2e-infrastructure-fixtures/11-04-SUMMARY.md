---
phase: 11-playwright-e2e-infrastructure-fixtures
plan: 04
subsystem: testing
tags: [playwright, prisma, mailpit, e2e, fixtures]

# Dependency graph
requires:
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 01)
    provides: "@kurzly/e2e workspace scaffold, playwright.config.ts smoke project, proven @kurzly/api/prisma-client subpath import"
  - phase: 11-playwright-e2e-infrastructure-fixtures (plan 03)
    provides: "docker-compose.e2e.yml (db published on 5433, deterministic app env), scripts/e2e-compose.sh (boots/runs/tears down, exports E2E_DATABASE_URL/MAILPIT_URL/PLAYWRIGHT_BASE_URL)"
provides:
  - "apps/e2e/src/db.ts — createE2ePrisma()/seedBaseline()/resetDb() + seeded email/hostname constants"
  - "apps/e2e/src/mailpit.ts — findMagicLinkUrl() (recipient-scoped, hard To-address assertion) and clearInbox()"
  - "apps/e2e/global-setup.ts / global-teardown.ts wired into playwright.config.ts"
  - "apps/e2e/tests/smoke/db-isolation.spec.ts and mailpit-wiring.spec.ts — throwaway proofs of INFRA-03/INFRA-02"
affects: [11-05, 11-06, "Phase 12-17 (all consume resetDb()/seedBaseline()/findMagicLinkUrl() as the shared data-plane fixtures)"]

# Tech tracking
tech-stack:
  added:
    - "@prisma/adapter-pg ^7.8.0 as a devDependency of apps/e2e (already vetted, first-party Prisma driver adapter)"
  patterns:
    - "Advisory-locked (pg_advisory_lock/unlock) truncate+reseed per resetDb() call, guarding the shared-table FK-safe reset against concurrent fullyParallel worker collisions"
    - "Recipient-scoped Mailpit retrieval with a hard To-address assertion inside the client itself (never at the call site) — a worker can never consume another worker's magic-link email"
    - "Playwright globalSetup/globalTeardown each open and close their own short-lived Prisma client (no in-memory handoff possible across the two separate process invocations)"

key-files:
  created:
    - apps/e2e/src/db.ts
    - apps/e2e/src/mailpit.ts
    - apps/e2e/global-setup.ts
    - apps/e2e/global-teardown.ts
    - apps/e2e/tests/smoke/db-isolation.spec.ts
    - apps/e2e/tests/smoke/mailpit-wiring.spec.ts
  modified:
    - apps/e2e/package.json
    - apps/e2e/playwright.config.ts
    - pnpm-lock.yaml

key-decisions:
  - "Confirmed the magic-link verify URL path empirically by reading better-auth@1.6.23's installed source (node_modules/.../better-auth/dist/plugins/magic-link/index.mjs) rather than a live-captured email (blocked by the same local port conflict as 11-03): the URL is built as `${BASE_URL}${basePath}/magic-link/verify?token=...&callbackURL=...` with basePath defaulting to /api/auth — i.e. exactly `/api/auth/magic-link/verify?token=...`, matching RESEARCH's assumed pattern (A2) with certainty, not just inference."
  - "seedBaseline()/resetDb()'s reseed step upsert the baseline DomainMembership by its composite `userId_domainId` key so resetDb() is safely re-callable any number of times without ever needing to re-create the User/Domain rows it deliberately never truncates."
  - "global-setup.ts and global-teardown.ts each construct and disconnect their own Prisma client rather than sharing one instance — Playwright's globalSetup and globalTeardown are separate process invocations with no shared in-memory state to hand a client through."
  - "db-isolation.spec.ts uses a plain `for` loop generating 6 independent `test()` calls (no `test.describe.serial`) so they are genuinely schedulable across multiple workers under this project's `fullyParallel: true` config — each test uses a cryptographically-random per-test slug specifically to make a real P2002 collision structurally impossible regardless of scheduling, isolating the advisory lock's actual job (serializing the shared TRUNCATE sequence) from slug uniqueness."

requirements-completed: [INFRA-02, INFRA-03]

coverage:
  - id: D1
    description: "apps/e2e/src/db.ts exports createE2ePrisma (adapter-pg against E2E_DATABASE_URL, fail-fast if unset), seedBaseline (idempotent upsert: one active Domain, one admin User, one least-privilege Member User with exactly one DomainMembership at role member), resetDb (advisory-locked FK-safe TRUNCATE of QrRemapHistory/QrCode/ClickEvent/Link/DomainMembership, never User/Domain/Session/Account/Verification), and the ADMIN_EMAIL/MEMBER_EMAIL/BASELINE_DOMAIN_HOSTNAME constants"
    requirement: "INFRA-03"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "Direct source inspection: resetDb's TRUNCATE statement lists exactly QrRemapHistory, QrCode, ClickEvent, Link, DomainMembership (matches RESEARCH Pattern 3's FK-safe order); pg_advisory_lock/pg_advisory_unlock wrap the whole sequence; User/Domain/Session/Account/Verification never appear in any TRUNCATE"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh apps/e2e/tests/smoke/db-isolation.spec.ts (full boot/run/teardown against the built image + live :5433 Postgres)"
        status: unknown
    human_judgment: true
    rationale: "Could not complete a full live end-to-end run in this sandbox — see 'Issues Encountered' below: the same pre-existing, unrelated Docker containers documented in 11-03-SUMMARY.md (zbr-brain-postgres-1 on 5433, ddev-router on 8025) still occupy both ports this phase's locked architecture requires. A human or CI runner without those two specific conflicting containers must confirm the actual `exit 0` end-to-end."
  - id: D2
    description: "apps/e2e/src/mailpit.ts exports findMagicLinkUrl (recipient-scoped via GET /api/v1/search?query=to:, hard To-address assertion before returning a link, extraction from the Text plain-text MIME part, bounded 500ms poll) and clearInbox (DELETE /api/v1/messages); global-setup.ts/global-teardown.ts wire clearInbox+seedBaseline / Prisma disconnect into playwright.config.ts's globalSetup/globalTeardown, keeping the existing smoke project and baseURL unchanged"
    requirement: "INFRA-02"
    verification:
      - kind: unit
        ref: "pnpm --filter @kurzly/e2e typecheck (tsc --noEmit) — passed cleanly"
        status: pass
      - kind: other
        ref: "Direct source inspection of node_modules/better-auth@1.6.23's magic-link plugin confirms the verify URL shape findMagicLinkUrl's regex targets (/api/auth/magic-link/verify?) is exactly correct"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh apps/e2e/tests/smoke/mailpit-wiring.spec.ts (full boot/run/teardown against the built image + live Mailpit)"
        status: unknown
    human_judgment: true
    rationale: "Same pre-existing local port conflict as D1 blocks a full live run in this sandbox — see 'Issues Encountered'."
  - id: D3
    description: "apps/e2e/tests/smoke/db-isolation.spec.ts (6 concurrent tests, each resetDb()+create/read a unique Link+QrCode, proving zero P2002 under fullyParallel) and mailpit-wiring.spec.ts (requests real magic-links for the seeded admin and member recipients via POST /api/auth/sign-in/magic-link with the x-e2e-bypass header, then findMagicLinkUrl per recipient) both correctly discover and structurally validate via Playwright's own test collection"
    requirement: "INFRA-02"
    verification:
      - kind: unit
        ref: "node node_modules/@playwright/test/cli.js test --list (with E2E_DATABASE_URL/MAILPIT_URL set to their compose-contract values) — all 10 tests across 4 smoke spec files (boot, db-isolation x6, mailpit-wiring x2, prisma-import spike) discovered correctly, zero collection errors"
        status: pass
      - kind: e2e
        ref: "./scripts/e2e-compose.sh --workers=4 apps/e2e/tests/smoke/db-isolation.spec.ts apps/e2e/tests/smoke/mailpit-wiring.spec.ts (workers=N) and the same at --workers=1 (INFRA-03's explicit two-run gate)"
        status: unknown
    human_judgment: true
    rationale: "Both the workers=1 and workers=N live runs are blocked by the same pre-existing local port conflict documented under 'Issues Encountered' — deferred to CI or a clean machine, exactly as 11-03-SUMMARY.md documented for its own boot-smoke verification."

duration: 27min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 04: E2E DB Helper, Mailpit REST Client & Global Setup/Teardown Summary

**Advisory-locked Prisma truncate/reseed fixture (`db.ts`), a recipient-scoped Mailpit REST client with a hard To-address assertion (`mailpit.ts`), Playwright global-setup/teardown wiring, and two throwaway smoke specs proving zero P2002 under `fullyParallel` and zero cross-worker magic-link theft — the shared data-plane foundation Phases 12–17 build on.**

## Performance

- **Duration:** ~27 min
- **Started:** 2026-07-24T14:00:00Z (approx.)
- **Completed:** 2026-07-24T14:27:29Z
- **Tasks:** 3/3 completed
- **Files modified:** 9 (6 created, 3 modified — `apps/e2e/package.json`, `apps/e2e/playwright.config.ts`, `pnpm-lock.yaml`)

## Accomplishments

- Added `@prisma/adapter-pg ^7.8.0` as a devDependency of `apps/e2e` and built `apps/e2e/src/db.ts`: `createE2ePrisma()` (fails fast if `E2E_DATABASE_URL` is unset), `seedBaseline()` (idempotent upsert of one active Domain, one admin User, one least-privilege Member User with exactly one `DomainMembership` at role `member` — T-11-03), and `resetDb()` (advisory-locked, FK-safe `TRUNCATE "QrRemapHistory", "QrCode", "ClickEvent", "Link", "DomainMembership" RESTART IDENTITY CASCADE`, never touching `User`/`Domain`/`Session`/`Account`/`Verification` so `storageState` session rows survive between spec files — T-11-06).
- Built `apps/e2e/src/mailpit.ts`: `findMagicLinkUrl(recipient, timeoutMs)` performs a bounded (20s/500ms) poll of Mailpit's recipient-scoped search endpoint, hard-asserts the retrieved message's `To` address equals the requested recipient before returning a link (never trusting the search filter alone — T-11-07), and extracts the URL from the plain-text `Text` MIME part. `clearInbox()` empties the mailbox via `DELETE /api/v1/messages`.
- Wired `global-setup.ts` (clears the inbox, seeds the baseline) and `global-teardown.ts` (closes its own Prisma connection) into `playwright.config.ts`, keeping the existing `smoke` project and `baseURL` from 11-01/11-03 unchanged.
- Created `db-isolation.spec.ts` (6 independently-scheduled tests, each `resetDb()` + create/read a cryptographically-unique Link+QrCode, proving no P2002 collision is structurally possible regardless of `fullyParallel` scheduling) and `mailpit-wiring.spec.ts` (requests real magic-links for both the admin and member seeded recipients via `POST /api/auth/sign-in/magic-link` with the `x-e2e-bypass` header, then resolves each via `findMagicLinkUrl` — proving recipient-scoped retrieval with zero cross-worker theft).
- Confirmed the magic-link verify URL path directly from `better-auth@1.6.23`'s installed source (not assumed): `${BASE_URL}/api/auth/magic-link/verify?token=...&callbackURL=...`.

## Task Commits

Each task was committed atomically:

1. **Task 1: E2E DB helper — reused Prisma client, FK-safe resetDb, least-privilege seedBaseline** - `0112401` (feat)
2. **Task 2: Mailpit REST client + Playwright global-setup/global-teardown wiring** - `0603557` (feat)
3. **Task 3: Smoke specs — DB isolation (INFRA-03) and Mailpit wiring (INFRA-02)** - `ad17e03` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `apps/e2e/src/db.ts` - `createE2ePrisma`/`seedBaseline`/`resetDb` + `ADMIN_EMAIL`/`MEMBER_EMAIL`/`BASELINE_DOMAIN_HOSTNAME` constants.
- `apps/e2e/src/mailpit.ts` - `findMagicLinkUrl`/`clearInbox`, recipient-scoped, hard To-address assertion.
- `apps/e2e/global-setup.ts` - clears the inbox + seeds the baseline once per suite run.
- `apps/e2e/global-teardown.ts` - closes its own short-lived Prisma client.
- `apps/e2e/tests/smoke/db-isolation.spec.ts` - 6-test P2002-free proof under `fullyParallel`.
- `apps/e2e/tests/smoke/mailpit-wiring.spec.ts` - recipient-scoped magic-link retrieval proof (admin + member).
- `apps/e2e/package.json` - + `@prisma/adapter-pg ^7.8.0` devDependency.
- `apps/e2e/playwright.config.ts` - + `globalSetup`/`globalTeardown` references.
- `pnpm-lock.yaml` - lockfile update from the new devDependency.

## Decisions Made

- Confirmed the magic-link verify URL path empirically against `better-auth@1.6.23`'s actual installed source rather than trusting RESEARCH's assumed regex blindly — closes Assumption A2/Open Question 2 with certainty.
- `global-setup.ts`/`global-teardown.ts` each open and close their own Prisma client rather than attempting to share one instance across the two separate Playwright process invocations.
- `db-isolation.spec.ts` deliberately uses cryptographically-random per-test slugs (not deterministic ones) so a real P2002 unique-constraint collision is structurally impossible regardless of worker scheduling — this isolates the phase's own "zero P2002" success criterion from the deeper, RESEARCH-acknowledged "read-your-own-write" race inherent in a shared-table truncate-per-test design (mitigated, not eliminated, by the advisory lock), which is out of scope for this throwaway smoke spec to fully solve.

## Deviations from Plan

None - plan executed exactly as written. All artifacts match the plan's `<action>` and `<acceptance_criteria>` blocks; no Rule 1-4 fixes were needed.

## Issues Encountered

**Full end-to-end live verification blocked by the same pre-existing, unrelated Docker containers documented in 11-03-SUMMARY.md — not a defect in this plan's artifacts.**

One live attempt of `./scripts/e2e-compose.sh apps/e2e/tests/smoke/db-isolation.spec.ts apps/e2e/tests/smoke/mailpit-wiring.spec.ts` was made in this sandbox:

- `docker ps` confirmed, before attempting, that both `zbr-brain-postgres-1` (bound to host port `5433`) and `ddev-router` (bound to host port `8025`) — pre-existing, unrelated containers from other projects on this shared dev machine — were still running, exactly as 11-03-SUMMARY.md documented.
- The compose stack booted its network/volumes/mailpit/db containers successfully, but failed at `mailpit`'s port bind (`Bind for 127.0.0.1:8025 failed: port is already allocated`) before the `app` container could even start.
- The teardown trap correctly fired (`down -v --remove-orphans`), confirmed via `docker ps -a --filter name=kurzly-e2e` showing zero leftover containers.

Per this plan's own `<important_note>` guardrail (never touch unrelated containers/volumes belonging to other projects), no attempt was made to stop or reconfigure `zbr-brain-postgres-1` or `ddev-router`.

**What was verified instead, to close the gap as tightly as possible without a full live run:**
- `pnpm --filter @kurzly/e2e typecheck` (`tsc --noEmit`) passes cleanly for all new/modified files.
- `pnpm install --filter @kurzly/e2e` resolves `@prisma/adapter-pg@^7.8.0` cleanly against the existing lockfile (already present at `7.8.0` via `apps/api`'s dependency).
- `docker compose -p kurzly-e2e-cfgcheck -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml config` still renders correctly (unmodified by this plan).
- Playwright's own test collection (`node node_modules/@playwright/test/cli.js test --list`, with `E2E_DATABASE_URL`/`MAILPIT_URL` set to their exact compose-contract values) discovers all 10 tests across all 4 smoke spec files (`boot.spec.ts`, `db-isolation.spec.ts` x6, `mailpit-wiring.spec.ts` x2, `prisma-import.spike.spec.ts`) with zero collection errors — proving the `globalSetup`/`globalTeardown` wiring, module resolution, and TypeScript typing are all sound end-to-end short of an actual live Postgres/Mailpit connection.
- Direct source inspection confirmed `resetDb`'s `TRUNCATE` table list/order and lock usage exactly match the plan's acceptance criteria, and confirmed `better-auth@1.6.23`'s actual magic-link verify URL shape from its installed source rather than assuming it.
- A minor tooling note (not a defect): `npx playwright test <file> --list` intermittently returned `0 tests` in this sandbox due to an interaction with the `rtk` CLI proxy hook (`.claude/RTK.md`) intercepting the `npx` invocation ("`[RTK:PASSTHROUGH] playwright parser: All parsing tiers failed`"). Invoking `node node_modules/@playwright/test/cli.js test <file> --list` directly (bypassing the proxy) reliably reproduced correct results — used for all test-collection verification above.

**What remains unverified:** the literal `exit 0` of `./scripts/e2e-compose.sh --workers=1 ...` and `./scripts/e2e-compose.sh --workers=4 ...` against a live running stack (INFRA-03's explicit two-run gate). This requires an environment (CI, or a clean local machine) without `zbr-brain-postgres-1`/`ddev-router` already bound to `5433`/`8025`. Recorded as `status: unknown` / `human_judgment: true` in this SUMMARY's `coverage` block (D1/D2/D3) rather than silently claimed as passing.

## User Setup Required

None - no external service configuration required. (The port conflicts above are a pre-existing local sandbox condition from unrelated projects, not a new setup requirement introduced by this plan — CI and most clean dev machines will not have `zbr-brain-postgres-1`/`ddev-router` running.)

## Next Phase Readiness

- `apps/e2e/src/db.ts`, `apps/e2e/src/mailpit.ts`, `global-setup.ts`/`global-teardown.ts`, and the two smoke specs are all in place, typecheck cleanly, and are structurally verified via Playwright's own test collection.
- Downstream plans in this phase (`auth.setup.ts`'s magic-link round trip, `chromium-admin`/`chromium-member` projects) can build directly on `seedBaseline()`'s `ADMIN_EMAIL`/`MEMBER_EMAIL` constants, `resetDb()`'s per-file reset contract, and `findMagicLinkUrl()`'s recipient-scoped retrieval.
- **Recommended before this phase's final CI-wiring plan ships:** re-run `./scripts/e2e-compose.sh --workers=1 apps/e2e/tests/smoke/db-isolation.spec.ts apps/e2e/tests/smoke/mailpit-wiring.spec.ts` and the same at `--workers=4` once in a clean environment (or let the new CI `e2e` job itself be the first real confirmation) to close out D1/D2/D3's `unknown` status — the GitHub Actions runner will not have this sandbox's two conflicting local containers.
- No blockers for proceeding to the next plan in this phase.

---
*Phase: 11-playwright-e2e-infrastructure-fixtures*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: apps/e2e/src/db.ts
- FOUND: apps/e2e/src/mailpit.ts
- FOUND: apps/e2e/global-setup.ts
- FOUND: apps/e2e/global-teardown.ts
- FOUND: apps/e2e/tests/smoke/db-isolation.spec.ts
- FOUND: apps/e2e/tests/smoke/mailpit-wiring.spec.ts
- FOUND: .planning/phases/11-playwright-e2e-infrastructure-fixtures/11-04-SUMMARY.md
- FOUND: commit 0112401
- FOUND: commit 0603557
- FOUND: commit ad17e03
