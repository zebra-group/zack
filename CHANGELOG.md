## [1.3.2](https://github.com/zebra-group/zack/compare/v1.3.1...v1.3.2) (2026-08-05)


### Bug Fixes

* **deps:** bump @fastify/rate-limit from 11.1.0 to 11.2.0 ([#5](https://github.com/zebra-group/zack/issues/5)) ([d91d84c](https://github.com/zebra-group/zack/commit/d91d84ce12508868a79c9ada9ebe32f31b0b81fa))
* **deps:** bump better-auth from 1.6.23 to 1.6.25 ([#7](https://github.com/zebra-group/zack/issues/7)) ([c52914a](https://github.com/zebra-group/zack/commit/c52914a0dab690372463b07dbc1a1ec24d7e59de))
* **deps:** bump fastify from 5.10.0 to 5.11.0 ([#4](https://github.com/zebra-group/zack/issues/4)) ([b0c4552](https://github.com/zebra-group/zack/commit/b0c4552a66f8131388cc984527c4c308dd4edde7))

## [1.3.1](https://github.com/zebra-group/zack/compare/v1.3.0...v1.3.1) (2026-08-05)


### Bug Fixes

* **deps:** close 17 alerts from the 2026-08-03 advisory batch ([6932f6d](https://github.com/zebra-group/zack/commit/6932f6dd6d3365320d93b5e32181b5db958c1eed))
* **deps:** pin the undici 8.x and fast-uri 4.x majors too ([a37bb0e](https://github.com/zebra-group/zack/commit/a37bb0e53ba78f17cc1b94f509db0cf4fad5b771))

# [1.3.0](https://github.com/zebra-group/zack/compare/v1.2.0...v1.3.0) (2026-08-05)


### Bug Fixes

* **quick-260805-k2u:** add required DB-IP attribution to the analytics view ([6215841](https://github.com/zebra-group/zack/commit/621584124408671876c1033e4b0e21f6d367beb5))


### Features

* **quick-260805-jcs:** license Zack under AGPL-3.0 ([be50496](https://github.com/zebra-group/zack/commit/be5049662b9adf324fbd3e293d66a1a6e40c15a2))

# [1.2.0](https://github.com/zebra-group/zack/compare/v1.1.1...v1.2.0) (2026-08-05)


### Features

* **quick-260804-oln:** rename unlock-cookie prefix and theme storage key to zack

## [1.1.1](https://github.com/zebra-group/zack/compare/v1.1.0...v1.1.1) (2026-07-28)


### Bug Fixes

* **deps:** close remaining brace-expansion DoS alert ([#27](https://github.com/zebra-group/zack/issues/27))
* **deps:** resolve dependabot security alerts via override and unused-devDependency removal

# [1.1.0](https://github.com/zebra-group/zack/compare/v1.0.2...v1.1.0) (2026-07-26)


### Bug Fixes

* **11:** CR-01 exclude @kurzly/e2e from root recursive test job
* **11:** CR-02 gate E2E rate-limit bypass on non-production nodeEnv
* **11:** CR-03 pin resetDb's advisory lock to a single connection via $transaction
* **11:** CR-04 widen db-isolation.spec.ts's critical section to cover create+read, not just the truncate
* **11:** CR-05 stop E2E_COMPOSE_OVERLAY-marked E2E boots from crash-looping under NODE_ENV=production
* **11:** CR-06 disable better-auth's own internal rate limiter (double-gated the E2E bypass)
* **11:** CR-07 dashboard SPA routes 404 through the redirect engine on hard navigation
* **11:** IN-02 remove now-dead resetDb() truncate-only wrapper
* **11:** WR-01 make release job depend on e2e passing
* **11:** WR-02 make smoke project depend on setup to avoid shared-email magic-link race
* **11:** WR-03 fail boot loudly if E2E_RATE_LIMIT_BYPASS_SECRET is present under NODE_ENV=production
* **11:** WR-04 extract shared isE2EComposeOverlay() helper (dedupe CR-05 marker check)
* **12-05:** parse application/x-www-form-urlencoded on POST /:slug/verify
* **12:** WR-01 apply fetchWithFixtureRaceRetry consistently across password-gate and bot-og-render specs
* **12:** WR-02 add unit test coverage for fetchWithFixtureRaceRetry
* **12:** WR-03 log discarded retry attempts and inspect them for canary leaks
* **12:** WR-04 add regression test proving the urlencoded content-type parser stays scoped to POST /:slug/verify
* **13-07:** add openid/email/profile scopes to genericOAuth config
* **13-08:** add account.accountLinking to merge invited-unverified users on SSO
* **13:** CR-01 document SSO email_verified gate and add rejection test coverage
* **13:** WR-01 declare @koa/router as a direct oidc-mock dependency
* **13:** WR-02 document verified allowList/rate-limit isolation in resend-rate-limit.spec.ts
* **13:** WR-03 fail loudly when E2E_RATE_LIMIT_BYPASS_SECRET is unset
* **14-review:** WR-01 log retry attribution for whole-test db-race retries
* **14-review:** WR-02 add RFC 4180 CSV field escaping to buildImportCsv
* **15-01:** correct requirements frontmatter to [] for Wave 0 infra plan
* **15-review:** WR-01 document coarse whole-test-retry tradeoff in QR specs
* **15-review:** WR-02 assert persisted style fields after QR customization
* **16-review:** WR-01 harden Top Links rollup spec against shared-domain top-5 flakiness
* **17-review:** CR-01 add missing storageState: undefined to team-invite-accept.spec.ts's acceptance context
* **17-review:** WR-01 teardown fixture rows created by phase-17 specs
* **ci:** generate Prisma client in the e2e job before running Playwright
* **ci:** resolve D-17-05-01 rate-limit-bucket exhaustion in the full E2E suite
* **ci:** resolve D-17-05-02 residual E2E 429s on /health and OIDC callback
* **e2e:** add missing @types/node devDependency
* **security:** bump @fastify/static to 10.1.2


### Features

* **11-01:** add prisma-client subpath export to apps/api
* **11-01:** scaffold @kurzly/e2e workspace package with Playwright config
* **11-02:** extend registerRateLimit with env-gated x-e2e-bypass allowList
* **11-03:** add docker-compose.e2e.yml additive overlay
* **11-03:** add scripts/e2e-compose.sh boot/run/always-teardown entrypoint
* **11-04:** E2E DB helper — reused Prisma client, FK-safe resetDb, least-privilege seedBaseline
* **11-04:** Mailpit REST client + Playwright global-setup/global-teardown wiring
* **11-05:** auth.setup.ts real magic-link round trip per role, storageState fixture
* **11-06:** wire the Playwright e2e job into CI after test/smoke
* **12-02:** implement apps/e2e/src/links.ts raw-insert fixture helper + shared vocabulary
* **13-01:** create apps/e2e/oidc-mock package (Task 2)
* **13-01:** wire oidc-mock into docker-compose.e2e.yml + app OIDC env (Task 3)
* **13-02:** add allowlisted + invited-unverified User fixtures
* **13-02:** add typed mock-IdP control client
* **13-02:** register standalone auth Playwright project
* **13-03:** magic-link round trip proves an active, server-verified session
* **13-03:** reject consumed/expired/malformed magic-link tokens
* **13-04:** AUTH-E2E-03 -- non-invited email gets zero email and zero session
* **13-05:** AUTH-E2E-06 — logout ends session, unauthenticated access redirects to /login
* **13-06:** AUTH-E2E-07 tripped rate limit shows exact German UI copy
* **14-01:** implement apps/e2e/src/csv.ts buildImportCsv fixture builder
* **14-02:** LINKS-E2E-01 canonical link lifecycle through the real UI
* **14-03:** LINKS-E2E-02 CSV import happy path (preview -> commit, DB-asserted)
* **14-04:** LINKS-E2E-03 CSV import slug conflict (preview surfaces it, commit skips it)
* **15-01:** implement apps/e2e/src/qr.ts createE2eQrCode + decodeQrImage, closes [#000000](https://github.com/zebra-group/zack/issues/000000)
* **15-02:** QR-E2E-01 static QR create+customize+decode round-trip
* **15-03:** QR-E2E-02 dynamic /q/:code remap A->B + ordered history
* **17-01:** TEAM-E2E-01 real-UI invite -> Mailpit -> accept -> status flip
* **17-02:** TEAM-E2E-02 role/domain reassignment reaches member's own re-navigated session

## [1.0.2](https://github.com/zebra-group/zack/compare/v1.0.1...v1.0.2) (2026-07-24)


### Bug Fixes

* **quick-260724-uiversion:** show the actual deployed version instead of a hardcoded UI literal

## [1.0.1](https://github.com/zebra-group/zack/compare/v1.0.0...v1.0.1) (2026-07-24)


### Bug Fixes

* **quick-260724-qrlogo:** stop the decorative logo tile from masking a real saved logo
* **quick-260724-qrname:** make QR code names editable in the Studio panel

# 1.0.0 (2026-07-24)


### Bug Fixes

* **01:** allow compose-only POSTGRES_* keys in env drift guard
* **01:** WR-01 fail-fast db.ts on missing DATABASE_URL
* **01:** WR-03 run Docker runtime container as non-root node user
* **01:** WR-05 load dotenv in server.ts so pnpm dev reads .env
* **01:** WR-06 reject .env.example placeholder BETTER_AUTH_SECRET
* **01:** WR-07 make dev CORS opt-in for known non-production NODE_ENV values
* **02:** CR-01 close authorization fail-open on invalid role
* **02:** CR-02 route failed magic-link verification to D-05 error screen
* **02:** IN-01 document admin-seed's ?? email fallback as intentional
* **02:** IN-02 assert SameSite=Lax session cookie attribute in tests
* **02:** IN-03 redirect authenticated users away from /login
* **02:** WR-01 remove timing side-channel on neutral magic-link response
* **02:** WR-02 add TRUST_PROXY env and wire Fastify trustProxy
* **03:** CR-01 normalize hostname before persist + uniqueness check
* **03:** IN-01 add dedicated rate limit for POST /api/domains
* **03:** IN-02 de-duplicate CNAME_TARGET/A_RECORD_IP fallback literals
* **03:** WR-01 return 404 not 500 for malformed tls-check ?domain= param
* **03:** WR-02 add hostname format validation on domain creation
* **03:** WR-03 clear DNS-verify timeout timer when resolver settles first
* **04:** IN-02 make CSV import body size ceiling explicit
* **04:** IN-04 give a clear error when CSV headers don't match ziel_url/slug/domain
* **04:** WR-01/WR-02 stop silent slug regeneration and enable title:null clearing on PATCH
* **04:** WR-03 enforce Domain.status===active for manual create and CSV import
* **04:** WR-04 close the not-found/forbidden timing side channel in resolveOwnedLink
* **04:** WR-06 make auto-generated slugs honor RESERVED_SLUGS too
* **04:** WR-07 give slug shape failures a distinct SLUG_INVALID_SHAPE error code
* **04:** WR-08 debounce link search and discard out-of-order responses
* **04:** WR-09 surface unmapped create/edit errors via toast instead of failing silently
* **04:** WR-10 stop CSV commit from losing partial state on a mid-loop error
* **07-03:** reject non-hex QR colors to close SVG attribute-injection XSS, closes [RGB/#RRGGBB](https://github.com/zebra-group/zack/issues/RRGGBB)
* **07-10:** CR-01 encode the short-link URL in static QR codes
* **07-10:** CR-02 type every logo decode failure as InvalidLogoError
* **07-10:** WR-01 use one fit mode for the logo in both exports
* **07-10:** WR-02 resize the logo before embedding it in render.svg
* **07-12:** IN-01 make validateQrCodeInput private and name the real shared gate
* **07-12:** IN-03 encode the QR module matrix once per render
* **07-12:** IN-04 cancel the pending render debounce on QR switch and unmount
* **07-12:** IN-05 accept multi-parameter data URIs for logo uploads
* **07-12:** IN-07 shape-guard the /q/:code param before lookup or cookie write
* **07-12:** IN-08 give synthetic remap-history entries collision-free ids
* **07-12:** WR-03 align the client logo size cap with the server's
* **07-12:** WR-04 handle FileReader failure instead of dropping the rejection
* **07-12:** WR-05 keep optimistic QR style state local instead of mutating the prop
* **07-12:** WR-06 discard superseded QR style PATCH responses
* **07-12:** WR-08 clear logoEnabled alongside logoData on logo removal
* **08-06:** preload the OG image preview on edit-mode open
* **08-13:** CR-01 apply owner UTM params on password-unlock redirect in both handlers
* **08-13:** WR-01 preserve unset embedded utm keys in applyUtmParams and buildUtmPreview
* **09-02:** stop reusing seedInitialAdmin as a plain test-user fixture
* **09-08:** make inviteMember atomic so a failed membership write cannot orphan a User (WR-01)
* **09-08:** map lockout-guard P2028 contention to a typed CONFLICT (409), not a 500 (WR-02)
* **09-08:** stop inviteMember validating domainIds it discards on resend (WR-03)
* **10-06:** CR-01 normalize empty optional env vars to unset so verbatim .env.example boots SSO-off
* **10-06:** WR-02 send errorCallbackURL on SSO sign-in so callback failures reach /auth/error
* **api:** give each test file its own database
* **quick-260724-d1m:** thread trackingEnabled through LinkDetailView edit flow
* **quick-260724-ecl:** generate real BETTER_AUTH_SECRET in smoke scripts


### Features

* **01-02:** make packages/shared buildable and importable by both apps
* **01-02:** scaffold pnpm workspace root and install Phase 1 dependencies
* **01-02:** scaffold web build/test config and base API vitest/tsup config
* **01-03:** author Prisma schema, initial migration, and generated client
* **01-04:** add .env.example and schema-drift guard test
* **01-04:** implement fail-fast ENV validation module
* **01-05:** wire testcontainers Postgres globalSetup + per-test rollback
* **01-06:** Fastify app factory, health + redirect-stub routes, static SPA fallback, dev CORS
* **01-06:** implement PersistenceCanary read/write route (GREEN)
* **01-07:** wire Vue dashboard to live canary API via typed client
* **01-08:** multi-stage Dockerfile with migration-on-start entrypoint
* **01-08:** production compose (app+db) + dev-only Mailpit overlay
* **01-09:** add CI workflow running full suite on every change
* **02-01:** install auth/security packages and INITIAL_ADMIN_EMAIL ENV contract
* **02-02:** add better-auth instance, mailer, allowlist, and shared auth DTOs
* **02-02:** apply auth/domain schema to Postgres, regenerate client, prove queryability
* **02-02:** generate better-auth tables and add Domain/DomainMembership models
* **02-03:** implement requireDomainAccess/scopedDomainIds authorization core
* **02-04:** add @fastify/helmet + @fastify/rate-limit plugins (D-07)
* **02-04:** mount /api/auth/* + admin seed + extend registration order
* **02-05:** add authSession store + typed getSession/logout API client
* **02-05:** add LoginView (Idle/Sent) + AuthErrorView + component tests
* **02-05:** add theme engine — LOCKED tokens.css + Geist fonts + theme store
* **02-06:** App.vue/main.ts wiring + AppShell component test
* **02-06:** AppShell layout + Dashboard + Coming-soon views
* **02-06:** Vue Router with session-aware auth guard
* **03-01:** extend Domain schema with lifecycle fields + DomainDTO
* **03-01:** implement domainsRoute POST/GET /api/domains (DOMAIN-01)
* **03-02:** add CNAME_TARGET/A_RECORD_IP env vars + verify/tls-check rate limits
* **03-02:** add verify/delete/instructions routes, admin-gated + resolver-injected
* **03-02:** implement dnsClient.verifyDomain (injectable, SSRF-safe, timeout-bounded)
* **03-03:** add GET /api/tls-check ask endpoint, wire into app.ts
* **03-03:** add resolveActiveDomainByHost exact-match deny-by-default host guard
* **03-04:** build DomainsView and swap /domains to it
* **03-04:** extend typed API client with domain CRUD/verify/instructions
* **04-01:** install csv-parse and nanoid for links/CSV import
* **04-02:** add Link model, migration, shared DTOs, and link rate limits
* **04-02:** implement the D-01 single-write-path link core
* **04-02:** wire POST/GET /api/links routes into app.ts
* **04-03:** implement GET/DELETE /api/links/:id with the IDOR guard
* **04-03:** implement PATCH /api/links/:id via the validated updateLink core
* **04-04:** add CSV import preview/commit routes (GREEN)
* **04-04:** add runImport shared CSV import core to lib/links.ts
* **04-05:** LinkDetailView — attributes, placeholder stats, copy/edit/delete
* **04-05:** Links list — api client, routes, shared modal, search/filter/CRUD
* **04-05:** LinksImportView — file picker, live server-driven preview, commit
* **05-01:** add BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST env keys, closes [#d7ff01](https://github.com/zebra-group/zack/issues/d7ff01)
* **05-02:** add Link password/expiry/forwardQuery columns and migrate
* **05-02:** hash+persist+expose password/expiry/forwardQuery (GREEN)
* **05-03:** implement shared public-HTML render layer with escapeHtml
* **05-04:** implement botDetection, unlockCookie, and new rate-limit configs
* **05-04:** implement resolveLinkState + mergeQuery redirect engine
* **05-05:** add Security accordion + forwardQuery toggle to LinkFormModal
* **05-05:** thread password/expiresAt/forwardQuery through LinksView + LinkDetailView
* **05-06:** implement redirect precedence engine route with no-leak canary (GREEN)
* **06-01:** install maxmind and add GEOIP_DB_PATH/CLICK_RETENTION_DAYS env keys
* **06-02:** add click tracking schema and migration
* **06-02:** thread trackingEnabled through the single Link write path
* **06-03:** bake DB-IP Country Lite .mmdb into the Docker image
* **06-03:** implement local GeoIP country lookup with graceful degradation
* **06-03:** implement referrer + visitorHash privacy transforms
* **06-04:** add retention pruning + daily scheduler wiring (D-12)
* **06-04:** fill recordClickHook with atomic privacy-first click write
* **06-05:** add IDOR-guarded/session-gated analytics endpoints (TRACK-04/05)
* **06-05:** implement lib/analytics.ts parameterized aggregation (TRACK-04/05, D-10)
* **06-06:** add footer tracking toggle to LinkFormModal
* **06-06:** add Klicks column and Tracking-aus badge to LinksView
* **06-07:** add getLinkAnalytics typed API client
* **06-07:** replace LinkDetailView placeholder with live per-link analytics (Surface A)
* **06-08:** add global analytics overview (Surface B, TRACK-05)
* **06-08:** route /analytics to AnalyticsView
* **07-02:** add QrCode + QrRemapHistory models and migrate schema
* **07-02:** install qrcode, sharp (prod) and jsqr, @types/qrcode (dev) for @kurzly/api
* **07-03:** centered logo overlay with forced level-H, decode-verified for PNG and SVG
* **07-03:** module-matrix QR renderer with SVG/PNG parity and forced EC-H
* **07-04:** QrCode single-write-path create + validation + code generation
* **07-04:** QrCode style update + remap transaction + remap history
* **07-05:** QR management CRUD + remap routes with IDOR + mass-assignment guards
* **07-05:** QR render endpoints + validated logo upload with dedicated rate limit
* **07-06:** /q/:code dynamic redirect with gate reuse and qr scan tracking
* **07-06:** /q/:code password unlock flow reusing redirect verify
* **07-07:** optimistic QR remap + full remap-history expander
* **07-07:** QR web API client + route swap to QrCodesView
* **07-07:** QrCodesView list surface with four states and instant dynamic create
* **07-08:** QR Studio panel — preview, style controls, logo upload, export
* **07-09:** QR-Code entry point on link detail (create-or-deep-link)
* **07-11:** count scans of static QR codes (QR-07)
* **08-01:** add UTM + custom OG columns to Link with migration
* **08-01:** allowlist UTM/OG fields on the links HTTP surface
* **08-01:** validate and thread UTM/OG fields through the single write path
* **08-02:** applyUtmParams with owner-wins override and safe encoding
* **08-02:** serve owner-typed OG title/description/image to bots
* **08-03:** append owner UTM parameters when building the redirect target
* **08-03:** serve custom OG values to bots on both redirect handlers
* **08-04:** buildUtmPreview mirroring the server plus UTM/OG inline error mapping
* **08-04:** UTM builder section with live destination preview
* **08-05:** custom OG-tag section with input column and length guidance
* **08-05:** social-card live preview with debounced image and hatched fallback
* **08-06:** thread UTM/OG through link detail and add metadata chips
* **08-06:** thread UTM/OG through the links list and add attribute badges
* **09-01:** add global AccountRole enum, User.accountRole column, isAccountAdmin
* **09-01:** seed initial admin as account admin, expose accountRole in session
* **09-02:** account-admin bypass in requireDomainAccess/scopedDomainIds
* **09-03:** admin-gated GET /api/team + POST /api/team/invite
* **09-03:** team DTOs + lib/team.ts list/invite with emailVerified-derived status
* **09-04:** PATCH role / PUT domains / DELETE member routes with typed-error mapping
* **09-04:** team mutations with atomic promote-clear and lockout guards
* **09-06:** admin-only Team nav, requiresAdmin guard, TeamView route swap, listTeamMembers
* **09-06:** TeamView read-only member table + role-model card
* **09-07:** AssignDomainsModal and remove flow with last-admin lockout
* **09-07:** InviteMemberModal and invite flow with re-invite resend
* **09-07:** team mutation client + immediate role change with revert and last-admin guard
* **10-01:** add ssoConfig reader, SSO primitives, and SsoStatusDTO
* **10-01:** register optional OIDC env vars with all-three-or-none boot guard
* **10-02:** conditionally register genericOAuth OIDC when configured, least-privilege by default
* **10-03:** add read-only GET /api/sso/status endpoint
* **10-04:** add getSsoStatus client and /login preview escape hatch
* **10-04:** add read-only Authentifizierung section to TeamView
* **10-05:** add conditional Mit-SSO-anmelden login affordance initiating genericOAuth
* **260724-d6y-01:** add DELETE /api/qr-codes/:id route (WR-07)
* **260724-d6y-01:** add QR Studio delete action (WR-07)
* **260724-d72:** add partial unique index enforcing one static QR per link
* **260724-d72:** surface QR_ALREADY_EXISTS (409) from createQrCode (GREEN)
* **quick-260724-fmm:** add GHCR publish job to ci.yml
* **quick-260724-gsf-01:** add semantic-release config and pinned devDependencies
* **quick-260724-gsf-02:** replace publish job with tag-diff-gated release job in ci.yml
