# Phase 11: Playwright E2E Infrastructure & Fixtures - Research

**Researched:** 2026-07-24
**Domain:** Playwright E2E test harness for an existing Fastify + Vue + Postgres + better-auth monorepo, added against the shipped v1.0 Docker/compose stack
**Confidence:** MEDIUM-HIGH (all repo-state claims verified by directly reading the actual files this session; Mailpit REST API shape verified empirically against a live `axllent/mailpit:latest` container; `@fastify/rate-limit`'s `allowList` mechanism verified against the actual installed package README; package versions verified via `npm view`/registry)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Workspace & config layout**
- New pnpm workspace package `apps/e2e` (`@kurzly/e2e`), sibling to `apps/api`/`apps/web` — already covered by `pnpm-workspace.yaml`'s `apps/*` glob, zero workspace-config changes needed. Do NOT put a root-level `playwright.config.ts` — matches the existing per-app config convention.
- `@playwright/test` ^1.61.x as devDependency of `apps/e2e` only.
- `playwright.config.ts`: `baseURL` from `PLAYWRIGHT_BASE_URL` env (default `http://localhost:3000`). Projects: `setup` (runs `auth.setup.ts`), `chromium-admin`, `chromium-member` — the latter two declare `dependencies: ['setup']` and `use: { storageState: 'playwright/.auth/<role>.json' }`.
- `apps/e2e` reuses `apps/api`'s existing generated Prisma Client (`apps/api/src/generated/prisma`) via a new subpath export added to `apps/api/package.json`'s `exports` map — do NOT duplicate `schema.prisma` or hand-roll raw SQL in a second package. `apps/e2e` declares a `workspace:*` dependency on `@kurzly/api` for this subpath only; it must never import API route/business-logic modules.

**Target under test**
- E2E's canonical, CI-gating target is the **built Docker/compose image**, never split Vite-dev-server + `tsx watch` Fastify.
- New third additive compose overlay `docker-compose.e2e.yml` (on top of `docker-compose.yml` + `docker-compose.dev.yml`). Publishes Postgres on `5433` for the test runner's direct seed/reset client, pins deterministic test env. Boots under `-p kurzly-e2e`.
- New `scripts/e2e-compose.sh`, mirroring `scripts/smoke-compose.sh`'s trap/cleanup/`.env`-bootstrap structure.

**Email capture (Mailpit)**
- Mailpit already exists in `docker-compose.dev.yml` — reuse as-is, do not add a second instance. E2E reads Mailpit's REST API on published `8025`.
- Build `apps/e2e/src/mailpit.ts`: thin fetch wrapper to list/search-by-recipient/delete messages. Scope every read by the unique test-recipient address, not "the latest message." Clear the inbox in global-setup; consider per-file isolation via unique recipient addresses (e.g. `admin+${testId}@e2e.kurzly.local`) — confirm this works with `isEmailAllowed`'s allowlist matching during planning.

**Database isolation**
- Give E2E its own long-lived Postgres connection via the e2e overlay's published `5433` port — do NOT touch, share, or extend the Vitest testcontainers harness.
- Reset strategy: **truncate-and-reseed per spec file** via a `resetDb()` fixture in `apps/e2e/src/db.ts`, NOT `BEGIN/ROLLBACK`.
- `global-setup.ts` seeds baseline fixtures once per run (a Domain, admin User, one Member User with a DomainMembership) directly via Prisma — do NOT drive the real invite-UI flow in this phase. Both seeded users get `emailVerified: true`.

**Auth fixture (storageState)**
- `apps/e2e/tests/auth.setup.ts` performs one real magic-link round trip per role, writes `playwright/.auth/<role>.json`. Every other spec declares `dependencies: ['setup']` and reuses saved state.
- `playwright/.auth/*.json` MUST be gitignored and regenerated every run. Add to `.gitignore`: `apps/e2e/playwright/.auth/`, `apps/e2e/playwright-report/`, `apps/e2e/test-results/`.
- Verify during planning/execution what better-auth's client actually persists (cookie-only vs. `sessionStorage`/`localStorage`) before assuming `storageState`'s cookie+localStorage capture is sufficient.

**Rate-limit test bypass (INFRA-06)**
- Do NOT blanket-disable `@fastify/rate-limit`. Existing per-route limits stay registered as-is.
- Recommended mechanism: a narrow, env-gated bypass — an `E2E_RATE_LIMIT_BYPASS_SECRET` env var set ONLY in `docker-compose.e2e.yml` (never in prod, never with a default in `env.ts`) that, when a request carries a matching `x-e2e-bypass` header, routes that request around the limiter. Most fixtures send this header by default; the one dedicated rate-limit-proof spec (Phase 13 scope) omits it to observe a real 429.

**CI wiring**
- New `e2e` job in `.github/workflows/ci.yml`, `needs: [test, smoke]`. Reuse `smoke`'s image-build step, add `cache-from: type=gha`.
- Upload Playwright's HTML report and trace files as CI artifacts on failure (`actions/upload-artifact`, `if: failure()`).

### Claude's Discretion
Exact Playwright project/file naming beyond what's specified above, exact `resetDb()` table-truncation list and ordering (respecting FK constraints), exact shape of the `x-e2e-bypass` header-to-bypass-key wiring inside `plugins/rateLimit.ts`, and whether the Prisma Client subpath export needs a matching `.d.ts`/type export path for `apps/e2e`'s TypeScript config.

### Deferred Ideas (OUT OF SCOPE)
- Mock OIDC/SSO IdP container (needed for Phase 13's SSO E2E spec, not this phase) — no mock IdP exists in this repo today.
- Per-worker DB schemas (`search_path`) or per-worker containers, if the truncate/reseed strategy ever starts contending under parallel workers — not needed at this milestone's scale, revisit only if it becomes a real bottleneck.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| INFRA-01 | `apps/e2e` workspace package, runs against the built Docker image, never split dev servers | Verified `pnpm-workspace.yaml`'s `apps/*` glob already covers a new `apps/e2e` dir with zero config changes; `scripts/smoke-compose.sh` is a directly reusable structural template; see Architecture Patterns §1 and Code Examples §1 |
| INFRA-02 | Mailpit readable from Playwright via HTTP API | Verified exact live REST API shape (`/api/v1/messages`, `/api/v1/search?query=to:`, `/api/v1/message/{ID}`, `DELETE /api/v1/messages`) against the actual `axllent/mailpit:latest` image (v1.30.5) already in `docker-compose.dev.yml`; see Mailpit REST API section |
| INFRA-03 | Isolated, resettable Postgres for E2E, separate from Vitest testcontainers | Verified `apps/api/test/globalSetup.ts`'s ephemeral testcontainers model is structurally incompatible with E2E's long-lived-connection need; confirmed `docker-compose.yml`'s `db` service has no published port today (E2E overlay must add one); see Architecture Patterns §2/§3 |
| INFRA-04 | Reusable `storageState` fixture per role | Verified `apps/web` has NO better-auth client SDK and NO `sessionStorage`/`localStorage` use for session state at all — session lives entirely in an httpOnly cookie, re-derived via `GET /api/auth/get-session` on each navigation; `storageState`'s cookie capture is therefore fully sufficient — closes CONTEXT.md's open question 1 with certainty, not just a recommendation. See Validation Architecture and Common Pitfalls |
| INFRA-05 | CI job after test/build, report/trace artifacts on failure | Verified exact `ci.yml` job shape/conventions (`smoke` job as template) to sketch a concrete, pasteable `e2e` job; see CI YAML Sketch |
| INFRA-06 | Narrow rate-limit test bypass, not blanket disable | Verified `@fastify/rate-limit@11.1.0`'s own `allowList` option (function form) is the correct, non-hand-rolled mechanism — set once at `registerRateLimit`'s global registration, applies across the global default AND every named per-route override without per-route edits; see Don't Hand-Roll and Code Examples §2 |
</phase_requirements>

## Summary

This phase adds a new `apps/e2e` pnpm workspace package running Playwright against the already-shipped, production-shaped Kurzly Docker/compose stack. The milestone-level research (STACK/ARCHITECTURE/PITFALLS.md) already made the big architectural calls correctly and this document does not relitigate them — it verifies them against the actual current repo state and fills in the concrete mechanics the planner needs.

Three repo-state facts materially refine (not contradict) the milestone research:

1. **The generated Prisma client has no `index.js`.** Prisma 7's `prisma-client` provider generates readable TypeScript source directly at `apps/api/src/generated/prisma/{client,browser,commonInputTypes,enums,models}.ts` (plus `internal/` and `models/` subdirs) — there is no compiled JS/`.d.ts` pair anywhere in that tree, and `apps/api`'s own `tsup` build bundles the whole thing into one `dist/server.js`, leaving nothing separately importable from `dist/`. The correct subpath-export target is the raw `client.ts` file itself, which diverges from this monorepo's only existing cross-package precedent (`packages/shared` exports a `tsc`-built `dist/index.js`+`.d.ts` pair). This is workable (Playwright's runtime has native TS support) but must be proven empirically as the very first `apps/e2e` task, not assumed.
2. **`apps/web` has no better-auth client SDK and stores nothing outside a cookie.** The dashboard talks to `/api/auth/*` via plain `fetch()`; the Pinia `authSession` store is pure in-memory state, rehydrated via `GET /api/auth/get-session` on every router-guard navigation. This fully closes CONTEXT.md's `storageState` open question — cookie-only `storageState` reuse is safe by construction, not merely "probably fine."
3. **The invite-only allowlist is an exact-string `findUnique({ where: { email } })`.** Plus-addressed recipient variants (`admin+e2e@...`) are NOT automatically treated as "the same" email — each must be seeded as its own literal `User` row. This is good news for per-worker isolation (it just needs global-setup to seed N literal rows) but rules out any assumption that sub-addressing "just works" against a single seeded admin row.

**Primary recommendation:** Build `apps/e2e` exactly per CONTEXT.md's locked architecture, but sequence the very first task as an empirical spike proving the Prisma-client subpath import resolves and executes inside Playwright's runtime (not tsup/tsc) — this is the one genuinely unverified mechanical risk in the whole plan. Implement the rate-limit bypass using `@fastify/rate-limit`'s built-in `allowList` function option (not a custom key-generator hack) registered once in `registerRateLimit`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Playwright test runner/config/fixtures | Test infrastructure (new, host process) | — | Runs outside all containers, drives the browser against the compose-published port |
| Compose orchestration (3-file overlay, `-p kurzly-e2e`) | DevOps/CI tooling | — | Bash script + Docker Compose, not application code |
| Email capture & retrieval | External Service (Mailpit, existing dev-compose service) | Test infrastructure (`mailpit.ts` client) | Mailpit owns SMTP capture + REST API; the E2E client is a thin consumer |
| DB seed/reset for E2E fixtures | Database/Storage (direct Prisma, bypassing HTTP) | Test infrastructure (`db.ts`) | Deliberately bypasses the API tier for setup/teardown plumbing only — never for entities under test |
| Session/auth proof | API / Backend (`better-auth` via Fastify, unchanged) | Browser (cookie storage only) | No new auth logic in this phase; the fixture only *exercises* the existing tier boundary |
| Rate-limit bypass mechanism | API / Backend (`@fastify/rate-limit` plugin config) | — | Must live inside the existing Fastify plugin registration, not in test infrastructure — it's a server-side gate, however narrowly scoped |
| CI job sequencing | CI/CD (GitHub Actions) | — | New `e2e` job, no application-tier changes |

**Why this matters here:** the single biggest risk in this phase is capability leakage across the "test infra ↔ application" boundary — e.g., accidentally putting the rate-limit bypass logic in `apps/e2e` instead of `apps/api`'s own plugin (which would mean the app never actually has the mechanism, only the test client "cheats" some other way), or letting `apps/e2e` import API business logic instead of staying a black-box HTTP consumer (CONTEXT.md is explicit about this boundary; this map exists to make it checkable during planning).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `@playwright/test` | `^1.61.1` [VERIFIED: npm registry, 2026-07-24 — `dist-tags.latest` = `1.61.1`; `engines: {node: ">=18"}`, comfortably covered by the project's Node 24 baseline] | E2E test runner, browser automation, `storageState`, tracing | Already locked in CONTEXT.md; current stable; package-legitimacy gate passed (see audit below) |
| Docker `axllent/mailpit:latest` (already in `docker-compose.dev.yml`) | Resolves to **v1.30.5** as of this session [VERIFIED: live `docker run axllent/mailpit:latest` + `GET /api/v1/info` → `{"Version":"v1.30.5", ...}`, this session] | SMTP capture + REST API for magic-link retrieval | Already shipped in this repo; reused verbatim per CONTEXT.md — do not add a second instance or pin a different tag |
| `@testcontainers/postgresql` | Already a devDependency of `apps/api` (`^12.0.4`) [VERIFIED: `apps/api/package.json`] | NOT reused for E2E's app-under-test DB (that's the compose `db` service via published `5433`) — remains local-only for the existing Vitest harness | CONTEXT.md is explicit: do not touch or extend this harness for E2E |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pg` (transitively resolved via `@prisma/adapter-pg`, already in `apps/api`) | matches lockfile | Only needed if `apps/e2e/src/db.ts` wants raw `TRUNCATE ... RESTART IDENTITY CASCADE` alongside the reused Prisma client | Prefer `prisma.$executeRawUnsafe('TRUNCATE ... CASCADE')` through the reused Prisma client instead of adding a second driver dependency — avoids a redundant `pg` devDependency in `apps/e2e/package.json` entirely |

### Alternatives Considered

No new alternatives beyond what the milestone-level STACK.md already evaluated (Mailpit vs. MailHog, `@testcontainers/postgresql` vs. native GH Actions `services:` block, native sharding vs. hand-split jobs) — this phase does not revisit those calls.

**Installation:**
```bash
mkdir -p apps/e2e
# apps/e2e/package.json — see Recommended Project Structure below for full shape
pnpm --filter @kurzly/e2e add -D @playwright/test@^1.61.1
pnpm --filter @kurzly/e2e exec playwright install --with-deps chromium
```

**Version verification:** confirmed via `npm view @playwright/test dist-tags --json` this session — `latest: "1.61.1"`. `@fastify/rate-limit` (already installed, `^11.1.0`) confirmed to ship the `allowList` function-form option needed for INFRA-06 by extracting and reading its actual README (`npm pack @fastify/rate-limit@11.1.0`), not from memory.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `@playwright/test` | npm | actively released (latest publish 2026-06-23 per registry metadata) | ~48.0M/week | `github.com/microsoft/playwright` | **OK** [VERIFIED: `gsd-tools query package-legitimacy check`, this session] | Approved |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

No other new npm packages are installed in this phase — Mailpit is a pre-existing Docker image (not an npm dependency), `@testcontainers/postgresql` is already an approved, shipped dependency, and the rate-limit bypass reuses the already-installed, already-vetted `@fastify/rate-limit`.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CI: GitHub Actions (ci.yml)                                             │
│  job:test  → job:smoke → job:e2e (NEW)                                  │
│                              │ needs: [test, smoke]                     │
└──────────────────────────────┼───────────────────────────────────────────┘
                                ▼
        scripts/e2e-compose.sh (NEW, mirrors smoke-compose.sh)
                                │
                                ▼
   docker compose -p kurzly-e2e \
     -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml \
     up -d --wait   ◄── blocks on app's existing HEALTHCHECK, not a TCP probe
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                         ▼
   ┌─────────┐           ┌───────────┐              ┌──────────┐
   │  app    │──SMTP────►│  mailpit  │              │    db    │
   │(built   │  :1025    │ (existing │              │postgres18│
   │ image)  │           │ dev ovl)  │              │          │
   │:3000    │           │ web/API   │              │:5432 (int)│
   │(publ.)  │           │  :8025    │              │:5433(NEW,│
   └────┬────┘           │ (publ.)   │              │ e2e ovl, │
        │ pg :5432(int)  └─────┬─────┘              │ publ.)   │
        └────────────────────────────────────────────┘─────┬────┘
                                │                            │
                                ▼                            ▼
                     pnpm --filter @kurzly/e2e test  (host process)
                                │
     ┌──────────────┬──────────┴───────────┬────────────────────┐
     ▼              ▼                      ▼                    ▼
global-setup.ts  auth.setup.ts       spec files          global-teardown.ts
(seed via        (magic-link round   (chromium-admin/    (close shared
 @kurzly/api     trip via mailpit,   -member projects,   Prisma client)
 prisma-client   writes storageState  reuse storageState,
 @ :5433)        per role)            resetDb() per file)
```

**Reading this diagram for the primary use case (a spec proving an authenticated route):** CI triggers `e2e-compose.sh` → compose boots all three services and blocks on the real HEALTHCHECK → Playwright's `global-setup.ts` seeds baseline Domain/User rows directly via Prisma against the published `5433` port → the `setup` project's `auth.setup.ts` requests a magic link over real HTTP to `app:3000`, reads it from Mailpit's REST API on `8025`, follows it, and snapshots `storageState` → every downstream spec project loads that `storageState` into a fresh browser context and asserts against `app`'s real, running HTTP surface — never re-authenticating.

### Recommended Project Structure

```
apps/e2e/
├── package.json              # @kurzly/e2e, private, devDep @playwright/test, workspace dep on @kurzly/api (prisma-client subpath only)
├── tsconfig.json             # extends ../../tsconfig.base.json (matches apps/api's own extension pattern)
├── playwright.config.ts      # projects: setup / chromium-admin / chromium-member; baseURL from PLAYWRIGHT_BASE_URL
├── global-setup.ts           # seed baseline fixtures once, clear mailpit inbox
├── global-teardown.ts        # close shared Prisma client
├── src/
│   ├── db.ts                 # PrismaClient wrapper against E2E_DATABASE_URL (:5433), truncate+reseed helper
│   ├── mailpit.ts             # fetch wrapper: search-by-recipient / read / delete against mailpit REST API
│   └── fixtures.ts           # test.extend<>: authenticatedPage(role), resetDb(), mailbox()
└── tests/
    ├── auth.setup.ts          # magic-link login via mailpit-read link; writes playwright/.auth/{admin,member}.json
    └── smoke/
        ├── db-isolation.spec.ts     # throwaway: P2002-free at workers=1 and workers=N (success criterion 3)
        ├── storage-state.spec.ts    # throwaway: fresh context + saved storageState reaches an authenticated route (success criterion 4)
        ├── mailpit-wiring.spec.ts   # throwaway: zero cross-worker email theft at workers=N (success criterion 2)
        └── rate-limit-bypass.spec.ts # throwaway: bypass header works, a request WITHOUT it still gets a real 429 (success criterion 5)

docker-compose.e2e.yml         # NEW — 3rd overlay, additive
scripts/e2e-compose.sh         # NEW — boot/run/teardown
.github/workflows/ci.yml       # MODIFIED — + job:e2e
.gitignore                     # MODIFIED — + apps/e2e/playwright/.auth/, playwright-report/, test-results/
apps/api/package.json          # MODIFIED — + exports map for the prisma-client subpath
```

**Structure rationale — deviation flagged:** unlike `packages/shared` (which exports a `tsc`-built `dist/index.js`+`.d.ts` pair — see Structure Deviation section below), `apps/api`'s Prisma-client export necessarily points at raw generated TypeScript source, because Prisma 7's `prisma-client` provider does not emit a separately-compilable artifact outside `apps/api`'s own bundled `dist/server.js` (which inlines and discards the module boundary). This is the one place this phase's structure genuinely differs from established monorepo convention — call it out explicitly in the plan rather than silently copying `packages/shared`'s exports shape.

### Pattern 1: Compose `--wait` + healthcheck as the readiness gate (not Playwright's `webServer`)

**What:** Let `docker compose ... up -d --wait` block on `app`'s existing `HEALTHCHECK` (verified: `docker-compose.yml`'s `app` service already has one, `GET /health` via a `node -e fetch(...)` check, `start_period: 30s`). Do not configure Playwright's `webServer.url` against the compose stack.
**When to use:** Always, for this phase — the app healthcheck already exists and is proven by `scripts/smoke-compose.sh`.
**Verified in this repo:** `scripts/smoke-compose.sh` line 62-63 (`"${COMPOSE[@]}" up -d --wait`) is the exact, already-working precedent to mirror in the new `scripts/e2e-compose.sh`.

### Pattern 2: `auth.setup.ts` + `storageState` dependency, once per role per run

**What:** A dedicated Playwright "setup project" performs one real magic-link round trip per role, snapshots `storageState`. Every other project declares `dependencies: ['setup']`.
**Verified safe in this repo (see Validation Architecture / Common Pitfalls below):** `apps/web` has zero `sessionStorage` usage and zero `localStorage` usage for anything session-related (only `theme.ts`/`main.ts` use `localStorage`, for the UI theme preference — unrelated to auth). The auth session itself lives ONLY in the httpOnly cookie set by better-auth's `/api/auth/*` handlers and is re-derived via `GET /api/auth/get-session` on every router-guard navigation (`apps/web/src/router/index.ts` lines 92-104, `apps/web/src/stores/authSession.ts`). `storageState`'s cookie capture is therefore provably sufficient — this closes what CONTEXT.md flagged as an open question.

### Pattern 3: Truncate-and-reseed per spec file, not `BEGIN/ROLLBACK`

**What:** Each spec file's `resetDb()` fixture truncates mutable tables and reseeds baseline fixtures via the shared Prisma client from `apps/e2e/src/db.ts`.
**FK-aware truncation order (derived directly from `apps/api/prisma/schema.prisma`'s actual relations, this session):** leaf-first order respecting cascade direction —
```
QrRemapHistory → QrCode → ClickEvent → Link → DomainMembership → (keep Domain, User, Session, Account, Verification seeded once in global-setup unless a spec specifically needs a fresh Domain/User)
```
Note `Link.creator` uses `onDelete: SetNull` (not cascade) — deleting a seeded User would null out `createdBy` on any surviving Link rather than delete it, so if a spec truncates `User` rows it must also explicitly truncate `Link` first or accept orphaned `createdBy: null` rows. Recommend `TRUNCATE "QrRemapHistory", "QrCode", "ClickEvent", "Link", "DomainMembership" RESTART IDENTITY CASCADE;` as the default per-file reset, leaving `User`/`Domain`/`Session`/`Account`/`Verification` seeded once in `global-setup.ts` and never truncated mid-run (this also avoids invalidating the `storageState` session cookie, which references a `Session.token` row that must survive between spec files).

## Prisma Client Subpath Export — Verified Mechanics (repo-state deep dive)

**What was assumed at the milestone level (STACK/ARCHITECTURE.md):** `"exports": { "./prisma-client": "./src/generated/prisma/index.js" }`.

**What is actually on disk** [VERIFIED: `ls apps/api/src/generated/prisma`, this session]:
```
apps/api/src/generated/prisma/
├── browser.ts
├── client.ts            ← the actual main entry point (exports PrismaClient, Prisma namespace, model types)
├── commonInputTypes.ts
├── enums.ts
├── models.ts
├── internal/
└── models/
```
There is **no `index.js`, no `index.ts`, and no compiled `.js`/`.d.ts` anywhere in this tree.** `apps/api`'s own code imports the client as `import { PrismaClient } from "./generated/prisma/client.js"` (`apps/api/src/db.ts`, `apps/api/src/lib/auth.ts`, `apps/api/src/lib/allowlist.ts`, `apps/api/src/routes/canary.ts` — all four consistently use the `client.js` extension-on-a-`.ts`-file convention, which works today because `apps/api`'s own `tsup` build (entry `src/server.ts`, `splitting: false`) bundles it inline — the extension is a TS/Node ESM-authoring convention, not evidence a `client.js` file exists).

**Also confirmed:** `apps/api/package.json` currently has `"main": "dist/server.js"` and **no `"exports"` field at all** [VERIFIED: full file read, this session] — this must be added from scratch, not extended.

**Recommended `exports` addition:**
```jsonc
// apps/api/package.json
{
  "main": "dist/server.js",
  "exports": {
    ".": "./dist/server.js",
    "./prisma-client": "./src/generated/prisma/client.ts"
  }
}
```
Both the `types` and `import` conditions point at the same `.ts` file since Prisma 7's `prisma-client` provider ships self-describing TypeScript source (marked `// @ts-nocheck` internally, but consumable as a normal TS module) rather than a separate declaration file — there is nothing else to point `types` at.

**Why this is workable despite diverging from `packages/shared`'s convention:** `packages/shared`'s `exports` map (`"./dist/index.js"` + `"./dist/index.d.ts"`, built via `tsc -p tsconfig.json`) is the only existing cross-package-import precedent in this repo, and it points at *compiled* output. Pointing `apps/api`'s new subpath at raw `.ts` source is a genuine deviation. It is workable because `apps/e2e`'s consumer (Playwright's test runner) ships its own built-in TypeScript transform (esbuild-based, same class of tool as `tsx`) and does not require pre-compiled JS to execute a `.ts` file it encounters via module resolution — but **this has not been executed in this repository yet** and is the one mechanical detail in this whole plan that is asserted from general TypeScript/Playwright behavior, not from a test run in this repo.

**Recommendation for the plan:** make the very first `apps/e2e` task a minimal spike — a `global-setup.ts` that does nothing but `import { PrismaClient } from '@kurzly/api/prisma-client'`, connect to the E2E Postgres, and `prisma.domain.count()` — and treat this as its own checkpoint before building `db.ts`/`mailpit.ts`/fixtures on top of it. If the subpath import fails to resolve or fails to typecheck under `apps/e2e/tsconfig.json`, the fallback is a small dedicated `tsc --emitDeclarationOnly` (or a one-line `esbuild` transform) step added to `apps/api`'s build that also emits a compiled `.js`+`.d.ts` pair for just this subpath — more consistent with the `packages/shared` precedent, at the cost of a second build target. Do not silently assume the raw-`.ts` export "just works" without this proof step; do not skip straight to building the fallback either, since it adds real complexity that may prove unnecessary.

## Mailpit REST API — Verified Shape (live container test, this session)

Confirmed by running `axllent/mailpit:latest` directly (`docker run -p 18025:8025 -p 11025:1025 axllent/mailpit:latest`), sending a real SMTP message via Python `smtplib`, and querying the REST API:

- **Version:** `GET /api/v1/info` → `{"Version":"v1.30.5", ...}` — matches the milestone STACK.md's already-verified pin.
- **List all:** `GET /api/v1/messages` → `{ "total": N, "count": N, "messages": [ {ID, MessageID, From, To, Subject, Created, Tags, Snippet, ...}, ... ] }`. **Do not use this for retrieval** — it returns everything currently in the mailbox with no recipient filter, which is exactly Pitfall 1's "most recent message" anti-pattern if a test naively takes `messages[0]`.
- **Search by recipient (the correct retrieval mechanism):** `GET /api/v1/search?query=to:<address>` (URL-encode the address) → same shape as list-all, but pre-filtered. Verified this returns exactly and only the message(s) addressed to that recipient.
- **Fetch full message body:** `GET /api/v1/message/{ID}` → includes `"Text"` (plain-text body, unescaped — extract the magic-link URL from here, not `"HTML"`, to avoid handling `&amp;`-escaped query-string ampersands) and `"HTML"` fields, plus `From`/`To`/`Subject`/`Date`.
- **Delete all messages:** `DELETE /api/v1/messages` (verified with both an empty JSON body `{"IDs":[]}` and no body at all) → `200 {"ok"}`, empties the mailbox completely. Use this in `global-setup.ts` to guarantee a clean inbox at run start; a per-file recipient-scoped search already avoids cross-file contamination without needing a delete between every spec file.

**Recommended `apps/e2e/src/mailpit.ts` contract:**
```typescript
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export async function findMagicLinkUrl(recipient: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`);
    const data = await res.json();
    if (data.count > 0) {
      const msg = await fetch(`${MAILPIT_URL}/api/v1/message/${data.messages[0].ID}`).then((r) => r.json());
      const match = msg.Text.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/);
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 500)); // bounded poll, no sleep-and-hope
  }
  throw new Error(`No magic-link email found for ${recipient} within ${timeoutMs}ms`);
}

export async function clearInbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}
```
(Verify the exact magic-link URL path/regex against `apps/api/src/lib/auth.ts`'s actual `sendMagicLink` `url` shape at implementation time — better-auth's `magicLink()` plugin default callback path may not be exactly `/api/auth/magic-link/verify`; confirm empirically against the first real email captured, rather than assuming this pattern.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Narrow rate-limit bypass for E2E (INFRA-06) | A custom per-request "unique key generator" hack, or a bespoke header-check middleware registered separately from `@fastify/rate-limit` | `@fastify/rate-limit`'s own `allowList` option, as a function: `allowList: (request) => Boolean(process.env.E2E_RATE_LIMIT_BYPASS_SECRET) \|\| false` (see Code Examples §2) | [VERIFIED: extracted `@fastify/rate-limit@11.1.0`'s actual README, this session] `allowList` is a first-class plugin option purpose-built for exactly this "some requests should be fully excluded from the limiter" need. Per the README: "the `allowList` if configured: on plugin registration will affect all endpoints within the encapsulation scope" — meaning setting it ONCE in `registerRateLimit`'s global `fastify.register(rateLimit, {...})` call automatically covers the global default bucket AND every named per-route override (`MAGIC_LINK_RATE_LIMIT`, `LINK_CREATE_RATE_LIMIT`, etc.) without touching any of those per-route call sites in `routes/*.ts`. A custom key-generator hack would require touching every route's rate-limit config individually and would still register limiter state, just under an unlimited bucket — `allowList` is the actually-intended API for full exclusion. |
| Magic-link URL extraction from a captured email | Regex-scraping the HTML body (entity-escaped `&amp;` in query strings) | Extract from the `Text` (plain-text) MIME part instead — verified the raw plain-text body contains the unescaped URL directly | Avoids an entity-unescaping step that HTML scraping would otherwise require |
| DB truncate/reset plumbing | Raw `pg` client as a new dependency | `apps/api`'s already-approved Prisma client via `prisma.$executeRawUnsafe('TRUNCATE ...')` | Avoids adding a second DB driver dependency to `apps/e2e/package.json` for a capability the reused Prisma client already provides |
| Compose readiness gating | Playwright's own `webServer.url` TCP/HTTP poll | Docker Compose's own `--wait` against `app`'s existing `HEALTHCHECK` | Already the pattern `scripts/smoke-compose.sh` uses; a bare TCP/HTTP poll can succeed before the process inside is actually ready (documented general race condition), whereas the compose healthcheck is the same one this project already trusts for its smoke tests |

**Key insight:** every "don't hand-roll" item in this phase resolves to "the library/tool this project already trusts elsewhere already has the exact primitive needed" — this phase adds almost no genuinely new mechanisms, it wires existing ones together.

## Common Pitfalls

### Pitfall 1: Shared/global inbox polling makes magic-link tests flaky
**What goes wrong:** Polling `GET /api/v1/messages` and grabbing "the latest message" instead of scoping by recipient.
**Verified in this session:** Mailpit's `GET /api/v1/search?query=to:<address>` exists and correctly filters — use it, never the bare list endpoint, for retrieval.
**How to avoid:** Per-worker/per-role literal seeded email addresses (not plus-addressing tricks unless each variant is separately seeded — see Pitfall 5 below), bounded-timeout polling (the sketch above uses 20s / 500ms interval), clear the inbox once in `global-setup.ts`.

### Pitfall 2: `storageState` reuse silently produces unauthenticated tests
**Status: RESOLVED for this repo, not just mitigated.** Verified `apps/web` has zero `sessionStorage` usage anywhere and zero auth-related `localStorage` usage (only the UI theme preference uses `localStorage`, unrelated to auth). The `authSession` Pinia store (`apps/web/src/stores/authSession.ts`) is pure in-memory `ref` state, re-derived from the httpOnly cookie via `GET /api/auth/get-session` on first navigation (`router/index.ts`'s `beforeEach` guard). `storageState`'s cookie-only capture is therefore certain to be sufficient — no further verification step is needed beyond the smoke spec asserting it (success criterion 4).

### Pitfall 3: Playwright auto-follows redirects, hiding the actual status code
Deferred to Phase 12 (redirect-handler E2E) per the roadmap — not this phase's concern, but the infra this phase builds (`APIRequestContext` usage for status-code assertions) should be available/documented for Phase 12 to consume. No action needed in Phase 11 beyond not accidentally building a `webServer`/navigation-only pattern that would make this harder later.

### Pitfall 4: Shared Postgres + parallel workers collide on unique constraints
**Directly actionable for this phase** (success criterion 3: `workers=1` and `workers=N` both pass with zero `P2002`). Given CONTEXT.md's locked truncate-and-reseed-per-file strategy (not per-worker DB), the practical mitigation is: keep `fullyParallel` scoped so that spec FILES run in parallel but nothing within one file assumes isolation from another concurrently-running file's rows for globally-unique fields (email, slug-within-domain). Since global-setup seeds a fixed small set of baseline rows once (not per-file), and each file's `resetDb()` truncates the *file-scoped* tables (Link, QrCode, ClickEvent, etc.) before reseeding what that file needs, the practical collision risk is between concurrently-running files racing on the SAME truncate — recommend `apps/e2e`'s `resetDb()` acquire a Postgres advisory lock (`pg_advisory_lock`) around the truncate+reseed sequence so two parallel worker files never truncate mid-write of another. This is a deliberate refinement beyond CONTEXT.md's plain "truncate and reseed" wording, added because CONTEXT.md's own truncate-and-reseed choice combined with `fullyParallel` workers otherwise reproduces exactly this pitfall.

### Pitfall 5: Invite-only allowlist is exact-string match — plus-addressing needs explicit seeding
**New finding this session, not in the milestone PITFALLS.md.** `apps/api/src/lib/allowlist.ts`'s `isEmailAllowed` does `prisma.user.findUnique({ where: { email } })` — an exact string equality lookup against `User.email` (`@@unique([email])`). A plus-addressed variant like `admin+worker0@e2e.kurzly.local` is a DIFFERENT string than `admin@e2e.kurzly.local` and will NOT pass the allowlist unless a `User` row exists with that exact literal email. **How to avoid:** if per-worker/per-test email isolation via sub-addressing is wanted, `global-setup.ts` must seed one literal `User` row per variant actually used (e.g., one admin + one member row per Playwright worker index, using `process.env.TEST_PARALLEL_INDEX`), not rely on Mailpit or better-auth "normalizing" the address. Given this phase's success criteria only require ONE admin and ONE member `storageState` (not per-worker fixtures), the simplest compliant approach is: seed exactly two literal User rows (one admin, one member) in `global-setup.ts`, run the `auth.setup.ts` setup project at its default single-worker semantics (Playwright always runs `dependencies` projects before dependent projects, and setup projects are not divided across workers the same way spec files are), and reserve per-worker email variants only if/when a later phase's spec needs concurrent independent logins (not needed here).

### Pitfall 6: `@fastify/rate-limit` throttles E2E specs that hammer the same IP
Addressed directly via the `allowList` mechanism above (Don't Hand-Roll). The dedicated proof spec (this phase's own success criterion 5) must send a request WITHOUT the `x-e2e-bypass` header/secret and assert it still receives a real 429 — proving the limiter itself is not silently defeated by NODE_ENV or similar global condition.

### Pitfall 7: CI-only flakiness from container resource limits, browser caching, startup ordering
**Concrete additions for this repo's `e2e` job** (see CI YAML Sketch): run Chromium with `--disable-dev-shm-usage` (do not rely on default `/dev/shm` sizing on the GitHub-hosted runner), do NOT cache `~/.cache/ms-playwright` across runs (per milestone STACK.md's own "What NOT to Use" — a stale cache pinned to an old browser build is a documented footgun); instead run `pnpm --filter @kurzly/e2e exec playwright install --with-deps chromium` fresh every run (acceptable cost at this milestone's scale — revisit only if wall-clock time becomes a real problem).

## Code Examples

### 1. `scripts/e2e-compose.sh` (mirrors the verified structure of `scripts/smoke-compose.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -p kurzly-e2e \
  -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml)

cleanup() {
  local exit_code=$?
  echo "==> Tearing down kurzly-e2e stack"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

# same jq/openssl/.env-bootstrap preflight as smoke-compose.sh goes here —
# reuse verbatim, do not duplicate divergent logic.

echo "==> docker compose up -d --wait (kurzly-e2e)"
"${COMPOSE[@]}" up -d --wait

echo "==> pnpm --filter @kurzly/e2e test"
PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:3000}" \
  pnpm --filter @kurzly/e2e test
```

### 2. Rate-limit bypass via `@fastify/rate-limit`'s `allowList` (NOT a custom key generator)
```typescript
// apps/api/src/plugins/rateLimit.ts — extend the existing registerRateLimit()
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  // Deliberately read directly from process.env (mirrors routes/domains.ts's
  // computeVerificationTarget precedent) — NOT added to env.ts's envSchema,
  // so it is structurally impossible to set via .env.example / production
  // config, and the env-example-drift.test.ts guard never needs to know
  // about it.
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "15 minutes",
    allowList: bypassSecret
      ? (request) => request.headers["x-e2e-bypass"] === bypassSecret
      : undefined, // production/dev: option omitted entirely, zero behavior change
  });
}
```
`allowList`'s function form covers the global bucket AND every named per-route override (`MAGIC_LINK_RATE_LIMIT`, `LINK_CREATE_RATE_LIMIT`, `QR_CREATE_RATE_LIMIT`, `DOMAIN_CREATE_RATE_LIMIT`, `REDIRECT_RATE_LIMIT`) automatically, per the plugin's own documented encapsulation-scope behavior — no edits needed to any individual `routes/*.ts` file.

### 3. CI YAML Sketch (concrete, pasteable into `.github/workflows/ci.yml`)
```yaml
  e2e:
    name: Playwright E2E suite
    runs-on: ubuntu-latest
    needs: [test, smoke]
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm --filter @kurzly/e2e exec playwright install --with-deps chromium

      - name: Build the app image
        run: docker compose -f docker-compose.yml build app
        env:
          DOCKER_BUILDKIT: "1"
        # NOTE: reuse smoke's build step exactly; add cache-from: type=gha via
        # `docker compose build --build-arg BUILDKIT_INLINE_CACHE=1` or switch
        # this step to `docker/build-push-action@v7` with `cache-from: type=gha`
        # if measured cold-build time on this job becomes a problem — the
        # `smoke` job today does a plain `docker compose ... build app` with no
        # GHA cache, so this is a deliberate, phase-scoped improvement over
        # that existing job, not a requirement to match it exactly.

      - name: Run Playwright E2E suite
        run: ./scripts/e2e-compose.sh
        env:
          # Set ONLY here — never in docker-compose.yml/.env.example — so a
          # bypass secret can never leak into a production config surface.
          E2E_RATE_LIMIT_BYPASS_SECRET: ${{ github.run_id }}-e2e-bypass

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: apps/e2e/playwright-report/
          retention-days: 7

      - name: Upload Playwright traces
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: apps/e2e/test-results/
          retention-days: 7
```
Notes on fidelity to this repo's actual conventions: `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `node-version: 24` — all copied verbatim from the existing `test`/`smoke`/`release` jobs (not invented). `needs: [test, smoke]` matches CONTEXT.md's decision exactly. `actions/upload-artifact@v4` is the version already implicitly expected by the milestone STACK.md; this repo's `ci.yml` doesn't use `upload-artifact` anywhere yet, so `v4` is asserted from current GitHub Actions marketplace convention, not from an existing in-repo precedent — verify the exact major at implementation time.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|----------------|--------|
| MailHog for SMTP test-catching | Mailpit | MailHog effectively unmaintained since ~2020 (already established by milestone STACK.md, not re-verified this session) | Already reflected in this repo's `docker-compose.dev.yml` — no action needed |
| `@fastify/rate-limit`'s `keyGenerator` override for "exempt this request" | `allowList` function option | N/A — both options coexist in the current v11.1.0 API; `allowList` is simply the more precise tool for the "exempt entirely" case | Use `allowList`, not `keyGenerator`, for INFRA-06 (see Don't Hand-Roll) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | Playwright's built-in TypeScript transform can resolve and execute a workspace package's `exports`-mapped subpath that points directly at a raw `.ts` file (not compiled JS) | Prisma Client Subpath Export section | If wrong, `apps/e2e`'s very first Prisma import fails at module-resolution time — mitigated by recommending this as literally the first task/checkpoint in the plan, with a documented fallback (small dedicated build step) |
| A2 | The magic-link verification URL path in `apps/api` is `/api/auth/magic-link/verify?token=...` (used in the `mailpit.ts` regex sketch) | Mailpit REST API section, Code Examples §1 | If the actual better-auth-generated path differs, the regex misses — mitigated by the sketch's own note to verify against the first real captured email rather than trust the regex blindly |
| A3 | `actions/upload-artifact@v4` is the correct current major version for this GitHub Actions setup | CI YAML Sketch | Low risk (artifact upload failing would be loud and immediately visible in CI logs); verify against the Marketplace listing at implementation time since this repo has no existing precedent to copy |

**If this table is empty:** N/A — three assumptions above should be confirmed/resolved during Wave 0 of execution, not carried silently into later phases.

## Open Questions

1. **Does the raw-`.ts` Prisma-client subpath export actually resolve under Playwright's runtime in this repo?**
   - What we know: Playwright ships its own esbuild-based TS transform and is documented to support TypeScript project-wide; this repo's own `apps/api` already imports the very same generated files internally without issue (under `tsup`, a different bundler).
   - What's unclear: whether Node's `exports` map resolution (which Playwright's module loading sits on top of) treats a `.ts`-suffixed `exports` target the same as any other file path, or whether some tool in the chain expects a `.js`/`.mjs` suffix specifically.
   - Recommendation: make this the literal first task of Phase 11 execution (a 5-line spike script), not something inferred from documentation.

2. **What is better-auth's exact magic-link verification URL shape in this installed version (1.6.23)?**
   - What we know: `apps/api/src/lib/auth.ts` configures `magicLink({ expiresIn: 900, disableSignUp: true, sendMagicLink: async ({ email, url }) => ... })` — the `url` is provided by better-auth itself, not constructed by this codebase.
   - What's unclear: the exact path/query-param shape of that `url` (assumed `/api/auth/magic-link/verify?token=...` based on better-auth's documented convention, but not read from source this session).
   - Recommendation: confirm empirically against the first real Mailpit-captured email during `auth.setup.ts` implementation — do not hardcode a regex before seeing one real example.

3. **Does `fullyParallel` + the locked truncate-and-reseed-per-file strategy need an advisory lock, or does spec-file-level sequencing already prevent collisions?**
   - What we know: CONTEXT.md locks truncate-and-reseed-per-file (not per-worker DB); Pitfall 4 above flags the collision risk if two files' `resetDb()` calls interleave.
   - What's unclear: Playwright's actual file-to-worker scheduling guarantees at the exact concurrency level this project's CI runner will use.
   - Recommendation: the phase's own success criterion 3 (`workers=1` and `workers=N` both pass with zero P2002) is the direct empirical test for this — treat the advisory-lock suggestion above as the first mitigation to reach for if that criterion fails at `workers=N`, not something to build preemptively without first observing a failure.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|-----------|
| Docker | Compose stack (all of INFRA-01/02/03) | ✓ | 29.5.3 (this session's sandbox; CI runner ships its own current Docker) | — |
| Node.js | Playwright runtime, tooling | ✓ | v22.19.0 locally (this session's sandbox) — project's own Docker image targets Node 24; CI (`actions/setup-node@v7`, `node-version: 24`) matches the project baseline | Local dev machines running an older Node are fine since the app itself always runs inside the Node-24 Docker image; only `apps/e2e`'s own `pnpm --filter @kurzly/e2e test` invocation runs on the host Node version — verify `@playwright/test`'s `engines: {node: ">=18"}` is satisfied (it is, on both v22 and the CI's v24) |
| pnpm | Workspace tooling | ✓ | 11.11.0 | — |
| jq, openssl | `.env` bootstrap in the compose script (mirrors `smoke-compose.sh`'s own preflight) | ✓ | jq 1.6, OpenSSL 3.6.2 | — |
| Playwright browsers (Chromium) | All specs | Not yet installed in this sandbox — installed on demand via `playwright install --with-deps chromium` | 1.61.1-matched build | None needed — install step is part of the phase's own deliverable |

**Missing dependencies with no fallback:** none — this sandbox has everything required to develop and smoke-test this phase locally.

## Validation Architecture

> Required per `.planning/config.json`'s `workflow.nyquist_validation: true`. This section translates each ROADMAP success criterion into a concrete, executable proof — not just "write a test," but the specific assertion strategy each criterion actually needs.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` ^1.61.1 (new — this phase introduces it) |
| Config file | `apps/e2e/playwright.config.ts` (new — see Recommended Project Structure) |
| Quick run command | `pnpm --filter @kurzly/e2e test -- --project=setup --project=chromium-admin tests/smoke/` (fast, single-role smoke subset during iteration) |
| Full suite command | `./scripts/e2e-compose.sh` (boots the full 3-file compose stack, runs the complete `apps/e2e` suite at the CI's configured worker count, tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior (from ROADMAP success criteria) | Test Type | Concrete Assertion Strategy | File Exists? |
|--------|-------------------------------------------|-----------|-------------------------------|--------------|
| INFRA-01 (success criterion 1) | `pnpm --filter @kurzly/e2e test` boots the 3-file compose stack and runs against the built image at `:3000`, never split dev servers | infra/smoke | `scripts/e2e-compose.sh` exit code 0 end-to-end; a throwaway spec asserts `test.info().project.use.baseURL` resolves to `http://localhost:3000` (or `PLAYWRIGHT_BASE_URL`) AND that `GET /health` against that base URL returns 200 with response header evidence of the real Fastify server (e.g., absence of Vite's dev-server-specific headers) — proves it's hitting the built image, not a dev server | ❌ Wave 0 |
| INFRA-02 (success criterion 2) | A throwaway smoke spec reads a magic-link email from Mailpit scoped by unique recipient, logs in, zero cross-worker email theft at `workers=N` | integration/smoke | `tests/smoke/mailpit-wiring.spec.ts`: request a magic link for a literal seeded test address, poll `GET /api/v1/search?query=to:<addr>` (never `/api/v1/messages` bare), assert exactly one matching message, extract + follow the link, assert an authenticated route is reached. Run this spec at `--workers=4` locally against the same seeded addresses used across files and assert no message is ever matched to the WRONG recipient (a hard assertion on `To[0].Address === expectedRecipient` before extracting the link, not just "a message was found") | ❌ Wave 0 |
| INFRA-03 (success criterion 3) | Suite passes identically at `workers=1` and `workers=N`, no P2002, against the published `5433` Postgres, separate from Vitest testcontainers | integration | Run the full `apps/e2e` suite twice — `pnpm --filter @kurzly/e2e test -- --workers=1` then `--workers=4` (or CI's configured count) — assert both exit 0 and grep CI/local logs for zero occurrences of `P2002`. This is inherently a two-run comparison, not a single assertion inside one spec — document it as an explicit CI/local verification step, not just "a test exists" | ❌ Wave 0 |
| INFRA-04 (success criterion 4) | A fresh browser context loaded from saved `storageState` reaches an authenticated dashboard route without re-login, for both Admin and Member | integration | `tests/smoke/storage-state.spec.ts`, one test per role: `test.use({ storageState: 'playwright/.auth/<role>.json' })`, `browser.newContext()` fresh (not reusing any context from `auth.setup.ts`), navigate directly to a `requiresAuth` route (e.g. `/dashboard` or `/team`), assert the router guard did NOT redirect to `/login` (assert final URL, not just "no error thrown") AND assert a role-specific element renders (e.g. Member sees no admin-only nav item) — this doubles as an implicit proof that the correct role's session was captured, not just "a session" | ❌ Wave 0 |
| INFRA-05 (success criterion 5, first half) | CI runs the suite as its own job after test/build, uploads report/trace artifacts on failure | infra | The CI YAML sketch above (`needs: [test, smoke]`, `actions/upload-artifact` steps `if: failure()`). Verified by deliberately breaking one throwaway assertion once during initial rollout and confirming the artifact actually appears in the failed run's Summary page — a "the YAML looks right" review is not sufficient proof, actually trigger one real CI failure during Wave 0 | ❌ Wave 0 (CI config, no test file) |
| INFRA-06 (success criterion 5, second half) | One dedicated spec still trips a real 429 while the rest of the suite runs unthrottled via the narrow bypass | integration | `tests/smoke/rate-limit-bypass.spec.ts`, `test.describe.serial` (per PITFALLS.md's own recommendation to isolate this from parallel-worker interference): (a) send N+1 requests to `POST /api/auth/sign-in/magic-link` WITHOUT the `x-e2e-bypass` header/secret, assert the (N+1)th receives HTTP 429; (b) send N+1 requests WITH the correct header/secret to the same endpoint, assert ALL succeed (no 429) — both halves in the same spec so a future regression that accidentally makes the bypass "leaky" (weakens the real limit) or "too tight" (still blocks legitimate bypassed requests) is caught by the same file | ❌ Wave 0 |

### Sampling Rate
- **Per task commit (during `apps/e2e` scaffolding):** the relevant single smoke spec only (`pnpm --filter @kurzly/e2e test -- tests/smoke/<file>.spec.ts`), against a manually-booted `docker-compose.e2e.yml` stack left running locally — fast iteration loop.
- **Per wave merge:** `./scripts/e2e-compose.sh` (full boot + full `apps/e2e` suite + teardown) at least once at default worker count.
- **Phase gate:** `./scripts/e2e-compose.sh` green at BOTH `--workers=1` and the CI's actual configured worker count before this phase is considered complete (INFRA-03's explicit two-run requirement) — this is a genuine two-invocation gate, not satisfied by a single green run.

### Wave 0 Gaps
- [ ] `apps/e2e/package.json`, `playwright.config.ts`, `tsconfig.json` — package scaffold does not exist yet
- [ ] `apps/api/package.json`'s `exports` field — does not exist at all today (only `"main"`)
- [ ] `docker-compose.e2e.yml`, `scripts/e2e-compose.sh` — do not exist yet
- [ ] The Prisma-client-subpath-resolves-under-Playwright spike (Open Question 1) — must run before any fixture code is written on top of it
- [ ] `.gitignore` additions for `apps/e2e/playwright/.auth/`, `playwright-report/`, `test-results/`
- [ ] `.github/workflows/ci.yml`'s new `e2e` job

*(No existing test infrastructure covers any of this phase's scope — it IS the test infrastructure being built.)*

## Security Domain

> Required per `.planning/config.json`'s `security_enforcement: true` (ASVS level 1, `security_block_on: high`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|-----------------|---------|---------------------|
| V2 Authentication | Indirectly — this phase exercises, does not modify, the existing magic-link auth | No new auth logic; the auth fixture must exercise the REAL flow (already CONTEXT.md's stance) — never a test-only auth shortcut that would let a weakened path silently regress |
| V3 Session Management | Yes — `storageState` files ARE session tokens | Treat `playwright/.auth/*.json` as a live credential: gitignored, regenerated every run, never a CI cache artifact, never committed — already locked in CONTEXT.md and verified as a real risk (Pitfall/Anti-Pattern 3 in milestone research: "checking storageState into git 'to speed up CI' is a credential leak") |
| V4 Access Control | Indirectly — Phase 17 (not this phase) proves domain-scoped denial E2E; this phase's global-setup only needs to seed a Member with a legitimate DomainMembership, correctly scoped (not accidentally over-privileged), so downstream phases inherit a correctly-shaped fixture | Seed exactly the DomainMembership CONTEXT.md specifies (one Domain, one Member scoped to it) — do not seed the Member as account-admin or with memberships to domains not intended for testing |
| V5 Input Validation | N/A — no new user-input-accepting endpoint is added in this phase | — |
| V6 Cryptography | Yes — the new `E2E_RATE_LIMIT_BYPASS_SECRET` | Generate as a real random value in CI (the CI YAML sketch above uses `${{ github.run_id }}-e2e-bypass`, which is NOT cryptographically random and should be hardened to a real generated secret, e.g., `openssl rand -hex 32`, set as a `secrets.*` or generated fresh per run — do not ship the sketch's placeholder verbatim into the final plan) — never given a default value in `env.ts` (already locked in CONTEXT.md), must remain absent from `.env.example` |

### Known Threat Patterns for This Phase's Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| `E2E_RATE_LIMIT_BYPASS_SECRET` leaking into a non-test environment | Elevation of Privilege (a real attacker who obtains this header+secret could bypass rate-limiting on the real production magic-link endpoint, aiding email-bombing/brute-force) | Never add to `envSchema`/`.env.example` (structurally impossible to set via the documented production config surface); only ever set inline in `docker-compose.e2e.yml`'s `environment:` block and the CI job's `env:` step, generated fresh per run, never a fixed/committed value |
| Committing `playwright/.auth/*.json` | Information Disclosure (live session cookie leak) | `.gitignore` entry (already locked in CONTEXT.md); regenerate every run |
| Seeding an over-privileged Member fixture "to make specs easier to write later" | Elevation of Privilege (downstream AUTHZ-E2E specs in Phase 17 would then be testing against a fixture that doesn't actually represent a real least-privilege Member, silently invalidating that phase's denial proofs) | `global-setup.ts` seeds the Member with EXACTLY one DomainMembership at the lowest applicable role — resist any temptation to over-seed "for convenience" |

## Sources

### Primary (HIGH confidence — verified directly this session)
- Direct file reads, this repository, this session: `apps/api/package.json`, `apps/api/prisma/schema.prisma`, `apps/api/src/generated/prisma/*` (directory listing + `client.ts` header), `apps/api/src/db.ts`, `apps/api/src/lib/auth.ts`, `apps/api/src/lib/allowlist.ts`, `apps/api/src/plugins/rateLimit.ts`, `apps/api/src/env.ts`, `apps/api/src/routes/canary.ts`, `apps/api/tsup.config.ts`, `apps/api/tsconfig.json`, `tsconfig.base.json`, `docker-compose.yml`, `docker-compose.dev.yml`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `scripts/smoke-compose.sh`, `.env.example`, `apps/api/test/env-example-drift.test.ts`, `apps/api/vitest.config.ts`, `packages/shared/package.json`, `apps/web/src/api.ts`, `apps/web/src/router/index.ts`, `apps/web/src/stores/authSession.ts`, `apps/web/src/main.ts`, `apps/web/src/stores/theme.ts`, `.gitignore`
- Live empirical test, this session: `docker run axllent/mailpit:latest` + real SMTP send (Python `smtplib`) + REST API calls (`/api/v1/messages`, `/api/v1/search`, `/api/v1/message/{ID}`, `DELETE /api/v1/messages`) — confirms v1.30.5 and exact response shapes
- `npm view @playwright/test dist-tags --json`, `npm view @playwright/test@1.61.1 engines`, `npm view @testcontainers/postgresql version`, `npm view oidc-provider version` — this session, direct registry queries
- `npm pack @fastify/rate-limit@11.1.0` + direct README extraction, this session — confirms `allowList` function-form option and its "affects all endpoints within the encapsulation scope when set at registration" behavior
- `gsd-tools query package-legitimacy check --ecosystem npm @playwright/test` — this session — OK verdict, 48M weekly downloads, official `microsoft/playwright` repo

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` (milestone-level research, 2026-07-24) — used as the architectural baseline this document verifies/refines against actual repo state; not re-derived from scratch
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — phase scope, requirements, and success criteria source

### Tertiary (LOW confidence — carried from milestone research, not re-verified this session)
- General web-search synthesis on Playwright CI patterns, `webServer`/race-condition behavior, Postgres seeding patterns for Playwright — see milestone PITFALLS.md/STACK.md's own Sources sections for the original (LOW-confidence) citations; not independently re-verified this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified directly against npm registry this session; no new packages beyond the already-locked `@playwright/test`
- Architecture: MEDIUM-HIGH — the compose/CI/fixture shapes are the milestone research's own well-grounded recommendations, now cross-checked against actual repo files; the Prisma-client-subpath mechanics are a genuinely new, repo-specific finding this session (raw `.ts` export, no `index.js`) that required direct investigation to surface
- Pitfalls: MEDIUM-HIGH — two of CONTEXT.md's flagged "verify empirically" open questions (storageState/sessionStorage, allowlist exact-match semantics) are now fully resolved via direct code reads, not just mitigated with process; the parallel-worker truncate/reseed collision risk (Pitfall 4) remains a genuine open risk to be proven by the phase's own success criterion 3

**Research date:** 2026-07-24
**Valid until:** 30 days (stable infra domain; re-verify `@playwright/test` version and Mailpit image tag if this phase's execution is delayed more than a few weeks, since both are actively released)

---
*Research for: Kurzly Phase 11 — Playwright E2E Infrastructure & Fixtures (v1.1 milestone)*
*Researched: 2026-07-24*
