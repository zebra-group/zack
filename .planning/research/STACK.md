# Stack Research

**Domain:** Playwright E2E test infrastructure addition to an existing Fastify + Vue + Postgres + better-auth pnpm monorepo (Kurzly v1.1 milestone)
**Researched:** 2026-07-24
**Confidence:** MEDIUM-HIGH (versions verified directly against npm registry / GitHub Releases API; integration patterns synthesized from official Playwright docs + current community practice via web search, no MCP docs provider available in this environment)

The v1.0 stack (Node 24, Fastify ^5.10, Vue 3.5 + Vite 8, PostgreSQL 18 + Prisma ^7, better-auth ^1.6.23, nodemailer, qrcode+sharp, Vitest ^4.1 + @testcontainers/postgresql, @vue/test-utils) is **already validated and shipped** — this document does not re-research it. It covers only what's new for the v1.1 E2E-coverage milestone: Playwright itself, an SMTP test-catcher, an OIDC test double, and how to wire all of it into the existing pnpm workspace + GitHub Actions CI.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@playwright/test` | ^1.61.1 (verified via npm registry `dist-tags.latest`, 2026-07-24) | E2E test runner, browser automation, assertions, tracing | Spec-named tool for this milestone, and current stable. Ships its own test runner (deliberately separate from Vitest — E2E has a different execution model than the existing unit/integration suites), first-class TypeScript, `webServer` orchestration for booting the app under test, `storageState` for reusable authenticated sessions, native test sharding + blob-report merging for CI, and a matching official Docker image (`mcr.microsoft.com/playwright:v1.61.1-noble`) for CI/local parity. `engines` requires Node >=18 — comfortably covered by the project's Node 24 baseline (exact Node-24 compatibility not explicitly documented by Playwright as of this pass; low risk, worth a smoke-check at scaffolding time). |
| Mailpit (Docker: `axllent/mailpit`) | v1.30.5 (verified via GitHub Releases API, published 2026-07-20 — actively maintained) | SMTP test-catcher + REST API, so Playwright tests can read the real magic-link email sent via nodemailer | MailHog (the alternative named in the milestone context) is effectively unmaintained — no meaningful commits since ~2020, confirmed via 4+ independent community sources. Mailpit is the community-adopted drop-in replacement: same default ports (SMTP 1025, Web UI 8025), a documented REST API (`GET /api/v1/messages`, `GET /api/v1/message/{ID}`) purpose-built for "capture email → extract link → navigate to it" test flows, and active releases. Add to `docker-compose.dev.yml` only (test/dev-only, matching the project's existing SMTP-provider-neutral, ENV-configured convention). |
| `@testcontainers/postgresql` | reuse existing ^12.0.4 (already a project dependency for the Vitest API integration harness; verified current on npm) | Provisions a real, disposable Postgres instance for local `pnpm test:e2e` runs | Do not add a second Postgres-provisioning mechanism. This exact library is already validated in this repo for real-Postgres integration testing (540 API tests), including the hard-won "Postgres has no nested transactions" lesson from Phase 7 (per-file cloned-DB isolation). Reuse the same container-lifecycle code in E2E's `globalSetup`, with a different reset granularity suited to HTTP-level E2E rather than `fastify.inject`-level integration tests (see Stack Patterns below). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `oidc-provider` | ^9.10.0 (verified current on npm) | In-process mock OpenID Connect IdP, run as a Playwright fixture/global-setup process, so the OIDC/SSO login flow (better-auth's `genericOAuth` plugin) can be exercised E2E without depending on a real external IdP | Add as a devDependency in the new E2E workspace package only. Boot it in `globalSetup` (or per-file fixture) on a local port with one pre-registered test client matching Kurzly's `genericOAuth` config shape (issuer, client id/secret, redirect URI). Materially lighter than running Dex (`v2.45.1`, verified via GitHub Releases) or Keycloak as a separate Docker service just for a handful of SSO E2E cases — starts in-process in milliseconds, torn down with the test process, no extra CI service to provision. |
| `pg` (already resolved transitively via `@testcontainers/postgresql`/Prisma's `adapter-pg`) | matches existing lockfile-resolved version | Direct SQL for E2E database reset/seed helpers (`TRUNCATE ... RESTART IDENTITY CASCADE`), deliberately bypassing the app's authorization layer for out-of-band plumbing only | Use in a small `apps/e2e/src/db.ts` helper for the "full reset between test files" path (see Stack Patterns). Do **not** use it to create the actual entities under test (links, QR codes, invites) — those must go through the real API/UI so the server-side `requireDomainAccess`/`scopedDomainIds` authorization logic is what's actually being exercised, which is the whole point of E2E coverage per this milestone's stated scope. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `mcr.microsoft.com/playwright:v1.61.1-noble` (Docker image) | CI runner image with browsers + OS deps preinstalled, version-locked to `@playwright/test` | Pin the image tag to exactly match the installed npm package version; a mismatched pair is the most common cause of "green locally, red in CI" Playwright flakiness. Bump both together whenever `@playwright/test` is upgraded. |
| Playwright blob + HTML reporters | Local debugging (traces/videos in `playwright-report/`) and CI report merging across shards | `reporter: [['html', { open: 'never' }], ['blob']]` in CI config; a separate merge job runs `npx playwright merge-reports --reporter html` over all shards' blob artifacts, then uploads the combined report via `actions/upload-artifact@v4`. |
| GitHub Actions native `services:` block (Postgres + Mailpit) | Provision Postgres (`postgres:18-alpine`) and Mailpit (`axllent/mailpit:v1.30.5`) as native CI service containers instead of orchestrating them through testcontainers-in-Node inside the CI job | Simpler and one layer shallower than container-in-container orchestration; GH Actions natively starts/health-checks/tears down `services:` entries per job. Keep `@testcontainers/postgresql` for local developer runs only (mirrors how the existing Vitest harness already behaves locally vs. in CI). |

## Installation

```bash
# New workspace package for E2E, mirroring the apps/api, apps/web naming convention
mkdir -p apps/e2e

# Inside apps/e2e's package.json (add as devDependencies), then from repo root:
pnpm install

# Add the new E2E-only packages
pnpm --filter e2e add -D @playwright/test@^1.61.1 oidc-provider@^9.10.0

# Install browsers + OS deps (first-time local setup)
pnpm --filter e2e exec playwright install --with-deps chromium

# No new package needed for Postgres provisioning — reuse the existing
# @testcontainers/postgresql devDependency already used by apps/api's Vitest harness.
```

```yaml
# docker-compose.dev.yml addition (dev/test only — never in the production compose file)
services:
  mailpit:
    image: axllent/mailpit:v1.30.5
    ports:
      - "1025:1025"   # SMTP — point SMTP_HOST/SMTP_PORT here for dev + E2E runs
      - "8025:8025"   # Web UI + REST API (GET /api/v1/messages)
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Mailpit | MailHog | Never, for new setup in 2026 — no meaningful MailHog commits since ~2020, community-considered abandoned. Only relevant if the team already had deep MailHog-specific tooling elsewhere (not the case: this repo has zero existing E2E/SMTP-catcher tooling — greenfield). |
| `oidc-provider` (in-process mock IdP) | Dex (`dexidp/dex`, current `v2.45.1`, verified via GitHub Releases) or a Keycloak container | Use a real IdP container only if the suite needs to validate against a *specific* IdP's quirks (e.g. a claims-mapping bug seen with an actual customer IdP) rather than the generic OIDC contract better-auth's `genericOAuth` plugin consumes. For "does our SSO login flow work end-to-end," the in-process mock is faster to boot, trivial to seed per-test, and removes a Docker service from the CI matrix entirely. |
| `@testcontainers/postgresql` for local `pnpm test:e2e` runs | GitHub Actions native `services: postgres:18-alpine` for CI runs | Use native GH Actions services in CI (one less container-orchestration layer inside an already-containerized runner); keep testcontainers for local developer machines so nobody needs a manually-managed local Postgres instance — mirrors exactly how the existing Vitest integration harness already splits local vs. CI. |
| Data-namespacing (unique domain/slug/email per test) as the default E2E isolation strategy | Per-worker cloned database (the same pattern already validated for Vitest in Phase 7 — Postgres `CREATE DATABASE ... TEMPLATE`) | Fall back to per-worker DB cloning only for suites asserting on *global* counts with no natural unique key to namespace by. For the bulk of Kurzly's flows (link CRUD, QR, per-domain analytics, team management) every entity is already domain/email-scoped by the fixture, so unique naming is sufficient and far cheaper than spinning multiple Postgres containers per CI run. |
| Native Playwright sharding (`--shard=X/Y` + blob-report merge) | Hand-splitting suites into separate CI jobs | Only hand-split if there's a natural, stable grouping needing different service dependencies per job (e.g. an "SSO suite" needing `oidc-provider` vs. everything else). For one homogeneous suite against one running app, native sharding needs less upkeep. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| MailHog | Unmaintained since ~2020 — no active bugfixes/security patches/API evolution, despite being named as an option in the milestone context. Mailpit has fully superseded it in the ecosystem (Laravel Sail, DDEV, and others have already migrated). | Mailpit v1.30.5 |
| A second E2E runner (e.g. Cypress) alongside Playwright | Not requested, and would introduce a second test-runner paradigm for no benefit. Playwright's multi-tab/multi-origin support specifically matters here — custom-domain redirect testing crosses origins by design. | `@playwright/test` |
| Routing E2E test-data setup through raw SQL / direct Prisma writes for the entities under test | Bypasses the exact server-side authorization logic (`requireDomainAccess`/`scopedDomainIds`) this milestone exists to prove end-to-end. E2E's entire value proposition is exercising the real HTTP/UI surface, not seeding around it. | Create test data via real API/UI actions in fixtures; reserve raw `pg`/SQL strictly for full-database reset/seed plumbing between runs, never for the entities the test is actually verifying. |
| Caching `~/.cache/ms-playwright` browser binaries in GitHub Actions as a default optimization | Playwright's own CI guidance notes cache download+extraction can take as long as a fresh install, and a stale cache silently pinned to an old browser build is a real footgun whenever `@playwright/test` is bumped. | Run `playwright install --with-deps` fresh each CI run, or better — use the pre-built `mcr.microsoft.com/playwright` image (browsers baked in, version-pinned) as the CI container, sidestepping the cache-vs-no-cache tradeoff entirely. |
| Testing exclusively against split dev servers (`apps/web` Vite dev server + `apps/api` Fastify dev server, two origins) as the *only* CI configuration | Production is a single Fastify instance serving both `/api/*` and the built Vue `dist/` from one origin (`@fastify/static`), with CORS dropped entirely in prod. Dev-server-only E2E would never exercise that real topology and could hide origin/CORS-adjacent redirect-handler bugs. | Run the required CI E2E pass against the **built Docker image** (single origin, prod-shaped); keep a separate optional dev config (two `webServer` entries, `reuseExistingServer: !process.env.CI`) purely for fast local iteration while writing tests. |

## Stack Patterns by Variant

**If running E2E locally during test development:**
- Use `playwright.config.ts` with an array `webServer: [...]` starting `pnpm --filter api dev` and `pnpm --filter web dev` on their normal dev ports, `reuseExistingServer: !process.env.CI` so already-running dev servers aren't killed on every run.
- Point `SMTP_HOST`/`SMTP_PORT` at the Mailpit service in `docker-compose.dev.yml` (start once, leave running across iterations).
- Use `@testcontainers/postgresql` in `globalSetup` to boot a disposable Postgres, run `prisma migrate deploy` + the seed script, and export the resulting connection string for the dev-mode API process.

**If running E2E in CI (the required/canonical run):**
- Build the actual production Docker image as part of the job, then use a *single* `webServer` entry whose `command` runs `docker compose -f docker-compose.yml -f docker-compose.e2e.yml up`, `url` pointed at the single Fastify origin's health-check route, with a generous `timeout` for image build + migration on cold start.
- Use GitHub Actions' native `services:` block for Postgres (`postgres:18-alpine`) and Mailpit (`axllent/mailpit:v1.30.5`) rather than testcontainers-in-Node — one less orchestration layer inside an already-containerized runner.
- Run the job itself in/against the `mcr.microsoft.com/playwright:v1.61.1-noble` container so browsers are pre-installed and version-locked.
- Add sharding (`--shard=$INDEX/$TOTAL` matrix) once the suite is large enough that wall-clock time matters — not needed on day one with a small initial suite; add it when full "critical flows" coverage exists and runtime is actually measured.

**If a specific suite needs to assert on global/cross-tenant counts (rare):**
- Fall back to the heavier per-worker cloned-database pattern (the same Postgres `CREATE DATABASE ... TEMPLATE` approach already validated for Vitest) instead of data-namespacing, and pin that suite to `workers: 1` or its own project to avoid cross-test count pollution.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@playwright/test`@^1.61.1 | Node.js 24.x | `engines` field only requires Node >=18; no Node-24-specific incompatibility found in release notes, but this exact pairing isn't explicitly called out in Playwright's own compatibility docs as of this pass — low risk, worth a smoke-check (`pnpm --filter e2e exec playwright --version` + one trivial test) at scaffolding time. |
| `mcr.microsoft.com/playwright:v1.61.1-noble` | `@playwright/test`@^1.61.1 | Pin these together explicitly; a mismatched image/library pair surfaces as CI-only browser-binary/driver flakiness. |
| Mailpit v1.30.5 | nodemailer (existing project dependency, ^9.0.3) | Mailpit is a transparent SMTP endpoint — no Mailpit-specific nodemailer config needed, just `SMTP_HOST`/`SMTP_PORT` pointed at it with `secure: false` (no TLS needed for the local test catcher). |
| `oidc-provider`@^9.10.0 | better-auth `genericOAuth` plugin (existing project dependency, ^1.6.23) | `oidc-provider` implements a standards-compliant OIDC discovery document (`/.well-known/openid-configuration`), exactly what better-auth's `genericOAuth` resolution expects — no bespoke shimming beyond registering one test client (id/secret/redirect URI). |
| `@testcontainers/postgresql`@^12.0.4 | PostgreSQL 18.x (existing project version) | Already validated in the Vitest harness; use the same `postgres:18-alpine` image reference for E2E's `globalSetup` container to avoid version drift between what integration and E2E tests exercise. |

## Sources

- npm registry `dist-tags.latest` (direct fetch, `registry.npmjs.org/<pkg>`) for: `@playwright/test` (1.61.1), `@testcontainers/postgresql` (12.0.4), `oidc-provider` (9.10.0) — confidence HIGH (authoritative registry data, direct fetch, verified 2026-07-24)
- GitHub Releases API (direct fetch) for `axllent/mailpit` latest release (v1.30.5, published 2026-07-20) and `dexidp/dex` latest release (v2.45.1, considered as an alternative IdP) — confidence HIGH
- playwright.dev official docs: `/docs/test-webserver`, `/docs/ci`, `/docs/auth`, `/docs/test-sharding-js`, `/docs/test-global-setup-teardown` — confidence MEDIUM (WebSearch synthesis, not a direct MCP docs provider; core claims cross-checked across multiple independent community articles referencing the same official pages)
- mailpit.axllent.org official docs: `/docs/install/docker/`, `/docs/api-v1/` — confidence MEDIUM
- Community sources on MailHog-vs-Mailpit maintenance status (SendPigeon, SendPit, Jeff Geerling blog, `ddev/ddev` GitHub issue #4827) — confidence MEDIUM, cross-checked across 4+ independent sources reaching the same conclusion
- Community sources on GitHub Actions Playwright CI patterns (QASkills.sh "Playwright CI on GitHub Actions: Complete 2026 Guide", playwrightsolutions.com, Brian Birtles' blog on sharding-by-browser) — confidence MEDIUM, general patterns only; verify exact YAML syntax against `playwright.dev/docs/ci` at implementation time
- Community sources on Postgres seeding/reset patterns for Playwright (`playwright-postgres-seeder` README, Seedmancer blog, `microsoft/playwright` issue #33699 "How to write isolated playwright tests against a real database") — confidence LOW-MEDIUM, no single authoritative "official" pattern exists; the data-namespacing recommendation here is this researcher's synthesis from the project's own existing domain-scoped-entity constraints, not a directly-cited external best practice — flag for reconsideration if the actual suite reveals it insufficient

---
*Stack research for: Playwright E2E test infrastructure (Kurzly v1.1 milestone)*
*Researched: 2026-07-24*
