# Phase 9: Team Management & Domain-Scoped Authorization Enforcement - Context

**Gathered:** 2026-07-22
**Status:** Ready for planning
**Mode:** Auto-decided during an authorised unattended autonomous run (see `.planning/STATE.md`). Every grey area below was resolved by Claude rather than asked; each records its rationale so the choices can be reviewed and reversed.

<domain>
## Phase Boundary

Admins can manage the team's membership, roles, and per-domain access — and every Member's access to Links, QR codes, and Analytics is provably restricted to their assigned domains, enforced server-side on every request, not just hidden in the UI.

**Requirements:** TEAM-01 (invite by email with a chosen role, magic link sent), TEAM-02 (invitee is "Pending" until first successful login, then "Active"), TEAM-03 (assign specific domains to a Member), TEAM-04 (change a user's role; switching to Admin clears domain assignments), TEAM-05 (remove a user), TEAM-06 (a Member sees and edits only their assigned domains, authorised server-side on every Link/QR/Analytics operation).

**In scope:** the global account role, the invite flow, the team screen and its invite modal, domain assignment, role changes, user removal, the admin-bypass semantics inside the two existing authorization helpers, and the denial-test suite that proves TEAM-06 across every endpoint.

**Out of scope:** the "Authentifizierung" section of the team screen (design handoff §7) — the Magic Link card is descriptive only and the OIDC/SSO card belongs to Phase 10. Also out: multiple tenants/organisations, per-link ACLs, audit logging of admin actions, and email templates beyond the magic link already in place.
</domain>

<decisions>
## Implementation Decisions

### D-09-01 — A global account role, separate from the existing per-domain role

The schema already has a `Role` enum (`member`/`admin`/`owner`) used by `DomainMembership` to say *what someone may do within one domain*. TEAM-01/TEAM-04 need something different: *what someone is on this installation*. Overloading the existing enum would conflate "admin of this domain" with "admin of Kurzly".

Add `User.accountRole` as its own native Postgres enum `AccountRole { admin, member }`, defaulting to `member`. The design handoff's role model note (§7) defines the semantics exactly: **Admin = everything; Member = only assigned domains (Links/QR/Analytics)**.

`DomainMembership` keeps its current meaning and stays the mechanism for Member scoping.

### D-09-02 — Admin bypass lives inside the two authorization helpers, not in routes

`requireDomainAccess` and `scopedDomainIds` are already called from every Link, QR-code and Analytics path (verified: `lib/links.ts`, `lib/qrCodes.ts`, `routes/analytics.ts`). Teaching those two functions that an account-admin has access to every domain makes TEAM-06's admin half true everywhere at once, with no route touched and no chance of a forgotten call site.

- `requireDomainAccess(prisma, userId, domainId, minRole)` — if the user's `accountRole` is `admin`, grant regardless of `DomainMembership`.
- `scopedDomainIds(prisma, userId)` — if the user's `accountRole` is `admin`, return every domain id.

This changes the behaviour of already-shipped code, so it needs its own tests, including a regression test that a **Member's** scoping is completely unchanged.

### D-09-03 — "Pending" vs "Active" is derived from `emailVerified`, not a new column

TEAM-02 wants a status that flips on first successful login. `better-auth`'s magic-link verification already sets `emailVerified: true` on exactly that event, and an invited user is created with it false. So `emailVerified === true → "active"`, otherwise `"pending"` — no new column, no login hook to maintain, and no second source of truth that could drift from reality.

The coupling to better-auth's behaviour is deliberate but must not be silent: an integration test has to prove that an invited user shows as "Pending" and flips to "Active" after a real magic-link round-trip, so that if better-auth ever changes this, the suite fails loudly rather than the UI quietly lying.

The status is computed at the API boundary and shipped as an explicit `status` field on the user DTO — the frontend never re-derives it from `emailVerified`.

### D-09-04 — Inviting reuses the existing allowlist and the existing magic-link sender

Phase 2 established that the `User` table doubles as the invite-only allowlist. An invite is therefore: create a `User` row with the chosen `accountRole` and `emailVerified: false`, then send the ordinary magic link to that address. No `Invitation` table, no separate token type, no second email path.

Re-inviting an address that already exists must not create a duplicate or silently reset anything — it re-sends the magic link and leaves the role untouched. Changing a role is TEAM-04's job, not a side effect of re-inviting.

### D-09-05 — Promoting to Admin deletes the user's domain assignments

TEAM-04 says the switch to Admin clears the assignments, and with D-09-02 they would be meaningless anyway (an admin already reaches every domain). The delete and the role update happen in one transaction so a partial state cannot exist.

Demoting an Admin back to Member leaves them with **no** domain assignments — they are scoped to nothing until an admin assigns domains. This is the safe direction: a demotion should never silently hand out access.

### D-09-06 — Removing a user preserves their content

`Link.creator` is already `onDelete: SetNull` and `DomainMembership` is `onDelete: Cascade`, so deleting the `User` row keeps every Link and QR code the person created while cleaning up their access. That is the correct ownership model — links belong to the domain, not to the individual — and it needs no schema change, only a test that pins it.

### D-09-07 — Lockout guards

Not stated in the requirements, but a self-hosted admin tool that can lock every administrator out of itself is not production-ready. Three guards, each returning a typed error the UI renders:

1. An admin cannot remove the last remaining admin (including themselves).
2. An admin cannot demote the last remaining admin to Member.
3. An admin cannot remove their own account while they are the only admin.

The invariant enforced is simply: **at least one `accountRole = admin` user must always remain.**

### D-09-08 — TEAM-06 is proven by an explicit denial suite, not by inspection

The success criterion demands proof that a direct API request for a resource on an unassigned domain is rejected even when the ID is valid and guessed correctly. That means a test suite that, for a Member with no membership on the target domain, walks **every** Link, QR-code and Analytics endpoint with a genuinely existing resource ID and asserts the rejection.

Response shape follows what each surface already does rather than inventing a new convention: Link routes answer 403 and QR-code routes answer 404 (Phase 7 chose 404 there deliberately, because a QR code's domain boundary is never client-visible). Analytics scopes silently to the caller's domains, matching `GET /api/domains`'s established never-leak posture. The suite asserts the shape each route actually guarantees, and — more importantly — that **zero rows** of the foreign resource are ever returned.

### Claude's Discretion

File layout, component decomposition, DTO naming, and test breakdown follow the conventions phases 2-8 already established.
</decisions>

<code_context>
## Existing Code Insights

- `apps/api/src/lib/authorization.ts` — `ROLE_RANK`, `requireDomainAccess`, `scopedDomainIds`, `ForbiddenError`. The single place D-09-02 changes. Signatures were deliberately frozen in Phase 2 and are called from three modules; extending behaviour without changing the signature keeps all callers working.
- `apps/api/prisma/schema.prisma` — `User` (line ~34, `@@map("user")`, better-auth-owned), `Role` enum (~143), `DomainMembership` (~155, composite PK, cascade), `Link.creator` (`onDelete: SetNull`).
- Migration convention (STATE.md decisions): additive/nullable columns have gone through `prisma migrate dev` non-interactively since 05-02; the migrate-diff/deploy workaround against a throwaway `postgres:18-alpine` on host port 15432 is the fallback when a confirmation-shaped warning appears. A new enum plus a defaulted column is the same additive shape as 06-02, which ran cleanly.
- `apps/api/src/lib/auth.ts` — `createAuth(prisma)` factory (not a singleton) so tests bind auth writes to the test client. The magic-link sender is wired here via `lib/mailer.ts`.
- `apps/api/src/routes/domains.ts` — the closest analogue for a new admin-gated route module, including its own `$transaction` bootstrap and admin-only `GET /:id/instructions`.
- `apps/api/test/setupFileEach.ts` — reworked on 2026-07-22: every test file gets its own database cloned from a migrated template and truncates between tests. Tests must not assume a shared database and must not rely on absolute cross-file row counts.
- `apps/web/src/views/` — existing view components and the router; a `TeamView.vue` joins them. `apps/web/src/api.ts` holds the client layer and `ApiError` with its `code` field for typed inline errors.

## Prototype Contract (design_handoff README §7 and §8)

- **Team screen:** header „Team" + counter + button „+ Mitglied einladen". User table in a card, grid `1fr 130px 1fr 96px 28px`, columns Benutzer (28px avatar circle with initials + name/email) / Rolle (Select: Admin | Mitglied) / Domain-Zugriff / Status / (⋯).
- Role **Admin** → Domain-Zugriff shows an accent pill „alle Domains". Role **Mitglied** → chip pills of the assigned domains (monospace) plus a dashed „+ zuweisen" pill.
- Status badge: „Aktiv" (accent) / „Ausstehend" (chip).
- A dashed role-model card: Admin = alles; Mitglied = nur zugewiesene Domains (Links/QR/Analytics).
- **Invite modal:** 460px dialog, email input (monospace) + role choice as two clickable cards (Admin „Vollzugriff auf alles" / Mitglied „Nur zugewiesene Domains"; selected = accent border + chip background).
- The „Authentifizierung" section of §7 is Phase 10's and must not be built here.
</code_context>

<specifics>
## Specific Ideas

- The role `<select>` changes the role immediately on change (the prototype shows no separate save button); a failure must revert the select to its previous value rather than leave the UI lying.
- Switching a Member to Admin visibly replaces their domain chips with the „alle Domains" pill in the same update.
- The denial suite is the phase's headline evidence — it should read as a single, obviously exhaustive table of endpoint × expectation, not as scattered assertions, so a reviewer can see at a glance that nothing was skipped.
- A Member must not see the Team screen at all; the nav entry is hidden and the route guard redirects. The server still refuses regardless of what the UI does.
</specifics>

<deferred>
## Deferred Ideas

- OIDC/SSO configuration (Phase 10).
- Audit log of administrative actions.
- Bulk domain assignment or per-domain role overrides beyond the existing member/admin/owner hierarchy.
- Resending or expiring pending invitations from the UI.
- Multiple organisations/tenants in one installation.
</deferred>
