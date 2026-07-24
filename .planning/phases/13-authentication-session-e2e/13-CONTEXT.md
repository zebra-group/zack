# Phase 13: Authentication & Session E2E - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss — user is AFK, proceeding without pausing for questions. This phase is the most infrastructure-heavy of the remaining milestone (needs a mock OIDC IdP) — deeper research is warranted before planning, more than a pure CONTEXT.md can responsibly cover from my own reading alone.

<domain>
## Phase Boundary

Prove both login paths — magic-link (primary, already has Phase 11's `auth.setup.ts` proving the happy path) and OIDC/SSO (optional) — plus the full session lifecycle (logout, route guarding, invite-only enforcement, account-merge on SSO-after-magic-link, rate-limited resend UX). This phase deepens Phase 11's auth coverage from "harness proof" to full requirement coverage: invalid/expired token rejection, non-invited-email denial, OIDC/SSO round-trip against a mock IdP, SSO+magic-link account merge, logout/route-guard, and the resend rate-limit UX.

</domain>

<decisions>
## Known facts (verified against actual source, not assumed)

- **SSO plugin:** `genericOAuth` (not `sso`, per Phase 10's already-documented finding that better-auth 1.6.23 doesn't ship the `sso` plugin). Provider id fixed as `"oidc"` (`lib/ssoConfig.ts`'s `SSO_PROVIDER_ID`). Real callback path: `{BASE_URL}/api/auth/oauth2/callback/oidc` (verified against installed better-auth source, NOT the design handoff's guessed `/api/auth/callback/oidc`).
- **SSO env gating:** `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`, all-three-or-none (env.ts boot guard). `readSsoConfig()` is the single source of truth both `createAuth` and the status route use.
- **SSO provisioning:** a new SSO-authenticated user always lands on `accountRole: "member"` (DB column default, `input: false` — IdP cannot inject a role claim) with zero `DomainMembership` rows — this is what AUTH-E2E-04's "least-privilege, even against admin-shaped IdP claims" success criterion is actually asserting: feed the mock IdP an admin-looking claim (e.g. `role: "admin"` in the ID token) and confirm Kurzly still provisions `member`.
- **Mock IdP:** no mock OIDC provider exists anywhere in this repo today (flagged as an open gap by both Phase 11's milestone-level STACK.md research and this phase's own ROADMAP note). `oidc-provider` (npm, actively maintained) was Phase 11's STACK.md recommendation for an in-process mock IdP fixture — verify current version/fit during phase research rather than assuming Phase 11's research is still current.
- **E2E infra available to reuse:** Phase 11's `apps/e2e/src/db.ts` (seedBaseline, withResetDbLock, BASELINE_DOMAIN_HOSTNAME), Phase 11's `apps/e2e/src/mailpit.ts` (findMagicLinkUrl, clearInbox), Phase 12's `apps/e2e/src/links.ts` (fetchWithFixtureRaceRetry — reuse for any fixture-creation race, this phase will create Users/invite state directly via Prisma same as Phase 11/12 did for Links).
- **AUTH-E2E-01/02 (magic-link round trip + invalid/expired token):** Phase 11's `auth.setup.ts` already proves the HAPPY path (request → Mailpit → open link → session). This phase must additionally prove: a consumed token can't be reused, an expired token (magic-link `expiresIn: 900` = 15 min per `lib/auth.ts`) is rejected, and a malformed/tampered token is rejected — all with NO session created.
- **AUTH-E2E-03 (non-invited email):** `isEmailAllowed` gates `sendMagicLink` — a non-invited email gets the SAME neutral response as an invited one (D-01, no timing/response-shape leak), so this test must prove NO SESSION results from actually following whatever link (if any) can be extracted — likely: request a magic link for a genuinely non-existent User row, confirm Mailpit never receives an email at all (the neutral-response contract means the email literally never sends for a non-allowlisted address — confirm this exact behavior by reading `sendMagicLink`'s callback in `lib/auth.ts` again during planning, don't assume).
- **AUTH-E2E-05 (SSO account-merge):** this is the trickiest scenario — needs a magic-link-invited-but-never-logged-in User row (exists in DB, `emailVerified` state per invite flow) that then completes an SSO login with the SAME email, and asserts the result is ONE account, not two. Read `lib/auth.ts`'s header comment on this exact scenario (D-10-04 area) and better-auth's actual account-linking behavior for `genericOAuth` (does it link-by-email automatically, or does this require explicit configuration?) during phase research — do not assume.
- **AUTH-E2E-07 (resend rate-limit UX):** reuses Phase 11's `MAGIC_LINK_RATE_LIMIT` (5 req/15min) — the E2E-06 rate-limit-bypass mechanism (`E2E_RATE_LIMIT_BYPASS_SECRET`/`isE2EComposeOverlay`) must NOT be used here (the whole point is to observe the UI's real behavior when genuinely rate-limited) — this is a real browser/dashboard-UI test (does the LOGIN FORM show a clear message on a 429?), read `apps/web`'s login view component during planning to find the actual UI copy/state to assert against.
- **AUTH-E2E-06 (logout + route guard):** Phase 11's `storage-state.spec.ts` already partially covers route-guard behavior (member `/team` redirect). This phase's job is the LOGOUT half specifically: an authenticated session calling logout, then confirming subsequent dashboard access redirects to `/login`.

## Claude's Discretion

- Exact mock-IdP wiring mechanics (in-process Node fixture inside `apps/e2e` vs. a small dedicated compose service) — let phase research settle this, since it directly affects how `docker-compose.e2e.yml` and `OIDC_ISSUER_URL` (which must be reachable from BOTH the `app` container's internal network AND the test runner) need to be configured. This is genuinely more architecturally consequential than prior phases' grey areas and deserves real research, not a guess.
- Exact spec file layout under `apps/e2e/tests/` for this phase's 7 requirements — likely `tests/auth/` given the growing `tests/smoke/`+`tests/authed/` split, but let planning decide based on whether these specs need the `setup` project's storageState or run fully standalone (most of them are standalone — they ARE proving login itself, so must NOT depend on `dependencies: ["setup"]`).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/e2e/src/db.ts`, `apps/e2e/src/mailpit.ts` (Phase 11), `apps/e2e/src/links.ts`'s `fetchWithFixtureRaceRetry` (Phase 12).
- `apps/api/src/lib/ssoConfig.ts` — frozen, stable interface for SSO config reading.
- `apps/api/src/lib/auth.ts` — full `createAuth()` factory, magicLink + conditional genericOAuth registration, all D-10 decisions documented in its own header comment (read in full during planning).
- `apps/web/src/stores/authSession.ts`, `apps/web/src/router/index.ts` (Phase 11 already read these for the requiresAdmin guard — reuse for the logout/route-guard half here).

### Established Patterns
- Raw Prisma fixture creation (Phase 12's resolution of "can't import lib/links.ts from apps/e2e") applies equally here: any User/invite-state fixture this phase needs should go through direct Prisma inserts in `apps/e2e`, mirroring the same `createE2eLink`-style helper pattern (a new `apps/e2e/src/users.ts` or extension of `db.ts`, planner's call).
- Real bot/browser UA pinning (isbot trap, Phase 11/12 precedent) is not directly relevant here (no bot-detection path in auth), but the "Playwright/APIRequestContext default UA" trap is worth keeping in mind for any API-only auth request.

</code_context>

<specifics>
## Specific Ideas

None beyond what's captured above.

</specifics>

<deferred>
## Deferred Ideas

- Full OIDC edge-case matrix (denied consent, invalid state, callback tampering) — milestone-level FEATURES.md research explicitly recommended ONE real-flow smoke test against a disposable IdP plus mocked/intercepted variants for negatives, not a full matrix. Keep this phase's OIDC scope to what AUTH-E2E-04/05 literally require.
- Team-invite E2E (the OTHER caller of the magic-link-delivery mechanism, for a genuinely NEW user rather than the pre-seeded baseline admin/member) — that's Phase 17's job (Team Management E2E), not this phase's.

</deferred>
