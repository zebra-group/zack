# Architecture Research

**Domain:** Playwright E2E integration into an existing pnpm monorepo (Fastify single-image + Vue SPA + Postgres, real-Postgres TDD already established via Vitest/testcontainers)
**Researched:** 2026-07-24 (v1.1 milestone — supersedes the v1.0-era ARCHITECTURE.md for this document; that content described the shipped system, now recorded in `.planning/PROJECT.md`)
**Confidence:** MEDIUM (grounded primarily in this repo's own established patterns — `scripts/smoke-compose.sh`, `docker-compose.dev.yml`, `apps/api/test/globalSetup.ts` — cross-checked against general Playwright/monorepo community practice via web search; no official Playwright MCP/docs provider was available this run, see Sources)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                    CI: GitHub Actions (ci.yml, existing)               │
│  job:test  (vitest, testcontainers PG — ephemeral, per-run, in-process)│
│         │ needs                                                        │
│  job:smoke (docker compose up -d --wait, curl /health + /api/canary)   │
│         │ needs                                                        │
│  job:e2e  ◄── NEW: builds app image, boots docker-compose stack        │
│             + dev overlay (mailpit) + e2e overlay (published DB port), │
│             runs `pnpm --filter @kurzly/e2e test` against it           │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│              docker compose stack (E2E target — NEW overlay)           │
│  -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml -p kurzly-e2e │
│                                                                          │
│  ┌──────────┐   SMTP :1025    ┌──────────┐                              │
│  │   app    │ ───────────────►│ mailpit  │                              │
│  │ (built   │                 │ (dev ovl)│         ┌──────────┐         │
│  │  image,  │◄── HTTP :3000 ──┤ web UI/  │         │    db    │         │
│  │  D-01)   │   (published)   │ API :8025│         │ postgres │         │
│  └────┬─────┘   (published)   └────┬─────┘         │  :18     │         │
│       │ pg :5432 (internal)        │ HTTP           └────┬─────┘         │
│       └──────────────────────────►(published)             │ pg :5433     │
│                                     │                       │ (published,│
│                                     │                       │  e2e ovl)  │
└─────────────────────────────────────┼───────────────────────┼────────────┘
                                       ▼                       ▼
┌───────────────────────────────────────────────────────────────────────┐
│         apps/e2e (NEW workspace package) — Playwright test runner       │
│                          (host process, not containerized)              │
│  ┌────────────┐  ┌───────────────┐  ┌──────────────────────────────┐   │
│  │global-setup│  │ auth.setup.ts │  │ spec files (redirect/, links/,│   │
│  │ + teardown │  │ → storageState│  │ qr/, team/, analytics/, auth/)│   │
│  │(DB seed via│  │ per role, once│  │  use fixtures.ts for:         │   │
│  │ @kurzly/api│  │ per run       │  │  - authenticatedPage(role)    │   │
│  │ prisma-    │  └───────┬───────┘  │  - db reset per file          │   │
│  │ client     │          │          │  - mailpit inbox client        │   │
│  │ export)    │          ▼          └──────────────────────────────┘   │
│  └────────────┘  playwright/.auth/*.json (gitignored)                  │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| `apps/e2e` (new) | Owns all Playwright config, specs, fixtures, and DB/mail test helpers | New pnpm workspace package, sibling to `apps/api`/`apps/web`; auto-picked up by the existing `apps/*` glob in `pnpm-workspace.yaml` — no workspace config change needed |
| `docker-compose.e2e.yml` (new overlay) | Adds only what E2E needs beyond the existing prod + dev overlays: a host-published Postgres port for the test runner's seed/reset client, and fixed deterministic env (test secrets, test admin email, SMTP pointed at mailpit) | Third `-f` file, composed on top of `docker-compose.yml` + `docker-compose.dev.yml`, same additive-merge pattern the dev overlay already uses |
| `scripts/e2e-compose.sh` (new) | Boots the 3-file compose stack under a distinct project name, waits for health via `--wait` (delegating readiness to Docker's own healthcheck, not a Playwright `webServer` port-probe), runs the Playwright suite, always tears down | Mirrors `scripts/smoke-compose.sh`'s trap/cleanup structure almost line-for-line |
| `apps/api` prisma-client export (new subpath export) | Lets `apps/e2e` reuse the *same* generated Prisma Client (Prisma 7's `output`-path client) for DB seed/reset, instead of duplicating the schema or hand-rolling raw SQL | One line added to `apps/api/package.json`'s `exports` map, pointing at `src/generated/prisma` |
| `mailpit` (existing, `docker-compose.dev.yml`) | SMTP catcher for magic-link emails; also serves E2E as the assertable inbox | Already wired for Fastify's nodemailer client (`SMTP_HOST=mailpit:1025`); E2E test runner reads its REST API on the published `8025` port |
| CI `e2e` job (new, `ci.yml`) | Gates merge on real browser-driven proof against the actual shipped artifact | New job, `needs: [test, smoke]`, reuses `smoke`'s image-build step (add `cache-from: type=gha` to avoid a second cold build) |

## Recommended Project Structure

```
apps/
├── api/                          # existing — unchanged, +1 export line
│   ├── package.json              # + "exports": { "./prisma-client": "./src/generated/prisma/index.js" }
│   └── src/generated/prisma/     # existing Prisma 7 client output — now also consumed by apps/e2e
├── web/                          # existing — unchanged
└── e2e/                          # NEW workspace package
    ├── package.json              # @kurzly/e2e, devDep @playwright/test, workspace dep on @kurzly/api (prisma-client only)
    ├── playwright.config.ts      # projects: setup / chromium-admin / chromium-member; baseURL from PLAYWRIGHT_BASE_URL
    ├── tsconfig.json
    ├── global-setup.ts           # one-time: confirm stack reachable, seed baseline fixtures, clear mailpit
    ├── global-teardown.ts        # close shared Prisma client
    ├── src/
    │   ├── db.ts                 # thin PrismaClient wrapper against E2E_DATABASE_URL (published :5433), truncate+reseed helper
    │   ├── mailpit.ts             # fetch wrapper: list/search/delete against mailpit:8025 REST API
    │   └── fixtures.ts            # test.extend<>: authenticatedPage(role), resetDb(), mailbox()
    └── tests/
        ├── auth.setup.ts          # magic-link login via mailpit-read link; writes playwright/.auth/{admin,member}.json
        ├── auth/
        │   ├── magic-link.spec.ts
        │   └── sso.spec.ts
        ├── redirect/
        │   ├── slug-redirect.spec.ts
        │   ├── password-gate.spec.ts
        │   ├── expiry.spec.ts
        │   └── bot-og-render.spec.ts
        ├── links/
        │   ├── crud.spec.ts
        │   └── csv-import.spec.ts
        ├── qr/
        │   ├── static.spec.ts
        │   └── dynamic-remap.spec.ts
        ├── analytics/
        │   └── views.spec.ts
        └── team/
            ├── invite-roles.spec.ts
            └── domain-authorization.spec.ts

docker-compose.e2e.yml              # NEW — 3rd overlay, additive to prod + dev
scripts/e2e-compose.sh              # NEW — boot/run/teardown, mirrors smoke-compose.sh
.github/workflows/ci.yml            # MODIFIED — + job:e2e (needs: [test, smoke])
.gitignore                          # MODIFIED — + apps/e2e/playwright/.auth/, apps/e2e/playwright-report/, apps/e2e/test-results/
```

### Structure Rationale

- **`apps/e2e` as its own workspace package, not a root `playwright.config.ts`:** matches this repo's existing convention — `apps/api` and `apps/web` each own their own `vitest.config.ts`, dependencies, and test scripts. A root-level Playwright config would be the odd one out and would force Playwright's browser-download devDependency onto every workspace install. `pnpm-workspace.yaml`'s `apps/*` glob already covers it — zero workspace-config changes needed.
- **New DB port (`5433`) instead of reusing the testcontainers harness:** the Vitest harness (`apps/api/test/globalSetup.ts`) is deliberately ephemeral — one throwaway `testcontainers` Postgres per `vitest run` invocation, torn down at the end, with per-test `BEGIN/ROLLBACK`. E2E needs a *long-lived* Postgres that the actual running `app` container talks to over its own connection — a fundamentally different lifecycle. Giving it its own compose service port and (in CI) its own job keeps the two harnesses from ever touching each other, and a fixed `-p kurzly-e2e` project name means a developer can leave `smoke` or `dev` stacks running locally without collision.
- **Reusing `apps/api`'s generated Prisma Client via a subpath export**, rather than a second schema/generation step in `apps/e2e`: Prisma 7's `output`-path model (per this project's own `.claude/CLAUDE.md` stack notes, and confirmed directly in `apps/api/prisma/schema.prisma`'s `generator client { output = "../src/generated/prisma" }`) means the client already exists at a fixed path after `pnpm run -r build`/`prisma generate`. Duplicating `schema.prisma` into a second package would drift the moment a migration is added; a one-line `exports` addition is the smaller, safer diff.
- **`docker-compose.e2e.yml` as a third additive overlay, not edits to the existing two files:** `docker-compose.yml` is explicitly documented as the production shape (only `app`+`db`, no Mailpit) and `docker-compose.dev.yml` is explicitly "dev/CI-only... NEVER referenced by the production docker-compose.yml." Both carry load-bearing comments about what they intentionally exclude. A third file preserves those invariants and lets `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` (today's documented dev workflow) keep working completely unchanged.

## Architectural Patterns

### Pattern 1: Compose `--wait` + healthcheck as the readiness gate (not Playwright's `webServer`)

**What:** Let Docker Compose's own `--wait` flag (already used in `scripts/smoke-compose.sh`) block until the `app` service's `HEALTHCHECK` passes, *before* Playwright ever starts. Do not configure Playwright's `webServer.url` option against the compose-published port.
**When to use:** Any time the target under test is a multi-container compose stack rather than a single local process.
**Trade-offs:** Slightly more moving parts (a bash script instead of one config block) — but Playwright's `webServer` readiness is a bare TCP/HTTP poll against a port that Compose can open *before* the process inside is actually listening (community-reported race condition, LOW-confidence single-source finding but consistent with this repo's own healthcheck-vs-port-open distinction already called out in `docker-compose.yml`'s comments about `condition: service_healthy`). Reusing the healthcheck this project already ships avoids reintroducing that race.

**Example:**
```bash
# scripts/e2e-compose.sh (new — mirrors scripts/smoke-compose.sh's shape)
COMPOSE=(docker compose -p kurzly-e2e \
  -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml)
trap 'cleanup' EXIT   # docker compose down -v --remove-orphans, same as smoke script

"${COMPOSE[@]}" up -d --wait          # blocks on app's existing HEALTHCHECK
pnpm --filter @kurzly/e2e test        # PLAYWRIGHT_BASE_URL defaults to http://localhost:3000
```

### Pattern 2: `auth.setup.ts` + `storageState` dependency, once per role per run

**What:** A dedicated Playwright "setup project" logs in once per role (admin, member) via the real magic-link flow — request the link, read it out of Mailpit's REST API, follow it, then `page.context().storageState({ path })`. Every other project declares `dependencies: ['setup']` and `use: { storageState: 'playwright/.auth/<role>.json' }`.
**When to use:** Every spec that needs an authenticated session and doesn't specifically test the login flow itself (those live in `auth/magic-link.spec.ts` and exercise the real round-trip once).
**Trade-offs:** Removes the dominant cost in this suite — a magic-link round-trip through a real SMTP catcher is one of the slower operations available, and repeating it per spec file would make the domain-scoped-authorization and team-management suites (which need both an admin and a member session) multiply that cost. The trade-off is that `playwright/.auth/*.json` must be gitignored (it holds live session cookies) and regenerated every run — already accounted for in the `.gitignore` addition above.

**Example:**
```typescript
// apps/e2e/tests/auth.setup.ts
import { test as setup } from '@playwright/test';
import { readMagicLink } from '../src/mailpit';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  const link = await readMagicLink(process.env.E2E_ADMIN_EMAIL!);
  await page.goto(link);
  await page.context().storageState({ path: 'playwright/.auth/admin.json' });
});
```

### Pattern 3: Truncate-and-reseed per spec file, not `BEGIN/ROLLBACK`

**What:** Each spec file's `test.beforeAll` (or a `resetDb()` fixture) truncates mutable tables (`Link`, `QrCode`, `ClickEvent`, `TeamInvite`, etc. — leave `User`/`Domain` baseline fixtures seeded once in global setup) and reseeds the fixtures that spec needs, via the shared Prisma client from `apps/e2e/src/db.ts`.
**When to use:** Any E2E suite where the app-under-test and the test runner are separate processes with separate DB connections.
**Trade-offs:** The `apps/api` Vitest integration suite can wrap each test in `BEGIN/ROLLBACK` because the test *is* the one holding the transaction and the same code path executes inside it. E2E can't do that — the real `app` container owns its own Prisma connection, driving a real HTTP request through a real browser, so there is no single transaction to roll back. Truncate/reseed is the standard workaround for exactly this cross-process boundary (cross-checked across multiple general sources, MEDIUM confidence) and is directly analogous to the "per-file cloned-DB isolation" fix this project's *own* Vitest harness already had to adopt for the same underlying reason (nested-transaction/interactive-`$transaction` conflicts) — see `.planning/PROJECT.md`'s Key Decisions table.

## Data Flow

### Request Flow (E2E run)

```
scripts/e2e-compose.sh
    ↓ docker compose -p kurzly-e2e up -d --wait
[db healthy] → [app: entrypoint.sh runs migrate deploy → node dist/server.js] → [mailpit up]
    ↓
pnpm --filter @kurzly/e2e test
    ↓
global-setup.ts → seed baseline (Domain, admin/member Users) via @kurzly/api prisma-client @ :5433
    ↓
project:setup (auth.setup.ts) → real magic-link round trip → mailpit REST API :8025 → storageState written
    ↓
spec projects (chromium-admin / chromium-member) → browser → app :3000 (real HTTP, real Fastify, real Postgres)
    ↓ (per file) resetDb() truncate+reseed
[assertions against rendered DOM / redirect Location headers / HTTP status codes]
    ↓
global-teardown.ts → close Prisma client
    ↓
scripts/e2e-compose.sh trap → docker compose down -v --remove-orphans
```

### Key Data Flows

1. **Magic-link email retrieval:** `app` (nodemailer) → SMTP :1025 → `mailpit` → E2E test runner polls `mailpit`'s HTTP API (:8025) for the message addressed to the test email, extracts the link, navigates to it. No real email provider is ever involved.
2. **DB seed/reset:** E2E test runner (host process) ↔ `db` service directly, over the *published* `5433` port — bypassing `app` entirely for setup/teardown, so fixtures are planted without ever exercising the very HTTP layer under test; only real user-facing requests exercise `app`'s own DB connection.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current suite (~7 flow areas per milestone scope) | Single compose stack, single Chromium project per role, sequential CI job — no need for sharding yet |
| Suite grows to 50+ spec files | Turn on Playwright's built-in test sharding (`--shard`) across multiple CI runners, each against its own `-p kurzly-e2e-${shard}` stack (distinct project name/port already established, so this is a config change, not a re-architecture) |
| Suite needs cross-browser (Firefox/WebKit) matrix | Add projects, not new infrastructure — the compose stack and DB reset story are browser-agnostic |

### Scaling Priorities

1. **First bottleneck:** compose stack boot time (image build + `--wait` healthcheck ~30-60s) dominates wall-clock for a small suite. Mitigate with `cache-from: type=gha` on the E2E job's image build (already the pattern the `release` job uses) so most runs reuse cached layers.
2. **Second bottleneck (only once the suite is large):** a single shared Postgres serialized across all spec files. Truncate/reseed per file is fine at today's scale; if parallel workers start fighting over the same tables, revisit with per-worker DB schemas (`search_path`) before reaching for per-worker containers.

## Anti-Patterns

### Anti-Pattern 1: Running E2E against Vite dev server + `tsx watch` Fastify as the CI-gating target

**What people do:** Point Playwright at `vite dev` (proxying `/api` to a locally-run Fastify process) because it's faster to boot than a Docker image.
**Why it's wrong:** This project's Core Value is the redirect handler behaving correctly *as deployed* — the dev-server split never exercises `@fastify/static` single-origin serving, `@fastify/helmet`'s CSP, the migration-on-boot entrypoint, or the exact bot-OG-rendering code path the way the shipped image does. A passing E2E suite against dev servers proves less than this project's own `smoke-compose.sh` already proves for a plain boot.
**Do this instead:** Make the built-image/compose stack the canonical, CI-gating target (`PLAYWRIGHT_BASE_URL=http://localhost:3000` from the compose stack). Dev servers remain a legitimate *local-iteration* convenience — override `PLAYWRIGHT_BASE_URL` when hand-writing a new spec against `pnpm --filter @kurzly/api dev` + `pnpm --filter @kurzly/web dev` (whose Vite proxy already forwards `/api` and `/health`) — but never the merge-gating path.

### Anti-Pattern 2: Sharing the Vitest testcontainers Postgres (or its port) with E2E

**What people do:** Try to reuse the same ephemeral testcontainers instance the Vitest suite already stands up, to "avoid running two Postgres instances."
**Why it's wrong:** The testcontainers Postgres exists only for the lifetime of one `vitest run` invocation, on a random host port, with no persistent volume, and is torn down the instant that job's process exits — it's gone long before an E2E job (which needs the real `app` container's own long-running connection) would even start, and even if timing lined up, `vitest`'s per-test `BEGIN/ROLLBACK` isolation would fight with the real app's own concurrent connection.
**Do this instead:** A separate, purpose-built `db` service (already exists in `docker-compose.yml`) with its own fixed port published only in the `e2e` overlay, run in a separate CI job (`needs: [test, smoke]`) so the two harnesses never overlap in time or process.

### Anti-Pattern 3: Checking `playwright/.auth/*.json` into git "to speed up CI"

**What people do:** Commit the generated storageState files so CI can skip the `auth.setup.ts` project entirely.
**Why it's wrong:** These files hold live session cookies/tokens for whatever account they were generated against — committing them is a credential leak (and stale sessions/cookie rotation will make them useless within days anyway, per better-auth's session expiry).
**Do this instead:** Regenerate them every run via the `setup` project; gitignore the directory. The cost is one magic-link round trip per role per run, not per spec file (Pattern 2 above already amortizes this).

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Mailpit (`docker-compose.dev.yml`, existing) | `app`'s nodemailer client → SMTP `mailpit:1025` (compose-internal DNS name); E2E test runner → REST API `http://localhost:8025/api/v1/messages` (published port) | Must clear the inbox (`DELETE /api/v1/messages`) in global setup and/or per-file, or a later spec's "find the magic-link email" query can match a stale message from an earlier spec |
| Postgres (`db` service, existing + e2e-overlay port) | E2E test runner → direct Prisma connection on published `5433`; `app` → internal `db:5432` (unchanged) | Two separate connections to the *same* container are fine (Postgres handles concurrent connections natively) — this is not the same risk as sharing the ephemeral testcontainers instance |
| OIDC/SSO IdP (deferred — flagged, not solved here) | Target feature list includes an OIDC/SSO login E2E spec, but `docker-compose.yml`/`.env.example` assume a real external IdP (Keycloak/Authentik/Azure AD) — no mock IdP exists in this repo today | **Research flag for whichever phase plans the OIDC/SSO spec:** evaluate a mock-OIDC-provider compose service (e.g. a small mock-OAuth2-server image) as a 4th overlay addition before planning that spec; do not attempt to hit a real external IdP from CI |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `apps/e2e` ↔ `apps/api` | Workspace dependency (`workspace:*`) on the *published subpath export only* (`@kurzly/api/prisma-client`) — never imports API route/business logic | Keeps E2E a true black-box consumer of the running HTTP service; the only "white-box" reach-through is the DB seed/reset helper, which is explicitly a test-infrastructure concern, not a shortcut around the HTTP layer |
| `apps/e2e` ↔ `packages/shared` | Optional — reuse existing DTO types (e.g. link/QR/domain shapes) for typing seed fixtures and response assertions, same as `apps/web` already does | Avoids a third hand-written copy of these shapes |
| CI `e2e` job ↔ `smoke` job | Sequential (`needs: [test, smoke]`), not merged into one job | `smoke` proves a bare boot + one canary write; `e2e` proves full user-facing flows. Keeping them separate means a `smoke` failure fails fast without ever installing Playwright's browsers, and `e2e`'s (heavier) browser download only runs once `smoke` has already proven the image itself is sound |

## Sources

- This repository's own prior art (HIGH confidence, first-party, directly inspected this session): `docker-compose.yml`, `docker-compose.dev.yml`, `scripts/smoke-compose.sh`, `apps/api/test/globalSetup.ts`, `apps/api/vitest.config.ts`, `apps/api/prisma/schema.prisma`, `Dockerfile`, `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `.env.example`, `apps/web/vite.config.ts`, `.planning/PROJECT.md`
- [Playwright official docs: Authentication (storageState / auth.setup.ts pattern)](https://playwright.dev/docs/auth) — MEDIUM confidence, cross-checked across multiple independent write-ups
- [BrowserStack: Using Playwright's storageState](https://www.browserstack.com/guide/playwright-storage-state) — MEDIUM confidence
- [Kyrre Gjerstad: Setting Up E2E Testing with Playwright — Monorepo vs Standard Repository](https://www.kyrre.dev/blog/end-to-end-testing-setup) — MEDIUM confidence (monorepo package-boundary rationale)
- General web search synthesis on Playwright + Docker Compose `webServer`/race-condition behavior and Postgres truncate-vs-transaction reset strategies for cross-process E2E — LOW/MEDIUM confidence, single-pass web search only (no MCP docs provider available this session); flagged for re-verification against Playwright's own docs at implementation time

---
*Architecture research for: Kurzly v1.1 — Playwright E2E integration*
*Researched: 2026-07-24*
