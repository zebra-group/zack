# Phase 17: Team Management & Domain-Scoped Authorization E2E - Research

**Researched:** 2026-07-25
**Domain:** Playwright E2E coverage of Kurzly's invite-only team lifecycle (invite/accept, role/domain reassignment, member removal) and representative UI-layer proof of domain-scoped authorization (deny + admin bypass), reusing Phase 11/13's fixture/harness conventions
**Confidence:** HIGH — every claim in this file (invite mechanism, session-revocation implementation, IDOR-guard shape, admin-bypass logic) was verified directly against this repo's own installed source (`apps/api/src/lib/*.ts`, `apps/api/src/routes/*.ts`, `apps/api/prisma/schema.prisma`, and `node_modules/better-auth`'s own compiled source) — not against training-data assumptions about better-auth's typical behavior. No new external libraries are introduced by this phase, so no package-legitimacy audit or web-search-sourced claims are needed.

## Summary

This phase's three "least commonly implemented, verify don't assume" flags from CONTEXT.md all resolved cleanly and favorably from direct source reads — this is good news, not a gap, but it changes the shape of what the E2E specs need to prove.

**TEAM-E2E-01 (invite):** confirmed — `lib/team.ts`'s `inviteMember` creates a `User` row (`emailVerified: false`) and calls `auth.api.signInMagicLink` directly, the EXACT SAME better-auth magic-link send path the login flow uses. There is no separate invite-token table or route. The invite email is retrievable via Phase 11's existing `findMagicLinkUrl` unchanged. Accepting the invite (opening the magic link) additionally flips `emailVerified: true` (confirmed in `better-auth`'s own `magic-link/index.mjs`), which is what flips `toTeamMemberDto`'s derived `status` from `"pending"` ("Ausstehend") to `"active"` ("Aktiv") in the Team list — this status flip, cross-checked before/after acceptance, is the strongest available proof of the full round trip.

**TEAM-E2E-02 (role/domain reassignment) and TEAM-E2E-03 (immediate revocation on removal) are BOTH structurally guaranteed by the SAME two facts, verified this session:**
1. `createAuth()`'s `session` config sets no `cookieCache` — better-auth's own `getSession` route (`dist/api/routes/session.mjs`) confirms `cookieCache` defaults OFF, so its cache-cookie branch is dead code for this app; every single `getSession()` call falls through to `ctx.context.internalAdapter.findSession(sessionCookieToken)` — a live, uncached Postgres read, every request.
2. `schema.prisma`'s `Session.user` relation is `onDelete: Cascade`. `removeMember`'s `tx.user.delete(...)` therefore cascade-deletes every `Session` row for that user, atomically, inside the same transaction that deletes the `User` row.

Combined: TEAM-E2E-03's "immediate" claim is **not a stretch or a documentation aspiration — it is what the code actually does**, and there is no TTL/eventual-consistency gap to flag. A request replayed with the old session cookie the instant after removal genuinely gets `session: null` from the DB lookup, because the row is already gone. Likewise, TEAM-E2E-02's "own re-navigated session picks up the change" is true because `accountRole` (read via `findSession`'s joined `User` row) and domain scoping (`scopedDomainIds`, a fresh Prisma query on every route call) are BOTH re-derived from the database on every single request — nothing about a session cookie or client-side store caches either value across requests. **A page reload/re-navigation is sufficient; no explicit logout/re-login or token refresh is needed for either requirement.**

**AUTHZ-E2E-01 (domain-scoped denial)** — one clarifying, plan-relevant finding: the actual denial shape for a Link/QR/per-link-Analytics resource **outside a member's scope is HTTP 404, not 403** — a deliberate no-existence-oracle IDOR guard (`resolveOwnedLink`/`resolveOwnedQrCode`, both cost-identical for "not found" vs. "forbidden" by design, T-04-IDOR/T-07-IDOR). The corresponding Vue UI state is `LinkDetailView.vue`'s `.not-found-card` ("Link nicht gefunden") — this is the concrete, assertable UI surface for both the Link and (embedded) QR cases. The account-wide `/api/analytics` endpoint behaves differently: it never 404s, it silently scopes to `scopedDomainIds` and returns a smaller/empty rollup — so the Analytics representative case is an **empty-state assertion**, not a not-found page.

**AUTHZ-E2E-02 (admin bypass)** — confirmed mechanism: `requireDomainAccess`/`scopedDomainIds` (`lib/authorization.ts`) both start with an `isAccountAdmin` check that short-circuits before any `DomainMembership` lookup. Bonus finding: the EXISTING seeded `ADMIN_EMAIL` fixture (`apps/e2e/src/db.ts`) already has **zero** `DomainMembership` rows (only the seeded Member gets one) — meaning the already-existing `chromium-admin` storageState fixture, hitting the baseline domain's resources, is *already* a live instance of the exact bypass AUTHZ-E2E-02 must prove. No new admin fixture is required; the spec only needs to make the "never explicitly assigned" precondition explicit and assert on it (e.g., via a DB read confirming zero `DomainMembership` rows for the admin, alongside the successful resource access).

**Primary recommendation:** This phase requires NO new backend code changes (unlike Phase 13's `accountLinking` fix) — every requirement is provable against the CURRENT codebase as-is. All five specs are pure-test additions. The only genuinely new fixture code needed is a `createMemberWithNoDomains`-style helper (trivial: `createAllowlistedUser` from Phase 13's `apps/e2e/src/users.ts` ALREADY does exactly this — it upserts `emailVerified: true`, `accountRole: "member"`, and never touches `DomainMembership` — reuse verbatim) plus a thin `apps/e2e/src/team.ts` for the invite-only mutations (`inviteMember`/`changeMemberRole`/`assignMemberDomains`/`removeMember` direct-Prisma equivalents) for setup-only scenarios that are NOT this phase's own subject.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Invite delivery mechanism**: per Phase 13's own CONTEXT.md deferred-ideas note, team-invite is "the OTHER caller of the magic-link-delivery mechanism, for a genuinely NEW user rather than the pre-seeded baseline admin/member" — reuse Phase 11's `apps/e2e/src/mailpit.ts` (`findMagicLinkUrl`, `clearInbox`) for the invite email, but confirm during research whether the invite-acceptance flow uses the SAME `magicLink` better-auth plugin mechanism or a dedicated invite-token route — do not assume, verify against actual `apps/api` source.
- **Immediate session revocation on member removal (TEAM-E2E-03)**: this is the least commonly implemented of the three Team requirements — confirm during research HOW Kurzly achieves "immediate" revocation (session-table invalidation? a server-side session-version/generation counter checked on every request? better-auth's own session revocation API?) since this determines what the E2E spec must assert (a subsequent request with the OLD session cookie must be rejected immediately, not just eventually).
- **Role/domain reassignment taking effect in the member's OWN session (TEAM-E2E-02)**: confirm whether this requires a page reload/re-navigation to pick up new domain scoping (session data refreshed per-request from DB) or whether it requires an explicit session/token refresh — read the actual authorization middleware to confirm.
- **Reuses Phase 11's per-role fixture pattern** (admin/member `storageState`) but this phase's own subject is CREATING and MODIFYING team members/roles — the existing baseline admin/member accounts stay as-is; this phase's specs create NEW member accounts via the real invite flow (TEAM-E2E-01) and test role/domain changes on those newly-created members, or reuses `apps/e2e/src/users.ts` (from Phase 13) if applicable — confirm during research.
- **AUTHZ-E2E-01's three resource types (Link, QR, Analytics)**: one representative denial case per resource type is required — NOT a full matrix (explicitly out of scope, REQUIREMENTS.md's Out-of-Scope table). A member with NO domain assignment attempting to view/access a Link/QR/Analytics resource on a domain they don't own must be denied server-side, observed through the real UI (not just an API-level assertion).
- **AUTHZ-E2E-02 (account-admin bypass)**: an account-admin role (as opposed to a domain-scoped member) can reach a domain NEVER explicitly assigned to them — this is testing the INTENTIONAL admin bypass mechanism, not a bug. Confirm the actual admin-bypass authorization logic during research (is it a role check that skips domain-scoping entirely for `accountRole: "admin"`?).

### Claude's Discretion

- Exact new-member fixture creation mechanics for TEAM-E2E-01 (real invite-send → Mailpit → real acceptance flow, all via UI) vs. how TEAM-E2E-02/03 obtain the member account they then modify (could reuse the TEAM-E2E-01-created member, or create a fresh one via direct-Prisma/API for test independence) — planner's call once research clarifies the actual invite/role-management UI.
- Spec file layout under apps/e2e/tests/ — likely a new `tests/authed/team-*.spec.ts` set for TEAM-E2E-01/02/03 (dashboard-authenticated flows) and separate `tests/authed/authz-*.spec.ts` for AUTHZ-E2E-01/02 (or combined, planner's call).
- Whether TEAM-E2E-03's "immediate revocation" is tested via a second browser context holding the old session's storageState making a request AFTER removal, or some other concrete mechanism — depends on research findings about the actual revocation implementation.

### Deferred Ideas (OUT OF SCOPE)

- Full domain-denial matrix (every role × every resource × every operation) — explicitly out of scope per REQUIREMENTS.md, already covered by the existing v1.0 integration Denial-Suite.
- Exhaustive validation-error-message testing — out of scope per REQUIREMENTS.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEAM-E2E-01 | Invite → acceptance (magic-link-style delivery) → new member appears in team list | `lib/team.ts`'s `inviteMember` confirmed to reuse `auth.api.signInMagicLink` verbatim (same mechanism as login); `findMagicLinkUrl` works unchanged; acceptance flips `emailVerified` (confirmed in better-auth source), which flips the Team list's derived `status` badge — the concrete before/after assertion |
| TEAM-E2E-02 | Admin's role/domain reassignment takes real effect in the member's own re-navigated session | Confirmed structurally guaranteed: no `cookieCache`, `scopedDomainIds`/`accountRole` re-derived from Postgres on every request — a page reload/re-navigation (no re-login) is sufficient and is exactly what the spec should exercise |
| TEAM-E2E-03 | Removing a member immediately revokes their active session | Confirmed structurally guaranteed: `Session.user onDelete: Cascade` + `removeMember`'s single transaction + `getSession`'s uncached `findSession` DB read — no TTL/eventual-consistency gap exists; the "immediate" claim is code-verified, not aspirational |
| AUTHZ-E2E-01 | Per-resource-type (Link, QR, Analytics) real member session with no domain assignment denied server-side through the UI | Link/QR: `resolveOwnedLink`/`resolveOwnedQrCode` 404-for-both IDOR guard → `LinkDetailView.vue`'s `.not-found-card`; Analytics (global): `scopedDomainIds`-scoped silent empty rollup, no 404 — different assertion shape per resource type, documented below |
| AUTHZ-E2E-02 | Account-admin reaches a domain never explicitly assigned to them through the UI | `isAccountAdmin` short-circuit in `requireDomainAccess`/`scopedDomainIds`; the EXISTING seeded admin fixture already has zero `DomainMembership` rows — reusable as-is |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Invite send (magic-link trigger) | API / Backend (`lib/team.ts` → better-auth) | Browser (admin fills/submits `InviteMemberModal`) | The actual mail-send call (`auth.api.signInMagicLink`) is server-side; the browser only submits the form and (as a separate actor) later opens the received link |
| Invite acceptance / emailVerified flip | API / Backend (better-auth's magic-link verify handler) | Browser (invitee clicks the link, follows the redirect) | Verification and the `emailVerified` write happen entirely server-side; the browser is a passive conduit for the token |
| Role/domain reassignment authorization | API / Backend (`lib/team.ts`, `lib/authorization.ts`) | — | Every scoping decision (`scopedDomainIds`, `requireDomainAccess`) is a fresh server-side Postgres read on each request; no client-side cache is ever the source of truth |
| Session revocation on removal | API / Backend (Postgres `Session` cascade + better-auth's uncached `getSession`) | Database (schema-level `onDelete: Cascade`) | The database's own referential-integrity cascade IS the revocation mechanism, not application code polling/checking a flag — this is a schema-level guarantee, unusually strong for "immediate" |
| Domain-scoped resource denial (Link/QR) | API / Backend (`resolveOwnedLink`/`resolveOwnedQrCode`) | Browser (`LinkDetailView.vue`'s `.not-found-card` render) | The 404 decision is made entirely server-side before any data leaves the API; the Vue component only renders whatever state the API's response shape dictates |
| Domain-scoped denial (global Analytics) | API / Backend (`scopedDomainIds` filtering `getGlobalAnalytics`) | Browser (`AnalyticsView.vue`'s zero-data render branch) | Same server-authoritative pattern, different shape (silent narrowing vs. 404) — the UI has no dedicated "denied" state here, it is indistinguishable from "no data yet" by design (matches the codebase's own "scope silently, never leak" convention) |
| Admin bypass | API / Backend (`isAccountAdmin` short-circuit) | — | A pure server-side role check; no UI-tier control exists or should exist for this |

## Standard Stack

No new libraries are introduced by this phase. Every dependency this phase's specs need already exists in the workspace:

| Library | Version (already pinned) | Purpose in this phase | Source |
|---------|---------------------------|------------------------|--------|
| `@playwright/test` | 1.61.1 | Test runner, unchanged | `apps/e2e/package.json` (Phase 11) |
| `@kurzly/api/prisma-client` (subpath export) | matches Prisma 7.x generated client | Direct-Prisma fixture writes (`apps/e2e/src/team.ts`, new) | `apps/e2e/src/db.ts` convention (Phase 11) |

**Version verification:** not applicable — no new packages. `npm view` / registry checks are skipped per this file's own "no new external libraries" scope note.

## Package Legitimacy Audit

**Not applicable this phase.** No new npm/PyPI/crates packages are introduced — every fixture and test file this phase adds is pure TypeScript against already-approved, already-installed dependencies (`@playwright/test`, `@kurzly/api/prisma-client`). No `checkpoint:human-verify` gate is needed for a package install because there is no package install.

## Architecture Patterns

### System Architecture Diagram

```
 ┌─────────────────────────── HOST (Playwright) ───────────────────────────┐
 │                                                                          │
 │  chromium-admin (existing storageState)                                 │
 │     │                                                                   │
 │     │ 1. TeamView → "+ Mitglied einladen" → InviteMemberModal submit    │
 │     ▼                                                                   │
 │  POST /api/team/invite ──────────────► app (Fastify) ─┐                 │
 │                                                        │                 │
 │                                   inviteMember():      │                 │
 │                                   - creates User row   │                 │
 │                                     (emailVerified:false)                │
 │                                   - auth.api.signInMagicLink            │
 │                                     (SAME path as login) ──► Mailpit    │
 │                                                        │                 │
 │  fresh (unauthenticated) browser context                                │
 │     │ 2. findMagicLinkUrl(newEmail) ◄────────────────── Mailpit         │
 │     │ 3. page.goto(magicLinkUrl)                                        │
 │     ▼                                                                   │
 │  GET /api/auth/magic-link/verify ────► better-auth verify handler       │
 │                                         - creates Session row           │
 │                                         - user.emailVerified = true      │
 │                                         (session cookie set on browser) │
 │                                                                          │
 │  chromium-admin (same context as step 1, RE-NAVIGATED to /team)         │
 │     │ 4. GET /api/team ──────► listTeamMembers() reads fresh from DB    │
 │     ▼    status flips "Ausstehend" → "Aktiv" (emailVerified now true)   │
 │                                                                          │
 │  --- TEAM-E2E-02 (role/domain reassignment) ---                         │
 │  chromium-admin: TeamView role <select>/AssignDomainsModal              │
 │     │ PATCH /api/team/:id/role  or  PUT /api/team/:id/domains           │
 │     ▼ (writes DomainMembership/accountRole rows, no session touched)    │
 │  new-member's OWN browser context (separate storageState/session)      │
 │     │ re-navigates (e.g. page.reload() or page.goto('/links'))          │
 │     ▼ every route re-reads accountRole (getSession) + scopedDomainIds   │
 │       (fresh Prisma query) — sees the NEW scope with NO re-login        │
 │                                                                          │
 │  --- TEAM-E2E-03 (immediate revocation) ---                            │
 │  chromium-admin: TeamView "⋯" → "Mitglied entfernen" → confirm          │
 │     │ DELETE /api/team/:id                                              │
 │     ▼ removeMember(): ONE transaction —                                │
 │       tx.user.delete() ──► Postgres CASCADE deletes ALL Session rows   │
 │  new-member's OLD browser context/APIRequestContext (OLD cookie)       │
 │     │ IMMEDIATELY AFTER (same test, next line of code)                 │
 │     ▼ GET /api/auth/get-session → internalAdapter.findSession() finds  │
 │       nothing (row is gone) → session: null → dashboard route redirects │
 │       to /login (client guard) AND any API call independently 401s     │
 │                                                                          │
 │  --- AUTHZ-E2E-01 (denial) ---                                         │
 │  fresh member (zero DomainMembership, createAllowlistedUser)            │
 │     │ page.goto('/links/:idOnAnotherDomain')                            │
 │     ▼ GET /api/links/:id → resolveOwnedLink() → scopedDomainIds([]) ∩   │
 │       domainId → no match → 404 → LinkDetailView renders .not-found-card│
 │     (QR: identical shape via resolveOwnedQrCode/GET /api/qr-codes/:id)  │
 │     (Analytics: GET /api/analytics silently returns a scoped/empty      │
 │      rollup — NO 404 — AnalyticsView renders its zero-data branch)      │
 │                                                                          │
 │  --- AUTHZ-E2E-02 (admin bypass) ---                                   │
 │  chromium-admin (existing fixture, ZERO DomainMembership rows itself)  │
 │     │ page.goto('/links/:idOnBaselineDomain')                          │
 │     ▼ requireDomainAccess/scopedDomainIds → isAccountAdmin() TRUE →     │
 │       bypasses membership check entirely → 200, full access            │
 └──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/e2e/
├── src/
│   └── team.ts                          # NEW — direct-Prisma team-mutation
│                                         # helpers for setup-only scenarios
│                                         # NOT this phase's own subject
│                                         # (e.g. pre-seeding a member's role
│                                         # for a TEAM-E2E-03 test that isn't
│                                         # itself testing the reassignment
│                                         # flow). Mirrors users.ts's shape.
│                                         # inviteMember/accept themselves
│                                         # MUST go through the real UI —
│                                         # this file is NOT a shortcut
│                                         # around TEAM-E2E-01's own subject.
└── tests/
    └── authed/
        ├── team-invite-accept.spec.ts        # TEAM-E2E-01
        ├── team-role-domain-reassign.spec.ts # TEAM-E2E-02
        ├── team-member-removal.spec.ts       # TEAM-E2E-03
        ├── authz-domain-denial.spec.ts       # AUTHZ-E2E-01 (all 3 resource types)
        └── authz-admin-bypass.spec.ts        # AUTHZ-E2E-02
```

### Structure Rationale

- **`apps/e2e/src/team.ts` is additive, not a replacement for real UI interaction**: TEAM-E2E-01/02/03's own subject (invite, reassign, remove) MUST be driven through the real Team UI per CONTEXT.md's "Established Patterns" — this file exists only for setup-only preconditions a spec needs but isn't itself testing (e.g., TEAM-E2E-03 needs A pre-existing, already-active member to remove; whether that member was created via a prior spec's real invite flow or via a direct-Prisma helper is the planner's call, but the REMOVAL action itself must be a real click in the Team UI).
- **`tests/authed/` (not a new top-level directory)**: every spec here is a dashboard-authenticated, post-login flow — matches Phase 14/15/16's precedent of adding to the existing `tests/authed/` directory rather than inventing a new one (unlike Phase 13's `tests/auth/`, which deliberately stood alone because it tested login itself).
- **`chromium-admin`/`chromium-member` projects already declared in `playwright.config.ts`** cover TEAM-E2E-01's admin-side actions and AUTHZ-E2E-02's admin-bypass proof out of the box (`testMatch: /authed\/.*\.spec\.ts$/` already matches this phase's new files, zero config changes needed). The NEW-member sessions this phase creates (invited member, zero-domain member) are NOT one of the two pre-baked storageState roles — each such spec establishes its own session inline (real magic-link round trip, mirroring `auth.setup.ts`'s own request-then-verify shape) rather than trying to shoehorn a third pre-baked project into `playwright.config.ts` for what is fundamentally a per-test, disposable identity.

### Pattern 1: TEAM-E2E-01 — invite is a magic-link send, not a separate flow

**What:** `inviteMember` (`lib/team.ts`) creates the `User` row then calls `auth.api.signInMagicLink({ body: { email, callbackURL: "/", errorCallbackURL: "/auth/error" }, headers: new Headers() })` — the exact same better-auth API surface the login page's own magic-link request hits. `findMagicLinkUrl` (Phase 11's `mailpit.ts`) needs zero changes to retrieve this email; it is recipient-scoped and mechanism-agnostic.

**When to use:** TEAM-E2E-01's spec. Flow: (1) `chromium-admin` context opens `/team`, clicks `.invite-button`, fills `InviteMemberModal`'s `.field-input` (email) + selects a `.role-card` (member) + optionally `.domain-pill`(s), clicks `.btn-primary` ("Magic Link senden"); (2) assert the new row appears immediately in the Team list with `.status-badge` NOT `.active` (i.e., "Ausstehend") — proves invite-send + list-refresh; (3) a SEPARATE, fresh (unauthenticated) browser context calls `findMagicLinkUrl(newEmail)` and navigates to the returned URL; (4) `chromium-admin` re-fetches `/team` (reload or re-navigate) and asserts the SAME row's `.status-badge` now has class `.active` ("Aktiv") — proves acceptance completed end-to-end via the `emailVerified` flip.

**Trade-offs:** none — this is a strictly additive proof over Phase 13's existing magic-link machinery.

### Pattern 2: TEAM-E2E-02/03 — no cookieCache means DB is the single source of truth every request

**What:** `createAuth()`'s `session: { expiresIn, updateAge }` config has NO `cookieCache` key. `dist/cookies/index.mjs`'s `setCookieCache` (line 71) short-circuits `if (!ctx.context.options.session?.cookieCache?.enabled) return;` — this branch is provably dead in this app. Every `getSession()` call (`dist/api/routes/session.mjs`) therefore executes `const session = await ctx.context.internalAdapter.findSession(sessionCookieToken);` against Postgres, every time, unconditionally.

**When to use:** Both TEAM-E2E-02 and TEAM-E2E-03's assertion design. For TEAM-E2E-02: after an admin's `PATCH /api/team/:id/role` or `PUT /api/team/:id/domains`, the affected member's OWN already-open browser context should simply `page.reload()` (or navigate to a new route) — no `signOut`/re-login anywhere in the spec — and the newly-scoped domain list (e.g., `GET /api/links` returning only the newly-assigned domain's rows) should be immediately visible. For TEAM-E2E-03: after `DELETE /api/team/:id`, the SAME member's old context (or a raw `APIRequestContext` sharing that cookie jar) issuing literally the next request should observe `GET /api/auth/get-session` returning `null`/401, and any subsequent dashboard navigation redirecting to `/login`.

**Trade-offs:** none — this is the intended, documented better-auth behavior for a DB-backed (non-JWT, non-cookie-cached) session strategy; no code change is required to make this true.

### Pattern 3: AUTHZ-E2E-01 — 404-for-both is the actual denial shape, not 403

**What:** `resolveOwnedLink`/`resolveOwnedQrCode` (`routes/links.ts`, `routes/qrCodes.ts`, `routes/analytics.ts`) all run `scopedDomainIds` FIRST, then a single `findFirst({ where: { id, domainId: { in: domainIds } } })` — an out-of-scope id and a genuinely nonexistent id are BOTH `null`, and the route returns `404` either way (T-04-IDOR/T-07-IDOR's explicit no-existence-oracle design, cost-identical on every branch). `LinkDetailView.vue` renders `notFound.value = true` → the `.not-found-card` block ("Link nicht gefunden" / "Dieser Link existiert nicht oder ist nicht zugänglich.") for this exact response.

**When to use:** AUTHZ-E2E-01's Link and QR cases. Flow: an admin (or fixture) creates a Link (and optionally a QR bound to it) on the BASELINE domain via the existing `createE2eLink`/`createE2eQrCode` fixtures (Phase 12/15's `apps/e2e/src/links.ts`/`qr.ts` — reused verbatim, no changes needed). A fresh member fixture with **zero** `DomainMembership` rows (`createAllowlistedUser` from Phase 13's `apps/e2e/src/users.ts`, called with no domain-membership creation afterward) establishes a real session (magic-link round trip, same as Pattern 1 step 3) and navigates directly to `/links/:id` for that Link's id. Assert the `.not-found-card` renders — this is the UI-observable, server-side-enforced denial. For QR: either navigate to the SAME link (QR is Studio-embedded, not a standalone route) and confirm the QR panel is unreachable because the link itself 404s, OR — more directly proving the QR resource type's OWN IDOR guard independently — issue `page.request.get('/api/qr-codes/:qrId')` from the same authenticated browser context and assert `404` (this shares the real browser's cookie jar, matching Phase 12's established "`page.request` is a legitimate real-session proof" precedent).

**Trade-offs:** the Analytics case does NOT follow this pattern — see Pattern 4.

### Pattern 4: AUTHZ-E2E-01's Analytics case — silent scoping, not a 404 or an explicit "denied" state

**What:** `GET /api/analytics` (`routes/analytics.ts`) is session-gated only (`resolveUserId`), then unconditionally calls `scopedDomainIds(prisma, userId)` and passes that (possibly empty) array into `getGlobalAnalytics`. A zero-domain member gets a 200 response with a `GlobalAnalyticsDTO` whose aggregates are all rolled up over an EMPTY domain set — effectively all-zero. `AnalyticsView.vue` has no dedicated "denied" branch; it renders whatever the zero-data computed branch already renders for "no clicks yet" (the SAME state a legitimately domain-scoped-but-clickless member would see).

**When to use:** AUTHZ-E2E-01's Analytics representative case. The assertion is necessarily an INDIRECT proof: (1) as an admin/fixture, generate a real click on a Link on a domain the zero-domain member does NOT have access to (reuse Phase 16's `apps/e2e` click-generation pattern); (2) as the zero-domain member, load `/analytics` and assert the resulting `clicks30Days`/`topLinks` do NOT include that click/link — i.e., the rollup is scoped to (in this member's case, empty of) their own domains, not the whole instance. This is a narrower, DB-cross-checked proof rather than a "denied page" screenshot, and should be documented in the spec's own comments as deliberately different in shape from the Link/QR cases, so a future reader doesn't expect a `.not-found-card` equivalent here.

**Trade-offs:** slightly less visually dramatic than a 404 page, but it is the actual, correct behavior — do not "improve" the app to add a fake 403 page for global analytics; that would contradict this codebase's own "scope silently, never leak which domains exist" convention (already established at `GET /api/links`'s out-of-scope-domainId handling, `routes/links.ts` lines 261-269).

### Pattern 5: AUTHZ-E2E-02 — the existing admin fixture already IS the bypass proof

**What:** `seedBaseline` (`apps/e2e/src/db.ts`) creates the seeded `ADMIN_EMAIL` User with `accountRole: "admin"` and creates **no** `DomainMembership` row for it at all (only the Member gets one). `isAccountAdmin` short-circuits `requireDomainAccess`/`scopedDomainIds` before any membership lookup.

**When to use:** AUTHZ-E2E-02's spec. No new fixture is strictly required: the existing `chromium-admin` storageState project, navigating to the baseline domain's Link/QR/Analytics resources (created via the existing `createE2eLink`/`createE2eQrCode` fixtures), already demonstrates the bypass. To make the "never explicitly assigned" precondition assertable (not just implicit), the spec should include an explicit DB read confirming `prisma.domainMembership.count({ where: { userId: adminUserId } })` is `0`, immediately before/alongside the successful navigation — turning an implicit fact into an explicit, self-documenting assertion. If the planner prefers an even cleaner story, a SECOND domain (created fresh in the spec, never referenced by any `DomainMembership` for the admin OR anyone) removes any doubt that "baseline domain" isn't somehow implicitly admin-owned by convention.

**Trade-offs:** reusing the existing fixture is less new code but relies on `seedBaseline`'s current shape (no admin membership) staying true — if a future phase ever adds a membership row for convenience, this spec's precondition assertion would catch that regression immediately (a good thing), whereas silently assuming it without asserting would not.

### Anti-Patterns to Avoid

- **Asserting AUTHZ-E2E-01's Link/QR denial via the LIST view being empty:** `LinksView.vue`'s `.empty-state` ("Noch keine Links") is AMBIGUOUS — it renders identically whether the member has zero domains OR simply has zero links on domains they DO own. Use the direct `/links/:id` navigation to the SPECIFIC out-of-scope resource's `.not-found-card` instead — that is the only unambiguous, resource-specific denial proof.
- **Assuming TEAM-E2E-03 needs a polling/retry loop to observe revocation "eventually":** it does not — the cascade delete is transactional and the very next `getSession()` call already returns `null`. A spec that polls or waits is testing a weaker (and wrong) claim than what the code actually guarantees; assert on the FIRST subsequent request.
- **Testing TEAM-E2E-02 by having the member log out and back in:** this would test something TRIVIALLY true (a fresh login obviously picks up current DB state) and would NOT prove the actual, more interesting guarantee — that an ALREADY-OPEN session, with no re-authentication at all, sees the new scope on its very next request/reload.
- **Adding a `data-testid` to any Team/Modal component "to make the E2E test easier":** zero `data-testid` attributes exist anywhere in `apps/web/src` (confirmed, Phase 14/15/16 precedent, and directly confirmed again this session across `TeamView.vue`/`InviteMemberModal.vue`/`AssignDomainsModal.vue`) — use the existing CSS-class/role/text selectors (`.invite-button`, `.role-select`, `.domain-pill`, `.action-menu-item`, `.not-found-card`, `.status-badge.active`, etc.), consistent with every prior E2E phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Invite email retrieval | A new Mailpit client tuned for "invite" emails | `apps/e2e/src/mailpit.ts`'s existing `findMagicLinkUrl`/`clearInbox` verbatim | The invite email IS a magic-link email (same better-auth mechanism, same URL pattern) — no new parsing logic needed |
| Zero-domain member fixture | A new Prisma helper | `apps/e2e/src/users.ts`'s existing `createAllowlistedUser` (Phase 13) called with no follow-up `DomainMembership` write | Already produces exactly `emailVerified: true`, `accountRole: "member"`, zero memberships — precisely AUTHZ-E2E-01's precondition |
| Established-member session for TEAM-E2E-02/03 | A hand-rolled cookie-injection trick | The same real magic-link round trip pattern `auth.setup.ts`/Phase 13's specs already use (request → `findMagicLinkUrl` → `page.goto`) | Every prior phase establishes real sessions this way; a shortcut here would test a artificial code path, not the real one |
| Link/QR fixture on the baseline (or a second) domain | New fixture helpers | `apps/e2e/src/links.ts`'s `createE2eLink` and `apps/e2e/src/qr.ts`'s `createE2eQrCode`, unchanged | Both already exist, already raw-Prisma, already proven across Phases 12/15/16 |

**Key insight:** This phase is unusual among the v1.1 milestone's phases in requiring almost zero NEW fixture code — nearly everything it needs (session establishment, Link/QR fixtures, Mailpit retrieval, DB reset) already exists from Phases 11–16. The only genuinely new helper is the thin `apps/e2e/src/team.ts` for setup-only team mutations, and even that is optional if the planner decides every team mutation in this phase's specs should go through the real UI (which is arguably MORE in the spirit of this phase's own subject matter).

## Runtime State Inventory

Not applicable — this is a pure test-addition phase with zero rename/refactor/migration scope. No file, table, or config-key names change.

## Common Pitfalls

### Pitfall 1: Conflating "member sees an empty list" with "member is denied a specific resource"

**What goes wrong:** A spec asserts `GET /api/links` returns `[]` for a zero-domain member and calls that "proof of denial" for AUTHZ-E2E-01.

**Why it happens:** An empty list IS the correct behavior for a zero-domain member, but it is a WEAKER claim than "a SPECIFIC resource this member has no rights to is rejected when directly requested" — a list-scoping bug and an IDOR bug are different bugs, and only the second is what a real attacker (or a misconfigured client) would actually attempt.

**How to avoid:** Always test the direct-by-id path (`GET /api/links/:id`, `/links/:id` route, `GET /api/qr-codes/:id`) for a KNOWN id the member does not own — never substitute a list-emptiness check for this.

**Warning signs:** A spec named "denial" that never constructs/knows a specific out-of-scope resource id.

---

### Pitfall 2: Racing the invite-acceptance's `emailVerified` write against the admin's list re-fetch

**What goes wrong:** The admin's Team-list re-fetch (post-acceptance) happens before better-auth's magic-link verify handler has actually committed the `emailVerified: true` update, producing a flaky "still Ausstehend" read.

**Why it happens:** The acceptance step (a SEPARATE browser context navigating the magic link) and the admin's re-fetch are two independent actors; nothing inherently sequences them unless the spec explicitly `await`s the acceptance navigation's response/redirect completing BEFORE triggering the admin's re-fetch.

**How to avoid:** `await page.goto(magicLinkUrl)` (or equivalent) must fully resolve (including whatever redirect better-auth issues post-verify) before the admin context does its re-fetch — do not race the two browser contexts in parallel.

**Warning signs:** An intermittent, non-reproducible failure where the status badge is occasionally still "Ausstehend" immediately after acceptance.

---

### Pitfall 3: Forgetting the member-count/last-admin guard when picking WHICH user to demote/remove in TEAM-E2E-02/03

**What goes wrong:** A spec attempts to demote or remove the SEEDED baseline admin (`ADMIN_EMAIL`) directly, tripping `changeMemberRole`/`removeMember`'s `LAST_ADMIN` guard (`countAdmins`, D-09-07) if it happens to be the only admin at that point in the run.

**Why it happens:** `LAST_ADMIN` is a real, deliberate lockout — the guard doesn't know or care that this is "just a test."

**How to avoid:** TEAM-E2E-02/03's target should always be a NEWLY CREATED member (via TEAM-E2E-01's own invite flow or a direct-Prisma fixture), never the seeded baseline admin or member fixtures those OTHER specs' `storageState` files depend on.

**Warning signs:** A `409 LAST_ADMIN` or `409 CONFLICT` response the spec didn't anticipate; or — worse — accidentally breaking the seeded ADMIN_EMAIL/MEMBER_EMAIL fixture other specs' `dependencies: ["setup"]` rely on for their OWN login.

---

### Pitfall 4: Assuming TEAM-E2E-03's old-session request needs a special "replay" mechanism

**What goes wrong:** Overengineering the "subsequent request with the OLD cookie" proof — e.g., manually extracting and re-injecting a raw cookie header into a new `APIRequestContext`.

**Why it happens:** The phrase "immediate revocation" invites over-caution about HOW to construct the "old" request.

**How to avoid:** The simplest, most direct proof is to keep the SAME browser context/page (the one whose session is being removed) open throughout the test and simply make the NEXT request/navigation on it AFTER the admin's removal call resolves — no manual cookie extraction needed, Playwright's own context already holds the (now-stale) cookie.

**Warning signs:** Test code that manually reads `context.cookies()` and re-sets them on a fresh context — unnecessary complexity for what Playwright's existing context object already provides.

## Code Examples

### Confirmed: invite reuses the login magic-link mechanism verbatim

```typescript
// apps/api/src/lib/team.ts (existing, read in full this session)
async function triggerMagicLinkSend(auth: Auth, email: string): Promise<void> {
  await auth.api.signInMagicLink({
    body: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
    headers: new Headers(),
  });
}
```
No separate invite-token table, no second email template — `findMagicLinkUrl` from Phase 11 works unchanged.

### Confirmed: no cookieCache, every getSession() hits Postgres fresh

```javascript
// node_modules/better-auth/dist/cookies/index.mjs (installed source, read this session)
async function setCookieCache(ctx, session, dontRememberMe) {
	if (!ctx.context.options.session?.cookieCache?.enabled) return; // <-- always returns here, this app never sets cookieCache
  ...
}
```
```javascript
// node_modules/better-auth/dist/api/routes/session.mjs (installed source, read this session)
const session = await ctx.context.internalAdapter.findSession(sessionCookieToken); // <-- live DB read, every call
ctx.context.session = session;
if (!session || session.session.expiresAt < new Date()) {
  deleteSessionCookie(ctx);
  ...
  return ctx.json(null);
}
```

### Confirmed: Session cascades on User delete (schema-level revocation)

```prisma
// apps/api/prisma/schema.prisma (existing, read in full this session)
model Session {
  ...
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ...
}
```
```typescript
// apps/api/src/lib/team.ts's removeMember (existing, read in full this session)
await tx.user.delete({ where: { id: targetUserId } }); // cascades ALL that user's Session rows, same transaction
```

### Confirmed: the 404-for-both IDOR shape (AUTHZ-E2E-01's Link/QR denial)

```typescript
// apps/api/src/routes/links.ts (existing, read in full this session)
async function resolveOwnedLink(prisma: PrismaClient, userId: string, id: string): Promise<Link | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.link.findFirst({ where: { id, domainId: { in: domainIds } } });
}
// route: if (!link) return reply.code(404).send({ error: "Not found" });
```
```vue
<!-- apps/web/src/views/LinkDetailView.vue (existing, read in full this session) -->
<div v-if="notFound" class="screen-container">
  <div class="not-found-card">
    <h3 class="empty-heading">Link nicht gefunden</h3>
    <p class="empty-body">Dieser Link existiert nicht oder ist nicht zugänglich.</p>
    <button type="button" class="back-link" @click="goBack">← Alle Links</button>
  </div>
</div>
```

### Confirmed: admin bypass short-circuit (AUTHZ-E2E-02)

```typescript
// apps/api/src/lib/authorization.ts (existing, read in full this session)
export async function requireDomainAccess(prisma, userId, domainId, minRole): Promise<void> {
  if (await isAccountAdmin(prisma, userId)) {
    return; // <-- bypass, no DomainMembership lookup at all
  }
  ...
}
```
```typescript
// apps/e2e/src/db.ts's seedBaseline (existing, read this session) — the
// seeded admin gets NO DomainMembership row (only the Member does):
await prisma.user.upsert({ where: { email: ADMIN_EMAIL }, ..., data: { accountRole: "admin" } });
// (no prisma.domainMembership.upsert call for the admin anywhere in seedBaseline)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| CONTEXT.md's framing of TEAM-E2E-03 as "the least commonly implemented... confirm during research" | Confirmed CORRECTLY implemented via DB cascade + uncached session lookup | This research pass | Removes the anticipated risk — no code fix needed, unlike Phase 13's `accountLinking` gap; the phase is purely test-writing |
| Assuming AUTHZ-E2E-01's denial is a 403 (CONTEXT.md's phrasing: "a real 403/redirect/empty-state") | Confirmed it is a 404 (IDOR no-existence-oracle design) for Link/QR, and a silent empty-rollup (no error code at all) for Analytics | This research pass | Changes the exact assertion each spec must make — plan tasks should reference `.not-found-card`/404 explicitly, not a generic "403 page" |

**Deprecated/outdated:** none identified — this phase touches no legacy code paths.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The QR resource-type denial case is best proven via a direct `page.request.get('/api/qr-codes/:id')` call (since QR has no standalone detail ROUTE, only a list + embedded Studio panel) rather than purely through `/qr-codes` list navigation | Architecture Patterns, Pattern 3 | Low risk — if the planner prefers a pure-UI-only proof, the QR case can instead ride on the SAME `/links/:id` `.not-found-card` proof (since QR is Studio-embedded in LinkDetailView) at the cost of not independently exercising `resolveOwnedQrCode`'s own code path; either is a valid, defensible choice, this is a "which is more thorough" judgment call, not a factual uncertainty |
| A2 | A second, dedicated Domain (beyond the existing seeded baseline) is NOT required for AUTHZ-E2E-01/02 — the existing single baseline domain plus a zero-membership member fixture is sufficient | Architecture Patterns, Patterns 3/5 | Low risk — if the planner prefers clearer test isolation (a domain the member fixture was NEVER even offered during a hypothetical invite), adding a second domain via the existing `apps/e2e` domain-seeding pattern is a small addition, not a redesign |

**All other claims in this file are `[VERIFIED]`** — directly read from this repo's own installed source (`better-auth`'s compiled `dist/` output, `apps/api/src/lib/*.ts`, `apps/api/src/routes/*.ts`, `apps/api/prisma/schema.prisma`, `apps/web/src/views/*.vue`, `apps/e2e/src/*.ts`) during this research session, not from training-data assumptions about typical better-auth/Prisma behavior.

## Open Questions

None outstanding — every question CONTEXT.md flagged as "confirm during research, do not assume" was resolved with direct source evidence this session (see Summary). The two Assumptions Log entries above are judgment calls for the planner, not unresolved factual gaps.

## Environment Availability

Not applicable — this phase introduces no new external dependencies (no new services, no new npm packages, no new Docker Compose services). All required infrastructure (Mailpit, the E2E Postgres instance, the built app image) already exists and is already proven working by Phases 11–16.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` 1.61.1 |
| Config file | `apps/e2e/playwright.config.ts` |
| Quick run command | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/team-*.spec.ts tests/authed/authz-*.spec.ts --project=chromium-admin --project=chromium-member` |
| Full suite command | `scripts/e2e-compose.sh` (boots the full compose stack, runs `pnpm --filter @kurzly/e2e test`, always tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| TEAM-E2E-01 | Invite send → Mailpit → accept → Team-list status flip | e2e (browser + Mailpit REST) | `playwright test tests/authed/team-invite-accept.spec.ts` | ❌ Wave 0 |
| TEAM-E2E-02 | Role/domain reassignment takes effect on the member's own re-navigated session | e2e (two browser contexts: admin + already-open member) | `playwright test tests/authed/team-role-domain-reassign.spec.ts` | ❌ Wave 0 |
| TEAM-E2E-03 | Member removal immediately revokes the active session (next request, not next login) | e2e (two browser contexts: admin + already-open member/APIRequestContext) | `playwright test tests/authed/team-member-removal.spec.ts` | ❌ Wave 0 |
| AUTHZ-E2E-01 | Zero-domain member denied Link (404/.not-found-card), QR (404), Analytics (scoped empty rollup) | e2e (browser + direct DB fixture creation) | `playwright test tests/authed/authz-domain-denial.spec.ts` | ❌ Wave 0 |
| AUTHZ-E2E-02 | Account-admin reaches a never-assigned domain's resource | e2e (existing `chromium-admin` fixture, plus a DB precondition read) | `playwright test tests/authed/authz-admin-bypass.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted spec file only, against a running local compose stack.
- **Per wave merge:** full `tests/authed/team-*.spec.ts`/`authz-*.spec.ts` set at `--workers=1` then again at CI's configured parallelism — this phase's specs mutate `User`/`Session`/`DomainMembership` rows more aggressively than prior phases (invite creates new Users, removal deletes them), so cross-file interference with the SHARED baseline admin/member fixtures other specs' `dependencies: ["setup"]` rely on is a genuine new risk class this phase introduces — verify at both worker counts before merging.
- **Phase gate:** full E2E suite (`scripts/e2e-compose.sh`, every directory) green before `/gsd-verify-work`. Given this is the FINAL phase of the milestone, this full-suite gate is also effectively the milestone's own closing regression check.

### Wave 0 Gaps

- [ ] `apps/e2e/src/team.ts` — optional, planner's call — direct-Prisma team-mutation helpers for setup-only preconditions (NOT a substitute for TEAM-E2E-01/02/03's own real-UI actions).
- [ ] Confirm (at implementation time, one spec run) that `createAllowlistedUser` (Phase 13's `apps/e2e/src/users.ts`) can be called for a THIRD, never-before-used email per test file without colliding with `withResetDbLock`'s truncate list — `User` rows are NOT truncated between spec files (`db.ts`'s own header comment), so each spec needing a fresh zero-domain member must use a cryptographically-unique email per test (mirroring `db-isolation.spec.ts`'s existing per-test-random-slug convention) to avoid `P2002` across repeated runs.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes | Invite reuses the existing magic-link authentication mechanism unchanged (existing, this phase adds test coverage only) |
| V3 Session Management | yes | This phase's core subject — session cascade-delete on user removal, DB-fresh session reads (existing, code-verified this session, unchanged by this phase) |
| V4 Access Control | yes | Domain-scoped IDOR guard (`resolveOwnedLink`/`resolveOwnedQrCode`) and the account-admin bypass (existing, this phase drives both through the real UI for the first time at the E2E layer) |
| V5 Input Validation | n/a | This phase adds no new input surfaces; `inviteMemberSchema`/`updateMemberRoleSchema`/`assignDomainsSchema` (Zod, Phase 9) are unchanged and out of this phase's scope (exhaustive validation-error testing is explicitly out of scope per REQUIREMENTS.md) |
| V6 Cryptography | n/a | No new crypto surface |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Stale session use after account/role change (privilege persists past intended revocation) | Elevation of Privilege | Confirmed CLOSED this session — DB cascade + uncached `getSession` reads mean no window exists; this phase's job is to PROVE this in an E2E-observable way, not to fix anything |
| IDOR via direct resource-id guessing/enumeration (Link/QR/Analytics) | Information Disclosure / Elevation of Privilege | Confirmed CLOSED via the 404-for-both no-existence-oracle design (`resolveOwnedLink`/`resolveOwnedQrCode`) — this phase's AUTHZ-E2E-01 is the first E2E-layer (as opposed to `fastify.inject`-integration-layer) proof of this |
| Admin-bypass logic silently regressing to a membership-required check (or, inversely, a member row silently gaining bypass) | Elevation of Privilege / Denial of Service (of legitimate admin access) | AUTHZ-E2E-02's explicit DB-precondition assertion (admin has zero `DomainMembership` rows, yet succeeds) makes a future regression in either direction immediately test-visible, not just theoretically covered by the existing integration Denial-Suite |
| Team-mutation lockout (`LAST_ADMIN`) accidentally tripped by test fixtures, masking a REAL lockout-guard regression with test noise | Denial of Service (false-positive on the safety guard itself) | This phase's specs must target NEWLY created members for demote/remove operations, never the seeded baseline fixtures other specs' `storageState` depends on (Pitfall 3) |

## Sources

### Primary (HIGH confidence — direct source reads, this session)
- `apps/api/src/lib/team.ts`, `apps/api/src/routes/team.ts` — full reads (invite/reassign/remove mechanics)
- `apps/api/src/lib/auth.ts` — full read (session config, no `cookieCache`)
- `apps/api/src/lib/authorization.ts`, `apps/api/src/lib/accountRole.ts` — full reads (admin bypass, deny-by-default)
- `apps/api/src/routes/links.ts`, `apps/api/src/routes/qrCodes.ts`, `apps/api/src/routes/analytics.ts` — full/targeted reads (IDOR guard shape, 404-for-both, global analytics scoping)
- `apps/api/prisma/schema.prisma` — full read (`Session.user onDelete: Cascade`)
- `node_modules/better-auth/dist/cookies/index.mjs`, `node_modules/better-auth/dist/api/routes/session.mjs`, `node_modules/better-auth/dist/plugins/magic-link/index.mjs` — installed source, read directly this session (cookieCache default-off, uncached `findSession` DB read, magic-link verify's `emailVerified: true` write)
- `apps/web/src/views/TeamView.vue`, `apps/web/src/components/InviteMemberModal.vue`, `apps/web/src/components/AssignDomainsModal.vue`, `apps/web/src/views/LinkDetailView.vue`, `apps/web/src/views/AnalyticsView.vue`, `apps/web/src/views/QrCodesView.vue`, `apps/web/src/views/LinksView.vue`, `apps/web/src/router/index.ts`, `apps/web/src/api.ts` — full/targeted reads (selectors, error/notFound states, route guards)
- `apps/e2e/src/db.ts`, `apps/e2e/src/users.ts`, `apps/e2e/src/mailpit.ts`, `apps/e2e/playwright.config.ts` — full reads (existing fixture/project shape, admin's zero-DomainMembership seeding fact)
- `.planning/phases/13-authentication-session-e2e/13-CONTEXT.md`, `.planning/phases/13-authentication-session-e2e/13-RESEARCH.md` — full reads (invite-mechanism deferred-idea note, established fixture conventions)
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — full reads (phase scope, requirement text, prior-phase decisions/blockers)

### Secondary / Tertiary
None — this phase's research required zero external documentation or web search; every claim was resolvable directly against this repository's own already-installed source, per this session's scope (no new libraries, no new external services).

## Metadata

**Confidence breakdown:**
- Invite mechanism (TEAM-E2E-01): HIGH — read directly from `lib/team.ts`, cross-checked against better-auth's own `signInMagicLink`/magic-link-verify installed source
- Session revocation (TEAM-E2E-02/03): HIGH — read directly from `schema.prisma`'s cascade FK and better-auth's own `getSession`/`cookies` compiled source; this is the strongest-evidence finding in this file
- Domain-scoped denial shape (AUTHZ-E2E-01/02): HIGH — read directly from `routes/links.ts`/`routes/qrCodes.ts`/`routes/analytics.ts`/`lib/authorization.ts` and the corresponding Vue views' actual render conditions

**Research date:** 2026-07-25
**Valid until:** 30 days (stable domain — no new dependencies, and the underlying better-auth/Prisma versions are unchanged from Phase 13's already-pinned versions; re-verify only if `better-auth` or the Prisma schema's `Session` model changes before this phase executes)

---
*Research for: Kurzly Phase 17 — Team Management & Domain-Scoped Authorization E2E (v1.1 milestone, FINAL phase)*
*Researched: 2026-07-25*
