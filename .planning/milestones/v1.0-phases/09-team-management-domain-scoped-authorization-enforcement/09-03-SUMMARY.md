---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 03
subsystem: api
tags: [fastify, prisma, better-auth, magic-link, zod, postgres]

# Dependency graph
requires:
  - phase: 09-01
    provides: "AccountRole enum, User.accountRole column, isAccountAdmin(prisma, userId) primitive, SessionUser.accountRole"
provides:
  - "TeamMemberDTO/InviteMemberInput/MemberStatus shared DTOs (packages/shared)"
  - "lib/team.ts: toTeamMemberDto (sole status-derivation site), listTeamMembers, inviteMember (create-or-resend)"
  - "GET /api/team (admin-gated list) and POST /api/team/invite (admin-gated, rate-limited invite)"
  - "Confirmed auth.api.signInMagicLink as the correct server-side magic-link trigger method for better-auth@1.6.23"
affects: [09-04, 09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Status-derivation-at-the-boundary: a DTO field computed from a DB column in exactly one mapping function, never re-derived downstream (mirrors LinkDTO.passwordProtected/QrCodeDTO.logoEnabled precedent)"
    - "Server-side better-auth trigger via auth.api.<endpoint>({ body, headers: new Headers() }) for actions with no real inbound HTTP request to forward headers from"

key-files:
  created:
    - apps/api/src/lib/team.ts
    - apps/api/src/routes/team.ts
    - apps/api/test/team.integration.test.ts
  modified:
    - packages/shared/src/index.ts
    - apps/api/src/app.ts

key-decisions:
  - "Confirmed (not guessed) auth.api.signInMagicLink as the server-side magic-link trigger by reading the installed better-auth@1.6.23 package's own type surface (dist/plugins/magic-link/index.d.mts) and implementation (index.mjs) before writing the call — it unconditionally invokes the sendMagicLink callback regardless of disableSignUp/allowlist status, which live only inside our own callback (lib/auth.ts) and inside magicLinkVerify respectively"
  - "requireHeaders: true on signInMagicLink only requires a truthy Headers object (verified against better-call@1.3.7's validator.mjs source) — passing `new Headers()` for a server-originated call with no real inbound request satisfies it"
  - "inviteMember validates domainIds exist BEFORE any write, returning a typed INVALID_DOMAIN result instead of letting an unhandled Prisma foreign-key violation surface as a 500 (Rule 2 — missing critical functionality, not in the plan's explicit behavior list but required for correctness)"
  - "Re-invite path (D-09-04) looks the user up first and, on hit, applies zero accountRole/membership changes — proven by a test that deliberately requests a DIFFERENT accountRole on the second invite call to assert it is ignored"

patterns-established:
  - "toTeamMemberDto as the ONE place MemberStatus is computed from User.emailVerified — plans 09-04+ must reuse listTeamMembers/toTeamMemberDto rather than re-deriving status"
  - "Team route admin gate: isAccountAdmin(prisma, userId) called directly in the route handler (401 no-session, then 403 non-admin) — the same shape 09-04's assign/role/remove endpoints should follow"

requirements-completed: [TEAM-01, TEAM-02]

coverage:
  - id: D1
    description: "GET /api/team is admin-gated: 401 unauthenticated, 403 for a non-admin member, 200 with the full member list for the account admin"
    requirement: "TEAM-01"
    verification:
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#GET /api/team returns 401 with no session"
        status: pass
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#GET /api/team returns 403 for a signed-in non-admin member"
        status: pass
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#GET /api/team returns 200 with the full member list for the account admin"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/team/invite creates a pending User with the chosen accountRole (member+domains or admin), rejects non-admins (403) and invalid email (400)"
    requirement: "TEAM-01"
    verification:
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#POST /api/team/invite returns 403 for a non-admin member"
        status: pass
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#POST /api/team/invite returns 400 for an invalid/empty email"
        status: pass
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#creates a pending member invitee with domains assigned and sends exactly one magic link"
        status: pass
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#creates a pending admin invitee with no domains"
        status: pass
    human_judgment: false
  - id: D3
    description: "Re-inviting an existing address re-sends the magic link, creates no duplicate user, and leaves accountRole unchanged (D-09-04)"
    requirement: "TEAM-01"
    verification:
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#re-inviting an existing address re-sends the magic link, creates no duplicate, and leaves accountRole unchanged"
        status: pass
    human_judgment: false
  - id: D4
    description: "An invited user flips from status pending to active only after a REAL magic-link sign-in round trip (D-09-03), proving the emailVerified-derived status end to end"
    requirement: "TEAM-02"
    verification:
      - kind: integration
        ref: "apps/api/test/team.integration.test.ts#flips an invited user from pending to active after a real magic-link sign-in round trip (D-09-03)"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 3: Team List + Invite (Admin-Gated) Summary

**Admin-gated `GET /api/team` + `POST /api/team/invite`, backed by `lib/team.ts`'s single-write-path core, with status derived once from `emailVerified` and proven by a real magic-link pending-to-active round trip**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-23T08:55:00+02:00
- **Completed:** 2026-07-23T09:16:44+02:00
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- Added `MemberStatus`, `TeamMemberDTO`, `InviteMemberInput` to `packages/shared` — `status` is an explicit DTO field the frontend reads verbatim, never re-derived from `emailVerified` (which never crosses the JSON boundary).
- Created `apps/api/src/lib/team.ts`: `toTeamMemberDto` (the sole `status` derivation site, D-09-03), `listTeamMembers` (every user + assigned domains), and `inviteMember` (create-or-resend, D-09-04) — the only `prisma.user.create` call site this phase adds (grep-verified).
- **Verified, not guessed**, the better-auth server-side magic-link trigger method before wiring it: read the installed `better-auth@1.6.23` package's own `dist/plugins/magic-link/index.d.mts` (documents `signInMagicLink` as the "server: `auth.api.signInMagicLink`" API method) and its `index.mjs` implementation (confirms it unconditionally calls `sendMagicLink` regardless of `disableSignUp`/allowlist — that gate lives only inside our own callback in `lib/auth.ts`). Also verified `requireHeaders: true` only needs a truthy `Headers` object by reading `better-call`'s own validator source, so `headers: new Headers()` is correct for this server-originated (no real inbound request) call.
- Created `apps/api/src/routes/team.ts`: `GET /api/team` and `POST /api/team/invite`, both gated on `isAccountAdmin` (401 no session, 403 non-admin); invite carries a strict Zod allowlist (T-09-INVITE-MASS) and `MAGIC_LINK_RATE_LIMIT` (T-09-INVITE-BOMB, same bucket as the login magic-link endpoint).
- Registered `teamRoute(prisma, auth)` in `app.ts` directly after `qrCodesRoute`, before `healthRoute`/`redirectRoute`/`registerStatic` (Pitfall 5 shadowing rule), and extended the file's registration-order header comment.
- `apps/api/test/team.integration.test.ts`: 9 cases against real Postgres, including the headline D-09-03 evidence — an invited user is created `pending`, and only flips to `active` in `GET /api/team` after completing a genuine magic-link sign-in round trip (not a manually flipped column).

## Task Commits

Each task followed RED -> GREEN (Task 2; Task 1 is TDD via `tsc --noEmit` gate — no separate test file, its behavior is proven by Task 2's integration suite per the plan):

1. **Task 1: Team DTOs + lib/team.ts (list + invite + status derivation)**
   - `6f0de07` feat(09-03): team DTOs + lib/team.ts list/invite with emailVerified-derived status
2. **Task 2: routes/team.ts (admin-gated GET + invite) + app.ts registration + integration suite**
   - `8e43e24` test(09-03): failing team list + invite + pending->active round-trip cases
   - `794fbf8` feat(09-03): admin-gated GET /api/team + POST /api/team/invite

RED was verified genuinely: `routes/team.ts` and the `app.ts` registration were temporarily removed (`git checkout -- apps/api/src/app.ts`) before the test commit, confirming all 9 cases failed with `404` (route did not exist), then restored for GREEN.

## Files Created/Modified
- `packages/shared/src/index.ts` - `MemberStatus`, `TeamMemberDTO`, `InviteMemberInput`
- `apps/api/src/lib/team.ts` - `toTeamMemberDto`, `listTeamMembers`, `inviteMember` (create-or-resend, single write-path)
- `apps/api/src/routes/team.ts` - `teamRoute(prisma, auth)`: admin-gated `GET /api/team` + `POST /api/team/invite`
- `apps/api/src/app.ts` - registered `teamRoute` after `qrCodesRoute`/before `healthRoute`; extended registration-order comment
- `apps/api/test/team.integration.test.ts` - 9-case real-Postgres suite (admin gate, invite create/resend, pending->active round trip)

## Decisions Made
- `auth.api.signInMagicLink({ body: { email, callbackURL, errorCallbackURL }, headers: new Headers() })` is the confirmed trigger call — matches the plan's guessed shape exactly, but the confirmation itself (reading the installed package's own type/implementation source) was mandatory per the plan's critical execution notes and is documented in `lib/team.ts`'s header comment for future readers.
- `inviteMember` rejects a `domainIds` entry that doesn't reference an existing `Domain` row with a typed `INVALID_DOMAIN` result before any write (Rule 2 — the plan's behavior list didn't call this out explicitly, but silently letting a bad ID reach `domainMembership.createMany` would surface as an unhandled Prisma P2003 foreign-key violation / 500, which is a correctness gap for an admin-facing form).
- `domainIds` are silently ignored (not an error) when `accountRole` is `"admin"` — matches D-09-02's "an admin already reaches every domain" semantics and the UI-SPEC's mutually-exclusive role-card design (an admin invite never shows domain selection).

## Deviations from Plan

None - plan executed exactly as written, including the mandatory pre-implementation verification of `auth.api.signInMagicLink` against the installed better-auth package (the plan explicitly flagged this as an unverified guess that MUST be confirmed before use — confirmed, not assumed).

## Issues Encountered

None - `pnpm --filter @kurzly/shared build`, `pnpm --filter @kurzly/api exec tsc --noEmit`, and `pnpm -r exec tsc --noEmit` were all clean throughout. The full API suite (38 files / 473 tests) passed on the first GREEN run with zero regressions across auth/domains/links/qr/analytics/authorization suites.

## User Setup Required

None - no external service configuration required. The invite flow reuses the already-configured SMTP transport (`lib/mailer.ts`) and the existing magic-link plugin; no new environment variables or dashboard steps.

## Next Phase Readiness

- `lib/team.ts`'s `listTeamMembers`/`toTeamMemberDto`/`inviteMember` and `routes/team.ts`'s admin-gate shape are in place for 09-04 (assign domains / change role / remove user) to extend directly — 09-04 should add its mutation endpoints to the SAME `teamRoute` factory and reuse `toTeamMemberDto` for response shaping, not re-derive `status`.
- The TDD RED/GREEN gate sequence is confirmed present in git history for Task 2 (`test(09-03)` before `feat(09-03)`); Task 1 has no isolated failing-test commit since its correctness is proven entirely by Task 2's integration suite, per the plan's own task ordering note ("Task 2 owns the failing-test-first ordering for the route surface").
- No blockers or concerns for 09-04.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 6 created/modified files verified present on disk; all 3 task commit hashes (`6f0de07`, `8e43e24`, `794fbf8`) verified present in git history.
