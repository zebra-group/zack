---
phase: 17-team-management-domain-scoped-authz-e2e
plan: 04
subsystem: testing
tags: [playwright, e2e, authorization, idor, analytics, domain-scoping]

requires:
  - phase: 17-01/02/03
    provides: apps/e2e/src/users.ts createAllowlistedUser, apps/e2e/src/mailpit.ts findMagicLinkUrl, the storageState:undefined second-session-under-chromium-admin fixture pattern
provides:
  - "apps/e2e/tests/authed/authz-domain-denial.spec.ts — AUTHZ-E2E-01 live-verified"
affects: [17-05, verify-work, milestone-close]

tech-stack:
  added: []
  patterns:
    - "Zero-domain member fixture (createAllowlistedUser, no DomainMembership) + own real magic-link session established inline under chromium-admin via storageState:undefined (reused verbatim from 17-02)"
    - "Direct-by-id denial proof (never list-emptiness) for IDOR-guarded resources: /links/:id -> .not-found-card, GET /api/qr-codes/:id -> 404"
    - "Silent-scoping proof for account-wide read endpoints: seed a real click the caller cannot see, then assert the caller's own rollup excludes it (200, not 404/403)"

key-files:
  created:
    - apps/e2e/tests/authed/authz-domain-denial.spec.ts
  modified: []

key-decisions:
  - "Scoped to chromium-admin only (test.skip on chromium-member) — this spec establishes its own zero-domain member session inline, distinct from the seeded chromium-member fixture (which HAS a domain membership); running under both projects would be a redundant double-run of the identical inline-session setup."
  - "Analytics case asserted as 200 + empty rollup (clicks30Days:0, topLinks:[]), explicitly NOT a .not-found-card or fake 403 — matches 17-RESEARCH.md Pattern 4's documented 'scope silently, never leak' convention; no production code change."

requirements-completed: [AUTHZ-E2E-01]

coverage:
  - id: D1
    description: "A zero-domain member navigating directly to a baseline-domain Link's /links/:id renders .not-found-card (404 IDOR guard, resolveOwnedLink)"
    requirement: "AUTHZ-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/authz-domain-denial.spec.ts — CASE 1 (Link denial)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same member's GET /api/qr-codes/:id and GET /api/links/:id both return 404 (resolveOwnedQrCode/resolveOwnedLink IDOR guard), sharing the member's real cookie jar"
    requirement: "AUTHZ-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/authz-domain-denial.spec.ts — CASE 2 (QR denial)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The member's /analytics renders the zero-data branch and GET /api/analytics returns 200 with clicks30Days:0/topLinks:[] despite a real 302 click existing on a baseline link the member cannot see"
    requirement: "AUTHZ-E2E-01"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/authed/authz-domain-denial.spec.ts — CASE 3 (Analytics silent scoping)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-25
status: complete
---

# Phase 17 Plan 04: AUTHZ-E2E-01 — Zero-Domain Member Denial Summary

**A zero-DomainMembership member's own real session is denied server-side through the real UI/API for one representative case per resource type: Link 404 (`.not-found-card`), QR 404, and Analytics 200-empty-rollup — closing AUTHZ-E2E-01 with zero apps/api/apps/web diffs.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 1
- **Files modified:** 1 (new file)

## Accomplishments

- Proved the Link IDOR guard (`resolveOwnedLink`) at the E2E layer for the first time: a direct `/links/:id` navigation to a KNOWN baseline-domain link, by a member with zero `DomainMembership` rows, renders `LinkDetailView.vue`'s `.not-found-card` ("Link nicht gefunden") — never a list-emptiness check.
- Proved the QR IDOR guard (`resolveOwnedQrCode`) independently via `GET /api/qr-codes/:id` (404), sharing the member's real browser cookie jar — plus the Link resource's own API guard (`GET /api/links/:id` -> 404).
- Proved `GET /api/analytics`'s deliberately different denial shape: a REAL 302 click was generated on the baseline link first (so a real ClickEvent exists), then the zero-domain member's own `/analytics` load renders the zero-data branch and its `GET /api/analytics` independently returns 200 (never 404) with `clicks30Days: 0` and `topLinks: []` — the click is silently scoped out, not leaked and not error-gated.
- No production code changes were needed — every assertion held against the existing, already-shipped `apps/api`/`apps/web` behavior.

## Task Commits

1. **Task 1: AUTHZ-E2E-01 — zero-domain member denied Link (404), QR (404), Analytics (200 empty rollup)** - `34cc38e` (test)

**Plan metadata:** committed as part of this SUMMARY's finalization commit.

## Files Created/Modified

- `apps/e2e/tests/authed/authz-domain-denial.spec.ts` - AUTHZ-E2E-01 spec: zero-domain member fixture (`createAllowlistedUser`), a baseline Link + static QR fixture, a real 302 click seeded on that Link, the member's own real magic-link session (established inline under `chromium-admin` via `storageState: undefined`, reused verbatim from 17-02's documented CSRF fix), and three cases (Link 404, QR 404, Analytics 200-empty-rollup).

## Decisions Made

- Scoped the spec to `chromium-admin` only (skip under `chromium-member`) — the spec's own subject is a THIRD, ad-hoc zero-domain identity established inline, unrelated to either pre-baked `storageState` role; running it twice would be a redundant duplicate of the identical setup.
- Kept the Analytics case's assertion shape exactly as 17-RESEARCH.md's Pattern 4 documents (200 + empty rollup) rather than "improving" it into a denied-page equivalent — that would contradict the codebase's existing "scope silently, never leak" convention.

## Deviations from Plan

None — plan executed exactly as written. No apps/api or apps/web changes were required or made.

## Issues Encountered

- **Local port collisions on the host:** this machine already has unrelated Docker containers bound to the E2E stack's default ports (`3000`, `5433`, `8025`), so `scripts/e2e-compose.sh` could not be used verbatim. Worked around with a session-local, non-committed Compose port-remap overlay (`!override` on each service's `ports:` list, per STATE.md's Phase 15 precedent) plus an explicit `BASE_URL` override on `app` (docker-compose.e2e.yml hardcodes `http://localhost:3000`, which must match the remapped host port or magic-link URLs retrieved from Mailpit point at the wrong, already-occupied port). The overlay file lived only in the scratchpad directory, never committed, and the stack was booted/torn down (`down -v --remove-orphans`) under a dedicated project name (`kurzly-e2e-1704`).
- **Rate-limit bucket exhaustion from repeated manual re-invocation:** per the plan's own verification note, the spec was re-run at both `--workers=1` and default parallelism to confirm stability beyond `retries:2`. Both of those runs passed cleanly. A THIRD manual re-run (done purely to double-check) tripped the app's global `@fastify/rate-limit` bucket, because — unlike CI's one-boot-per-invocation flow — three back-to-back manual Playwright invocations against the SAME long-lived app container accumulate against its in-memory rate-limit state from the same host IP. Restarting the app container's process (`docker restart`, which clears its in-memory rate-limit bucket) immediately restored a clean pass. This is a testing-harness artifact of repeated manual re-invocation, not a spec or app-code regression — confirmed by inspecting the app's own logs, which showed the exact `429 Rate limit exceeded, retry in 15 minutes` responses hitting unrelated endpoints (`/api/version`, `/api/domains`) alongside the auth flow, consistent with the GLOBAL bucket (not the narrower `MAGIC_LINK_RATE_LIMIT`) being exhausted.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

AUTHZ-E2E-01 is closed. 17-05 (AUTHZ-E2E-02, the account-admin bypass case) can proceed — per 17-RESEARCH.md Pattern 5, the existing seeded `chromium-admin` fixture (zero `DomainMembership` rows itself) is already a live instance of the bypass it must prove, so no new fixture code is anticipated there either.

---
*Phase: 17-team-management-domain-scoped-authz-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED
- FOUND: apps/e2e/tests/authed/authz-domain-denial.spec.ts
- FOUND: .planning/phases/17-team-management-domain-scoped-authz-e2e/17-04-SUMMARY.md
- FOUND commit: 34cc38e
