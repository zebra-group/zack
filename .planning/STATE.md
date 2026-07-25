---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: E2E Test Coverage
current_phase: 17
current_phase_name: Team Management & Domain-Scoped Authorization E2E
status: planning
stopped_at: Completed 16-03-PLAN.md (ANALYTICS-E2E-03 global rollup, Phase 16 complete)
last_updated: "2026-07-25T08:20:01.014Z"
last_activity: 2026-07-25
last_activity_desc: Phase 16 complete, transitioned to Phase 17
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 30
  completed_plans: 30
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 12 — Redirect Handler E2E (Core Value)

## Current Position

Phase: 17 — Team Management & Domain-Scoped Authorization E2E
Plan: Not started
Status: Ready to plan
Last activity: 2026-07-25 — Phase 16 complete, transitioned to Phase 17

Progress: [██████████] 86%

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
| Phase 13 P04 | 20min | 1 tasks | 1 files |
| Phase 13 P05 | 20min | 1 tasks | 1 files |
| Phase 13 P06 | 20min | 1 tasks | 1 files |
| Phase 13 P07 | 25min | 1 tasks | 2 files |
| Phase 13 P08 | 45min | 2 tasks | 3 files |
| Phase 14 P01 | 35min | 2 tasks | 2 files |
| Phase 14 P02 | 55min | 1 tasks | 1 files |
| Phase 14 P03 | 30min | 1 tasks | 1 files |
| Phase 14 P04 | 60min | 1 tasks | 1 files |
| Phase 15 P01 | 10min | 2 tasks | 4 files |
| Phase 15 P02 | 25min | 1 tasks | 1 files |
| Phase 15 P03 | ~40min | 1 tasks | 1 files |
| Phase 15 P04 | ~30min | 1 tasks | 1 files |
| Phase 16 P01 | 45min | 1 tasks | 1 files |
| Phase 16 P02 | 40min | 1 tasks | 1 files |
| Phase 16 P03 | 50min | 1 tasks | 1 files |

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
- [Phase ?]: [Phase 13]: invite-only-denial.spec.ts creates NO Prisma fixture for its test email -- its absence from the User table IS the precondition isEmailAllowed checks, the one spec in this phase that deliberately writes nothing
- [Phase ?]: [Phase 13]: A transient 3rd-consecutive-invocation stack-reuse flake (spurious Dashboard-nav timeouts under --workers=1) in tests/auth/ was diagnosed as accumulated Mailpit/DB state across back-to-back Playwright invocations on one long-lived compose stack, not a spec defect -- resolved by re-running against a freshly booted stack.
- [Phase ?]: AUTH-E2E-07 tripped rate limit uses a 6-request same-IP pre-exhaust burst (no x-e2e-bypass anywhere) then drives the real LoginView UI once to assert the exact German 429 copy; no User fixture needed since MAGIC_LINK_RATE_LIMIT's onRequest hook fires before the allowlist check
- [Phase ?]: [Phase 13]: Fixed apps/api/src/lib/auth.ts's empty-scopes genericOAuth gap (STATE.md blocker from 13-01/13-02) as part of 13-07 -- confirmed RED (real error=access_denied) then GREEN live against the built compose image before adding scopes: ['openid','email','profile']
- [Phase 13]: [Phase 13]: Added account.accountLinking { enabled:true, requireLocalEmailVerified:false } to auth.ts (D-13-01) so an admin-invited unverified User merges into ONE account on first SSO login instead of being rejected with account_not_linked -- documented as a deliberate, bounded security tradeoff scoped to Kurzly's invite-only model (D-01) — Closes AUTH-E2E-05, the last known blocker in Phase 13; confirmed RED then GREEN live at both the Vitest-integration and real-browser-E2E levels
- [Phase ?]: [Phase 14]: apps/e2e/src/csv.ts's buildImportCsv is a dependency-free string join (not a CSV library) centralizing IMPORT_CSV_HEADER (ziel_url,slug,domain) as the single source of the import-CSV header, proven RED->GREEN via csv-fixture.spec.ts -- structurally closes 14-RESEARCH.md Pitfall 4 for every fixture 14-03/14-04 build
- [Phase ?]: [Phase 14]: LINKS-E2E-01 proved live against the built compose image with zero apps/api/apps/web diffs -- LinksView.vue/LinkFormModal.vue/api.ts behave exactly as 14-RESEARCH.md documented; test.describe.configure({ retries: 2 }) applied as the whole-journey UI equivalent of fetchWithFixtureRaceRetry for the documented cross-file db-isolation.spec.ts Link-table truncate race
- [Phase ?]: [Phase 14]: LINKS-E2E-02 CSV import happy path proved live -- select-default-domain-before-upload avoids the documented double-preview race, commit re-sends the SAME csv text (no preview-id exists), and the DB-level slug-scoped findMany (not just importedCount) is the real 'no silent extras' proof
- [Phase ?]: [Phase 14]: LINKS-E2E-03 CSV slug conflict proved live -- pre-existing Link seeded via createE2eLink inside the test body, preview surfaces slug_conflict, commit skips the row; the definitive proof is a direct-Prisma findMany scoped to the conflict slug returning exactly one row with the UNCHANGED pre-existing target (skip, never overwrite, no duplicate row) -- closing T-14-06, no overwrite path exists anywhere in the codebase
- [Phase 15]: sharp's [SUS] freshness-heuristic flag (15-RESEARCH.md Package Legitimacy Audit) is a documented false-positive -- sharp is a 10+-year-old, ~76M-weekly-download package already an approved, in-production @kurzly/api dependency since Phase 7 and already resolved in the shared pnpm-lock.yaml; the blocking-human checkpoint was pre-authorized by the orchestrator for this autonomous run, no substitution
- [Phase 15]: apps/e2e/src/qr.ts's createE2eQrCode is a raw prisma.qrCode.create (lib/qrCodes.ts's createQrCode is unreachable from apps/e2e via @kurzly/api's exports map, same as createLink/updateLink before it) and decodeQrImage is a verbatim port of apps/api/test/qrDecode.test.ts's sharp+jsQR decode recipe -- proven RED->GREEN via qr-fixture.spec.ts, closing 15-01-PLAN.md's Wave 0 infra gate for 15-02/03/04
- [Phase 15]: QR-E2E-01 proved live against the built compose image with zero apps/api/apps/web diffs -- LinkDetailView.vue's handleQrCode/QrStudioPanel.vue's color-swatch/rounded-toggle/logo-upload controls behave exactly as 15-RESEARCH.md documented; decode assertion built from BASELINE_DOMAIN_HOSTNAME+slug+qrId (resolveQrPayload's static-QR short URL), never link.targetUrl
- [Phase ?]: [Phase 15]: Rule 1 bug fix -- Playwright's request fixture default UA is bot-classified by isbot, routing GET /q/:code to the bot-OG 200 branch instead of the human 302 branch; fixed with an explicit BROWSER_UA header, mirroring Phase 12's redirect-*.spec.ts's already-documented identical fix
- [Phase ?]: [Phase 15]: QR-E2E-03 proved live against the built compose image with zero apps/api/apps/web diffs -- QrStudioPanel.vue's exportFile/routes/qrCodes.ts's render.png/render.svg behave exactly as 15-RESEARCH.md documented; both real export-button downloads independently decode (SVG rasterized via sharp first) to the same expected short-URL string built from BASELINE_DOMAIN_HOSTNAME+slug+qrId, never link.targetUrl -- closing Phase 15
- [Phase ?]: [Phase 15]: Compose v5's plain ports: override list ADDS to (never replaces) the base files' original published ports -- a session-local port-remap override needs each remapped ports: key tagged with the !override merge directive, or the boot fails with 'port is already allocated' on the ORIGINAL port
- [Phase 16]: [Phase 16]: ANALYTICS-E2E-01 proved live -- recordClickHook's fully-awaited $transaction makes the ClickEvent+lifetimeClicks write synchronous relative to the HTTP response (no polling needed); LinkDetailView.vue's one-shot loadAnalytics() mount fetch requires the click to be generated strictly before page.goto
- [Phase 16]: ANALYTICS-E2E-02 proved live via the REAL LinkDetailView .tracking-card .toggle (awaited updateLink PATCH), never the fixture-only trackingEnabled:false path -- recordClickHook's structural early-return guard produces a true DB-asserted zero-rows guarantee (clickEvent.count===0, lifetimeClicks===0) while the redirect itself still 302s
- [Phase 16]: ANALYTICS-E2E-03 proved live -- 3/2 real clicks across two distinct baseline-domain links roll up correctly in getGlobalAnalytics's server-side SQL GROUP BY topLinks; per-link Top Links rows (scoped by unique slug) are exact-matched, the shared "Klicks (30 Tage)" tile is asserted only with toBeGreaterThanOrEqual (never exact equality, since the query sums ALL links on the shared baseline domain) -- Phase 16 (Analytics E2E) complete, zero apps/api/apps/web diffs across all three plans
- [Phase 16]: pre-existing, unrelated flakiness observed again in links-crud.spec.ts/qr-static-customize-decode.spec.ts/storage-state.spec.ts (chromium-member) when running the full tests/authed/ directory -- consistent with 16-02's identical finding, deferred (out of scope for Phase 16's own spec files), noted for Phase 17 or a dedicated stabilization pass

### Pending Todos

None yet.

### Blockers/Concerns

Research flags to resolve during phase planning:

- Phase 11: DB-isolation mechanism (per-worker DB vs. unique-ID generation) needs a short spike; finalize rate-limit bypass mechanism.
- Phase 12: review actual bot-detection UA implementation before writing bot/OG specs; confirm custom-domain testing approach (/etc/hosts vs. host-header).
- Phase 13: mock OIDC IdP (oidc-provider) + better-auth genericOAuth callback specifics need planning validation; confirm where better-auth stores session (cookies vs. sessionStorage) before trusting storageState.
- Phase 14: confirm CSV import unit-test coverage; keep E2E light where already covered.

## Deferred Items

Items carried forward from v1.0 close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Decision revisit | OIDC admin card read-only status (D-10-02) may need a follow-up phase for dashboard-side OIDC config entry | Open | v1.0 close |

## Session Continuity

Last session: 2026-07-25T07:59:35.000Z
Stopped at: Completed 16-03-PLAN.md (ANALYTICS-E2E-03 global rollup, Phase 16 complete)
Resume file: None
