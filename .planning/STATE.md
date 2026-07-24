---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: E2E Test Coverage
current_phase: 13
current_phase_name: Authentication & Session E2E
status: verifying
stopped_at: Completed 13-03-PLAN.md (magic-link round trip + token rejection)
last_updated: "2026-07-24T23:57:20.059Z"
last_activity: 2026-07-24
last_activity_desc: Phase 12 complete, transitioned to Phase 13
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 19
  completed_plans: 14
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 12 — Redirect Handler E2E (Core Value)

## Current Position

Phase: 13 — Authentication & Session E2E
Plan: 3 of 8 in current phase
Status: Ready to execute
Last activity: 2026-07-24 — Phase 12 complete, transitioned to Phase 13

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed (v1.0): 65
- Average duration: ~8 min
- v1.1 plans completed: 6

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 11 | 6/6 | Complete |
| 12 | TBD | Not started |
| 13 | TBD | Not started |
| 14 | TBD | Not started |
| 15 | TBD | Not started |
| 16 | TBD | Not started |
| 17 | TBD | Not started |

**Recent Trend:**

- v1.0 shipped 2026-07-23 (10 phases, 65 plans); v1.1 started 2026-07-24 with Phase 11 Plan 01
- Trend: -

**Recent Plans:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 11 P01 | 10min | 3 tasks | 6 files |

*Updated after each plan completion*
| Phase 11 P02 | 12min | 2 tasks | 2 files |
| Phase 11 P03 | 25min | 3 tasks | 3 files |
| Phase 11 P04 | 27min | 3 tasks | 9 files |
| Phase 11 P05 | 15min | 2 tasks | 3 files |
| Phase 11 P06 | 10min | 2 tasks | 2 files |
| Phase 12 P01 | 20min | 1 tasks | 1 files |
| Phase 12 P02 | 25min | 2 tasks | 4 files |
| Phase 12 P03 | 35min | 2 tasks | 3 files |
| Phase 12 P04 | 20min | 2 tasks | 2 files |
| Phase 12 P05 | 95min | 2 tasks | 3 files |
| Phase 13 P01 | 50min | 3 tasks | 5 files |
| Phase 13 P02 | 15min | 3 tasks | 3 files |
| Phase 13 P03 | 30min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Full decision log lives in PROJECT.md Key Decisions. Carried forward for v1.1:

- E2E harness must target the built Docker image in production shape (single Fastify origin), never split dev servers — Core Value (redirect handler as deployed) is what E2E must prove.
- E2E Postgres is a separate long-lived instance (published port 5433), distinct from the Vitest testcontainers harness; per-file truncate/reseed, not `BEGIN/ROLLBACK` (cross-process boundary).
- Sequence infra-first: shared foundation bugs (Mailpit inbox scoping, DB isolation, rate-limit 429s, CI healthchecks/shm) solved once in Phase 11 before any flow coverage.
- Domain-scoped authz E2E complements, does NOT re-run, the v1.0 integration Denial-Suite — only representative UI-layer proof per resource type.
- [Phase 11]: Raw-.ts Prisma-client subpath export (apps/api/package.json exports['./prisma-client']) resolves directly under Playwright's runtime — RESEARCH OQ-1/A1 closed green, no compiled-artifact fallback needed.
- [Phase 11]: allowList (not a custom keyGenerator hack) is the correct @fastify/rate-limit mechanism for full request exclusion — set once at global registration, covers global bucket + every named per-route override
- [Phase 11]: E2E_RATE_LIMIT_BYPASS_SECRET is read directly from process.env in registerRateLimit, never added to envSchema/.env.example — structurally impossible to set via production config, proven by a dedicated schema-absence test
- [Phase 11]: scripts/e2e-compose.sh derives E2E_DATABASE_URL Postgres credentials from the bootstrapped .env at runtime (fallback kurzly/changeme/kurzly), not a hardcoded string
- [Phase 11]: better-auth 1.6.23's magic-link verify URL confirmed empirically from installed source as /api/auth/magic-link/verify?token= (basePath default /api/auth), closing RESEARCH A2/OQ-2 with certainty
- [Phase 11]: resetDb() wraps its TRUNCATE+reseed in pg_advisory_lock/unlock so parallel fullyParallel worker files never interleave; db-isolation.spec.ts uses cryptographically-random per-test slugs so a real P2002 is structurally impossible regardless of scheduling
- [Phase 11]: auth.setup.ts requests magic links via direct request.post (mirroring 11-04's mailpit-wiring pattern) rather than driving the LoginView UI form — the UI login flow itself is Phase 13 scope; keeps the auth fixture focused on establishing a real session
- [Phase 11]: storage-state.spec.ts detects role via testInfo.project.name in a single shared spec file instead of two near-duplicate per-role files — one assertion body proves both "reaches an authenticated route" and "correct role's session was captured" (T-11-08) for chromium-admin and chromium-member alike
- [Phase 11]: rate-limit-bypass.spec.ts runs the negative burst before the positive burst against the same probe IP so the positive burst proves the bypass overrides an already-tripped bucket
- [Phase 11]: CI's e2e job generates E2E_RATE_LIMIT_BYPASS_SECRET itself via a dedicated openssl rand -hex 32 step (id: bypass-secret) rather than relying solely on scripts/e2e-compose.sh's own fallback, making per-run provenance explicit in ci.yml
- [Phase 12]: RESEARCH OQ-1/A1 CONFIRMED live against the built compose image — Playwright APIRequestContext delivers a caller-supplied Host header unmodified to Fastify, no raw http.request fallback needed for this phase's feature specs
- [Phase 12]: Confirmed RESEARCH Q2's resolved finding empirically -- @kurzly/api's exports map makes lib/links.ts's createLink/updateLink unreachable from apps/e2e, so createE2eLink is a raw prisma.link.create mirroring derivePasswordHash/deriveExpiresAt's exact derivation shape
- [Phase 12]: bcryptjs added as an explicit apps/e2e devDependency -- pnpm's non-hoisted workspace layout does not expose a sibling workspace package's (apps/api) transitive deps as bare imports, even when already pinned/vetted in the shared lockfile
- [Phase 12]: REDIRECT-E2E-01/03 proven over real HTTP against the built compose image; fetchWithFixtureRaceRetry added to apps/e2e/src/links.ts to close a cross-file DB race between db-isolation.spec.ts's concurrent Link-table truncates and a fixture-creating real-HTTP test's read-back
- [Phase 12]: Bot-vs-human test reuses the SAME slug/Link for both the bot-UA and browser-UA requests, proving the branch is driven purely by User-Agent, not by any incidental fixture difference between two separate Links
- [Phase 12]: REDIRECT-E2E-04/REDIRECT-E2E-05 required zero changes to apps/e2e/src/links.ts -- the existing createE2eLink/BOT_UA/BROWSER_UA/CANARY_TARGET/assertNoLeak/fetchWithFixtureRaceRetry vocabulary from 12-02/12-03 covered every fixture and assertion verbatim
- [Phase ?]: [Phase 12, Rule 1 bug FIXED] renderPasswordPage's real-browser form encoding (application/x-www-form-urlencoded) was never parseable by POST /:slug/verify -- fastify.inject's JSON-only payload shape had hidden this since v1.0. Fixed with a plugin-scoped addContentTypeParser inside registerRedirectRoute, proven via RED->GREEN TDD.
- [Phase ?]: [Phase 12] A real Chromium page navigation cannot exercise a Secure-flagged cookie (NODE_ENV=production forces Secure) over the plain-HTTP, non-localhost e2e.kurzly.local origin -- Chromium withholds it regardless of CSP. page.request (shares the same BrowserContext cookie jar as page, but bypasses CSP form-action + Secure-cookie enforcement) is the closest achievable real-cookie-jar proof given this deliberate architecture; documented as a follow-up consideration, not actioned.
- [Phase 13]: oidc-provider Provider instance IS the Koa app -- custom routes/middleware register via provider.use() (which inserts immediately before the internal action router), never via a second wrapping Koa() app calling provider.callback() as middleware (throws TypeError)
- [Phase 13]: mock IdP's auto-approve /interaction/:uid must resolve BOTH login and consent prompts (a provider.Grant covering the requested scope/claims) -- single-prompt-only handling gets stuck looping on consent
- [Phase 13]: mock IdP's userinfo response needs a rewrite middleware merging extraClaims directly into the response body -- oidc-provider's own claims-scope filtering silently strips unregistered claim keys (role/admin) before they'd otherwise reach the app, which would make AUTH-E2E-04's no-elevation assertion prove nothing
- [Phase 13]: createInvitedUnverifiedUser uses prisma.user.create (not upsert) -- a colliding email is a test bug, not a legitimate resend; inviteMember's own resend semantics stay app-layer
- [Phase 13]: Playwright 1.61.1 throws Error: No tests found (exit 1) when a --project filter matches zero total spec files -- expected for the new auth project until Wave 1/2 adds tests/auth/** specs; verified project registration via the Available-projects listing instead of the plan's literal exit-code check
- [Phase ?]: [Phase 13]: better-auth's verification.identifier column stores the raw, unhashed magic-link token (confirmed against installed 1.6.23 source) -- consumeVerificationValue deletes the matching row unconditionally before checking expiresAt, so consumed-reuse and DB-expired tokens both fail via the identical INVALID_TOKEN redirect
- [Phase ?]: [Phase 13]: browser.newContext() does not inherit playwright.config.ts's use.baseURL -- every fresh negative-path context in magic-link-token-rejection.spec.ts explicitly passes baseURL (with the same fallback chain as smoke/boot.spec.ts)

### Pending Todos

None yet.

### Blockers/Concerns

Research flags to resolve during phase planning:

- Phase 11: DB-isolation mechanism (per-worker DB vs. unique-ID generation) needs a short spike; finalize rate-limit bypass mechanism.
- Phase 12: review actual bot-detection UA implementation before writing bot/OG specs; confirm custom-domain testing approach (/etc/hosts vs. host-header).
- Phase 13: mock OIDC IdP (oidc-provider) + better-auth genericOAuth callback specifics need planning validation; confirm where better-auth stores session (cookies vs. sessionStorage) before trusting storageState.
- Phase 14: confirm CSV import unit-test coverage; keep E2E light where already covered.
- Phase 13 (13-01 finding): apps/api/src/lib/auth.ts's genericOAuth config sets no scopes (empty scope='' at authorization time, empirically confirmed live against the real running app+mock) -- will cause access_denied against a spec-compliant IdP; add scopes: ['openid','email','profile'] as its own TDD RED->GREEN fix paired with sso-login.spec.ts

## Deferred Items

Items carried forward from v1.0 close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Decision revisit | OIDC admin card read-only status (D-10-02) may need a follow-up phase for dashboard-side OIDC config entry | Open | v1.0 close |

## Session Continuity

Last session: 2026-07-24T23:57:20.052Z
Stopped at: Completed 13-03-PLAN.md (magic-link round trip + token rejection)
Resume file: None
