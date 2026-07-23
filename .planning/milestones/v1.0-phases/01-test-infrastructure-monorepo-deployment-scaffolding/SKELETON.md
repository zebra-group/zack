# Walking Skeleton — Kurzly

**Phase:** 1
**Generated:** 2026-07-10

## Capability Proven End-to-End

> One sentence: the smallest user-visible capability that exercises the full stack.

An operator runs `docker compose up`, opens the served Vue dashboard, clicks a button that writes a row to PostgreSQL through the Fastify API, and sees the live count read back from the database — with all configuration supplied via environment variables and the data surviving a container restart.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo | pnpm workspace: `apps/api`, `apps/web`, `packages/shared` | Fixed by CLAUDE.md; native `workspace:*` + topological `pnpm -r build` orders `packages/shared` before its consumers with no extra tooling (RESEARCH Pitfall 2) |
| Backend framework | Fastify ^5.10 (Node 24-alpine) | Fixed by CLAUDE.md; single process serves `/api/*`, the redirect handler, and the built SPA (D-01) |
| Frontend framework | Vue 3 ^3.5 + Vite ^8 (`<script setup>`) | Fixed by CLAUDE.md; builds to `dist/` served by `@fastify/static` in one image (D-01) |
| Data layer | PostgreSQL 18-alpine + Prisma ^7 | Fixed by CLAUDE.md; Prisma 7 requires an explicit `generator client { output = "../src/generated/prisma" }` path, fixed now so Phase 2 better-auth imports the same client instance (RESEARCH Pattern 4, Pitfall 1) |
| Config | Fail-fast Zod ENV schema at boot (`exit 1` on invalid), `.env.example` documents every var | D-06 / D-07; nothing hardcoded in the image (INFRA-02) |
| Migrations | `prisma migrate deploy` in the container entrypoint, before the server starts — never a Dockerfile `RUN` step | D-05; zero manual migration steps on `docker compose up` (INFRA-01), matches RESEARCH Pattern 3 / Pitfall 4 |
| Deployment target | Two-service Docker Compose (`app` + `db`), named volume `db-data`, `pg_isready` healthcheck + `depends_on: condition: service_healthy` | D-02 / D-08; data survives restart (INFRA-03), app waits for a ready DB (RESEARCH Pitfall 3) |
| Reverse proxy / TLS | NOT wired into product code — compose exposes only the app port; a `docs/deployment/reverse-proxy.md` documents Caddy/nginx/Traefik/certbot | D-03 / D-04; operator owns TLS termination |
| Test harness | Vitest ^4 + `@testcontainers/postgresql` (real Postgres) + Mailpit; one shared container via `globalSetup`, per-test `BEGIN`/`ROLLBACK` isolation | D-09 / D-10; no Prisma mocking, mandatory TDD (CLAUDE.md) |
| Directory layout | `apps/*`, `packages/shared`, root-level `Dockerfile` + `docker-compose*.yml`, `docs/deployment/`, `.github/workflows/` | Matches RESEARCH "Recommended Project Structure" |

## Stack Touched in Phase 1

- [x] Project scaffold (pnpm workspace, Vite/Vue, Fastify, TypeScript, ESLint-ready, Vitest runner)
- [x] Routing — real Fastify routes: `GET /health`, `GET /api/canary`, `POST /api/canary`, redirect-handler stub `GET /:slug`, SPA fallback
- [x] Database — real read AND write: `POST /api/canary` writes a `PersistenceCanary` row; `GET /api/canary` reads the count back, both against real Postgres
- [x] UI — interactive element wired to the API: Vue dashboard button POSTs `/api/canary` and renders the live count from `GET /api/canary`
- [x] Deployment — `docker compose up` boots `app` + `db`, applies migrations automatically at entrypoint, serves the SPA + API on one origin; documented full-stack local run command

## Out of Scope (Deferred to Later Slices)

> Anything that is *not* in the skeleton. Explicit list to stop later phases re-litigating Phase 1's minimalism.

- Magic-link auth, the `User` model, and first-admin bootstrap (Phase 2 — deferred per CONTEXT.md)
- `requireDomainAccess` / `scopedDomainIds` authorization helper (Phase 2)
- Reverse-proxy / TLS as product code (operator responsibility, documented only — D-03/D-04; Phase 3 re-scope flagged in CONTEXT.md)
- `@fastify/helmet` and `@fastify/rate-limit` wiring (deferred to the phases that introduce real attack surface — RESEARCH Open Question 2)
- Any Kurzly feature logic (links, redirects, QR, analytics, teams, metadata)
- The `PersistenceCanary` model is a skeleton probe only — it will be removed or superseded once real models land

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Magic-link auth + theme-aware app shell + the domain-authorization helper
- Phase 3: Domain registration + DNS verification (TLS delegated to the documented reverse proxy)
- Phase 4: Link create/search/edit/delete + CSV bulk import
- Phase 5: Core redirect engine (302 / 410 / password gate / bot-OG precedence)
- Phase 6: Internal privacy-first click tracking + analytics
- Phase 7: Static + dynamic QR codes (QR Studio)
- Phase 8: UTM builder + custom OG metadata
- Phase 9: Team management + server-side domain-scoped authorization enforcement
- Phase 10: Optional OIDC/SSO login
