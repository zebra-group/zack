---
phase: 09-team-management-domain-scoped-authorization-enforcement
fixed_at: 2026-07-23T09:09:02Z
review_path: .planning/phases/09-team-management-domain-scoped-authorization-enforcement/09-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 2
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-07-23T09:09:02Z
**Source review:** .planning/phases/09-team-management-domain-scoped-authorization-enforcement/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (critical + warning): 3
- Fixed: 3
- Skipped: 2 (both INFO — out of the critical_warning fix scope)

Each fix followed the project's mandatory TDD flow: a failing `test(09-08)` commit
first (RED, verified against the unfixed code), then a `fix(09-08)` commit (GREEN).
All 46 tests across the four team API suites pass, and `pnpm -r exec tsc --noEmit`
is clean (shared package rebuilt after its type change).

## Fixed Issues

### WR-01: `inviteMember` is not atomic — a failed membership write leaves an orphaned User

**Files modified:** `apps/api/src/lib/team.ts`
**Test commit:** d7aef86
**Commit:** 7be837c
**Applied fix:** Wrapped the new-invitee `user.create` + `domainMembership.createMany` +
re-read in a single `prisma.$transaction`, mirroring `assignMemberDomains`/`changeMemberRole`.
A mid-invite membership-write failure now rolls the User row back entirely, so it can no
longer be left half-initialized (which a later re-invite would treat as a resend and never
assign the intended domains). `triggerMagicLinkSend` was already positioned after the write
block and stays outside the transaction, so an invitee is never mailed for a row that then
rolls back.
**Test:** a duplicated `domainId` passes the Set-deduped existence pre-check but violates
`DomainMembership`'s composite primary key inside `createMany`, forcing a deterministic
mid-invite failure; the test asserts zero User rows survive for that email (RED before:
`length ... got 1`; GREEN after).

### WR-03: `inviteMember` validates `domainIds` it then silently discards on resend

**Files modified:** `apps/api/src/lib/team.ts`
**Test commit:** 979b068
**Commit:** 466b87e
**Applied fix:** Moved the domain-existence check out of the top of `inviteMember` and into
the new-user (`else`) branch only — the path that actually applies `domainIds`. On a resend
of an existing address, `domainIds` are now neither validated nor applied, consistent with
D-09-04 (a re-invite re-sends the magic link and leaves the role untouched; per-domain
assignment is the dedicated `PUT /:id/domains` endpoint's job). This removes the
"validate-then-ignore" asymmetry: an unknown `domainId` on a resend no longer surfaces a
spurious `INVALID_DOMAIN` for an operation that would ignore it either way. Behavior chosen
per the fix guidance: ignore `domainIds` entirely on resend, with no validation side effect.
**Test:** re-inviting an existing member with an unknown `domainId` must return `ok: true`
(a resend) with domains unchanged, rather than `INVALID_DOMAIN` (RED before: `expected false
to be true`; GREEN after). The existing invite suite (new-user INVALID_DOMAIN path, valid
domain assignment, resend leaves role untouched) still passes.

### WR-02: Lockout-guard transactions surface a 500 (not a typed result) under lock contention

**Files modified:** `apps/api/src/lib/team.ts`, `apps/api/src/routes/team.ts`, `packages/shared/src/index.ts`
**Test commit:** aeef33c
**Commit:** b773a69
**Applied fix:** Added an `isTransactionContention` helper that detects Prisma's `P2028`
(interactive-transaction timeout / could-not-serialize). The demote guard in `changeMemberRole`
and the guard in `removeMember` now catch that error and return a new typed
`CONFLICT` result instead of letting it escape as an unhandled 500. `CONFLICT` was added to the
shared `TeamErrorCode` union and mapped to HTTP 409 in `statusForTeamError` (retryable; nothing
changed). The web `mapTeamError` already falls back to a generic "please try again" message for
any non-`LAST_ADMIN` code, so the new code degrades gracefully on the frontend with no change
required there. The real `SELECT ... FOR UPDATE` concurrency guarantee is untouched — this only
translates the fail-safe timeout path.
**Test:** two unit tests drive a mocked Prisma whose target lookup succeeds but whose
`$transaction` rejects with a constructed `P2028`; they assert `changeMemberRole` (demote) and
`removeMember` each return `{ ok: false, error: "CONFLICT" }` rather than throwing (RED before:
the P2028 propagated out of the function; GREEN after). The existing real-Postgres concurrency
test (`team-mutations`: "never lets two concurrent demote requests both succeed") still passes,
confirming the guarantee was not weakened.

## Skipped Issues

### IN-01: Re-invite success response is indistinguishable from a fresh invite

**File:** `apps/api/src/routes/team.ts:136-141`
**Reason:** skipped — INFO severity, out of the `critical_warning` fix scope for this pass.
**Original issue:** `POST /api/team/invite` returns `201` for both a first-time invite and a
pure resend, so the admin UI cannot distinguish "created a new pending member" from "re-sent a
link". Suggested a `200` vs `201` distinction or a `resent: true` flag.

### IN-02: `isAccountAdmin` adds a `User` lookup to every domain-scoped authorization call

**File:** `apps/api/src/lib/authorization.ts:48`, `apps/api/src/lib/authorization.ts:94`
**Reason:** skipped — INFO severity, out of the `critical_warning` fix scope for this pass;
the review itself flags performance as explicitly out of v1 review scope.
**Original issue:** `requireDomainAccess` and `scopedDomainIds` each issue an extra
`prisma.user.findUnique` on every invocation, doubling the query count on the hot authorization
path. Optional optimization: pass the session-carried `accountRole` into the helpers.

---

_Fixed: 2026-07-23T09:09:02Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
