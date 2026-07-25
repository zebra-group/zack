# Phase 17: Team Management & Domain-Scoped Authorization E2E - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss — user is AFK, proceeding without pausing for questions. This is the final phase of the v1.1 milestone.

<domain>
## Phase Boundary

Prove the invite-only team lifecycle end-to-end (invite → magic-link-style delivery via Mailpit → acceptance → new member appears in team list), that a role/domain reassignment takes real effect in the affected member's own re-navigated session, that removing a member immediately revokes their active session (not merely at next login), and — reusing the multi-role fixtures this phase establishes — that domain-scoped authorization is enforced server-side through the real UI for one representative case per resource type (Link, QR, Analytics), plus one account-admin domain-bypass case. This explicitly complements, not duplicates, the existing v1.0 integration Denial-Suite (`fastify.inject`-based) — only representative UI-layer cases here, not an exhaustive role×resource×operation matrix.

</domain>

<decisions>
## Known facts (verified against actual source, not assumed)

- **Invite delivery mechanism**: per Phase 13's own CONTEXT.md deferred-ideas note, team-invite is "the OTHER caller of the magic-link-delivery mechanism, for a genuinely NEW user rather than the pre-seeded baseline admin/member" — reuse Phase 11's `apps/e2e/src/mailpit.ts` (`findMagicLinkUrl`, `clearInbox`) for the invite email, but confirm during research whether the invite-acceptance flow uses the SAME `magicLink` better-auth plugin mechanism or a dedicated invite-token route — do not assume, verify against actual `apps/api` source.
- **Immediate session revocation on member removal (TEAM-E2E-03)**: this is the least commonly implemented of the three Team requirements — confirm during research HOW Kurzly achieves "immediate" revocation (session-table invalidation? a server-side session-version/generation counter checked on every request? better-auth's own session revocation API?) since this determines what the E2E spec must assert (a subsequent request with the OLD session cookie must be rejected immediately, not just eventually).
- **Role/domain reassignment taking effect in the member's OWN session (TEAM-E2E-02)**: confirm whether this requires a page reload/re-navigation to pick up new domain scoping (session data refreshed per-request from DB) or whether it requires an explicit session/token refresh — read the actual authorization middleware to confirm.
- **Reuses Phase 11's per-role fixture pattern** (admin/member `storageState`) but this phase's own subject is CREATING and MODIFYING team members/roles — the existing baseline admin/member accounts stay as-is; this phase's specs create NEW member accounts via the real invite flow (TEAM-E2E-01) and test role/domain changes on those newly-created members, or reuses `apps/e2e/src/users.ts` (from Phase 13) if applicable — confirm during research.
- **AUTHZ-E2E-01's three resource types (Link, QR, Analytics)**: one representative denial case per resource type is required — NOT a full matrix (explicitly out of scope, REQUIREMENTS.md's Out-of-Scope table). A member with NO domain assignment attempting to view/access a Link/QR/Analytics resource on a domain they don't own must be denied server-side, observed through the real UI (not just an API-level assertion).
- **AUTHZ-E2E-02 (account-admin bypass)**: an account-admin role (as opposed to a domain-scoped member) can reach a domain NEVER explicitly assigned to them — this is testing the INTENTIONAL admin bypass mechanism, not a bug. Confirm the actual admin-bypass authorization logic during research (is it a role check that skips domain-scoping entirely for `accountRole: "admin"`?).

## Claude's Discretion

- Exact new-member fixture creation mechanics for TEAM-E2E-01 (real invite-send → Mailpit → real acceptance flow, all via UI) vs. how TEAM-E2E-02/03 obtain the member account they then modify (could reuse the TEAM-E2E-01-created member, or create a fresh one via direct-Prisma/API for test independence) — planner's call once research clarifies the actual invite/role-management UI.
- Spec file layout under apps/e2e/tests/ — likely a new `tests/authed/team-*.spec.ts` set for TEAM-E2E-01/02/03 (dashboard-authenticated flows) and separate `tests/authed/authz-*.spec.ts` for AUTHZ-E2E-01/02 (or combined, planner's call).
- Whether TEAM-E2E-03's "immediate revocation" is tested via a second browser context holding the old session's storageState making a request AFTER removal, or some other concrete mechanism — depends on research findings about the actual revocation implementation.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/e2e/src/mailpit.ts` (Phase 11) — `findMagicLinkUrl`, `clearInbox` — reusable for invite email retrieval if invite uses the same magic-link delivery mechanism.
- `apps/e2e/src/db.ts` — seedBaseline, admin+member fixtures, `withResetDbLock`.
- `apps/e2e/src/users.ts` (Phase 13) — Prisma fixture helpers for allowlisted/invited-unverified User rows — check if reusable for this phase's new-member creation.
- Existing v1.0 integration Denial-Suite (`fastify.inject`-based) — the authorization logic this phase's E2E specs will exercise through the UI is ALREADY unit/integration-tested; this phase adds UI-layer representative proof only, per REQUIREMENTS.md's explicit Out-of-Scope framing.

### Established Patterns
- Real UI interaction (not API bypass) required wherever the phase's own subject IS that interaction — invite/accept, role/domain reassignment via the Team management UI, member removal via the Team UI, and the denial/bypass cases must be OBSERVED through the real UI (a real member session hitting a real page and seeing a real 403/redirect/empty-state), not just asserted via a raw API call.
- Zero data-testid attributes exist in apps/web/src (confirmed Phase 14/15/16 precedent) — use role/placeholder/CSS-class-based selectors verified against actual Team management UI markup.

</code_context>

<specifics>
## Specific Ideas

None beyond what's captured above — read the actual invite/accept routes, session-revocation mechanism, role/domain-reassignment authorization middleware, and the Team management Vue views during phase research before planning. This is the final phase of the milestone — research should be especially thorough given its "closing the milestone's safety-critical coverage" framing in ROADMAP.md.

</specifics>

<deferred>
## Deferred Ideas

- Full domain-denial matrix (every role × every resource × every operation) — explicitly out of scope per REQUIREMENTS.md, already covered by the existing v1.0 integration Denial-Suite.
- Exhaustive validation-error-message testing — out of scope per REQUIREMENTS.md.

</deferred>
