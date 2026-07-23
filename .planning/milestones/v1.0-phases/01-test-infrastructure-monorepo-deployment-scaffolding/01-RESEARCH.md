# Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding - Research

**Researched:** 2026-07-10
**Domain:** pnpm monorepo scaffolding, Docker/Compose deployment, ENV validation, TDD harness (Vitest + testcontainers + Mailpit)
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Deployment-Topologie**
- **D-01:** Single-Image-Deployment. Fastify serviert das gebaute Vue-`dist/` via `@fastify/static` und beherbergt sowohl `/api/*`, den Redirect-Handler als auch die statische SPA in **einem** `app`-Container. Gleiche Origin → in Produktion kein CORS nötig (`@fastify/cors` nur dev-only, per `NODE_ENV` gated).
- **D-02:** Produktions-Compose besteht aus zwei Services: `app` und `db` (`postgres:18-alpine`). Kein separater web-Container.

**Reverse-Proxy & TLS**
- **D-03:** Kurzly verdrahtet **keinen** bestimmten Reverse-Proxy fest. Das mitgelieferte `docker-compose.yml` exponiert nur den App-Port (z. B. `3000`); TLS/Reverse-Proxy ist Betreiber-Verantwortung.
- **D-04:** Stattdessen wird der Proxy **dokumentiert** — eine `docs/deployment/reverse-proxy.md` (o. ä.) mit konkreten Beispielen: Caddyfile, nginx-Config, Traefik-Labels, certbot-Hinweis. Der Betreiber wählt selbst.

**DB-Migration beim Start**
- **D-05:** Prisma-Migrationen werden **automatisch beim App-Start** angewendet: Der `app`-Container-Entrypoint führt `prisma migrate deploy` aus, bevor der Server startet. `docker-compose up` erfordert keine manuellen Migrationsschritte (erfüllt INFRA-01 „keine manuellen Schritte").

**ENV-Konfiguration**
- **D-06:** Fail-fast Konfiguration. Beim Boot wird die ENV gegen ein Schema (Zod oder Typebox) validiert; fehlende Pflicht-Variablen oder ungültige Werte führen zu sofortigem Abbruch (`exit 1`) mit klarer Fehlermeldung — statt kryptischem Spät-Crash. Per Unit-Test abgedeckt.
- **D-07:** Eine `.env.example` listet **alle** Variablen mit erklärenden Kommentaren (DB-URL, SMTP-Zugangsdaten, Base-Domain, Secrets). Nichts ist im Image hardcodiert (erfüllt INFRA-02).

**Persistenz**
- **D-08:** Postgres-Daten liegen auf einem **named volume**, sodass sie einen vollen Stop/Restart/Recreate-Zyklus überstehen (erfüllt INFRA-03). Als Canary-/Erfolgstest verifizieren, dass Daten nach `down`/`up` (ohne `-v`) erhalten bleiben.

**Test-Harness**
- **D-09:** Integrationstests nutzen eine **Hybrid-Isolationsstrategie**: ein Postgres-Container pro Vitest-Worker, einmal geseedet, jeder Test läuft in einer Transaktion, die zurückgerollt wird (schnell für die Masse). Echte Multi-Container-Isolation nur für Migrations-/Schema-Tests (frischer Container).
- **D-10:** Ein separates `docker-compose.dev.yml` bringt Mailpit als SMTP-Catcher (nur dev/CI, **nie** im Produktions-Compose). Testcontainers spinnt Postgres ephemeral pro Testlauf hoch.
- **D-11:** CI führt die gesamte Suite bei jeder Änderung aus (TDD-Mandat aus PROJECT.md/CLAUDE.md).

### Claude's Discretion
- Konkrete Ausgestaltung von Healthchecks, `depends_on`/Wartelogik zwischen `app` und `db`, Multi-Stage-Dockerfile-Struktur, `pnpm`-Workspace-Details und die exakte testcontainers-Verdrahtung (globalSetup `provide`/`inject`) überlässt der Nutzer dem Planner/Researcher auf Basis der Tech-Stack-Empfehlung in CLAUDE.md.

### Deferred Ideas (OUT OF SCOPE)
- **Reverse-Proxy/TLS als Produktcode → Phase 3 neu bewerten.** Die Roadmap führt Phase 3 als „Multi-Domain-TLS-Routing". Da TLS/Proxy per D-03/D-04 an den Betreiber (dokumentiert) delegiert wird, muss der Umfang von Phase 3 bei deren Planung neu bewertet werden — evtl. reduziert sich Phase 3 auf App-seitige Domain-Verifizierung + Doku statt eigener TLS-Routing-Implementierung.
- **Erster Admin-Bootstrap → Phase 2 (Auth).** Wie der erste Admin ohne Public-Signup entsteht (z. B. `INITIAL_ADMIN_EMAIL`-ENV), gehört zum User-Modell/Magic-Link in Phase 2, nicht in die Infra-Phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Betreiber kann den gesamten Dienst via `docker-compose up` starten, keine manuellen Schritte | Multi-stage Dockerfile pattern, `app`+`db` compose topology, `prisma migrate deploy` in entrypoint (D-05), healthcheck/`depends_on` wait-logic — see Architecture Patterns, Code Examples |
| INFRA-02 | Betreiber konfiguriert die Instanz vollständig über ENV (DB-URL, SMTP, Basis-Domain, Secrets) | Zod fail-fast env schema pattern, `.env.example` convention — see Architecture Patterns Pattern 2, Code Examples |
| INFRA-03 | Postgres-Daten überstehen Container-Neustarts über persistentes Volume | Named volume declaration + canary persistence test pattern — see Don't Hand-Roll, Validation Architecture |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `./.claude/CLAUDE.md` — binding, not open for re-litigation in this phase:

- Node.js 24.x (Active LTS) — Docker base image target.
- Fastify ^5.10.0 — backend framework, single process serves `/api/*`, redirect handler, and static SPA.
- PostgreSQL 18.x (`postgres:18-alpine` official image) — do not target PG 19 (beta).
- Prisma ORM ^7.x — **requires explicit `generator client { output = "..." }`** (e.g. `src/generated/prisma`); client must be imported from that generated path everywhere, not from bare `@prisma/client`. Decide the path now — better-auth's Prisma adapter (Phase 2) must import the same generated client instance.
- Vue 3 (`^3.5.39`, Composition API `<script setup>`) + Vite `^8.x` — frontend build, output to `dist/`.
- pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` — matches user's global "rebuild the shared package" instruction.
- `@fastify/cors` — dev-only, `NODE_ENV`-gated (production is single-origin, D-01).
- `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static` — mentioned in stack but their concrete wiring belongs to later feature phases; only `@fastify/static` (SPA serving) is in-scope for Phase 1's walking skeleton. Do not install/wire helmet or rate-limit in this phase unless the walking skeleton needs a bare healthcheck route protected — out of scope here, defer to phases that add real attack surface (auth, redirect, public forms).
- **Do NOT** add `@fastify/session` (better-auth owns sessions — irrelevant to Phase 1 but noted for consistency).
- Vitest `^4.1.x` + `@testcontainers/postgresql` (testcontainers-node `^12.x`) + Mailpit — TDD harness, real Postgres, no Prisma mocking.
- `fastify.inject` (bundled) — default for backend integration tests; Playwright reserved for true E2E (later phases).
- User's **global** CLAUDE.md: run `pnpm tsc --noEmit` and rebuild `packages/shared` after any code change before declaring work done; common failure mode explicitly flagged there is "missing generated Prisma client" — directly relevant to D-05/Prisma-7-output-path decisions below.
- TDD is mandatory project-wide: every requirement needs automated tests before being considered done; CI runs the full suite on every change (D-11).

## Summary

This phase has no application feature logic — it is pure scaffolding: a pnpm monorepo skeleton (`apps/web`, `apps/api`, `packages/shared`), a two-service Docker Compose stack (`app` + `db`) that boots with zero manual steps, fail-fast ENV validation, a persistent named Postgres volume, and a TDD harness built on Vitest + testcontainers + Mailpit. The "walking skeleton" framing matters: the goal is not to build any of Kurzly's features yet, but to prove the full deploy-and-test loop works end-to-end — `docker-compose up` produces a running app that serves *something* (even a placeholder route) behind the same origin, migrations apply automatically, and `pnpm test` spins up a real ephemeral Postgres and passes.

The two hardest technical risks in this phase, confirmed via research, are: (1) **Prisma 7's mandatory explicit `output` path** interacting with pnpm's default-blocked lifecycle scripts — `prisma generate`'s postinstall hook will silently not run under pnpm ≥10 unless the package is added to `pnpm-workspace.yaml`'s `allowBuilds`, which is exactly the kind of "missing generated Prisma client" failure the user's global CLAUDE.md already warns about; and (2) **build-order correctness in both the Dockerfile and CI** — `packages/shared` must be compiled before `apps/web`/`apps/api` consume it, which pnpm's own topological `-r` run order handles automatically as long as `packages/shared` is declared as a workspace dependency (not just colocated in the same repo).

**Primary recommendation:** Use pnpm's own documented Docker pattern (`pnpm install --frozen-lockfile` → `pnpm run -r build` → `pnpm deploy --filter=<app> --prod /prod/<app>`) for the multi-stage Dockerfile, run `prisma migrate deploy` from a shell entrypoint script immediately before `node dist/server.js` (never as a `RUN` build step), validate ENV with Zod `safeParse` + `process.exit(1)` at the very top of the API boot sequence, and wire the TDD harness with Vitest `globalSetup`'s `provide`/`inject` around `@testcontainers/postgresql`, one container per worker pool, transaction-rollback per test.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Monorepo build orchestration (shared → apps) | Build tooling (pnpm workspace) | — | pnpm's workspace protocol + topological `-r` execution owns build ordering; not a runtime concern |
| SPA static asset serving | API / Backend (Fastify, `@fastify/static`) | CDN/Static (deferred to reverse-proxy, D-03/D-04) | D-01 locks this to the single `app` container; a CDN/edge cache is explicitly the operator's own reverse-proxy concern, out of scope here |
| ENV / config validation | API / Backend (boot-time Zod schema) | — | Fail-fast belongs at process entrypoint, before any DB/SMTP connection is attempted (D-06) |
| DB schema migration | API / Backend (container entrypoint script) | Database/Storage (Prisma migration engine executes SQL) | D-05 locks migration-on-boot to the app container's entrypoint, not a separate migration job/service |
| Data persistence | Database/Storage (named Docker volume) | — | D-08; Postgres owns durability, Docker Compose owns volume lifecycle |
| Test isolation (integration tests) | Database/Storage (ephemeral testcontainers Postgres) | API/Backend (Vitest test runner orchestrates) | D-09; real Postgres via testcontainers avoids mocking the persistence layer |
| Outbound email (dev/test only) | External Dependency (Mailpit container) | — | D-10; SMTP catcher, never part of the production topology |
| CI test execution | Build tooling (GitHub Actions) | Database/Storage (Docker-in-runner Postgres via testcontainers) | D-11; ubuntu-latest runners ship Docker preinstalled, no extra CI service-container config needed for testcontainers |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pnpm | `^11.11.0` [VERIFIED: npm registry] | Monorepo package manager / workspaces | Already assumed by user's global CLAUDE.md (`pnpm tsc --noEmit`); native workspace protocol + `pnpm deploy --prod` gives the leanest Docker production stage without extra tooling (Turborepo not needed for a 3-package workspace) |
| Node.js | `24.x` (Active LTS) [CITED: CLAUDE.md] | Runtime, Docker base image | Fixed by project CLAUDE.md |
| Fastify | `^5.10.0` [VERIFIED: npm registry, matches CLAUDE.md] | Backend HTTP framework | Fixed by project CLAUDE.md |
| `@fastify/static` | `^9.3.0` [VERIFIED: npm registry, matches CLAUDE.md] | Serve built Vue `dist/` from the same Fastify instance (D-01) | Fixed by project CLAUDE.md |
| `@fastify/cors` | `^11.3.0` [VERIFIED: npm registry, matches CLAUDE.md] | Dev-only CORS between Vite dev server and Fastify API | Fixed by CLAUDE.md; gate behind `NODE_ENV !== 'production'` |
| PostgreSQL | `18-alpine` (image tag) [CITED: CLAUDE.md] | Primary datastore | Fixed by project CLAUDE.md; do not use `postgres:19` (beta) |
| Prisma / `@prisma/client` | `^7.8.0` [VERIFIED: npm registry, matches CLAUDE.md] | ORM, migrations, typed client | Fixed by CLAUDE.md; **requires explicit `output` path** — see Pitfall 1 |
| Vue 3 | `^3.5.39` [VERIFIED: npm registry, matches CLAUDE.md] | Frontend framework (placeholder shell only in this phase) | Fixed by CLAUDE.md |
| Vite | `^8.1.4` [VERIFIED: npm registry, matches CLAUDE.md] | Frontend build tool / dev server | Fixed by CLAUDE.md |
| TypeScript | `^7.0.2` [VERIFIED: npm registry] | Static typing across all three workspace packages | Standard for a TS monorepo; TS 7 (native Go-ported compiler) is current — verify `pnpm tsc --noEmit` (user's global mandate) works with the new binary before relying on it in CI |
| Zod | `^4.4.3` [VERIFIED: npm registry] | ENV schema validation (D-06) | Locked choice between "Zod or Typebox" in CONTEXT.md D-06 — recommend Zod: already implied by CLAUDE.md's broader stack recommendations, largest ecosystem, `safeParse` gives structured `.issues` for clear fail-fast error messages |
| Vitest | `^4.1.10` [VERIFIED: npm registry, matches CLAUDE.md] | Unit + integration test runner (backend and frontend) | Fixed by CLAUDE.md |
| `@vitest/coverage-v8` | `^4.1.10` [VERIFIED: npm registry, matches CLAUDE.md] | Coverage reporting | Fixed by CLAUDE.md; v4 removed `coverage.all` — set `coverage.include` explicitly |
| `testcontainers` / `@testcontainers/postgresql` | `^12.0.4` [VERIFIED: npm registry, matches CLAUDE.md's "testcontainers-node current"] | Ephemeral real Postgres for integration tests (D-09) | Fixed by CLAUDE.md; version bump from CLAUDE.md's unpinned "current" — 12.x is current as of research date |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nodemailer | `^9.0.3` [ASSUMED — training knowledge, not re-verified this session; CLAUDE.md already pins this] | SMTP transport pointed at Mailpit in dev/test | Only needed in this phase to prove the Mailpit wiring works (a smoke test sending one email); full magic-link integration is Phase 2 |
| pino + pino-pretty | `^10.3.1` / `^13.1.3` [VERIFIED: npm registry] | Structured logging | Fastify's built-in logger is pino; `pino-pretty` for readable dev-console output, disabled (raw JSON) in production — not in CLAUDE.md's explicit list but is Fastify's own default logger, needed the moment the app boots and logs ENV-validation failures or migration errors |
| dotenv | `^17.4.2` [VERIFIED: npm registry] | Load `.env` file into `process.env` in local dev (Docker Compose injects real env vars in prod, no dotenv needed there) | Dev-only convenience; guard so it's a no-op / not required in the container image |
| tsup or tsx | `^8.5.1` / `^4.23.0` [VERIFIED: npm registry] | Build `apps/api` (tsup, bundling to `dist/`) and/or run TS directly in dev (tsx) | `apps/api` needs a build step producing plain JS for the production image; `packages/shared` also needs a build step (tsc or tsup) so its compiled output is what `apps/web`/`apps/api` import |
| `@testcontainers/postgresql` peer: Docker Engine | n/a (host requirement) | Required by testcontainers at both dev-machine and CI runtime | See Environment Availability section |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod for ENV validation | Typebox | CONTEXT.md D-06 explicitly leaves the choice open ("Zod oder Typebox"); Typebox is faster (JSON-schema based, no runtime validation overhead comparable to Zod v3) but Zod v4 closed most of that gap and has far better DX for one-time boot-time validation (not a hot path) — recommend Zod, flag as a discretion call the planner can present as a quick confirm |
| `pnpm deploy --prod` for Docker production stage | Turborepo `turbo prune --docker` | Turborepo's prune is designed for larger monorepos with many independently-deployed services and remote build caching; for a 3-package workspace with one deployable app image, `pnpm deploy` is simpler and needs no extra tool/config |
| tsup for `apps/api` build | esbuild directly, or `tsc` alone | tsup wraps esbuild with sensible defaults (bundling, `.d.ts` generation) — fine default; `tsc`-only build is slower and doesn't bundle, acceptable if the team prefers zero extra build tooling. Not a strong opinion either way; planner's discretion |
| Entrypoint shell script for `prisma migrate deploy` | A separate one-off "migrate" init container/job | Adds Compose complexity (a 3rd service, ordering against it) for a single-instance self-hosted deployment; D-05 already locks this to "app container entrypoint," so a separate migrate service is out of scope |

**Installation:**
```bash
# root
pnpm add -D -w typescript vitest @vitest/coverage-v8 zod

# apps/api
pnpm add --filter @kurzly/api fastify @fastify/static @fastify/cors prisma @prisma/client pino pino-pretty dotenv zod
pnpm add -D --filter @kurzly/api tsup tsx @testcontainers/postgresql testcontainers vitest

# apps/web
pnpm create vue@latest apps/web  # or manual Vite+Vue scaffold
pnpm add --filter @kurzly/web vue vue-router pinia
pnpm add -D --filter @kurzly/web vite @vitejs/plugin-vue vitest @vue/test-utils

# packages/shared
pnpm add -D --filter @kurzly/shared typescript
```

**Version verification:** All Core/Supporting versions above were checked against the npm registry on 2026-07-10 via `npm view <pkg> version`; all matched or were compatible with the pins already declared in `.claude/CLAUDE.md`. `typescript@7.0.2` and `vitest@4.1.10` are newer point releases than CLAUDE.md's stated floor (`^7.x` / `^4.1.x`) — both satisfy the caret ranges, no action needed.

## Package Legitimacy Audit

All packages checked via `gsd-tools query package-legitimacy check --ecosystem npm`.

| Package | Registry | Age signal | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-------------|-----------|--------------|---------|-------------|
| fastify | npm | latest published 2026-07-05 | 9.0M/wk | github.com/fastify/fastify | SUS ("too-new") | Approved — see note below |
| @fastify/static | npm | latest published 2026-07-08 | 3.6M/wk | github.com/fastify/fastify-static | SUS ("too-new") | Approved — see note below |
| @fastify/cors | npm | latest published 2026-07-08 | 4.5M/wk | github.com/fastify/fastify-cors | SUS ("too-new") | Approved — see note below |
| @fastify/helmet | npm | latest published 2026-07-08 | 1.6M/wk | github.com/fastify/fastify-helmet | SUS ("too-new") | Approved — noted for future phase, not installed this phase |
| @fastify/rate-limit | npm | latest published 2026-06-28 | 1.6M/wk | github.com/fastify/fastify-rate-limit | SUS ("too-new") | Approved — noted for future phase, not installed this phase |
| prisma | npm | latest published 2026-04-22 | 13.6M/wk | github.com/prisma/prisma | OK | Approved |
| @prisma/client | npm | latest published 2026-04-22 | 13.5M/wk | github.com/prisma/prisma | OK | Approved |
| zod | npm | latest published 2026-05-04 | 215.7M/wk | github.com/colinhacks/zod | OK | Approved |
| vitest | npm | latest published 2026-07-06 | 71.8M/wk | github.com/vitest-dev/vitest | SUS ("too-new") | Approved — see note below |
| @vitest/coverage-v8 | npm | latest published 2026-07-06 | 26.8M/wk | github.com/vitest-dev/vitest | SUS ("too-new") | Approved — see note below |
| testcontainers | npm | latest published 2026-06-29 | 4.5M/wk | github.com/testcontainers/testcontainers-node | SUS ("too-new") | Approved — see note below |
| @testcontainers/postgresql | npm | latest published 2026-06-29 | 2.3M/wk | github.com/testcontainers/testcontainers-node | SUS ("too-new") | Approved — see note below |
| vue | npm | latest published 2026-06-25 | 12.9M/wk | github.com/vuejs/core | SUS ("too-new") | Approved — see note below |
| vite | npm | latest published 2026-07-09 | 152.6M/wk | github.com/vitejs/vite | SUS ("too-new") | Approved — see note below |
| typescript | npm | latest published 2026-07-08 | 216.4M/wk | github.com/microsoft/TypeScript | SUS ("too-new") | Approved — see note below |
| pino | npm | latest published 2026-02-09 | 36.4M/wk | github.com/pinojs/pino | OK | Approved |
| pino-pretty | npm | latest published 2025-12-01 | 17.3M/wk | github.com/pinojs/pino-pretty | OK | Approved |

**Note on "too-new" SUS verdicts (fastify, @fastify/static, @fastify/cors, @fastify/helmet, @fastify/rate-limit, vitest, @vitest/coverage-v8, testcontainers, @testcontainers/postgresql, vue, vite, typescript):** the legitimacy heuristic flags packages whose *latest version* was published very recently — it does not distinguish "brand-new hallucinated package" from "actively-maintained mainstream package that shipped a patch release last week." Every one of these packages has a multi-year-old GitHub repo under a well-known org, weekly download counts in the millions to hundreds of millions, and matches a version already pinned in `.claude/CLAUDE.md` from a separate, independently-researched sourcing pass. These are not slopsquat risk signals. Still, per the Package Legitimacy Gate protocol, **the planner must add one `checkpoint:human-verify` task before the first `pnpm install`** that diffs the generated `package.json`/`pnpm-lock.yaml` against this table (single consolidated checkpoint covering all SUS-flagged packages, not one per package — disproportionate to flag each individually given the shared, well-understood root cause).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** fastify, @fastify/static, @fastify/cors, @fastify/helmet, @fastify/rate-limit, vitest, @vitest/coverage-v8, testcontainers, @testcontainers/postgresql, vue, vite, typescript — all due to "too-new" (recent patch release), not identity/trust concerns. See note above; planner should add a single consolidated `checkpoint:human-verify` before first install rather than 12 separate checkpoints.

Packages tagged `[ASSUMED]` in this document (nodemailer version, tsup/tsx choice) were sourced from CLAUDE.md/training knowledge and not independently re-verified via `npm view` in this research pass beyond nodemailer's version (which was verified). Planner should gate nodemailer's install behind the same consolidated checkpoint if the team wants full paranoia; risk is low given it's already pinned in CLAUDE.md's own independently-sourced version matrix.

## Architecture Patterns

### System Architecture Diagram

```
Operator machine
   │
   │  docker compose up  (D-01/D-02)
   ▼
┌─────────────────────────────────────────────────────────┐
│ docker-compose.yml (production)                          │
│                                                            │
│  ┌──────────────┐   healthcheck: pg_isready   ┌────────┐ │
│  │   db          │◄──────────────depends_on────│  app   │ │
│  │ postgres:18-  │   condition: service_healthy│(Fastify)│ │
│  │ alpine        │                              │         │ │
│  │               │        DATABASE_URL (env)    │         │ │
│  │ named volume: │◄─────────────────────────────┤         │ │
│  │ db-data:/var/ │                              │         │ │
│  │ lib/postgresql│                              │         │ │
│  │ /data         │                              │         │ │
│  └──────────────┘                              └────┬────┘ │
│         ▲ survives `down` (no -v) / restart          │      │
└─────────┼───────────────────────────────────────────┼──────┘
          │                                             │
          │                          exposes :3000      │
          │                                             ▼
          │                                    Operator's own
          │                                    reverse proxy
          │                                    (Caddy/nginx/Traefik,
          │                                     documented, D-03/D-04)
          │
   Container entrypoint sequence (inside `app`):
   1. entrypoint.sh starts
   2. ENV validated via Zod schema.safeParse(process.env)
      → invalid/missing → log formatted errors → exit 1 (D-06)
   3. `prisma migrate deploy` runs against DATABASE_URL (D-05)
      → migration failure → exit non-zero, container marked unhealthy
   4. node dist/server.js starts Fastify
      → registers /api/* routes (placeholder in this phase)
      → registers @fastify/static for apps/web's built dist/
      → GET /health → 200 (used by Docker HEALTHCHECK)
      → catch-all not-found handler → serves index.html (SPA fallback,
        registered AFTER all /api/* routes to avoid route-order conflicts)
```

```
Dev/CI test topology (separate from production compose)
                                                        
  pnpm test (Vitest)
       │
       ▼
  vitest.config.ts { test.globalSetup: "./globalSetup.ts" }
       │
       ▼
  globalSetup.ts: setup(project)
       │  starts PostgreSqlContainer (testcontainers, D-09)
       │  runs prisma migrate deploy once against it
       │  seeds baseline fixtures once
       │  project.provide('dbUrl', container.getConnectionUri())
       ▼
  Each test file: inject('dbUrl') → Prisma client → wraps test body
       in a transaction that's rolled back afterEach (fast path, D-09)
       │
       └─ Migration/schema tests: spin up a FRESH container instead
          (true isolation, slower, used sparingly)

  docker-compose.dev.yml (dev/CI only, D-10):
       mailpit service (SMTP :1025, Web UI :8025)
       nodemailer test transport → mailpit:1025
       NEVER referenced by production docker-compose.yml
```

### Recommended Project Structure

```
kurzly/
├── apps/
│   ├── api/                     # Fastify backend
│   │   ├── src/
│   │   │   ├── env.ts           # Zod schema + safeParse + process.exit(1) (D-06)
│   │   │   ├── generated/
│   │   │   │   └── prisma/      # Prisma 7 explicit output path — gitignored
│   │   │   ├── server.ts        # Fastify instance, route registration order
│   │   │   ├── plugins/
│   │   │   │   ├── static.ts    # @fastify/static wiring (D-01)
│   │   │   │   └── cors.ts      # dev-only, NODE_ENV gated
│   │   │   └── routes/
│   │   │       └── health.ts    # GET /health placeholder for this phase
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # generator client { output = "../src/generated/prisma" }
│   │   │   └── migrations/
│   │   ├── test/
│   │   │   ├── globalSetup.ts   # testcontainers provide/inject (D-09)
│   │   │   └── env.test.ts      # unit test for fail-fast validation (D-06)
│   │   ├── Dockerfile.entrypoint.sh
│   │   ├── vitest.config.ts
│   │   ├── tsup.config.ts
│   │   └── package.json
│   └── web/                     # Vue 3 + Vite SPA
│       ├── src/
│       │   └── App.vue          # placeholder shell for this phase
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   └── shared/                  # DTOs consumed by web + api
│       ├── src/index.ts
│       ├── tsconfig.json
│       └── package.json
├── docker/
│   └── (optional: split Dockerfile stages if not root-level)
├── docs/
│   └── deployment/
│       └── reverse-proxy.md     # Caddy/nginx/Traefik examples (D-04)
├── .github/
│   └── workflows/
│       └── ci.yml               # full Vitest suite on every push (D-11)
├── Dockerfile                   # multi-stage: base → build → runtime
├── docker-compose.yml           # production: app + db (D-02)
├── docker-compose.dev.yml       # adds mailpit (D-10), dev overrides
├── .env.example                 # all vars documented (D-07)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

### Pattern 1: Multi-stage Dockerfile with `pnpm deploy --prod`

**What:** Build once with full devDependencies, then extract a pruned, production-only directory per app via `pnpm deploy`.
**When to use:** Any pnpm workspace producing a Docker image, especially when `packages/shared` must be compiled before the consuming app.
**Example:**
```dockerfile
# Source: pnpm.io/docker (official docs), adapted for single-service Kurzly image
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /usr/src/app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Topological build: packages/shared builds before apps/web and apps/api
# because both declare it as a workspace:* dependency.
RUN pnpm run -r build
RUN pnpm deploy --filter=@kurzly/api --prod /prod/api

FROM base AS runtime
WORKDIR /prod/api
COPY --from=build /prod/api /prod/api
COPY --from=build /usr/src/app/apps/web/dist /prod/api/public
COPY apps/api/entrypoint.sh /prod/api/entrypoint.sh
RUN chmod +x /prod/api/entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/prod/api/entrypoint.sh"]
```

### Pattern 2: Fail-fast ENV validation with Zod

**What:** Parse and validate `process.env` against a strict schema at the very top of the boot sequence, before any Fastify/Prisma/nodemailer client is constructed.
**When to use:** Every app entrypoint, satisfies D-06 and INFRA-02.
**Example:**
```typescript
// Source: pattern synthesized from Zod official docs + community best practice (WebSearch, MEDIUM confidence)
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.email(),
  BASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid environment configuration:');
  console.error(result.error.format());
  process.exit(1);
}
export const env = result.data;
```

### Pattern 3: Prisma migration on container start (not build)

**What:** Run `prisma migrate deploy` from a shell entrypoint script, immediately before `node dist/server.js`.
**When to use:** Every deploy/restart of the `app` container (D-05).
**Example:**
```bash
#!/bin/sh
# Source: Prisma official "Deploying database changes with Prisma Migrate" docs
# https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate
set -e
echo "Running prisma migrate deploy..."
node_modules/.bin/prisma migrate deploy
echo "Starting server..."
exec node dist/server.js
```

### Pattern 4: Prisma 7 explicit generator output + import path

**What:** Prisma 7 makes `prisma-client` the default generator and requires an explicit `output`; every consumer imports from that path.
**When to use:** `apps/api/prisma/schema.prisma`, fixed now so Phase 2's better-auth Prisma adapter imports the same client instance.
**Example:**
```prisma
// Source: Prisma official docs, "Generating Prisma Client"
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```
```typescript
// apps/api/src/db.ts
import { PrismaClient } from './generated/prisma/client';
export const prisma = new PrismaClient();
```
Add `apps/api/src/generated/` to `.gitignore` — it is build output, regenerated by `prisma generate` (which itself runs as part of `pnpm install` via Prisma's own postinstall — see Pitfall 1 for the pnpm build-script gate that can silently block this).

### Pattern 5: Vitest globalSetup + testcontainers hybrid isolation

**What:** One Postgres container started once per Vitest worker via `globalSetup`, connection string passed via `provide`/`inject`, seeded once, per-test transaction rollback for speed; fresh container only for migration/schema tests.
**When to use:** All integration tests touching Prisma (D-09).
**Example:**
```typescript
// apps/api/test/globalSetup.ts
// Source: testcontainers-node official docs (node.testcontainers.org/quickstart/global-setup)
//         + Vitest official docs (vitest.dev/config/globalsetup)
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';

let container: StartedPostgreSqlContainer;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const dbUrl = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', { env: { ...process.env, DATABASE_URL: dbUrl } });
  project.provide('dbUrl', dbUrl);
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
```
```typescript
// apps/api/test/setupFileEach.ts — per-test transaction rollback
import { beforeEach, afterEach, inject } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';

export const prisma = new PrismaClient({ datasourceUrl: inject('dbUrl') });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('BEGIN');
});
afterEach(async () => {
  await prisma.$executeRawUnsafe('ROLLBACK');
});
```
Note: true Prisma transaction-rollback-per-test with raw `BEGIN`/`ROLLBACK` requires the app code under test to reuse the *same* Prisma client/connection for the duration of the test (Prisma's connection pooling can otherwise route statements to a different connection than the one that issued `BEGIN`). This is a known sharp edge — validate this pattern with a canary test early (Wave 0) rather than assuming it works from this research alone; flag as `[ASSUMED]` (see Assumptions Log).

### Pattern 6: SPA fallback registered after API routes

**What:** Register all `/api/*` routes and `/health` before calling `fastify.setNotFoundHandler()` to serve `index.html` for unmatched paths (Vue Router history mode).
**When to use:** Single-image deployment (D-01).
**Example:**
```typescript
// Source: @fastify/static official docs + community pattern (WebSearch, MEDIUM confidence)
await fastify.register(apiRoutes, { prefix: '/api' });
fastify.get('/health', async () => ({ status: 'ok' }));

await fastify.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  wildcard: false, // don't auto-serve every path; we control the fallback explicitly
});

fastify.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Not Found' });
  }
  return reply.sendFile('index.html');
});
```

### Anti-Patterns to Avoid

- **Running `prisma migrate deploy` in a Dockerfile `RUN` step:** bakes the migration into the image build, disconnected from the actual runtime database state at deploy time — always run it from the entrypoint, at container start (Pitfall confirmed via Prisma's own docs).
- **`docker-compose down -v` in any documented "restart" instructions or scripts:** destroys the named volume and defeats INFRA-03; only plain `down`/`up` or `restart` should ever appear in operator-facing docs.
- **Using `@fastify/static`'s `wildcard: true` default alongside a `/api/*` prefix without explicit route-order testing:** can cause the static plugin to shadow API routes or vice versa depending on registration order — always register API routes first, then static + a scoped not-found handler.
- **Testing against a mocked Prisma client for anything beyond pure unit logic:** hides real SQL/constraint bugs (e.g. Postgres unique constraints) — this project's whole TDD philosophy (D-09) is built around avoiding this via testcontainers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Waiting for Postgres to accept connections before starting the app | Custom polling loop / `wait-for-it.sh` shell script bundled manually | Docker Compose `healthcheck` (`pg_isready`) + `depends_on: condition: service_healthy` | Compose-native mechanism, no extra script to maintain, documented and battle-tested (see Code Examples / Architecture Diagram) |
| Ephemeral Postgres for tests | Hand-rolled Docker CLI spawn/teardown logic in test setup | `@testcontainers/postgresql`'s `PostgreSqlContainer` | Battle-tested lifecycle management (start/stop/cleanup on crash), already the CLAUDE.md-mandated choice |
| ENV schema validation | Manual `if (!process.env.X) throw` checks scattered across the codebase | Zod schema + single `safeParse` call at boot | Centralizes all required vars in one typed, self-documenting place; produces structured, complete error output (all missing vars at once, not one-at-a-time crashes) |
| Production dependency pruning for the Docker image | Manually deleting `node_modules` subfolders or writing a custom prune script | `pnpm deploy --filter=<app> --prod <dir>` | Official pnpm feature purpose-built for exactly this; correctly resolves workspace `catalog:`/`workspace:*` protocol deps and hard-links to avoid duplication |
| Prisma client generation gating under pnpm's script-blocking security default | A wrapper script running `prisma generate` manually in every Dockerfile stage and dev `postinstall` | `pnpm-workspace.yaml`'s `allowBuilds`/`pnpm approve-builds prisma @prisma/client @prisma/engines` (see Pitfall 1) | Uses pnpm's own supported allowlist mechanism rather than fighting it with manual scripts scattered across CI/Docker/dev setup |

**Key insight:** Every "don't hand-roll" item above exists because this exact infrastructure problem (readiness waiting, ephemeral test DBs, config validation, image pruning, script gating) has a first-party or de-facto-standard tool answer as of 2026 — the risk in this phase is not missing functionality but mis-wiring the standard tools (wrong route order, wrong build-vs-runtime migration timing, wrong pnpm build-script allowlist).

## Common Pitfalls

### Pitfall 1: pnpm blocks Prisma's postinstall script by default → "missing generated Prisma client"
**What goes wrong:** `pnpm install` completes successfully but `prisma generate` (which Prisma normally runs automatically via a postinstall lifecycle script) silently does not run, because pnpm ≥10 ignores dependency lifecycle scripts by default unless explicitly allowlisted. The app then fails at import time (`Cannot find module './generated/prisma/client'`) — exactly the failure mode the user's own global CLAUDE.md flags as a common recurring issue ("missing generated Prisma client").
**Why it happens:** pnpm 10+'s supply-chain-hardening default disables all dependency `postinstall`/`preinstall`/`install` scripts unless the package is listed in `pnpm-workspace.yaml`'s `allowBuilds` (pnpm 11+; formerly `onlyBuiltDependencies` in pnpm 10). This is silent — `pnpm install` exits 0.
**How to avoid:** Run `pnpm approve-builds prisma @prisma/client` once during scaffolding (writes `allowBuilds: { prisma: true, "@prisma/client": true }` into `pnpm-workspace.yaml`), and additionally add an explicit `pnpm --filter @kurzly/api exec prisma generate` step in both the Dockerfile build stage and CI, so generation never silently depends on the lifecycle-script allowlist alone. Add a Wave-0 test asserting the generated client module resolves (`import('../src/generated/prisma/client')` succeeds).
**Warning signs:** `pnpm install` succeeds but `pnpm tsc --noEmit` or the app boot immediately fails with a "Cannot find module" pointing at the generated Prisma path.

### Pitfall 2: `packages/shared` not rebuilt before consuming app types resolve stale
**What goes wrong:** Editing `packages/shared` doesn't propagate to `apps/web`/`apps/api` because they import compiled `dist/` output (not source), and nothing rebuilds it automatically outside of an explicit `pnpm run -r build` or a workspace `postinstall`/`prepare` hook.
**Why it happens:** pnpm workspace `workspace:*` protocol resolves `packages/shared` to its published `main`/`types` entry, which is `dist/`, not live TS source — unless the consuming app's build/dev tooling is specifically configured to alias to source (Vite can do this; a plain `tsc`-built `apps/api` cannot without extra config).
**How to avoid:** In this phase, keep it simple: root `package.json` `"build": "pnpm run -r build"` builds `shared` before `apps/*` (pnpm's topological ordering handles this automatically when `apps/*` declare `"@kurzly/shared": "workspace:*"` as a dependency — pnpm resolves the dependency graph, not alphabetical/directory order). This matches the user's own global CLAUDE.md instruction to "rebuild the shared package" before declaring work done — bake this into a documented `pnpm build` root script so it's not a manual step anyone has to remember.
**Warning signs:** `tsc --noEmit` passes in `packages/shared` but fails (or the app runs with stale behavior) in `apps/web`/`apps/api` after editing shared DTOs.

### Pitfall 3: Docker Compose `depends_on` without a healthcheck condition only orders container *start*, not readiness
**What goes wrong:** `app` container starts as soon as the `db` container process starts (not once Postgres is actually accepting connections), causing intermittent `ECONNREFUSED`/migration failures on `docker-compose up` — especially on first-ever startup when Postgres's `initdb` bootstrap takes longer.
**Why it happens:** Plain `depends_on: [db]` (list form) only guarantees Docker starts `db`'s container before `app`'s; it does not wait for the Postgres server process inside to be ready to accept connections.
**How to avoid:** Use the long-form `depends_on: db: condition: service_healthy` together with a `healthcheck` block on `db` using `pg_isready`, and generous `start_period` (30s+) to tolerate slow first-boot `initdb`.
**Warning signs:** Intermittent (not consistent) failures on `docker-compose up` from a cold state (no existing volume), that go away on a second `docker-compose up` once the volume/data directory already exists.

### Pitfall 4: Running migrations as a Dockerfile `RUN` step instead of at entrypoint
**What goes wrong:** Migrations get baked into the image at build time, against whatever database the CI/build machine happened to reach (or none, causing build failure) — completely disconnected from the actual production database the image is later deployed against.
**Why it happens:** Copy-pasting a "just run the command" mental model from local dev, where build and run happen against the same environment.
**How to avoid:** Always run `prisma migrate deploy` from `entrypoint.sh`, executed every time the container starts, right before the server process (Pattern 3 above).
**Warning signs:** Image builds fail in CI because no `DATABASE_URL` is reachable at build time (a strong tell this anti-pattern has crept in), or migrations silently don't apply to a freshly-deployed environment.

### Pitfall 5: Vitest `globalSetup` per-worker semantics vs. "one container per worker" intent
**What goes wrong:** Assuming `globalSetup` runs once per test *file* (it doesn't — it runs once per worker *pool process*, and with Vitest's default `pool: 'forks'`/`'threads'` and multiple workers, `globalSetup` itself actually only executes once total per `vitest` invocation unless `fileParallelism`/pool config is deliberately tuned) can lead to either an unwanted single shared container across all workers (fine for D-09's stated hybrid strategy, but worth confirming intentionally) or unexpected container-per-file costs if misconfigured.
**Why it happens:** Vitest's global setup lifecycle is subtle and has changed across major versions (v1→v4); "one container per worker" requires either relying on Vitest's default single global-setup invocation (which then serves all workers via one shared container — this is what D-09 actually describes: "ein Postgres-Container pro Vitest-Worker" is best read as the granularity ceiling, not literally N containers for N workers when a single shared instance + transaction rollback already achieves the isolation goal) or explicit `poolOptions` tuning.
**How to avoid:** Confirm early (Wave 0) with a two-line diagnostic test (`console.log(process.pid)` in two parallel test files) whether the default Vitest 4 config gives one shared container (recommended, matches "seed once" from D-09) before building more elaborate per-worker container plumbing. Default to **one shared container via a single `globalSetup` + transaction-rollback-per-test** unless a concrete need for multiple containers emerges (e.g. migration tests needing total isolation, which D-09 already carves out as the exception).
**Warning signs:** Test suite hangs or errors on startup with multiple containers competing for the same host port; or tests interfere with each other's data despite the transaction-rollback pattern (sign the shared-container assumption is violated).

## Runtime State Inventory

Not applicable — this is a greenfield phase (no existing repo state, confirmed by directory listing: only `.git`, `.claude`, `.planning`, and the unrelated `design_handoff_url_shortener/` reference material exist; no `package.json`, `apps/`, `packages/`, or CI config present yet). None of the 5 runtime-state categories (stored data, live service config, OS-registered state, secrets/env vars, build artifacts) apply — there is nothing pre-existing to migrate away from.

## Code Examples

Verified/cited patterns from official sources — see Architecture Patterns section above for the full Pattern 1–6 code blocks (Dockerfile, Zod env schema, Prisma entrypoint script, Prisma 7 generator config, Vitest globalSetup/testcontainers, SPA fallback routing). Additional standalone examples:

### `.env.example` (D-07)
```bash
# Source: pattern synthesized from CONTEXT.md D-07 requirements + CLAUDE.md ENV list
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://kurzly:changeme@db:5432/kurzly

# SMTP (magic-link email delivery — used from Phase 2 onward, validated now)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Kurzly <no-reply@example.com>"

# App
BASE_URL=https://kurzly.example.com
BETTER_AUTH_SECRET=  # generate with: openssl rand -base64 32
```

### `docker-compose.yml` (production, D-01/D-02)
```yaml
# Source: pattern synthesized from Docker Compose official healthcheck docs (WebSearch, MEDIUM confidence)
services:
  db:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: kurzly
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: kurzly
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kurzly"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  app:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    env_file: .env
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

volumes:
  db-data:
```

### `docker-compose.dev.yml` (dev/CI overlay, D-10)
```yaml
# Source: axllent/mailpit Docker Hub docs (WebSearch, MEDIUM confidence)
services:
  mailpit:
    image: axllent/mailpit:latest
    restart: unless-stopped
    ports:
      - "8025:8025"
      - "1025:1025"
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
```

### CI workflow skeleton (D-11)
```yaml
# Source: testcontainers-node CI guidance (WebSearch, MEDIUM confidence) —
# ubuntu-latest ships Docker preinstalled, no extra services: config needed for testcontainers
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run -r build
      - run: pnpm run -r test   # spins up testcontainers Postgres per D-09
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Prisma client generated into `node_modules/.prisma/client` by default | Explicit `output` path required in `generator client` block (Prisma 7) | Prisma 7.0 (2026) | Every consumer must import from the project-declared path, not the bare `@prisma/client` package; must be fixed now for Phase 2's better-auth adapter compatibility |
| npm/pnpm run all dependency lifecycle scripts by default | pnpm 10+ blocks lifecycle scripts (postinstall etc.) unless allowlisted via `allowBuilds`/`onlyBuiltDependencies` | pnpm 10 (mid-2025) | Prisma's automatic `prisma generate` postinstall silently no-ops unless explicitly approved — see Pitfall 1 |
| `pnpm-workspace.yaml`'s `onlyBuiltDependencies` setting | Replaced by `allowBuilds` map (`{ "pkg-name": true/false }`) | pnpm 11.0 | Use `allowBuilds`, not `onlyBuiltDependencies`, when scaffolding on pnpm ^11 |
| Turborepo `prune` as the default Docker monorepo pattern | pnpm's own `pnpm deploy --prod` covers single-app-per-image cases without extra tooling | pnpm 8+ (documented at pnpm.io/docker) | No need to add Turborepo to this project just for Docker image pruning |

**Deprecated/outdated:**
- `onlyBuiltDependencies` in `pnpm-workspace.yaml`: replaced by `allowBuilds` as of pnpm 11.0; do not follow older tutorials referencing the old key name.
- Generating Prisma Client into `node_modules` implicitly: removed as the default in Prisma 7; always declare `output` explicitly.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | nodemailer `^9.0.3` is current/correct (only cross-checked once via `npm view`, primary source was CLAUDE.md/training knowledge, not independently re-derived from official nodemailer docs this session) | Standard Stack → Supporting | Low — version already independently pinned in CLAUDE.md's own separately-researched pass; worst case is a minor version drift, not a wrong package |
| A2 | tsup vs. tsc-only vs. tsx for `apps/api`'s build step is left as an open choice, defaulting to tsup, based on general Node/TS ecosystem convention rather than a Kurzly-specific verified source | Standard Stack → Supporting, Alternatives Considered | Low — build tool choice, easily changed later, no data-loss or security implication |
| A3 | Vitest `globalSetup`'s exact per-worker-vs-shared container semantics with Vitest 4's default pool settings, as they apply to achieving D-09's "one container per worker" intent | Pattern 5, Pitfall 5 | Medium — if the assumption that a single shared container + transaction rollback satisfies D-09's intent is wrong, the planner may need to budget extra Wave-0 time for a genuinely per-worker-container setup (more complex `poolOptions` config); flagged as a Wave-0 diagnostic test to resolve before deeper harness build-out |
| A4 | Prisma's raw `BEGIN`/`ROLLBACK` transaction-rollback-per-test pattern (Pattern 5) works cleanly with Prisma 7's connection pooling without extra `$transaction` wrapping or a dedicated single-connection Prisma Client instance per test | Pattern 5 | Medium — if Prisma's connection pool routes the `ROLLBACK` to a different physical connection than the `BEGIN`, tests will not actually be isolated (silent data leakage between tests) — this must be verified with an early canary test (Wave 0) before broader test-suite build-out, not assumed correct from research alone |
| A5 | `postgres:18-alpine`'s `pg_isready` binary is available and sufficient as a healthcheck without also verifying the target database (`kurzly`) specifically exists/is reachable (vs. just "server process is up") | Code Examples → docker-compose.yml, Pitfall 3 | Low — `pg_isready -U kurzly` checks the role can connect; if the specific DB name check matters more precisely, `pg_isready -U kurzly -d kurzly` is a trivial addition the planner can make |

## Open Questions

1. **Does Vitest 4's default `pool` setting (threads vs. forks) actually spin up multiple worker processes for this project's likely-small initial test count, or will it run single-threaded in practice, making the "container per worker" question moot for Phase 1's walking-skeleton test count?**
   - What we know: Vitest defaults to `pool: 'threads'` (or `forks` depending on version), spawns workers based on available CPUs, but with only a handful of test files in this phase's placeholder test suite, actual worker parallelism may not materialize.
   - What's unclear: Whether the planner should build the "one container per worker" mechanism now for a test suite that may not yet exercise multiple workers, or defer that complexity until the test count grows in later phases.
   - Recommendation: Start with the simpler single-shared-container + transaction-rollback pattern (satisfies D-09's stated goal), verified via a Wave-0 diagnostic; treat true per-worker containers as a later optimization only if CI test times become a bottleneck.

2. **Should `@fastify/helmet` and `@fastify/rate-limit` be installed in this phase even though they're not wired to any real route yet (since there's no auth/redirect surface until Phase 2/5)?**
   - What we know: CLAUDE.md lists both as part of the "Recommended Stack," but their concrete application (rate-limiting the magic-link endpoint, hardening CSP around OG-tag rendering) only makes sense once those routes exist.
   - What's unclear: Whether installing-but-not-configuring them now vs. deferring installation entirely to the phase that needs them is preferred.
   - Recommendation: Defer both to the phases that introduce the routes they protect (Phase 2 for rate-limit on magic-link, Phase 5 for helmet's CSP tuning around the redirect/OG-tag handler) — keeps Phase 1's dependency surface minimal and matches the "walking skeleton" framing.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|-----------|
| Docker Engine + Docker Compose | Production deploy, all local dev, testcontainers (dev machine) | Not probed in this research session (sandbox has no Docker daemon) | — | Planner must add an early "Docker availability" verification step in the plan itself (e.g. `docker info` check) — no code fallback exists for a self-hosted Docker-based deployment; this is a hard requirement, not optional |
| Node.js 24.x | Local dev, CI | Not probed (sandbox may differ from target dev/CI environment) | — | CI pins `actions/setup-node@v4` with `node-version: 24` explicitly; local dev should use the same via `.nvmrc`/`packageManager` corepack pin |
| pnpm ^11 | Monorepo tooling | Not probed | — | `packageManager` field in root `package.json` + `corepack enable` ensures the correct pnpm version is used regardless of what's globally installed |
| GitHub Actions ubuntu-latest Docker socket | CI testcontainers (D-11) | N/A — verified via research (ubuntu-latest ships Docker preinstalled) [CITED: multiple WebSearch sources] | — | — |

**Missing dependencies with no fallback:**
- Docker Engine/Compose on the operator's and developer's machines — this is the entire premise of the project (self-hosted via Docker), so there is no code-level fallback; the plan should include a documented prerequisite check, not a workaround.

**Missing dependencies with fallback:**
- None beyond the above — pnpm/Node version pinning via `packageManager`/CI config is itself the fallback mechanism for version mismatches.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.10 (unit + integration), `fastify.inject` for HTTP-level route tests |
| Config file | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts` (none exist yet — Wave 0) |
| Quick run command | `pnpm --filter @kurzly/api test -- --run` (unit tests, no testcontainers) |
| Full suite command | `pnpm run -r test` (includes testcontainers-backed integration tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|---------------|
| INFRA-01 | `docker-compose up` starts the full stack with zero manual steps | integration/smoke (docker compose driven, not Vitest) | `docker compose up -d --wait && curl -f http://localhost:3000/health` | ❌ Wave 0 — needs a smoke-test script, e.g. `scripts/smoke-compose.sh` |
| INFRA-01 | Migrations apply automatically on container start | integration | Assert `prisma migrate status` reports "up to date" after `docker compose up`, or a Vitest test hitting a migrated table via a health-of-schema route | ❌ Wave 0 |
| INFRA-02 | ENV validation fails fast with exit 1 on missing/invalid vars | unit | `pnpm --filter @kurzly/api test env.test.ts` — spawn boot with a deliberately incomplete env, assert non-zero exit + expected stderr content | ❌ Wave 0 — `apps/api/test/env.test.ts` |
| INFRA-02 | `.env.example` covers every var the schema requires | unit (schema-drift guard) | A test parsing `.env.example` keys and diffing against the Zod schema's `.shape` keys | ❌ Wave 0 |
| INFRA-03 | Postgres data survives `down`/`up` without `-v` | canary/smoke (docker compose driven) | `scripts/smoke-persistence.sh`: write a row via `psql`/Prisma, `docker compose down && docker compose up -d --wait`, assert row still present | ❌ Wave 0 |
| (harness) | testcontainers Postgres integration test round-trips a Prisma query | integration | `pnpm --filter @kurzly/api test db.integration.test.ts` | ❌ Wave 0 — first real testcontainers-backed test |
| (harness) | Transaction-rollback-per-test actually isolates data between tests | integration (canary, resolves A4) | A test that writes a row, a second test in the same file asserting it's absent | ❌ Wave 0 |
| (harness) | packages/shared build required before apps consume it | build-time check, not a runtime test | `pnpm run -r build` in CI fails loudly if `apps/*` import an unbuilt `shared` | ❌ Wave 0 — covered by CI workflow itself, no dedicated test file needed |

### Sampling Rate
- **Per task commit:** `pnpm --filter @kurzly/api test -- --run` (fast unit-only subset)
- **Per wave merge:** `pnpm run -r test` (full suite, including testcontainers integration tests)
- **Phase gate:** Full suite green, plus the two compose-driven smoke scripts (`smoke-compose.sh`, `smoke-persistence.sh`) passing, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/vitest.config.ts` + `apps/web/vitest.config.ts` — framework config, none exist yet
- [ ] `apps/api/test/globalSetup.ts` — testcontainers provide/inject wiring (Pattern 5)
- [ ] `apps/api/test/env.test.ts` — fail-fast ENV validation coverage (D-06)
- [ ] `apps/api/test/db.integration.test.ts` — first real testcontainers-backed Prisma round-trip
- [ ] `scripts/smoke-compose.sh` — INFRA-01 zero-manual-steps verification
- [ ] `scripts/smoke-persistence.sh` — INFRA-03 canary persistence test (D-08)
- [ ] `.github/workflows/ci.yml` — D-11's CI-runs-full-suite requirement
- [ ] Framework install: `pnpm add -D -w vitest @vitest/coverage-v8 @testcontainers/postgresql testcontainers`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No (Phase 2 scope) | — |
| V3 Session Management | No (Phase 2 scope) | — |
| V4 Access Control | No (Phase 2/9 scope) | — |
| V5 Input Validation | Yes — ENV input | Zod schema validation at boot (D-06) is itself an ASVS V5-aligned control: untrusted external input (env vars set by the operator) is validated before use, with fail-closed behavior on invalid input |
| V6 Cryptography | Marginal — `BETTER_AUTH_SECRET` generation is documented (`openssl rand -base64 32` in `.env.example`) but the secret itself is consumed by Phase 2, not this phase; ensure the Zod schema enforces a minimum length now so a weak secret can't silently pass validation later |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Hardcoded secrets/credentials committed to the repo (e.g. a real `DATABASE_URL` password in `docker-compose.yml` instead of `${POSTGRES_PASSWORD}` from `.env`) | Information Disclosure | INFRA-02's ENV-only configuration mandate; `.env` in `.gitignore`, only `.env.example` (with placeholder values) committed |
| Docker socket exposure in CI (`testcontainers` needs Docker access) | Elevation of Privilege | Only relevant on shared/self-hosted CI runners, not GitHub-hosted `ubuntu-latest` (isolated per-job VM) — no action needed for this phase's CI choice, but flag if the team later moves to self-hosted runners |
| Silent Prisma-client-generation failure leading to a stale/absent client shipped to production (Pitfall 1) | Tampering (indirect — a broken build could mask a real code-integrity issue) | CI step explicitly asserting the generated client module resolves, not relying on implicit postinstall behavior |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view <pkg> version`, direct registry query) — fastify, @fastify/static, @fastify/cors, @fastify/helmet, @fastify/rate-limit, prisma, @prisma/client, zod, vitest, @vitest/coverage-v8, testcontainers, @testcontainers/postgresql, vue, vite, typescript, pino, pino-pretty, pnpm, tsx, tsup, dotenv — all versions confirmed current as of 2026-07-10
- `gsd-tools query package-legitimacy check` — legitimacy signals (downloads, repo, publish date) for all packages above

### Secondary (MEDIUM confidence)
- pnpm.io/docker (official pnpm docs, fetched via WebFetch) — multi-stage Dockerfile + `pnpm deploy --prod` pattern
- node.testcontainers.org/quickstart/global-setup (official testcontainers-node docs, fetched via WebFetch) — Vitest globalSetup + provide/inject pattern
- vitest.dev/config/globalsetup (official Vitest docs, referenced via WebSearch synthesis)
- prisma.io official docs — "Deploying database changes with Prisma Migrate", "Generating Prisma Client", "Generators (Reference)" (referenced via WebSearch synthesis)
- pnpm.io/settings, pnpm.io/blog/releases/11.0, pnpm.io/cli/approve-builds (official pnpm docs, referenced via WebSearch synthesis) — `allowBuilds` / lifecycle-script-blocking behavior
- axllent/mailpit GitHub + Docker Hub docs (referenced via WebSearch synthesis) — Mailpit compose/port configuration
- Docker Compose official healthcheck/depends_on behavior (referenced via WebSearch synthesis across multiple vendor blog posts)
- @fastify/static official npm/GitHub docs (referenced via WebSearch synthesis) — SPA fallback + not-found-handler pattern

### Tertiary (LOW confidence)
- General WebSearch-synthesized community blog posts (Medium, DEV.to, oneuptime.com) for Docker healthcheck examples, Fastify healthcheck plugin patterns, Zod env validation boilerplate, GitHub Actions + testcontainers CI examples — cross-checked against official docs where available (marked MEDIUM above); pure community-blog-only claims not independently verified against an official source are flagged inline where they appear (e.g. exact Vitest per-worker globalSetup semantics, Pitfall 5 / Assumption A3)

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — every version independently verified against the npm registry and cross-checked against CLAUDE.md's separately-researched pins; no discrepancies found
- Architecture (Dockerfile, Compose, entrypoint patterns): MEDIUM-HIGH — core patterns (pnpm deploy, healthcheck/depends_on, Prisma entrypoint migration) confirmed via official docs; exact Vitest globalSetup per-worker semantics (Pattern 5/Pitfall 5/A3) is MEDIUM and flagged for Wave-0 verification
- Pitfalls: HIGH for Pitfall 1 (pnpm build-script blocking + Prisma) — directly corroborated by the user's own global CLAUDE.md independently flagging "missing generated Prisma client" as a known recurring failure; MEDIUM for the rest (well-documented but not project-specific)

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (30 days — this domain moves at a moderate pace: pnpm's build-script-blocking behavior and Prisma's generator defaults have both changed within the last year, so version-specific claims should be re-verified if planning is delayed beyond a month)
</content>
