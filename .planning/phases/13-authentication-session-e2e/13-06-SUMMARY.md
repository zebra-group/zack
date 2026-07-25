---
phase: 13-authentication-session-e2e
plan: 06
subsystem: testing
tags: [playwright, e2e, rate-limit, magic-link, auth, ux]

# Dependency graph
requires:
  - phase: 13-authentication-session-e2e
    plan: "02"
    provides: "apps/e2e's standalone `auth` Playwright project (no `dependencies: [\"setup\"]`, no storageState) that this spec runs under"
provides:
  - "apps/e2e/tests/auth/resend-rate-limit.spec.ts: the ONE magic-link-sending spec in this phase that deliberately omits the INFRA-06 x-e2e-bypass header, proving the real @fastify/rate-limit limiter drives a real 429 that LoginView.vue surfaces as clear German UI copy"
affects: ["13-07", "13-08"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-exhaust an IP-keyed rate-limit bucket via direct page.request.post calls (no bypass header) BEFORE driving the real UI once, so the UI-driven request deterministically observes the already-tripped bucket rather than racing the UI's own idle->success state transition"

key-files:
  created:
    - apps/e2e/tests/auth/resend-rate-limit.spec.ts

key-decisions:
  - "No Prisma User fixture is created for the test email — confirmed by reading routes/auth.ts that MAGIC_LINK_RATE_LIMIT is applied via Fastify's onRequest rate-limit hook, which runs BEFORE the route handler (and therefore before isEmailAllowed's allowlist check), so the bucket counts every request to this route regardless of whether the target email exists as a User row."
  - "Live-verified this spec passes both alone and together with all 6 other tests/auth/ specs (which DO send the bypass header) under a single Playwright invocation — confirms the real burst this spec drives never collides with sibling specs' rate-limit budgets, exactly as 13-RESEARCH.md's cross-plan coordination note required."

requirements-completed: [AUTH-E2E-07]

coverage:
  - id: D1
    description: "A magic-link request burst that trips the real @fastify/rate-limit limiter (5/15min, IP-keyed) surfaces the exact German copy 'Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.' in LoginView.vue, with no x-e2e-bypass header ever sent"
    requirement: "AUTH-E2E-07"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/auth/resend-rate-limit.spec.ts — live-run against the built compose image (isolated project name/ports on this dev machine), passed alone (1 passed) and alongside all 7 tests/auth/ specs together (7 passed)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-25
status: complete
---

# Phase 13 Plan 06: Resend Rate-Limit UX (AUTH-E2E-07) Summary

**One dedicated Playwright spec proves the real `@fastify/rate-limit` limiter — not the E2E bypass — drives a genuine 429 that `LoginView.vue` surfaces as the exact German "Zu viele Anfragen" copy, live-verified alone and alongside every sibling `tests/auth/` spec with zero cross-spec rate-limit collision.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-25
- **Tasks:** 1/1
- **Files modified:** 1 (created)

## Accomplishments

- Created `apps/e2e/tests/auth/resend-rate-limit.spec.ts`: pre-exhausts `MAGIC_LINK_RATE_LIMIT` (5 req/15min, IP-keyed) via 6 direct `page.request.post` calls to `POST /api/auth/sign-in/magic-link` with NO `x-e2e-bypass` header anywhere in the file, then drives the real login UI once and asserts the verbatim German 429 copy.
- Confirmed via source read (`routes/auth.ts`) that the rate limiter's `onRequest` hook fires before `isEmailAllowed`'s allowlist check, so no Prisma `User` fixture is needed — the dedicated email's non-existence is irrelevant to tripping the bucket.
- Live-verified against the actual built compose image: the spec passes standalone, and passes together with all 6 other `tests/auth/` specs (which all send the bypass header) in a single Playwright run, proving this spec's real burst never contends their budgets.

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-E2E-07 — tripped rate limit shows the exact German UI copy** - `52152d7` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/auth/resend-rate-limit.spec.ts` - fires a 6-request same-IP burst (no bypass header) against the magic-link endpoint, then drives `LoginView.vue`'s real form and asserts the exact `.error-inline` German copy plus that the form did not transition to the "Link gesendet" sent state

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline items:
- No `User` fixture: the rate limiter is applied at the route's `onRequest` hook, ahead of the allowlist check, so a genuinely non-existent email still trips the bucket — confirmed by reading `routes/auth.ts`'s route registration directly rather than assuming.
- Verified real cross-spec isolation empirically (not just by convention): ran the full `tests/auth/` directory in one Playwright invocation against the live compose stack and confirmed all 7 specs pass together, since every sibling spec sends the INFRA-06 bypass header and this is the only one that doesn't.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1/2/3 fixes were needed; the plan's action text already anticipated the exact pre-exhaust-then-drive-UI shape implemented here.

## Issues Encountered

- This dev machine's canonical E2E ports (3000/5433/8025) were already bound by unrelated projects (same as Phases 11-13's prior plans). Resolved via the established pattern: an uncommitted `docker-compose.e2e.local-ports.override.yml` (project name `kurzly-e2e-p1306`, remapping `db`→15433, `mailpit`→18025/1025, `app`→13000 with a matching `BASE_URL` override) using Compose's `!override` merge tag. Port 9000 (`oidc-mock`, unused by this spec but required by `depends_on: service_healthy`) was free.
- First live-verification attempt against the isolated stack (before `E2E_RATE_LIMIT_BYPASS_SECRET` was correctly exported into the recreated `app` container's environment) caused 4 sibling specs to also observe 429s, since their bypass header had nothing to match — not a defect in this plan's spec, but a reminder that the bypass secret must be present for sibling specs' isolation to hold. Re-ran with the secret correctly exported; all 7 `tests/auth/` specs passed together on the corrected run.
- Tore the stack down fully (`down -v --remove-orphans`), deleted both built images (`kurzly-e2e-p1306-app`, `kurzly-e2e-p1306-oidc-mock`), deleted the override file and the generated `.env`, and confirmed via `docker ps`/`git status --short` that every other project's containers were untouched and the working tree contains only this plan's one new file.

## Live Verification (per the plan's `<important_note>`)

1. Booted the 4-service stack under `kurzly-e2e-p1306` with the override file above: `db`, `mailpit`, `oidc-mock`, `app` all reported healthy.
2. `playwright test tests/auth/resend-rate-limit.spec.ts --project=auth` — **1 passed**, standalone.
3. `playwright test tests/auth/ --project=auth` (all 7 specs, `E2E_RATE_LIMIT_BYPASS_SECRET` correctly exported) — **7 passed**, confirming this spec's real burst never collides with `magic-link-round-trip.spec.ts`, `magic-link-token-rejection.spec.ts`, `invite-only-denial.spec.ts`, or `logout-route-guard.spec.ts` (all bypass-header specs).
4. Tore the stack down (`down -v --remove-orphans`), removed both built images, removed the override file and `.env`, confirmed no other project's containers were affected.

**Result: PROVEN LIVE**, not just statically reasoned about.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

AUTH-E2E-07 is closed. The carried-forward blocker from 13-01/13-02 (`apps/api/src/lib/auth.ts`'s `genericOAuth` config needs `scopes: ["openid", "email", "profile"]` before AUTH-E2E-04/05's real round trip can pass) remains unaddressed by this plan (out of scope — this plan's `files_modified` is only the new spec) and is still recorded in STATE.md's Blockers/Concerns for whichever plan writes `sso-login.spec.ts`.

---
*Phase: 13-authentication-session-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/tests/auth/resend-rate-limit.spec.ts
- FOUND: commit 52152d7 (Task 1)
- FOUND: .planning/phases/13-authentication-session-e2e/13-06-SUMMARY.md
