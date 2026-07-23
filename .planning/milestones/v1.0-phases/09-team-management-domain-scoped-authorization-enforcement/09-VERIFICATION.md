---
phase: 09-team-management-domain-scoped-authorization-enforcement
verified: 2026-07-23T11:20:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 9: Team Management & Domain-Scoped Authorization Enforcement Verification Report

**Phase Goal:** Admins can manage the team's membership, roles, and per-domain access — and every Member's access to Links, QR codes, and Analytics is provably restricted to their assigned domains, enforced server-side on every request, not just hidden in the UI.
**Verified:** 2026-07-23T11:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin invites a user by email with a chosen role; invitee shows "Pending" until first login, then "Active" | ✓ VERIFIED | `apps/api/src/lib/team.ts` `inviteMember` creates a `User` row (`emailVerified:false`, chosen `accountRole`) and calls the same `auth.api.signInMagicLink` the login flow uses (D-09-04). `toTeamMemberDto` derives `status` from `user.emailVerified` (D-09-03). Proven not by inspection but by a real round-trip integration test: `apps/api/test/team.integration.test.ts:263` invites, asserts `status:"pending"`, performs a genuine magic-link sign-in (`signInAs`), then re-lists and asserts `status:"active"`. |
| 2 | Admin assigns domains to a Member, changes a user's role (Admin clears domain assignments), and removes a user | ✓ VERIFIED | `apps/api/src/lib/team.ts`: `assignMemberDomains` (TEAM-03, replaces exactly, one transaction), `changeMemberRole` (TEAM-04, promote deletes all `DomainMembership` rows + role update in ONE `$transaction`, demote leaves zero domains, D-09-05/07 lockout-guarded), `removeMember` (TEAM-05, `onDelete:SetNull`/`Cascade` preserve content, D-09-06/07 lockout-guarded). Routes wired in `apps/api/src/routes/team.ts` (`PUT /:id/domains`, `PATCH /:id/role`, `DELETE /:id`), all admin-gated. Covered by `apps/api/test/team-mutations.integration.test.ts` (25+ cases incl. promote-clears-domains, demote-leaves-zero, LAST_ADMIN lockout on remove/demote, two-admins-succeed, concurrent-demote-race) and `apps/api/test/team-hardening.integration.test.ts` (WR-01/02/03 fix-specific tests). |
| 3 | A Member sees and can edit only the domains (and their Links/QR/Analytics) assigned to them in the dashboard | ✓ VERIFIED | Frontend: `apps/web/src/router/index.ts:125` route guard redirects unless `accountRole==="admin"`; `apps/web/src/layouts/AppShell.vue:38` hides the Team nav entry for non-admins. Data scoping: every Link/QR/Analytics list and by-id lookup goes through `scopedDomainIds`/`requireDomainAccess` (see truth 4). `team-domain-denial.integration.test.ts`'s "GET /api/links and GET /api/qr-codes omit the foreign resources entirely — own resources still appear" test proves the Member's dashboard lists are scoped, not merely empty. |
| 4 | A Member's direct API request for a Link/QR/Analytics resource on an unassigned domain is rejected (403/404) server-side, even guessing a valid ID — proven by an automated denial suite covering every endpoint | ✓ VERIFIED | `apps/api/src/lib/authorization.ts`: `requireDomainAccess`/`scopedDomainIds` both start with an `isAccountAdmin` bypass then fall through unchanged to deny-by-default membership logic for a Member (D-09-02). `apps/api/test/team-domain-denial.integration.test.ts` walks all 13 real by-id/create Link+QR endpoints (enumerated directly from routes/links.ts, routes/qrCodes.ts — cross-checked against the actual route registrations, nothing missing, no DELETE/remap route exists to omit) plus list (`GET /api/links`, `GET /api/qr-codes`), CSV import (preview+commit), and `GET /api/analytics`/`GET /api/links/:id/analytics`, asserting zero-row-leak (not just status) on every list/create/import/analytics surface, and includes a full admin-bypass positive control reaching the same foreign resources. Regression coverage in `apps/api/test/authorization.test.ts:198,225` proves a plain Member's scoping is byte-for-byte unchanged from pre-Phase-9 behavior. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/prisma/schema.prisma` (`AccountRole` enum, `User.accountRole`) | Native Postgres enum, default `member` | ✓ VERIFIED | Enum + column present; migration `20260723061259_add_user_account_role` creates `AccountRole` and `ALTER TABLE "user" ADD COLUMN accountRole "AccountRole" NOT NULL DEFAULT 'member'` — matches D-09-01 exactly. |
| `apps/api/src/lib/accountRole.ts` (`isAccountAdmin`) | Single shared account-admin check | ✓ VERIFIED | Deny-by-default (`user?.accountRole === "admin"`), imported by both `authorization.ts` and `routes/team.ts` — single source of truth as designed. |
| `apps/api/src/lib/authorization.ts` (admin bypass) | Bypass inside `requireDomainAccess`/`scopedDomainIds` | ✓ VERIFIED | Both functions check `isAccountAdmin` FIRST, before membership lookup; non-admin path unchanged (D-09-02). |
| `apps/api/src/lib/team.ts` (list/invite/mutations) | invite, list, assign, changeRole, removeMember with typed results | ✓ VERIFIED | All five operations present, transactional where required, lockout-guarded via `countAdmins` (`FOR UPDATE`), WR-01/02/03 fixes present in code (transactional invite, resend skips domain validation, P2028→CONFLICT mapping). |
| `apps/api/src/routes/team.ts` (5 endpoints) | GET/POST invite/PATCH role/PUT domains/DELETE, all admin-gated | ✓ VERIFIED | All 5 routes present, each calls `isAccountAdmin` before any mutation, registered in `apps/api/src/app.ts:189`. |
| `apps/web/src/views/TeamView.vue` + `InviteMemberModal.vue`/`AssignDomainsModal.vue` | Team screen UI per UI-SPEC | ✓ VERIFIED | Role select commits immediately with optimistic update + full revert on failure (UI-09-03/04); admin-clears-domains reflected client-side in the same update; invite/assign/remove flows wired to the api.ts client functions. No stub/placeholder patterns found. |
| `apps/api/test/team-domain-denial.integration.test.ts` | Exhaustive endpoint × expectation denial suite | ✓ VERIFIED | See truth 4 — cross-checked against actual route registrations, no gaps found. |
| `packages/shared/src/index.ts` (`AccountRole`, `TeamMemberDTO`, `TeamErrorCode`) | Shared DTO/type contract | ✓ VERIFIED | `TeamErrorCode` includes `CONFLICT` (WR-02 fix), consumed identically by API and web. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `apps/api/src/app.ts` | `routes/team.ts` (`teamRoute`) | `app.register(teamRoute(prisma, auth))` | ✓ WIRED | Line 189, registered alongside all other route modules. |
| `routes/team.ts` | `lib/team.ts` | direct function calls (`inviteMember`, `listTeamMembers`, `assignMemberDomains`, `changeMemberRole`, `removeMember`) | ✓ WIRED | Routes never call Prisma directly for writes; delegate entirely per file's own header comment, confirmed by reading. |
| `lib/links.ts` / `lib/qrCodes.ts` / `routes/analytics.ts` | `lib/authorization.ts` (`requireDomainAccess`/`scopedDomainIds`) | existing call sites, now inheriting the D-09-02 bypass | ✓ WIRED | Confirmed via denial-suite admin-bypass positive control reaching foreign resources through the SAME call paths a Member is denied on. |
| `apps/web/src/router/index.ts` | `authSession.user.accountRole` | route guard (`requiresAdmin` meta) | ✓ WIRED | Line 125, redirects a non-admin away from `/team`. |
| `apps/web/src/layouts/AppShell.vue` | `authSession.user.accountRole` | nav-item filter | ✓ WIRED | Line 38, Team nav entry hidden for non-admins. |
| `apps/web/src/views/TeamView.vue` | `apps/web/src/api.ts` (`changeMemberRole`/`assignMemberDomains`/`removeMember`/`inviteMember`) | async handlers with optimistic update + revert | ✓ WIRED | Confirmed by reading `handleRoleChange`, `handleAssignSubmit`, `confirmRemove`, `handleInviteSubmit`. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| TEAM-01 | 09-01, 09-03, 09-07 | Invite by email with chosen role, magic link sent | ✓ SATISFIED | `inviteMember` + `POST /api/team/invite` + `InviteMemberModal.vue`, integration-tested. |
| TEAM-02 | 09-03, 09-06 | Pending until first login, then Active | ✓ SATISFIED | D-09-03 `emailVerified`-derived status, real round-trip test at `team.integration.test.ts:263`. |
| TEAM-03 | 09-04, 09-07 | Assign domains to a Member | ✓ SATISFIED | `assignMemberDomains` + `PUT /:id/domains` + `AssignDomainsModal.vue`. |
| TEAM-04 | 09-01, 09-04, 09-07 | Change role; Admin switch clears domains | ✓ SATISFIED | `changeMemberRole` atomically deletes memberships on promote (D-09-05), tested. |
| TEAM-05 | 09-04, 09-07 | Remove a user | ✓ SATISFIED | `removeMember`, content-preserving (D-09-06), lockout-guarded (D-09-07), tested. |
| TEAM-06 | 09-01, 09-02, 09-03, 09-05, 09-06 | Server-side domain scoping on every Link/QR/Analytics operation | ✓ SATISFIED | D-09-02 bypass + pre-existing deny-by-default membership check; exhaustively proven by `team-domain-denial.integration.test.ts`. |

**Note (documentation gap, non-blocking):** `.planning/REQUIREMENTS.md` still shows all six `TEAM-0x` rows as unchecked (`[ ]`) with a table status of "Pending" (lines 29-34, 169-174), unlike every other completed phase's requirements (which are checked `[x]` / marked "Complete", e.g. QR-01..07, META-01/02). This is a stale-tracking-doc issue only — the underlying functionality is fully implemented, tested, and reviewed. Recommend updating REQUIREMENTS.md's checkboxes and status column to reflect Phase 9 completion as a follow-up documentation step; it does not block phase goal achievement.

### Anti-Patterns Found

None. Scanned `apps/api/src/lib/team.ts`, `apps/api/src/lib/accountRole.ts`, `apps/api/src/lib/authorization.ts`, `apps/api/src/routes/team.ts`, `apps/web/src/views/TeamView.vue`, `apps/web/src/components/InviteMemberModal.vue`, `apps/web/src/components/AssignDomainsModal.vue` for `TODO|FIXME|XXX|TBD|HACK|PLACEHOLDER|not yet implemented|coming soon` — zero matches. Commit history for the phase is clean, TDD-flow commits (`test(09-0x)` before `feat/fix(09-0x)`) throughout, including the three post-review fix commits.

### Code Review Fix Verification (WR-01/02/03)

All three warnings from `09-REVIEW.md` are confirmed fixed in the current code, matching `09-REVIEW-FIX.md`'s claims:

- **WR-01** (inviteMember atomicity): `apps/api/src/lib/team.ts:156-183` wraps `user.create` + `domainMembership.createMany` + re-read in one `prisma.$transaction`. Test: `team-hardening.integration.test.ts:47`.
- **WR-02** (lockout-guard P2028 → typed CONFLICT): `isTransactionContention` helper (`team.ts:244-246`) catches `P2028` in both `changeMemberRole`'s demote branch (`team.ts:340-345`) and `removeMember` (`team.ts:391-396`); `CONFLICT` added to `TeamErrorCode` and mapped to HTTP 409 in `routes/team.ts:65-68`. Tests: `team-hardening.integration.test.ts:112,117`.
- **WR-03** (validate-then-discard on resend): domain-existence check moved into the new-user-only branch (`team.ts:136-147`); resend path (`team.ts:129-135`) neither validates nor applies `domainIds`. Test: `team-hardening.integration.test.ts:71`.

### Build Health

`pnpm -r exec tsc --noEmit` run directly during this verification: clean, zero errors, across all workspace packages (`apps/api`, `apps/web`, `packages/shared`). Full test suites (apps/api 510 tests, apps/web 240 tests) were not re-run per verification-task guidance (requires Docker/testcontainers, ~90s) — test file inventory, individual test bodies, and the code review's own file-by-file trace were used as the evidence basis instead; this is consistent with the code review's `files_reviewed_list` and the fix report's documented RED→GREEN commits for all three warnings.

### Human Verification Required

None. All four success criteria and all six requirement IDs resolve to server-side, test-backed evidence; no visual/UX-only claims required human judgment beyond what the design review (09-UI-SPEC.md, approved) already covered.

### Gaps Summary

No gaps found. The phase's headline evidence (the TEAM-06 denial suite) was independently cross-checked against the actual route registrations in `routes/links.ts`, `routes/qrCodes.ts`, and `routes/analytics.ts` rather than trusted from SUMMARY claims — every real by-id/create/list/import/analytics endpoint is covered, zero-row-leak is asserted (not just status codes), and the admin-bypass positive control is present and substantive. All three code-review warnings (WR-01/02/03) have corresponding fix commits and dedicated regression tests confirmed present in the code. The only non-blocking observation is REQUIREMENTS.md's stale checkbox/status tracking, noted above for a documentation follow-up.

---

_Verified: 2026-07-23T11:20:00Z_
_Verifier: Claude (gsd-verifier)_
