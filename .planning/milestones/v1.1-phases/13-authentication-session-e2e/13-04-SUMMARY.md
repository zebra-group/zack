---
phase: 13-authentication-session-e2e
plan: 04
subsystem: testing
tags: [playwright, e2e, better-auth, magic-link, allowlist, invite-only]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "02"
    provides: "apps/e2e/src/mailpit.ts's findMagicLinkUrl, the standalone `auth` Playwright project (no setup dependency, no storageState)"
  - phase: 11-playwright-e2e-infrastructure-fixtures
    provides: "apps/e2e/src/mailpit.ts's recipient-scoped findMagicLinkUrl (cross-worker email-theft guard)"
provides:
  - "apps/e2e/tests/auth/invite-only-denial.spec.ts: AUTH-E2E-03 — a genuinely non-invited (no User row) email produces zero Mailpit messages and zero session, through the real HTTP flow"
affects: ["13-05", "13-06", "13-07", "13-08"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Denial proof via absence, not response shape: findMagicLinkUrl(email, shortTimeout) is expected to REJECT (no message ever arrives) rather than asserting any distinguishable HTTP response — the neutral 200 (D-01) is documented as expected-by-design, not the assertion target"
    - "A short (4s) Mailpit poll timeout is safe and deterministic specifically because the recipient email is unique-per-test-run and never seeded anywhere — there is no race to wait out, the message will never appear"

key-files:
  created:
    - apps/e2e/tests/auth/invite-only-denial.spec.ts
  modified: []

key-decisions:
  - "No fixture User row is created for the test's email at all — its non-existence in the User table IS the precondition isEmailAllowed checks; this is the one spec in the phase that deliberately creates NO Prisma fixture, unlike every other auth spec."
  - "Used a distinct email domain (nobody.kurzly.local) from every other spec's e2e.kurzly.local convention, purely for readability at a glance in Mailpit/logs — no functional requirement drove this, uniqueness via randomUUID alone would have sufficed."
  - "Asserted findMagicLinkUrl(...).rejects.toThrow(/No magic-link email found/) rather than a bare .rejects.toThrow() — pins the assertion to the specific 'no message found within timeout' failure mode (mailpit.ts's own error text), not any arbitrary rejection (e.g. a network/fetch error would also make a bare toThrow() pass, proving nothing)."

requirements-completed: [AUTH-E2E-03]

coverage:
  - id: D1
    description: "POST /api/auth/sign-in/magic-link for a genuinely non-invited (no User row) email returns a neutral 200 (D-01) — asserted as expected-by-design, not as the denial proof"
    requirement: "AUTH-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/invite-only-denial.spec.ts — live compose (kurzly-e2e-p13-04), default parallelism and --workers=1, both green"
        status: pass
    human_judgment: false
  - id: D2
    description: "findMagicLinkUrl(nonInvitedEmail, 4000) rejects — zero Mailpit messages ever arrive for the non-allowlisted recipient, because sendMagicLinkEmail is never called"
    requirement: "AUTH-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/invite-only-denial.spec.ts#non-invited email yields zero Mailpit message and zero session (AUTH-E2E-03) — live compose, pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/auth/get-session from a fresh, cookie-less BrowserContext returns null (no session) for the non-invited email"
    requirement: "AUTH-E2E-03"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/invite-only-denial.spec.ts#non-invited email yields zero Mailpit message and zero session (AUTH-E2E-03) — live compose, pass"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 04: Invite-Only Denial (AUTH-E2E-03) Summary

**One new spec proves invite-only enforcement through the real flow: a genuinely non-invited email (no `User` row created, ever) triggers zero Mailpit messages and zero session, with the neutral 200 POST response documented as expected-by-design (D-01), never as the proof itself.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-25
- **Tasks:** 1/1
- **Files modified:** 1 (created)

## Accomplishments

- `apps/e2e/tests/auth/invite-only-denial.spec.ts` (AUTH-E2E-03) — POSTs `/api/auth/sign-in/magic-link` for a dedicated, never-seeded `not-invited-<random>@nobody.kurzly.local` address (with the INFRA-06 `x-e2e-bypass` header so it never contends the shared rate-limit bucket), asserts the response is a neutral 200, then proves denial two independent ways:
  - `findMagicLinkUrl(email, 4_000)` is asserted to REJECT with the specific "No magic-link email found" error — Mailpit never receives a message for this recipient because `apps/api/src/lib/auth.ts`'s `sendMagicLink` callback's `isEmailAllowed` gate short-circuits before `sendMagicLinkEmail` is ever called.
  - A fresh, cookie-less `browser.newContext()` confirms `GET /api/auth/get-session` returns `null`.
- Confirmed live against the built compose image, both at default parallelism and `--workers=1`, alongside the phase's two existing specs (`magic-link-round-trip.spec.ts`, `magic-link-token-rejection.spec.ts`) — 5/5 green in both runs.

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-E2E-03 — non-invited email gets zero email and zero session** — `2a2c911` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/auth/invite-only-denial.spec.ts` — AUTH-E2E-03, one test, standalone `auth` Playwright project

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- No Prisma fixture is created for this test's email — its absence from the `User` table is the entire precondition, unlike every other spec in this phase which explicitly writes a fixture row.
- Pinned the rejection assertion to the specific "No magic-link email found" error text (not a bare `.rejects.toThrow()`) so a coincidental unrelated failure (e.g. Mailpit unreachable) can never be mistaken for proof of denial.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, or blockers required a code fix; the spec file matches the task's action text and acceptance criteria directly.

## Issues Encountered

- **This dev machine's canonical E2E ports (3000, 5433, 8025) were already bound by unrelated projects** (a `product-catalog` Node dev server on 3000, `zbr-brain-postgres-1` on 5433, `ddev-router` on 8025), same as Phase 12/13-01/13-03. Resolved via the established pattern: alternate compose project name (`kurzly-e2e-p13-04`) + an uncommitted `docker-compose.e2e.local-ports.override.yml` remapping `db`→15433, `mailpit`→18025/11025, `app`→13000 (with matching `BASE_URL`/`OIDC_MOCK_REDIRECT_URI` overrides). Port 9000 (`oidc-mock`) was free and needed no remap.
- **First `up -d --wait` attempt failed** (`port is already allocated` for `mailpit`'s 8025): the override file's plain YAML `ports:` lists were concatenated with the base files' port lists by Compose's default sequence-merge behavior, rather than replacing them. Fixed by adding the `!override` merge tag to each remapped service's `ports:` key (mirroring 13-01/13-03's own documented convention) — second attempt booted all four services healthy on the first try.

## Live Verification (per the plan's `<important_note>`)

1. Built and booted the full 4-service stack (`db`, `mailpit`, `oidc-mock`, `app`) under `kurzly-e2e-p13-04` with the override file above — all four reported healthy.
2. Ran `pnpm --filter @kurzly/e2e exec playwright test tests/auth/invite-only-denial.spec.ts --project=auth` — 1/1 passed.
3. Ran the full `tests/auth/` directory at default parallelism (3 workers) — 5/5 passed (this plan's spec plus 13-03's two specs' four tests).
4. Re-ran the identical `tests/auth/` command at `--workers=1` — 5/5 passed again — no DB-isolation/rate-limit collision this new spec introduces alongside the existing ones.
5. Confirmed `pnpm --filter @kurzly/e2e run typecheck` (`tsc --noEmit`) passes clean.
6. Tore the stack down fully (`down -v --remove-orphans`), deleted the two built images, deleted the override file and the scratch `.env`, and confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's one new spec file.

**Result: PROVEN LIVE**, both at default parallelism and `--workers=1`, against the built compose image — not just statically reasoned about.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

AUTH-E2E-03 is closed. `apps/e2e/tests/auth/` now has 3 of the phase's 7 spec files (AUTH-E2E-01/02/03); the remaining four (AUTH-E2E-04 through AUTH-E2E-07) can proceed independently — none of them depend on this plan's file beyond the shared `mailpit.ts`/`users.ts`/`oidc-mock.ts` vocabulary already established by 13-01/13-02. The carried-forward blocker from 13-01/13-02 (`apps/api/src/lib/auth.ts`'s `genericOAuth` config needs a `scopes: ["openid", "email", "profile"]` fix before AUTH-E2E-04/05's real round trip can pass) remains unresolved and is not this plan's scope.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/auth/invite-only-denial.spec.ts
- FOUND: commit 2a2c911 (Task 1)
- FOUND: .planning/phases/13-authentication-session-e2e/13-04-SUMMARY.md
