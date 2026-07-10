# Stack Research

**Domain:** Self-hosted, open-source URL shortener (Kurzly) — Vue 3 + Fastify + Postgres/Prisma + better-auth, Docker-deployed, TDD-mandatory
**Researched:** 2026-07-10
**Confidence:** MEDIUM (versions cross-checked directly against the npm registry `dist-tags.latest` field and official docs via web search; no Context7/MCP doc tools were available in this environment, so nothing reaches HIGH — treat exact patch versions as a snapshot to re-verify at `npm install` time, not as pinned gospel)

The core stack (Vue 3, Fastify, PostgreSQL, Prisma, better-auth + magicLink + OIDC, nodemailer/SMTP, Docker) is **already fixed by the project owner** — this document does not re-litigate those choices. It prescribes current versions, companion libraries, and integration patterns for exactly that stack.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24.x (Active LTS "Krypton", LTS through 2028-05-31) | JS runtime | Node 24 is the current Active LTS as of mid-2026; Node 22 is Maintenance LTS (fine as a floor), Node 20 is end-of-active-support. Target 24 in Docker base images for longest runway; avoid Node 26 (Current, not LTS until Oct 2026) for a production self-hosted tool. |
| Fastify | ^5.10.0 | Backend HTTP framework | Fixed by project owner. v5 is current major (v4 still maintained, v3 EOL) — build on v5 for a greenfield project. Fastify's schema-based validation/serialization and plugin encapsulation model fit the multi-tenant (domain-scoped) authorization requirements well. |
| PostgreSQL | 18.x (18.4 current stable) | Primary datastore | Fixed by project owner. PG 18 is the latest stable major; PG 19 is in beta (target Sept 2026) — do not build against a beta major for a v1 self-hosted release. Use the official `postgres:18-alpine` Docker image. |
| Prisma ORM | ^7.x (7.8.0 latest) | ORM / migrations / typed client | Fixed by project owner. Prisma 7 dropped the Rust query engine for a TypeScript/Wasm runtime: ~3x faster queries, ~90% smaller client bundle, ~70% faster typechecking — directly relevant to a Docker image you want lean. **Breaking change to plan for:** Prisma 7 requires an explicit `output` path in the `generator client` block; the client must then be imported from that generated path, not the bare `@prisma/client` package. Decide this path (e.g. `src/generated/prisma`) at Phase 1 scaffolding time so better-auth's Prisma adapter imports the same client instance. |
| Vue 3 (Composition API) | ^3.5.39 | Frontend framework | Fixed by project owner. 3.5.x is the current stable line; use `<script setup>` Composition API throughout per the design handoff's component patterns. |
| Vite | ^8.x (8.1.4 latest) | Frontend build tool / dev server | Standard companion to Vue 3 via `create-vue` scaffolding; fast HMR, native ESM, first-class Vitest integration (shared config/transform pipeline). |
| better-auth | ^1.6.x (1.6.23 latest) | Auth framework (magicLink + generic OIDC/SSO) | Fixed by project owner. Actively developed, TypeScript-first, plugin architecture matches the exact requirement shape here: `magicLink()` as the sole login plugin, an OIDC plugin toggle for optional SSO, and a first-party Prisma adapter — no need to hand-roll session/cookie/token handling. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fastify/cors` | ^11.3.0 | CORS handling | Register before the better-auth catch-all route; needed because the Vue SPA and API may be served from different origins/ports in dev (and potentially prod if not served from the same Fastify instance). |
| `@fastify/helmet` | ^13.1.0 | Security headers (CSP, HSTS, X-Frame-Options, etc.) | Helmet-equivalent for Fastify. Mandatory baseline hardening for a public-facing redirect service; tune CSP carefully since the redirect handler renders OG-tag HTML for bots and the password/expiry pages are public. |
| `@fastify/rate-limit` | ^11.1.0 | Rate limiting | Apply to the magic-link request endpoint (prevent email-bombing), the link-password-check endpoint (prevent brute force), and the public redirect handler (basic abuse protection). |
| `@fastify/static` | ^9.3.0 | Static file serving | Serve the built Vue SPA (`dist/`) directly from Fastify in the self-hosted single-container deployment model, or serve QR logo uploads if stored on local disk instead of object storage. |
| `@fastify/cookie` | ^11.1.1 | Cookie parsing helper | Optional — better-auth manages its own session cookies internally via `Set-Cookie` response headers from `auth.handler()`, so this is **not required for auth itself**. Only add it if you need cookie access for something auth-unrelated (e.g. a UI preference cookie). Do **not** reach for `@fastify/session` — better-auth owns session state; a second session plugin would conflict. |
| Pinia | ^3.0.4 | Vue state management | The official Vue-team-endorsed store library for Vue 3 Composition API (Vuex is legacy/maintenance-only). Use for cross-screen state: `theme`, `domainFilter`, `authSession`, `toast` queue — matches the state shape already implied by the design handoff. |
| Vue Router | ^4.6.x (stable) | Client-side routing | Use the **v4 line**, not v5, for this project. v5 (5.1.0) exists in parallel and only adds optional file-based routing (absorbed `unplugin-vue-router`) with no other breaking changes — a nice-to-have, not a need, and it adds build-time complexity this project's fixed screen set (7 named views) doesn't benefit from. Revisit if the route surface grows organically later. |
| `prismaAdapter` (from `better-auth/adapters/prisma`) | bundled with better-auth 1.6.x | Connects better-auth to Prisma | Built into the core `better-auth` package (import path `better-auth/adapters/prisma`) — do not add a separate `@better-auth/prisma-adapter` package, that name is not the current shipping path. Pass your Prisma client instance + `provider: "postgresql"`. |
| `better-auth/plugins` → `magicLink` | bundled | Passwordless login | Server-side plugin; configure `sendMagicLink` to call your nodemailer transport. This is the *only* login method per spec — do not add an email/password plugin. |
| `better-auth/plugins` → `sso` (preferred) or `genericOAuth` | bundled | Optional OIDC/SSO | Use the dedicated **`sso` plugin** over `genericOAuth` for this project: it auto-discovers IdP endpoints from just an issuer URL (`{issuer}/.well-known/openid-configuration`) via `registerSSOProvider`, matching the spec's "Issuer-URL, Client-ID, Client-Secret" admin UI fields almost exactly, and its callback path is predictable (`/sso/callback/:providerId`, adjust the spec's `/api/auth/callback/oidc` naming to match or configure a shared callback). `genericOAuth` is the right fallback if a target IdP doesn't expose full OIDC discovery. Either way, run `npx @better-auth/cli generate` (better-auth's schema generator) after adding the plugin to update the Prisma schema with the SSO/account tables. |
| nodemailer | ^9.0.3 | SMTP email transport | `createTransport({host, port, secure, auth:{user, pass}})` populated entirely from ENV (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — provider-neutral, works against Postfix, Mailgun-SMTP, SES-SMTP, Fastmail, etc. Wire this as the `sendMagicLink` implementation for better-auth. |
| `qrcode` (node-qrcode) | ^1.5.4 | QR code generation (PNG buffer, SVG string, data URL) | The standard, most battle-tested server-side QR library. Set `errorCorrectionLevel: 'H'` whenever a logo overlay is requested (tolerates ~30% data loss — required, per spec, for logo-overlay QR codes). It does **not** composite logos natively — see pattern below. |
| `sharp` | latest 0.3x | Image compositing (QR + logo overlay, PNG output) | Composite the logo PNG/SVG onto the raster QR output using `sharp().composite([{ input: logoBuffer, gravity: 'center' }])`. Preferred over `canvas`/`jimp` for a Docker image because it ships prebuilt binaries per-platform and has no native `node-gyp` build step at container build time (avoids flaky Alpine builds) — pin the correct `--platform=linuxmusl-x64` prebuilt binary if using `node:*-alpine`. |
| — (manual SVG string manipulation) | n/a | SVG logo overlay | For the SVG export path, generate the QR as an SVG string via `qrcode`'s `toString({type:'svg'})`, then inject an `<image>` element (base64 data-URI logo) centered in the viewBox before returning — no extra library needed. |
| Playwright | ^1.61.x (`@playwright/test`) | E2E testing | For the critical-flow E2E suite mandated by TDD: magic-link login round-trip (using a test SMTP catcher like Mailpit/MailHog), redirect handler (slug → target, password gate, expiry 410), QR dynamic remap, domain-scoped member authorization. |
| Vitest | ^4.1.x | Unit + component test runner | See Testing Stack section below — this is the backbone test runner for both the Fastify backend and the Vue frontend. |
| `@vitest/coverage-v8` | matches Vitest 4.1.x | Coverage reporting | Default coverage provider; since Vitest 3.2 uses AST-based remapping so V8-speed coverage is Istanbul-accurate. v4 removed `coverage.all` — set `coverage.include` explicitly rather than relying on an "include everything" default. |
| `@vue/test-utils` | ^2.4.11 | Vue component testing | Official Vue-team library, works directly with Vitest. Preferred over `@testing-library/vue` for this project specifically because the design handoff has Suspense-adjacent async patterns (accordion sections, analytics data loading) where Testing Library has known gaps. |
| `@testcontainers/postgresql` (testcontainers-node) | current | Ephemeral Postgres for integration tests | Spin up a real disposable Postgres container per test run (or per Vitest worker) instead of mocking Prisma — validates actual SQL/migrations/constraints, which is where most Prisma-layer bugs hide. Use Vitest's `globalSetup` `provide`/`inject` to hand the container's connection string to worker threads; either one container per parallel worker, or seed once + wrap each test in a rolled-back transaction for speed (do the transaction-rollback pattern for the bulk of tests, keep true multi-container isolation only for migration/schema tests). |
| Mailpit or MailHog (Docker, dev/test only) | current | SMTP test double | Point nodemailer at this in dev/CI so magic-link E2E tests can assert on the actual received email + extract the link, without touching a real SMTP provider. Ship it in `docker-compose.dev.yml` only, never in the production compose file. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `fastify.inject` (light-my-request, bundled in Fastify core) | API/integration testing without a real socket | Exercises the full plugin lifecycle, schema compilation, and serialization — the same code path as a real HTTP request, minus the transport layer. Use this as the default for backend integration tests (route + auth + Prisma), reserving Playwright for true end-to-end (browser + real HTTP + real SMTP catcher) critical-flow tests only. |
| pnpm workspaces (or npm workspaces) | Monorepo layout (frontend/backend/shared) | Given the user's global tooling already assumes pnpm (`pnpm tsc --noEmit`), scaffold this as a pnpm workspace monorepo: `apps/web` (Vue), `apps/api` (Fastify), optionally a `packages/shared` for shared types (e.g. link/QR/domain DTOs) consumed by both — matches the "rebuild the shared package" instruction in the user's global CLAUDE.md. |
| Docker / docker-compose | Deployment | Multi-stage Dockerfile per app (or one image serving both via `@fastify/static` for the built SPA); `docker-compose.yml` wires Postgres + the app + (optionally) a reverse proxy for Let's Encrypt/DNS-01 TLS per custom domain. |
| ESLint + `eslint-plugin-vue` / TypeScript strict mode | Static analysis | Standard for a Vue 3 + TS + Fastify + TS project; run in CI alongside `tsc --noEmit` per the user's global build instructions. |

## Installation

```bash
# Core (backend)
pnpm add fastify @fastify/cors @fastify/helmet @fastify/rate-limit @fastify/static
pnpm add prisma @prisma/client better-auth nodemailer qrcode sharp

# Core (frontend)
pnpm add vue vue-router@^4 pinia

# Dev dependencies (shared / testing)
pnpm add -D vitest @vitest/coverage-v8 @vue/test-utils @playwright/test
pnpm add -D @testcontainers/postgresql testcontainers
pnpm add -D typescript vite @vitejs/plugin-vue

# Prisma init (PostgreSQL)
pnpm exec prisma init --datasource-provider postgresql

# better-auth schema generation after configuring plugins
pnpm exec @better-auth/cli generate
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `qrcode` + `sharp` (manual logo compositing) | `qr-code-styling` | If you want rounded-module styling and logo overlay "out of the box" without hand-writing the compositing step. Tradeoff: it depends on `canvas` + `jsdom` in Node, which is heavier and more fragile to build in a slim Docker/Alpine image than `sharp`'s prebuilt binaries. Given the spec wants rounded modules AND logo AND level-H AND dual PNG/SVG export, `qrcode`+`sharp` gives more control per format at the cost of a bit more glue code. |
| better-auth `sso` plugin for OIDC | `genericOAuth` plugin | Use `genericOAuth` if a target IdP does not expose a working OIDC discovery document (`/.well-known/openid-configuration`) or you need finer manual control over `authorizationEndpoint`/`tokenEndpoint`/`jwksEndpoint`. For mainstream IdPs named in the spec (Keycloak, Authentik, Azure AD) discovery works fine, so `sso` is less code. |
| Vue Router v4 | Vue Router v5 | If the app's route surface grows into dozens of nested/dynamic routes and file-based routing (auto-generated routes from a `pages/` directory) becomes valuable for maintainability. Not justified for this project's fixed ~7-screen nav. |
| `@vue/test-utils` | `@testing-library/vue` | If the team wants to enforce "test like a user" queries (role/label-based selectors) over instance-inspection APIs, and is willing to work around its documented Suspense-testing rough edges. |
| Vitest `coverage-v8` | `@vitest/coverage-istanbul` | If you need coverage features Istanbul historically had that V8 lacked; largely moot since Vitest 3.2+ V8 provider does AST remapping for Istanbul-equivalent accuracy — no strong reason to switch. |
| testcontainers ephemeral Postgres | SQLite/in-memory Postgres shims (e.g. pglite) for tests | Only for the fastest unit-level Prisma query tests where container startup latency matters more than 100% Postgres-fidelity (e.g. extension-specific SQL features aren't being exercised). Keep the real Postgres container for any test touching migrations, constraints, or the multi-tenant authorization queries — those are exactly the bugs a shim would hide. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@fastify/session` alongside better-auth | better-auth manages its own session tokens/cookies end-to-end via its Fetch-API-based handler; a second session plugin creates two competing sources of truth for "who is logged in" and cookie collisions. | Rely solely on better-auth's session cookie + `auth.api.getSession()` for all authenticated route guards. |
| Vuex | Superseded by Pinia; Vue core team has moved Vuex to maintenance-only status, and Pinia is the documented default for new Vue 3 projects. | Pinia |
| Email/password login plugin for better-auth | Explicitly out of scope per project spec — Magic Link is the sole login method. | `magicLink()` plugin only |
| Hand-rolled QR generation from scratch | Reinventing Reed–Solomon error correction / module-matrix generation is unnecessary risk for a solved problem with mature libraries. | `qrcode` npm |
| `canvas` npm for server-side logo compositing in an Alpine Docker image | Native `node-gyp` build of `canvas` against Alpine's musl libc is a well-known source of flaky Docker builds and large image bloat. | `sharp` (prebuilt binaries, smaller footprint) |
| Mocking Prisma entirely in "integration" tests | Gives false confidence — the actual SQL, migration compatibility, and Postgres-specific constraint behavior (e.g. unique slug-per-domain) never gets exercised. | testcontainers-backed Postgres for the integration layer of the test pyramid |
| Real third-party SMTP providers in CI/E2E tests | Slow, flaky, potential cost/rate-limit issues, and leaks real emails during automated test runs. | Mailpit/MailHog SMTP catcher container in dev/CI only |
| Building against PostgreSQL 19 (beta) | PG 19 is still in beta as of mid-2026 (target GA ~Sept 2026); not appropriate for a self-hosted tool users will run in production. | PostgreSQL 18.x (current stable) |

## Stack Patterns by Variant

**If deploying as a single Docker image (SPA + API together):**
- Use `@fastify/static` to serve the built Vue `dist/` from the same Fastify instance that serves `/api/*` and the redirect handler.
- Because it's the same origin, you can drop `@fastify/cors` in production (keep it dev-only, gated by `NODE_ENV`).

**If deploying as two containers (separate frontend/backend, e.g. behind a reverse proxy):**
- Keep `@fastify/cors` active in production, locked to the known dashboard origin(s) via ENV.
- The public redirect handler (custom domains) still lives in the same Fastify app — those requests hit arbitrary customer domains, not the dashboard's origin, so they bypass CORS entirely (server-to-browser redirect, not an XHR).

**If OIDC/SSO is disabled (default state per spec):**
- Do not register the `sso`/`genericOAuth` plugin at all in that instance's `betterAuth()` config — avoids exposing `/sso/*` or `/api/auth/callback/oidc` endpoints unnecessarily on installs that don't use SSO.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `prisma`@^7 / `@prisma/client`@^7 | `better-auth`@1.6.x prisma adapter | Confirmed working combination per better-auth's own Prisma guide; watch for the Prisma 7 custom `output` path — the adapter and your own app code must import the client from the same generated path. |
| Fastify@^5 | `@fastify/cors`@^11, `@fastify/helmet`@^13, `@fastify/rate-limit`@^11, `@fastify/cookie`@^11, `@fastify/static`@^9 | These major versions are the ones built against Fastify v5's plugin encapsulation API; do not mix with Fastify v4-targeted plugin majors. |
| Vite@^8 | Vitest@^4 | Both consume the same underlying Vite transform pipeline/config; keep them on majors released around the same time to avoid resolver mismatches. |
| Vue@^3.5 | `@vue/test-utils`@^2.4, Pinia@^3, Vue Router@^4.6 | All current majors are mutually compatible Vue-3-only lines; no known conflicts. |
| Node.js 24.x | `sharp` prebuilt binaries | Confirm `sharp`'s published prebuilt binary matrix covers your target Node ABI + Alpine musl variant before locking the Dockerfile base image — worth a quick check at implementation time since sharp's binary support matrix shifts with new Node majors. |

## Sources

- npm registry `dist-tags.latest` (direct fetch, `registry.npmjs.org/<pkg>`) for: fastify, better-auth, prisma, vue, vite, pinia, vue-router, nodemailer, qrcode, vitest, @playwright/test, @vue/test-utils, @fastify/cookie, @fastify/rate-limit, @fastify/cors, @fastify/helmet, @fastify/static — confidence MEDIUM (authoritative registry data, but fetched via generic web-fetch tool rather than an MCP docs provider)
- better-auth.com official docs: `/docs/integrations/fastify`, `/docs/plugins/magic-link`, `/docs/plugins/sso`, `/docs/plugins/generic-oauth`, `/docs/adapters/prisma` — confidence MEDIUM
- prisma.io official blog/changelog: "Announcing Prisma ORM 7.0.0", changelog entries 7.2–7.7 — confidence MEDIUM
- postgresql.org versioning/roadmap pages, endoflife.date/postgresql — confidence MEDIUM
- nodejs.org release blog + endoflife.date/nodejs — confidence MEDIUM
- vitest.dev migration guide + "Vitest 4.0/4.1 is out" blog posts — confidence MEDIUM
- General web search synthesis (WebSearch tool, no Context7/MCP docs provider available in this environment) for: qrcode logo-overlay compositing patterns, Fastify testcontainers/Vitest integration test patterns, `@vue/test-utils` vs `@testing-library/vue` guidance — confidence MEDIUM/LOW, flagged for re-verification at implementation time via each library's own README/docs

---
*Stack research for: self-hosted URL shortener (Kurzly) — Vue 3 / Fastify / Postgres+Prisma / better-auth stack*
*Researched: 2026-07-10*
