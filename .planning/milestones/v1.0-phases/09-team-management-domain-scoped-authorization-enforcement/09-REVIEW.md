---
phase: 09-team-management-domain-scoped-authorization-enforcement
reviewed: 2026-07-23T08:50:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/api/src/lib/authorization.ts
  - apps/api/src/lib/accountRole.ts
  - apps/api/src/lib/team.ts
  - apps/api/src/routes/team.ts
  - apps/api/src/lib/auth.ts
  - apps/api/src/lib/admin-seed.ts
  - apps/api/prisma/schema.prisma
  - packages/shared/src/index.ts
  - apps/web/src/router/index.ts
  - apps/api/test/team-domain-denial.integration.test.ts
  - apps/api/test/team-mutations.integration.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-23T08:50:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This is a security-critical phase whose purpose is provable server-side domain-scoped
authorization plus admin-gated team management. I reviewed the authorization core hardest,
tracing every interleaving of the lockout guards and every path into the account-admin bypass.

**The authorization core is sound. No BLOCKER found.** Specifically verified:

- **Account-admin bypass (authorization.ts).** `isAccountAdmin` reads `User.accountRole` (a
  separate column/table from `DomainMembership.role`), compares with strict `=== "admin"`, and
  is `await`ed first in BOTH `requireDomainAccess` and `scopedDomainIds`. A `null`/`undefined`
  accountRole is falsy under the strict compare; a per-domain `admin` role can never be confused
  with the global account role; a plain member's membership-only scoping is provably unchanged
  (regression tests at authorization.test.ts:198 and :225 assert this). No missing `await`.
- **Lockout guards (team.ts).** `countAdmins` uses parameterized `SELECT id ... WHERE
  "accountRole"='admin' FOR UPDATE`. All three guarded paths (remove-last-admin, demote-last-admin,
  remove-own-account-while-sole-admin) re-read role + `countAdmins(tx)` INSIDE the same
  `$transaction` as the mutation. I traced concurrent demote-two-different-admins,
  demote-same-admin, and promote-racing-demote interleavings under READ COMMITTED: the `FOR UPDATE`
  lock is the serialization point and no interleaving reaches zero admins. Promote-to-admin clears
  memberships in the SAME transaction (team.ts:288-291, D-09-05 satisfied). SQL is parameterized —
  no injection.
- **Admin gate coverage.** All five `/api/team` routes (GET, POST invite, PATCH :id/role,
  PUT :id/domains, DELETE :id) call `isAccountAdmin` and return 403 for a signed-in non-admin
  before any mutation; each also returns 401 with no session. No route checks auth but forgets
  the admin gate.
- **Mass-assignment.** Zod allowlists (strip semantics) plus the fact that `inviteMember`/mutations
  only read named fields means `id`/`emailVerified`/etc. are unreachable from any body. better-auth's
  `accountRole` additionalField is `input: false`, so it is not settable via any auth/update-user
  path. Defense-in-depth is real.
- **Denial suite (team-domain-denial.integration.test.ts).** Confirmed exhaustive against all three
  route files, every case uses a genuinely seeded foreign resource id, and zero-row-leak is asserted
  (not just status codes) for create/list/import/analytics. The "account-admin positive half" test
  is the control that proves the member's 404s are real IDOR enforcement, not route-not-found.

Findings below are robustness/consistency defects around the invite flow and transaction error
handling — none compromise the authorization guarantee, but they should be fixed.

## Warnings

### WR-01: `inviteMember` is not atomic — a failed membership write leaves an orphaned User

**File:** `apps/api/src/lib/team.ts:141-166`
**Issue:** For a NEW invitee, `prisma.user.create` (141), `prisma.domainMembership.createMany`
(154) and the re-read (163) run as three separate statements, not inside a `$transaction`. There
is a TOCTOU between the domain-existence check (team.ts:120-128) and `createMany`: if a domain is
deleted in that window, `createMany` throws a foreign-key violation that propagates out of the
route as an unhandled 500 — but the `User` row created at 141 has already been committed with zero
memberships and NO magic link was sent (169 never runs). The user now exists in a half-initialized
state; a subsequent re-invite takes the `existingUser` resend path (136-139) and will never assign
the intended domains. This is inconsistent with the same file's mutation functions, which correctly
wrap multi-write operations in `$transaction` (e.g. `assignMemberDomains` at 242, `changeMemberRole`
at 288) for exactly this reason.
**Fix:**
```ts
const created = await prisma.$transaction(async (tx) => {
  const u = await tx.user.create({
    data: { id: randomUUID(), name: input.email.split("@")[0] ?? input.email,
            email: input.email, emailVerified: false, accountRole: input.accountRole },
  });
  if (domainIds.length > 0) {
    await tx.domainMembership.createMany({
      data: domainIds.map((domainId) => ({ userId: u.id, domainId, role: "member" as const })),
    });
  }
  return tx.user.findUniqueOrThrow({ where: { id: u.id }, include: MEMBERSHIPS_INCLUDE });
});
user = created;
```

### WR-02: Lockout-guard transactions surface a 500 (not a typed result) under lock contention

**File:** `apps/api/src/lib/team.ts:293-308`, `apps/api/src/lib/team.ts:337-351`
**Issue:** The demote/remove guards rely on a second concurrent transaction BLOCKING on the
`FOR UPDATE` lock until the first commits. Prisma interactive transactions have a default timeout
(~5s) and maxWait (~2s). Under sustained contention a blocked demote/remove transaction can exceed
that window and reject with `P2028` (transaction timeout / could-not-serialize), which propagates
out of `changeMemberRole`/`removeMember` (neither catches it) and out of the route (`routes/team.ts`
does not wrap the call) as an unhandled 500 instead of the typed `LAST_ADMIN`/success result.
This fails SAFE — no unwanted demote occurs, so it is NOT a lockout — but it is an unhandled error
path that a caller cannot distinguish from a real server fault, and it only manifests under the
exact concurrency the guard exists to handle. The `never lets two concurrent demotes...` test
(team-mutations:236) passes only because two quick transactions never approach the timeout.
**Fix:** Catch Prisma's known-transaction errors in the guarded functions and map a
serialization/timeout failure to a typed "please retry"/`LAST_ADMIN`-safe outcome, e.g.:
```ts
try {
  return await prisma.$transaction(async (tx) => { /* guard + mutate */ });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") {
    return { ok: false, error: "LAST_ADMIN" }; // conservative, or a dedicated CONFLICT code
  }
  throw e;
}
```

### WR-03: `inviteMember` validates `domainIds` it then silently discards on resend

**File:** `apps/api/src/lib/team.ts:118-139`
**Issue:** For a re-invite of an existing user, the domain-existence check at 120-128 still runs
against `domainIds`, but the resend branch (136-139) discards them entirely — `existingUser` is
returned untouched. So a caller can send a body whose `domainIds` are validated (and rejected with
`INVALID_DOMAIN` if bad) yet never applied when valid. The wasted validation plus the fact that the
201 response returns the member's OLD domains means an admin who re-invites an existing member
expecting to grant new domains receives a success with no change and no signal. Behavior is
documented as intended (D-09-04 = resend-only), but the "validate-then-ignore" asymmetry is a
latent footgun. See also IN-01.
**Fix:** Skip the domain-existence check when the user already exists (move it inside the `else`
new-user branch), so the request cost matches what the operation actually does; and consider
returning a discriminated result that signals "resend, domains unchanged" so the UI can inform the
admin rather than implying an assignment happened.

## Info

### IN-01: Re-invite success response is indistinguishable from a fresh invite

**File:** `apps/api/src/routes/team.ts:136-141`
**Issue:** `POST /api/team/invite` returns `201` with the member DTO for both a first-time invite
and a pure resend. The admin UI cannot tell "created a new pending member" from "re-sent a link to
an existing member without touching their role/domains" (D-09-04 by design). Low-risk, but a
`200` vs `201` distinction (or a `resent: true` flag) would remove ambiguity.
**Fix:** Return `200` for the resend path and `201` only when a new `User` row was created.

### IN-02: `isAccountAdmin` adds a `User` lookup to every domain-scoped authorization call

**File:** `apps/api/src/lib/authorization.ts:48`, `apps/api/src/lib/authorization.ts:94`
**Issue:** Both `requireDomainAccess` and `scopedDomainIds` now issue an extra `prisma.user.findUnique`
on every invocation (every links/qr/analytics request), before the membership lookup. This is
correct and cleanly centralized, but note it doubles the query count on the hot authorization path.
Flagged as INFO only — performance is explicitly out of v1 review scope; recorded so it is not lost
if the redirect/list paths ever need tuning (e.g. folding accountRole into the membership query or
carrying it on the session).
**Fix:** Optional — the session already exposes `accountRole` (auth.ts additionalField); route
handlers could pass the already-loaded role into the authorization helpers to avoid the extra round-trip.

---

_Reviewed: 2026-07-23T08:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
