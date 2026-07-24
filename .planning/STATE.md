---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 0
status: Awaiting next milestone
stopped_at: Completed 07-09-PLAN.md
last_updated: "2026-07-24T08:37:03.352Z"
last_activity: 2026-07-24
last_activity_desc: "Completed quick task 260724-ecl: Fix CI smoke tests crashing app container"
current_phase_name: oidc-sso-integration
progress:
  total_phases: 10
  completed_phases: 10
  total_plans: 65
  completed_plans: 65
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-10)

**Core value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.
**Current focus:** Phase 10 — oidc-sso-integration

## Current Position

Phase: Milestone v1.0 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-07-24 — Completed quick task 260724-ecl: Fix CI smoke tests crashing app container

## Performance Metrics

**Velocity:**

- Total plans completed: 65
- Average duration: ~8 min
- Total execution time: ~0.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 9 | - | - |
| 02 | 6 | - | - |
| 03 | 4 | - | - |
| 04 | 5 | - | - |
| 05 | 6 | - | - |
| 06 | 8 | - | - |
| 7 | 9 | - | - |
| 8 | 6 | - | - |
| 9 | 7 | - | - |
| 10 | 5 | - | - |

**Recent Trend:**

- Last 5 plans: 01-01 (1 min), 01-02 (15 min)
- Trend: -

*Updated after each plan completion*
| Phase 01 P02 | 15 | 3 tasks | 24 files |
| Phase 01 P03 | 11min | 2 tasks | 8 files |
| Phase 01 P04 | 6min | 2 tasks | 4 files |
| Phase 01 P05 | 10min | 3 tasks | 5 files |
| Phase 01 P06 | 16min | 3 tasks | 10 files |
| Phase 01 P07 | 5min | 2 tasks | 4 files |
| Phase 01 P08 | 35min | 3 tasks | 8 files |
| Phase 01 P09 | 9min | 2 tasks | 2 files |
| Phase 02 P01 | 20min | 2 tasks | 6 files |
| Phase 02 P02 | 32min | 3 tasks | 7 files |
| Phase 02 P03 | 5min | 1 tasks | 2 files |
| Phase 02 P04 | 23min | 3 tasks | 10 files |
| Phase 02 P05 | 7min | 3 tasks | 9 files |
| Phase 02 P06 | 7min | 3 tasks | 8 files |
| Phase 03 P01 | 20min | 3 tasks | 11 files |
| Phase 03 P02 | 13min | 2 tasks | 5 files |
| Phase 03 P03 | 10min | 3 tasks | 6 files |
| Phase 03 P04 | 15min | 3 tasks | 4 files |
| Phase 04 P01 | 6min | 2 tasks | 2 files |
| Phase 04 P02 | 14min | 3 tasks | 8 files |
| Phase 04 P03 | 12min | 2 tasks | 2 files |
| Phase 04 P04 | 22min | 2 tasks | 3 files |
| Phase 04 P05 | 18min | 3 tasks | 10 files |
| Phase 05 P01 | 6min | 3 tasks | 4 files |
| Phase 05 P02 | 18min | 2 tasks | 8 files |
| Phase 05 P03 | 13min | 2 tasks | 2 files |
| Phase 05 P04 | 14min | 2 tasks | 5 files |
| Phase 05 P05 | 8min | 2 tasks tasks | 6 files files |
| Phase 06 P01 | 9min | 2 tasks | 4 files |
| Phase 06 P02 | 25min | 2 tasks | 9 files |
| Phase 06 P03 | 18min | 3 tasks | 8 files |
| Phase 06 P05 | 24min | 2 tasks | 5 files |
| Phase 06 P06 | 10min | 2 tasks | 4 files |
| Phase 06-internal-tracking-analytics P04 | 30min | 2 tasks | 6 files |
| Phase 06 P07 | 12min | 2 tasks | 3 files |
| Phase 06 P08 | 9min | 2 tasks | 4 files |
| Phase 07 P01 | 2min | 1 tasks | 0 files |
| Phase 07-qr-codes-static-dynamic-qr-studio P02 | 16 min | 3 tasks | 6 files |
| Phase 07-qr-codes-static-dynamic-qr-studio P03 | 21min | 3 tasks | 4 files |
| Phase 07 P04 | 20min | 3 tasks | 3 files |
| Phase 07-qr-codes-static-dynamic-qr-studio P06 | 55min | 3 tasks | 5 files |
| Phase 07 P07 | 25min | 3 tasks | 5 files |
| Phase 07 P08 | 20min | 3 tasks | 5 files |
| Phase 07 P09 | 20min | 2 tasks | 2 files |
| Phase quick-260724-ecl P01 | 15min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Redirect Engine split into its own dedicated phase (5) from Links Management (4), per research's pitfall-density recommendation.
- Roadmap: Bulk CSV Import folded into Links Management (4) rather than a standalone phase, to avoid a single-requirement phase.
- Roadmap: TEAM-06 (domain-scoped authorization enforcement) placed in Phase 9, where it can be proven end-to-end against real Links/QR/Analytics resources — the underlying `requireDomainAccess` helper itself is built in Phase 2, ahead of the routes it must gate.
- [Phase 01]: allowBuilds extended to @prisma/engines and esbuild (beyond prisma/@prisma/client) - both required for pnpm -r build to succeed; testcontainers unused SSH-remote-docker deps (cpu-features/protobufjs/ssh2) left unapproved
- [Phase 01]: Dropped vue-tsc from apps/web (incompatible with typescript@7.0.2); typecheck now runs plain tsc --noEmit against a *.vue module shim
- [Phase 01]: Prisma 7.8.0 (point release beyond CLAUDE.md/RESEARCH.md) requires prisma.config.ts for datasource.url and an @prisma/adapter-pg driver adapter on PrismaClient construction - both added in 01-03; Phase 2's better-auth adapter must follow the same new PrismaClient({ adapter }) pattern — Bare new PrismaClient() and schema.prisma datasource.url no longer type-check/validate against the actually-installed Prisma 7.8.0
- [Phase 01]: 01-04: SMTP_FROM schema validated as z.email() (bare address) — RESEARCH.md's own .env.example example used the RFC5322 'Name <email>' header format while its Pattern 2 code sample used z.email(); resolved in favor of the schema.
- [Phase 01]: 01-04: loadEnv() is an explicit boot-time call (not a top-level side-effecting env.ts export) so importing env.ts never triggers process.exit(1) as an import side effect.
- [Phase 01]: 01-05: PrismaPg adapter pinned to pool max:1 for per-test BEGIN/ROLLBACK isolation - @prisma/adapter-pg's per-statement pool.query() can otherwise route BEGIN/ROLLBACK to different connections, silently breaking isolation
- [Phase 01]: 01-05: Vitest globalSetup confirmed empirically (A3) to start exactly one shared testcontainers Postgres per vitest run invocation, reused across multiple worker processes
- [Phase 01]: 01-06: buildApp() accepts an injectable prisma override so integration tests reuse setupFileEach.ts's transaction-wrapped client (GET /api/canary sees rows written by an earlier POST in the same rolled-back test transaction) — Routes hard-importing db.ts's singleton would use a separate un-rolled-back connection, leaking writes across tests
- [Phase 01]: 01-06: server.ts dynamically imports app.ts after loadEnv() so db.ts's module-level PrismaClient construction never runs ahead of fail-fast ENV validation (D-06)
- [Phase 01]: 01-07: GET /api/canary's { total, latest } response is typed as a local CanaryStatus in api.ts, not the shared CanaryResult DTO (which only matches POST's { token, total }) - avoids silently mistyping a field that doesn't exist on the GET response
- [Phase 01]: 01-07: apps/web/tsconfig.json adds "DOM" to compilerOptions.lib (app-local) - the first real browser fetch() call in the SPA needed fetch/Response types beyond the workspace base tsconfig's ES2022-only lib
- [Phase 01]: 01-08: pnpm deploy requires --legacy under pnpm 11's default injected-workspace mode for Docker-safe production output
- [Phase 01]: 01-08: postgres:18-alpine's named volume must mount at /var/lib/postgresql (not .../data) - image manages its own major-version-specific subdirectory; confirmed empirically, RESEARCH.md example predates this behavior change
- [Phase 01]: 01-08: prisma generate needs a placeholder DATABASE_URL at Docker build time since prisma.config.ts resolves it eagerly via env(), even though generate never connects to a DB
- [Phase 01]: 01-09: Split CI into a fast test job (workspace-only) and a smoke job (needs: test) that builds the Docker image and runs the compose boot/persistence smoke scripts
- [Phase 01]: 01-09: Reused the Dockerfile's placeholder-DATABASE_URL trick for CI's explicit prisma generate step since prisma.config.ts resolves DATABASE_URL eagerly via env() even for a connection-less generate call
- [Phase 02]: 02-01: Operator-approved supply-chain sign-off for better-auth, @fastify/rate-limit, @fastify/helmet, @better-auth/cli at CLAUDE.md-pinned versions (T-02-SC-Gate)
- [Phase 02]: 02-01: better-sqlite3 (transitive optional dep of better-auth's bundled kysely/drizzle adapters) set to allowBuilds: false in pnpm-workspace.yaml - Postgres-only project, same no-blanket-lifecycle-script rationale as Phase 1's cpu-features/protobufjs/ssh2
- [Phase 02]: 02-02: auth.ts/mailer.ts read process.env directly with a requireEnv() guard (matching db.ts), not loadEnv() — avoids crashing tests that only set a placeholder DATABASE_URL
- [Phase 02]: 02-02: Confirmed empirically that better-auth/adapters/prisma re-exports the bundled @better-auth/prisma-adapter package (RESEARCH OQ-2 resolved) — no direct adapter dependency added
- [Phase 02]: 02-02: User table doubles as the invite-only allowlist (RESEARCH OQ-3 resolved) — no separate AllowedEmail table; DomainMembership composite PK (userId,domainId) built for 02-03's requireDomainAccess
- [Phase 02]: 02-03: requireDomainAccess/scopedDomainIds signature frozen exactly as researched — (prisma,userId,domainId,minRole)/(prisma,userId), zero route callers this phase
- [Phase ?]: lib/auth.ts refactored from a singleton to a createAuth(prisma) factory (auth=createAuth(defaultPrisma) kept for production) so tests can bind auth writes to the same transaction-wrapped Prisma client as the rest of the harness
- [Phase ?]: The tight magic-link rate limit is applied via a separate, more specific static route (POST /api/auth/sign-in/magic-link) ahead of the /api/auth/* wildcard catch-all, scoping it without touching other better-auth endpoints
- [Phase ?]: vitest.config.ts test env extended with BASE_URL/BETTER_AUTH_SECRET/SMTP_* placeholders since app.ts now transitively imports lib/auth.ts/lib/mailer.ts for every test file calling buildApp()
- [Phase ?]: [Phase 02]: 02-05: theme store's watch() uses flush:'sync' so body[data-theme]/localStorage stay synchronously consistent with the reactive theme ref (Pinia/Vue's default 'pre' flush would defer the DOM write to a microtask)
- [Phase ?]: [Phase 02]: 02-05: getSession() normalizes better-auth's raw null|{session,user} get-session response into the shared AuthSession DTO at the api.ts boundary, not left for stores/components to interpret
- [Phase ?]: [Phase 02]: 02-06: main.ts awaits router.isReady() before app.mount() so the beforeEach guard's redirect always resolves before App.vue's first render (no flash of a protected view for unauthenticated users)
- [Phase ?]: [Phase 02]: 02-06: test/App.test.ts rewritten (not deleted) for App.vue's new layout-switching behavior since the Phase 1 walking-skeleton canary UI it tested was fully replaced
- [Phase ?]: [Phase 03]: 03-01: prisma migrate dev refuses to run non-interactively even with --create-only on any confirmation-shaped warning (e.g. unique constraint on an empty table) — authored the migration via prisma migrate diff (temporary shadowDatabaseUrl, reverted) against a throwaway container, applied non-interactively via prisma migrate deploy
- [Phase ?]: [Phase 03]: 03-01: domainsRoute(prisma, auth) domain creation bootstraps its own owner DomainMembership in a single $transaction (RESEARCH A1) — the one exception to requireDomainAccess since no domainId exists pre-creation
- [Phase ?]: verifyDomain treats DNS mismatches as expected non-error outcomes; only lookup failures (ENOTFOUND/ENODATA/DNS_TIMEOUT) populate error
- [Phase ?]: GET /:id/instructions is admin-gated (not just any member) since it discloses the operator's exact DNS target for a domain
- [Phase ?]: A failed verify leaves verifiedAt untouched — only a successful check ever stamps it, preserving pending-vs-has-failed-before information
- [Phase 03]: 03-03: resolveActiveDomainByHost/GET /api/tls-check kept exactly to RESEARCH Pattern 4/3's spec — frozen signature for Phase 5 redirect engine reuse — Deny-by-default host guard + operator-delegated TLS ask endpoint satisfies DOMAIN-03 and Success Criterion 4 without deviation
- [Phase 03]: 03-03: reverse-proxy.md's Caddy example uses ask-only form (no interval/burst), Domain.status is the authoritative gate — RESEARCH State of the Art flags interval/burst as deprecated in favor of Caddy's permission module
- [Phase 03]: 03-04: ApiError class (extends Error, carries .status) added to api.ts so DomainsView can map 409/429 to exact locked copy; all prior throw sites migrated for consistency
- [Phase 03]: 03-04: verify failures (DNS-mismatch or 429) render as an inline .verify-error-row under the domain row, never a toast — only a successful verify toasts, per 03-UI-SPEC.md's DNS-Verify-Interaction contract
- [Phase ?]: Operator-approved supply-chain sign-off for csv-parse and nanoid at RESEARCH-pinned versions (T-04-SC-Gate)
- [Phase ?]: No pnpm-workspace allowBuilds entry needed for csv-parse/nanoid - neither introduced a build-script-requiring transitive dependency
- [Phase ?]: [Phase 04]: 04-02: prisma migrate dev ran non-interactively for the additive Link CREATE TABLE (no confirmation-shaped warning) - the migrate-diff/deploy workaround from 03-01 remains the fallback for future ALTER-shaped migrations
- [Phase ?]: [Phase 04]: 04-02: GET /api/links silently narrows an out-of-scope ?domainId= to [] rather than 403ing, matching GET /api/domains's scope-silently-never-leak convention
- [Phase ?]: resolveOwnedLink stays route-layer plumbing in routes/links.ts (not lib/links.ts's D-01 core) — composes requireDomainAccess with a link-specific lookup, not a shared validation rule.
- [Phase ?]: PATCH's title: null currently means 'keep existing title' (not clear it) since updateLink's ValidatedLink.title has no null variant and lib/links.ts is out of this plan's files_modified scope.
- [Phase 04]: runImport(mutate) shared by preview/commit reuses @kurzly/shared LinkSkipReason/ImportRowResult types instead of redeclaring them locally
- [Phase ?]: [Phase 04]: 04-05: ApiError extended with an optional code field (best-effort parsed from the JSON error body) so LinkFormModal can precisely map inline field errors (INVALID_TARGET_URL vs SLUG_RESERVED both share HTTP 400) instead of relying on status alone.
- [Phase ?]: [Phase 04]: 04-05: mapLinkFormError lives in api.ts, not inside LinkFormModal.vue's SFC — the generic declare module "*.vue" shim only declares a default export, so a named SFC export would not type-check under plain tsc --noEmit (no vue-tsc in this repo).
- [Phase ?]: [Phase 04]: 04-05: Toast-then-delayed-navigate (~900ms) for LinkDetailView's delete and LinksImportView's commit preserves the strict per-view-ref/no-global-store toast convention while still showing the toast before the view unmounts on navigation.
- [Phase ?]: Operator-approved supply-chain sign-off for bcryptjs/isbot/@fastify/cookie (T-05-SC); no allowBuilds entry needed
- [Phase ?]: BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST added as optional fail-safe-defaulted env keys mirroring CNAME_TARGET/A_RECORD_IP pattern
- [Phase ?]: [Phase 05]: 05-02: prisma migrate dev ran non-interactively for all three additive/nullable/defaulted Link columns (passwordHash/expiresAt/forwardQuery) - RESEARCH Pitfall 3's prediction confirmed, no migrate-diff/deploy workaround needed
- [Phase ?]: [Phase 05]: 05-02: PASSWORD_HASH_COST read directly from process.env inside lib/links.ts (not loadEnv()), matching domains.ts's computeVerificationTarget raw-env-read convention, so the module works under Vitest with the same default (11)
- [Phase ?]: [Phase 05]: 05-02: blank-string password on PATCH mapped to undefined ('keep') in the route layer, not lib/links.ts's core, keeping the D-01 core's three-state (undefined/null/value) contract uniform for both create and update callers
- [Phase ?]: [Phase 05]: 05-02: expiresAt day-granularity resolved as UTC end-of-day (23:59:59.999Z) - simplest/most predictable for a self-hosted tool with no per-user timezone model
- [Phase ?]: [Phase 05]: 05-03: formatExpiryDate uses UTC getters (not local time) matching 05-02's UTC end-of-day expiresAt persistence convention
- [Phase ?]: [Phase 05]: 05-03: BRAND_ACCENT interpolated raw (unescaped) into inline <style> CSS custom property - escaping would corrupt the CSS value; BRAND_NAME IS escaped anyway as free defensive consistency
- [Phase ?]: [Phase 05]: 05-03: renderBotOgPage builds its own minimal head/body document rather than reusing the visitor-page wrapper - bot-OG path is structural per 05-UI-SPEC section 4, not a fourth visual screen
- [Phase ?]: [Phase 05]: 05-04: resolveLinkState/mergeQuery take Pick<Link,...> input types (type-only import) instead of the full Prisma Link model, keeping the module's zero-DB-access contract unambiguous
- [Phase ?]: [Phase 05]: 05-04: unlockCookie.ts imports @fastify/cookie only for its declare module 'fastify' type-augmentation side effect - the plugin itself is registered by the route layer in 05-06
- [Phase ?]: [Phase 05]: 05-04: VERIFY_RATE_LIMIT_PER_LINK keyGenerator typed against a local RateLimitKeyRequest structural type, not FastifyRequest, keeping it Fastify-free and directly unit-testable with a stub
- [Phase ?]: [Phase 05]: 05-05: handleSubmit's password/expiresAt keep-vs-clear ternary kept local to LinkFormModal.vue (mirrors 05-02's PATCH three-state contract) rather than a shared helper - only the modal computes it, parent views just forward the emitted payload
- [Phase ?]: [Phase 05]: 05-05: accordion header summary date formatted via plain YYYY-MM-DD string split (no Date object), avoiding the TZ off-by-one 05-03/05-04 already worked around
- [Phase 06]: 06-01: Operator-approved supply-chain sign-off for maxmind@^5.0.6 (T-06-SC); allowBuilds entry added only if an ignored-build-script warning surfaces
- [Phase 06]: 06-01: GEOIP_DB_PATH/CLICK_RETENTION_DAYS added with no .default() (unlike CNAME_TARGET/BRAND_NAME/PASSWORD_HASH_COST) - absence must mean the tracking feature is off
- [Phase ?]: [Phase 06]: 06-02: prisma migrate dev ran non-interactively for the entire additive schema change (2 new Link columns, 1 new enum, 2 new tables) - no confirmation-shaped warning, matching 05-02's precedent; authored against a throwaway postgres:18-alpine container since no persistent local dev Postgres was running
- [Phase ?]: [Phase 06]: 06-02: trackingEnabled threaded through lib/links.ts's D-01 sole write path exactly like forwardQuery - a plain optional boolean, no tri-state derivation needed; lifetimeClicks is server-owned and never allowlisted on any Zod schema (T-06-MASS)
- [Phase ?]: [Phase 06]: 06-03: apps/api/test/geoip.test.ts nutzt MaxMinds offizielle MMDB-Spec-Testdatenbank (Apache-2.0, committed als test/fixtures/GeoIP2-Country-Test.mmdb) statt zur Testzeit die Produktions-DB-IP-Datei herunterzuladen - deterministisch, keine Netzwerkabhaengigkeit im Testlauf, klar getrennt von der Docker-Build-Artefakt-DB
- [Phase ?]: [Phase 06]: 06-03: vi.resetModules() + dynamischer Re-Import pro Testfall in geoip.test.ts, um den lazy-Singleton-.mmdb-Reader fuer jeden Testfall (bekannte IP / fehlende DB / unset GEOIP_DB_PATH) unabhaengig neu zu initialisieren
- [Phase ?]: [Phase 06]: 06-05: null referrerHost/country kept null through lib/analytics.ts's SQL layer (not COALESCEd to 'Direkt'/'Unbekannt' in SQL) - RESEARCH Pattern 5's example conflicted with its own Anti-Patterns rule; the Anti-Pattern (translate only at the view boundary) was followed
- [Phase ?]: [Phase 06]: 06-05: getGlobalAnalytics's empty-domainIds short-circuit returns a locally-computed 30-entry zero series rather than an empty array, so the fixed-30-bar chart contract holds even with zero domain memberships
- [Phase ?]: [Phase 06]: 06-05: source='qr' comparison uses an explicit ::ScanSource cast on the bound parameter - a bound text parameter against a native Postgres enum column needs an explicit cast
- [Phase ?]: [Phase 06]: 06-06: initialTrackingEnabled prop uses withDefaults(..., { initialTrackingEnabled: true }) instead of props.x ?? true - Vue casts an absent single-Boolean-type prop to false before setup() code runs, so a plain ?? default silently breaks for a true-by-default Boolean prop
- [Phase ?]: recordClickHook's lifetimeClicks increment is a documented second prisma.link.update call site (lifetimeClicks only, never link content fields) alongside lib/links.ts's updateLink
- [Phase ?]: Corrected the plan's literal single-call-site verify grep (over-counted generated Prisma client + prose) to the repo's established comment-filtered, generated-dir-excluded convention
- [Phase ?]: [Phase 06]: 06-07: toggleTracking mutates the reactive LinkDTO ref's trackingEnabled in place for the optimistic flip (not a separate boolean ref) - reverts the same in-place mutation on PATCH failure, replaces link.value with the server response on success
- [Phase ?]: [Phase 06]: 06-07: row-pct in the Referrer/Laender list rows renders as a rounded percentage string ('42%') - the UI-SPEC/prototype only labels the field '.row-pct' without locking an exact format
- [Phase ?]: [Phase 06]: 06-08: toListRows() Helper in AnalyticsView.vue generalisiert auf countOf/idOf-Callbacks statt fixem count-Feld - GlobalAnalyticsDTO.topLinks traegt clicks, nicht count
- [Phase 07]: 07-01: Operator-approved supply-chain sign-off for qrcode, sharp, jsqr, @types/qrcode (T-07-SC) — sharp's [SUS] too-new flag confirmed false-positive (12yr-old, 74.8M/week package); jsqr's [ASSUMED] provenance confirmed OK against github.com/cozmo/jsQR, devDependency/zero-deps only
- [Phase ?]: 07-02: Authored the add_qr_codes migration against a throwaway ad hoc postgres:18-alpine container (host port 15432), not the docker-compose db service which has no host port mapping — Matches the established project pattern from 03-01/05-02/06-02 for authoring Prisma migrations outside the testcontainers-per-test-run harness
- [Phase ?]: 07-02: Added test/qr-schema-push.test.ts (Rule 2 deviation) to prove QrCode/QrRemapHistory persist against real Postgres, satisfying the plan's must_haves.truths and mirroring the schema-push.test.ts/tracking-schema-push.test.ts precedent — No task explicitly requested this file, but every prior schema-migration plan in this codebase ships an analogous proof test
- [Phase 07-qr-codes-static-dynamic-qr-studio]: Added white background + ISO/IEC 18004 4-module quiet zone to buildModuleSvg — Light modules were fully transparent, giving near-zero luminance contrast that broke jsQR decode once a logo was composited; also needed for real-world scanner reliability
- [Phase 07-qr-codes-static-dynamic-qr-studio]: Logo tile fixed at 46/196 linear fraction of the full rendered dimension, shared by both PNG composite and SVG image-injection paths — Keeps PNG and SVG logo geometry identical and well under EC-H's damage budget
- [Phase ?]: QrCode's UNAUTHORIZED_DOMAIN maps to HTTP 404 (not Link's 403) since its domain boundary is never client-visible
- [Phase ?]: Dynamic /q code generation reuses generateSlug/AUTO_SLUG_RETRY_LIMIT from lib/links.ts verbatim (same 7-char Base62 shape), no re-derivation
- [Phase ?]: issueUnlockCookie now takes an explicit cookiePath instead of deriving /${slug} internally — so /:slug and /q/:code get independent, correctly path-scoped unlock cookies for the same Link
- [Phase ?]: QrCode.lifetimeScans increments unconditionally on every completed /q/:code scan — independent of the target Link's trackingEnabled preference (unlike the ClickEvent write) since it is a QR-code-level scan counter, not a privacy-sensitive per-visit event
- [Phase 07-qr-codes-static-dynamic-qr-studio]: 07-07: apps/web/src/api.qr.test.ts added (Rule 2, MVP+TDD gate) to give Task 1's api.ts additions a RED/GREEN home; no api.test.ts precedent existed in this codebase
- [Phase 07-qr-codes-static-dynamic-qr-studio]: 07-07: QrCodeDTO has no embedded remap history - fetched per dynamic QR via getQrRemapHistory on load (reversed to newest-first), extended locally with a synthetic entry after each successful remap
- [Phase 07-qr-codes-static-dynamic-qr-studio]: 07-07: Studio panel left as a header-only placeholder (title + code) for 07-08 to fill with preview/controls/export
- [Phase 07]: 07-09: RED/GREEN commit order swapped (test authored first) to satisfy the MVP+TDD gate - mirrors 07-07/07-08 precedent — Plan's Task 1 (implementation) preceded Task 2 (test); tdd=true requires a preceding failing test commit
- [Phase 07]: 07-09: existing-static-QR lookup uses listQrCodes() + client-side filter (variant/linkId) since GET /api/qr-codes has no by-link query param — No backend change was in scope for this frontend-only plan
- [Phase 07]: 07-09: added a fallback failure toast for handleQrCode's catch branch — Matches every other async action in LinkDetailView.vue; the UI-SPEC only locks the success toast
- [Phase ?]: Both smoke scripts' auto-create .env branch now generates a real openssl-rand BETTER_AUTH_SECRET (sed with | delimiter) instead of copying .env.example's rejected placeholder

### Pending Todos

None yet.

### Blockers/Concerns

- REQUIREMENTS.md's traceability summary previously stated "47 v1 requirements" — an actual count found 53 distinct v1 requirement IDs across the 10 categories. Traceability table has been corrected to 53/53 mapped. Flagging in case "47" was an intentional target that implies some listed items should have been out-of-scope — worth a quick confirmation with the user.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260724-d1m | Fix LinkDetailView edit-submit dropping trackingEnabled | 2026-07-24 | 7f15d45 | [260724-d1m-fix-linkdetailview-edit-submit-dropping-](./quick/260724-d1m-fix-linkdetailview-edit-submit-dropping-/) |
| 260724-d5o | Add UTM field coverage to team domain denial test suite | 2026-07-24 | 0c0bf4d | [260724-d5o-add-utm-field-coverage-to-team-domain-de](./quick/260724-d5o-add-utm-field-coverage-to-team-domain-de/) |
| 260724-d72 | Enforce one-static-QR-per-link with DB unique index and conflict error code | 2026-07-24 | 9edf583 | [260724-d72-enforce-one-static-qr-per-link-with-db-u](./quick/260724-d72-enforce-one-static-qr-per-link-with-db-u/) |
| 260724-d6y | Add delete path for QR codes | 2026-07-24 | 5c8265b | [260724-d6y-add-delete-path-for-qr-codes](./quick/260724-d6y-add-delete-path-for-qr-codes/) |
| 260724-ecl | Fix CI smoke tests crashing app container | 2026-07-24 | ee9fca4 | [260724-ecl-fix-ci-smoke-tests-crashing-app-containe](./quick/260724-ecl-fix-ci-smoke-tests-crashing-app-containe/) |
| 6 | Bump GitHub Actions to current majors (checkout v7, setup-node v7, pnpm/action-setup v6) | 2026-07-24 | fcbfc3f | — |
| 260724-fmm | Add GitHub Actions workflow to build and publish production Docker image to GHCR | 2026-07-24 | a22c687 | [260724-fmm-add-github-actions-workflow-to-build-and](./quick/260724-fmm-add-github-actions-workflow-to-build-and/) |
| 260724-gsf | Add semantic-release automated SemVer releases with GHCR publish on release | 2026-07-24 | eeb6362 | [260724-gsf-add-semantic-release-automated-semver-re](./quick/260724-gsf-add-semantic-release-automated-semver-re/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-24T08:36:16.092Z
Stopped at: Completed 07-09-PLAN.md
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
