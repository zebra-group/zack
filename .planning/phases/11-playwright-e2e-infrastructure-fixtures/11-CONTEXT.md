# Phase 11: Playwright E2E Infrastructure & Fixtures - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss — infrastructure-only phase (goal/success-criteria match the infra-detection rule: "infrastructure"/"fixtures" in scope, all success criteria technical — compose boots, spec passes, storageState reaches a route, CI job runs — no "user can/sees" language). Discuss ran non-interactively per the user's explicit instruction to proceed autonomously while AFK; recommended answers below were derived from the milestone's own STACK.md/ARCHITECTURE.md/PITFALLS.md research (already MEDIUM–HIGH confidence, first-party-grounded) rather than presented for accept/override.

<domain>
## Phase Boundary

Stand up a Playwright E2E harness that runs against the production-shape built Docker image (not dev servers), with real email capture (Mailpit), real-database isolation separate from the existing Vitest testcontainers harness, per-role authenticated session fixtures, CI wiring, and a narrow rate-limit test bypass. No feature specs are written in this phase — Phase 12 onward consume this foundation. Nothing in this phase is user-facing; it is pure test infrastructure (INFRA-01..06).

</domain>

<decisions>
## Implementation Decisions

### Workspace & config layout
- New pnpm workspace package `apps/e2e` (`@kurzly/e2e`), sibling to `apps/api`/`apps/web` — already covered by `pnpm-workspace.yaml`'s `apps/*` glob, zero workspace-config changes needed. Do NOT put a root-level `playwright.config.ts` — matches the existing per-app config convention.
- `@playwright/test` ^1.61.x as devDependency of `apps/e2e` only.
- `playwright.config.ts`: `baseURL` from `PLAYWRIGHT_BASE_URL` env (default `http://localhost:3000`, the compose-published `app` port). Projects: `setup` (runs `auth.setup.ts`), `chromium-admin`, `chromium-member` — the latter two declare `dependencies: ['setup']` and `use: { storageState: 'playwright/.auth/<role>.json' }`.
- `apps/e2e` reuses `apps/api`'s existing generated Prisma Client (Prisma 7 `output`-path client at `apps/api/src/generated/prisma`, provider `prisma-client`) via a new subpath export added to `apps/api/package.json`'s `exports` map — do NOT duplicate `schema.prisma` or hand-roll raw SQL in a second package. `apps/e2e` declares a `workspace:*` dependency on `@kurzly/api` for this subpath only; it must never import API route/business-logic modules (stay a black-box HTTP consumer for everything except DB seed/reset).

### Target under test
- E2E's canonical, CI-gating target is the **built Docker/compose image** (`docker compose ... up -d --wait`, waiting on the existing `app` HEALTHCHECK), never split Vite-dev-server + `tsx watch` Fastify. Rationale: the project's stated Core Value (redirect handler behaving correctly *as deployed*) is only proven against the same code path production runs (`@fastify/static`, helmet CSP, migrate-on-boot entrypoint, bot-OG rendering). Dev servers remain a legitimate local-iteration convenience only (override `PLAYWRIGHT_BASE_URL`), never the merge-gating path.
- New third additive compose overlay `docker-compose.e2e.yml` (on top of the existing `docker-compose.yml` prod file + the existing `docker-compose.dev.yml` dev overlay, which already ships Mailpit — do not create a second Mailpit service). The e2e overlay's job: publish Postgres on a distinct host port (`5433`) for the test runner's direct seed/reset client, and pin deterministic test env (test admin email, test secrets). Boot under a distinct compose project name (`-p kurzly-e2e`) so it never collides with a locally-running `dev`/`smoke` stack.
- New `scripts/e2e-compose.sh`, mirroring `scripts/smoke-compose.sh`'s trap/cleanup/`.env`-bootstrap structure: `docker compose -p kurzly-e2e -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml up -d --wait`, run `pnpm --filter @kurzly/e2e test`, always tear down (`down -v --remove-orphans`) in the trap, same as the smoke script.

### Email capture (Mailpit)
- Mailpit already exists in `docker-compose.dev.yml` (dev/CI-only, D-10) — reuse it as-is, do not add a second instance. `app`'s nodemailer client already points at `mailpit:1025` internally; the E2E test runner reads Mailpit's REST API on the published `8025` port (`GET /api/v1/messages`, `DELETE /api/v1/messages` to clear).
- Build `apps/e2e/src/mailpit.ts`: a thin fetch wrapper to list/search-by-recipient/delete messages. Scope every read by the unique test-recipient address (not "the latest message") to avoid cross-worker/cross-spec inbox theft when Playwright runs multiple workers in parallel — this was flagged as the #1 flakiness source in PITFALLS.md. Clear the inbox in global-setup and consider per-file isolation via unique recipient addresses (e.g. `admin+${testId}@e2e.kurzly.local`) rather than a shared fixed address, since better-auth's magic-link lookup is by exact email — confirm this works with `isEmailAllowed`'s allowlist matching during planning (may need the seeded admin/member rows to use the exact plus-addressed variants, or confirm `+` sub-addressing passes the allowlist check unmodified).

### Database isolation
- Give E2E its own long-lived Postgres connection via the e2e compose overlay's published `5433` port — do NOT touch, share, or extend the Vitest `testcontainers` harness (`apps/api/test/globalSetup.ts`). That harness is ephemeral/per-`vitest run` by design and torn down long before an E2E job would start; even if timing lined up, its per-test `BEGIN/ROLLBACK` isolation would fight the real `app` container's own concurrent connection.
- Reset strategy: **truncate-and-reseed per spec file** (via a `resetDb()` fixture in `apps/e2e/src/db.ts`, using the reused Prisma client), NOT `BEGIN/ROLLBACK` — the real `app` container owns its own DB connection separate from the test runner's, so there is no single transaction to wrap around a browser-driven HTTP request. This is the direct analog of this project's own prior discovery (documented in PROJECT.md's Key Decisions) that Vitest's per-test rollback isolation had to become per-file cloned-DB isolation for the identical nested-transaction reason.
- `global-setup.ts` seeds baseline fixtures once per run (a Domain, the admin User, one Member User with a DomainMembership) directly via Prisma — do NOT drive the real invite-UI flow to create the Member fixture in this phase (that round-trip is Phase 13/17's job, testing the invite flow itself is out of scope here). Both seeded users get `emailVerified: true` so the magic-link round trip in `auth.setup.ts` is the ONLY auth mechanism this phase exercises, proving the harness works — it is not a substitute for Phase 13's deeper AUTH-E2E requirements (invalid token, non-invited email, resend rate-limit, etc.).

### Auth fixture (storageState)
- `apps/e2e/tests/auth.setup.ts` (a Playwright "setup project") performs one real magic-link round trip per role (admin, member): request the link → read it from Mailpit's REST API → navigate to it → `page.context().storageState({ path: 'playwright/.auth/<role>.json' })`. Every other spec project declares `dependencies: ['setup']` and reuses the saved state — do not repeat the login round trip per spec file (the dominant cost in this suite per PITFALLS.md).
- `playwright/.auth/*.json` MUST be gitignored (live session cookies) and regenerated every run — never committed "to speed up CI". Add to `.gitignore`: `apps/e2e/playwright/.auth/`, `apps/e2e/playwright-report/`, `apps/e2e/test-results/`.
- Verify during planning/execution what better-auth's client actually persists (cookie-only vs. any `sessionStorage`/`localStorage` use) before assuming `storageState`'s cookie+localStorage capture is sufficient — PITFALLS.md flagged this as an unverified assumption worth checking against the actual better-auth client config (`apps/web`'s auth store) early, since `storageState` does not capture `sessionStorage`.

### Rate-limit test bypass (INFRA-06)
- Do NOT blanket-disable `@fastify/rate-limit` for E2E (defeats the purpose and the roadmap explicitly calls for a "narrow test-only bypass, not a blanket disable"). The existing per-route limits (`MAGIC_LINK_RATE_LIMIT` 5/15min, `LINK_CREATE_RATE_LIMIT`/`QR_CREATE_RATE_LIMIT`/`DOMAIN_CREATE_RATE_LIMIT` 20/15min each, global default 100/15min) stay registered as-is.
- Recommended mechanism: a narrow, env-gated bypass — an `E2E_RATE_LIMIT_BYPASS_SECRET` env var set ONLY in `docker-compose.e2e.yml` (never in `docker-compose.yml`/prod, never with a default in `env.ts`) that, when a request carries a matching `x-e2e-bypass` header, routes that single request to an effectively-unlimited rate-limit key (e.g. a per-request-unique key generator override) instead of skipping the plugin outright. Most fixtures/specs send this header via a shared Playwright `extraHTTPHeaders` or an API-request-context default; the one dedicated rate-limit-proof spec (part of Phase 13's AUTH-E2E-07, not this phase) deliberately omits the header to still observe a real 429. This phase's job is only to land the bypass mechanism and prove it with a throwaway smoke spec (per success criterion 5) — the actual magic-link-resend-UX spec is Phase 13 scope.

### CI wiring
- New `e2e` job in the existing `.github/workflows/ci.yml`, `needs: [test, smoke]` (sequential, not merged into `smoke` — `smoke` proves a bare boot fast, `e2e`'s heavier Playwright browser install only pays once `smoke` already proved the image itself is sound). Reuse `smoke`'s image-build step, add `cache-from: type=gha` to avoid a second cold build.
- Upload Playwright's HTML report and trace files as CI artifacts on failure (`actions/upload-artifact`, `if: failure()`).

### Claude's Discretion
- Exact Playwright project/file naming beyond what's specified above, exact `resetDb()` table-truncation list and ordering (respecting FK constraints), exact shape of the `x-e2e-bypass` header-to-bypass-key wiring inside `plugins/rateLimit.ts`, and whether the Prisma Client subpath export needs a matching `.d.ts`/type export path for `apps/e2e`'s TypeScript config — all at Claude's discretion, guided by the ROADMAP success criteria and this project's existing conventions (mirror `routes/canary.ts`'s factory pattern, `scripts/smoke-compose.sh`'s bash structure, etc.).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker-compose.dev.yml` already has a working Mailpit service (image `axllent/mailpit:latest`, ports 8025/1025, `MP_SMTP_AUTH_ACCEPT_ANY=1`) — reuse verbatim.
- `scripts/smoke-compose.sh` and `scripts/smoke-persistence.sh` are the direct structural templates for `scripts/e2e-compose.sh` (trap-based cleanup, `.env` bootstrap-if-missing, `jq`/`openssl` preflight checks, `--wait` on the existing `app` HEALTHCHECK).
- `apps/api/prisma/schema.prisma`'s `generator client { provider = "prisma-client", output = "../src/generated/prisma" }` is the exact client `apps/e2e` must import via a new subpath export — do not regenerate a second client.
- `apps/api/src/plugins/rateLimit.ts` already centralizes every named rate-limit config as an exported const (`MAGIC_LINK_RATE_LIMIT`, `LINK_CREATE_RATE_LIMIT`, etc.) and `registerRateLimit(app)` — the bypass mechanism should extend this file's existing pattern, not create a parallel one.
- `apps/api/src/env.ts`'s `envSchema`/`parseEnv()`/`OPTIONAL_ENV_KEYS` pattern (fail-fast Zod validation, empty-string-to-unset normalization for optional keys) is the established pattern for adding `E2E_RATE_LIMIT_BYPASS_SECRET` as a new optional key — mirror `GEOIP_DB_PATH`'s "optional, no default, absence means off" shape, not `CNAME_TARGET`'s "optional with fail-safe default" shape (a bypass secret must never silently exist).
- `.github/workflows/ci.yml`'s `smoke` job (needs: test, builds the app image, runs the compose smoke script) is the direct template for the new `e2e` job's shape.

### Established Patterns
- Factory-function pattern for anything Prisma-client-scoped (`canaryRoute(prisma)`, `createAuth(prisma)`) — if the E2E DB helper needs any server-side-shaped logic (it mostly won't; it's a direct Prisma consumer), follow the same factory shape.
- better-auth's `magicLink()` is invite-only via `isEmailAllowed` allowlist check inside the `sendMagicLink` callback (`apps/api/src/lib/auth.ts`) — the seeded E2E admin/member emails must pass this allowlist (i.e. exist as `User` rows, or whatever `isEmailAllowed` actually checks — confirm exact allowlist semantics during planning, since v1.0's "invite-only" model gates on DB row existence, not a separate env-configured list).
- ENV validation is fail-fast and centralized (`apps/api/src/env.ts`) with a drift test (`env-example-drift.test.ts`) asserting `.env.example` documents exactly the schema's key set — any new E2E-only env var added to the schema needs a matching `.env.example` entry (or must be scoped to only the e2e compose overlay's own inline environment, not the shared schema, if it should never appear in a production `.env` at all — lean toward the latter for `E2E_RATE_LIMIT_BYPASS_SECRET` specifically, to keep it structurally impossible to set in production).

### Integration Points
- `apps/e2e` ↔ `apps/api`: workspace dependency on the Prisma-client subpath export only.
- `apps/e2e` ↔ `packages/shared`: optional reuse of existing DTO types for typing seed fixtures/response assertions, same as `apps/web` already does.
- CI `e2e` job ↔ `smoke` job: sequential via `needs`, reusing the smoke job's image-build step with GHA cache.
- `docker-compose.e2e.yml` ↔ existing two compose files: purely additive overlay; must not require any edit to `docker-compose.yml` or `docker-compose.dev.yml` themselves.

</code_context>

<specifics>
## Specific Ideas

No specific UI/visual requirements — this is pure infrastructure. Two open technical questions flagged by research that planning/execution should resolve empirically rather than assume:
1. Whether better-auth's client persists anything in `sessionStorage` (would break plain `storageState` reuse) — check `apps/web`'s auth store/client config directly.
2. Whether Mailpit inbox scoping needs unique per-test recipient addresses (e.g. `+` sub-addressing) to avoid cross-worker email theft, and whether such addresses pass the allowlist/seed-matching logic unmodified — verify empirically with a throwaway spec before building every downstream spec on top of the assumption.

</specifics>

<deferred>
## Deferred Ideas

- Mock OIDC/SSO IdP container (needed for Phase 13's SSO E2E spec, not this phase) — no mock IdP exists in this repo today; flagged as a research item for whichever plan within Phase 13 addresses AUTH-E2E-04/05.
- Per-worker DB schemas (`search_path`) or per-worker containers, if the truncate/reseed strategy ever starts contending under parallel workers — not needed at this milestone's scale (~7 flow areas), revisit only if it becomes a real bottleneck.

</deferred>
