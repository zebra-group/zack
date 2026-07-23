# Phase 10: OIDC/SSO Integration - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Auto-decided during an authorised unattended autonomous run (see `.planning/STATE.md`). Every grey area below was resolved by Claude rather than asked; each records its rationale so the choices can be reviewed and reversed. **D-10-02 is the single most important item for the 09:00 review — it deviates from a literal reading of the prototype and is called out again at the top of the Decisions section.**

<domain>
## Phase Boundary

Admins can optionally enable OIDC/SSO login, purely additive on top of magic-link auth, with new SSO-provisioned users safely defaulting to the least-privileged role.

**Requirements:** AUTH-05 (admin enables OIDC/SSO by providing Issuer URL, Client ID, Client Secret), AUTH-06 (a user signs in through the configured OIDC provider once SSO is active, while magic-link login keeps working unchanged).

**In scope:** wiring better-auth's `genericOAuth` plugin (conditionally, only when configured), OIDC discovery from the issuer, auto-provisioning SSO users at the least-privileged role, the admin "Authentifizierung" section of the Team screen (design handoff §7 — the half deliberately deferred out of Phase 9), and the tests proving magic-link still works and SSO users never get Admin.

**Out of scope:** multiple simultaneous OIDC providers (one provider per install), SAML, social logins (Google/GitHub/etc. as branded buttons), SCIM/directory sync, group-to-role or claim-to-domain mapping, and making Kurzly itself an OIDC *provider* (the `oidc-provider` plugin is the opposite direction and is not used).
</domain>

<decisions>
## Implementation Decisions

### ⚠ D-10-02 (TOP MORNING-REVIEW ITEM) — OIDC is configured via environment variables, and the admin UI is a status + setup-guidance surface, not a live credential-entry form

This deviates from a literal reading of the design handoff §7 OIDC card ("Switch zum Aktivieren. Wenn an: Inputs Issuer-URL, Client-ID, Client-Secret") and of ROADMAP success criterion 1 ("Admin enables OIDC/SSO by entering an Issuer URL, Client ID, and Client Secret"). It deserves an explicit look in the morning.

**Why ENV, not DB-stored-via-UI:**
1. **The whole product is ENV-configured and self-hosted.** CLAUDE.md's hard constraints: "configure it entirely through environment variables" and "Alles Docker-/Compose-hostbar, on-premise betreibbar". SMTP, GeoIP, TLS target, brand — every operational secret and setting is already an ENV var the operator sets in their compose/secrets file. OIDC credentials belong in exactly that same place. For a self-hosted tool, the deployment's env/secrets file *is* the admin's configuration surface, so the admin genuinely does "enter an Issuer URL, Client ID and Client Secret" — in the place they enter everything else.
2. **The installed better-auth (1.6.23) configures `genericOAuth` statically at `createAuth()` construction.** There is no supported way to feed DB-stored OAuth config into a running better-auth instance without rebuilding the handler. The dedicated `sso` plugin with runtime `registerSSOProvider` (which CLAUDE.md preferred) is **not shipped in 1.6.23** — see D-10-01. Doing DB-stored + hot-reload would mean fighting the framework on the security-critical login path, in the final phase of a v1, unattended.
3. **A client secret in the app database is a weaker posture than in the deployment's secret store.** Keeping it in ENV means it lives in the operator's secret management, never in a Kurzly table, never in a backup of the app DB.

**What the UI becomes (still honouring the design's shape):** the "Authentifizierung" section shows two cards. The Magic Link card is descriptive (Badge "Standard", the existing copy). The OIDC/SSO card reads the server's SSO status (derived from whether the OIDC ENV vars are set at boot) and shows either: **enabled** — "Aktiv", the issuer, a masked client-id, the exact callback URL to register with the IdP, and "neue Nutzer erhalten die Rolle Mitglied"; or **disabled** — "Deaktiviert — nur Magic-Link-Login aktiv" plus the names of the ENV vars to set and the callback URL to register. No secret is ever sent to the browser. This keeps the informational content and layout of the prototype's card while not turning the dashboard into a credential-entry form.

**If the reviewer wants literal in-dashboard credential entry** with DB storage and a live-reconfigurable provider, that is a well-scoped follow-up phase (needs: a single-row encrypted config table, an auth-handler rebuild lifecycle, and its own threat model for secret-at-rest). It was deliberately not attempted unattended.

### D-10-01 — Use the `genericOAuth` plugin (installed), not the `sso` plugin (not installed)

CLAUDE.md preferred the `sso` plugin for its issuer-only auto-discovery. But the pinned/installed `better-auth@1.6.23` does **not** export an `sso` plugin — its plugin exports are `generic-oauth`, `oidc-provider` (wrong direction), and `oauth-proxy`. A separate `@better-auth/sso` package exists (1.6.24) but is not installed and would be a new dependency requiring the project's supply-chain legitimacy gate (the T-0X-SC pattern) mid-unattended-run.

`genericOAuth` fully satisfies the requirement: it supports `discoveryUrl`, so given just the issuer we construct `{issuer}/.well-known/openid-configuration` and it discovers the authorization/token/jwks endpoints itself — the same issuer-only ergonomics CLAUDE.md wanted from `sso`. Verified against the installed package's own source (`discoveryUrl` present in `generic-oauth/index.mjs` and its keycloak/okta/auth0 provider presets). No new dependency, no supply-chain gate.

### D-10-03 — The plugin is registered ONLY when OIDC is configured

Per CLAUDE.md's variant guidance ("Do not register the sso/genericOAuth plugin at all in that instance's betterAuth() config — avoids exposing /oauth2/* endpoints unnecessarily on installs that don't use SSO"). `createAuth(prisma)` reads the OIDC ENV vars once at boot; if they are absent, the `plugins` array contains only `magicLink()` exactly as today and no OAuth endpoints exist. This makes AUTH-06's "magic-link keeps working unchanged" the structural default, not a thing to test around.

### D-10-04 — SSO-provisioned users default to the least-privileged role, always

New users created through the OIDC flow get `accountRole = member` (the column default from D-09-01) and **zero** DomainMemberships — never Admin, never any domain access, regardless of any claim the IdP sends. An admin must explicitly promote them and assign domains afterward (the Phase 9 flow). This is ROADMAP success criterion 3 and must be proven by an automated test that provisions a user through the OAuth path and asserts `accountRole === "member"` with no memberships. No IdP claim (`role`, `groups`, `admin`, etc.) is ever mapped to `accountRole` — mapping external claims to privilege is an explicit non-goal and a deliberate security boundary.

### D-10-05 — No schema migration

better-auth's `genericOAuth` stores the provider link in the existing `Account` table (created in Phase 2 — it already has `providerId`, `accountId`, `accessToken`, `refreshToken`, `idToken`, `scope`). No new table, no migration. Confirm at execution that `genericOAuth` needs no additional columns against 1.6.23; if it does, follow the established additive-migration convention.

### D-10-06 — Surface the REAL callback path, not the prototype's guess

The design handoff names the callback `/api/auth/callback/oidc`. That is a spec-era guess; better-auth's `genericOAuth` uses its own callback path (of the `…/oauth2/callback/:providerId` shape). The executor MUST verify the actual callback path against the installed better-auth typings/source (the same "verify the API against the installed package" discipline 09-03 used for the magic-link send method) and surface THAT real path in the UI's "register this callback with your IdP" instruction — a wrong callback path is a silent setup failure for the operator.

### D-10-07 — ENV var names

`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, following the existing `SMTP_*`/`GEOIP_*` naming. All three must be present for SSO to activate; a partial set (e.g. issuer without secret) is a boot-time configuration error surfaced clearly, not a half-enabled state. Add a `.env.example` block documenting them and the callback URL to register.

### Claude's Discretion

Provider id string, the exact env-validation wiring, DTO naming for the SSO-status endpoint, and test breakdown follow the conventions phases 2-9 established.
</decisions>

<code_context>
## Existing Code Insights

- `apps/api/src/lib/auth.ts` — `createAuth(prisma)` factory; `magicLink()` is currently the ONLY plugin. This is where `genericOAuth` is conditionally added. The factory already reads `process.env` directly (with a `requireEnv` guard) rather than `loadEnv()`, so OIDC env reads follow that same convention.
- `apps/api/prisma/schema.prisma` — `Account` model (line 75) already carries every OAuth field genericOAuth needs; `User.accountRole` (Phase 9) defaults to `member`, which gives D-10-04 for free as long as nothing sets it to admin.
- `packages/shared/src/index.ts` — a small SSO-status DTO joins here (enabled boolean, issuer, masked client id, callback path) for the admin card.
- `apps/web` Team screen — Phase 9 built the member table and modals but deliberately left the "Authentifizierung" section out (it was scoped to Phase 10). `apps/web/src/views/TeamView.vue` is where the two auth cards attach; the login view is where an "over OIDC anmelden" affordance appears when SSO is active.
- `apps/api/src/lib/env.ts` (or wherever ENV validation lives) — the OIDC vars register here as optional (absent = SSO off), mirroring `GEOIP_DB_PATH`'s "absence means the feature is off" pattern (Phase 6 decision).
- Test harness (`apps/api/test/setupFileEach.ts`, reworked 2026-07-22): per-file cloned DB, truncate between tests, no shared-DB or absolute cross-file row-count assumptions. Magic-link E2E precedent: `auth.integration.test.ts` mocks the mailer rather than sending real email; the SSO tests will similarly avoid a real external IdP — stand up a stub/mock OIDC discovery+token endpoint (or drive the provisioning logic directly) rather than calling a live provider.

## Prototype Contract (design_handoff README §7 "Authentifizierung")

- Two cards side by side under an "Authentifizierung" heading.
- **Magic Link:** Badge "Standard", description "Anmeldung per E-Mail-Link, kein Passwort", code hint `better-auth · magicLink()`, a "Login-Seite ansehen →" button.
- **OIDC / SSO:** a toggle; when on, shows Issuer-URL / Client-ID / Client-Secret and a callback hint plus "neue Nutzer erhalten die Rolle Mitglied"; when off, "Deaktiviert — nur Magic-Link-Login aktiv." Per D-10-02 this becomes a status+guidance surface reflecting the ENV-configured state rather than a live credential-entry form; keep the card's information and layout, change the input fields to read-only status/instructions.
</code_context>

<specifics>
## Specific Ideas

- The login screen gains an "Über SSO anmelden" affordance only when SSO is active; magic-link stays the primary, always-present path.
- The SSO-status endpoint must never return the client secret (and ideally not the full client id — mask it).
- A test must prove that with OIDC env unset, the auth instance exposes no OAuth endpoints and magic-link is unchanged (AUTH-06's "unchanged" half).
- A test must provision a user through the OAuth callback path and assert least-privilege (accountRole member, zero memberships) — the headline safety guarantee.
</specifics>

<deferred>
## Deferred Ideas

- Literal in-dashboard credential entry with DB-stored, live-reconfigurable OIDC config (the D-10-02 alternative) — a well-scoped follow-up if the owner wants it.
- Multiple simultaneous OIDC providers.
- Mapping IdP claims/groups to roles or domain assignments.
- SAML, social-login buttons, SCIM/directory provisioning.
- Kurzly acting as an OIDC provider for other apps.
</deferred>
