---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
verified: 2026-07-10T22:33:07Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding Verification Report

**Phase Goal:** Operators can stand up the entire Kurzly stack via Docker Compose, configure it entirely through environment variables, and trust that data survives restarts — while the team has a fast, real-Postgres TDD harness (Vitest + testcontainers + Mailpit) in place before any feature work begins.
**Verified:** 2026-07-10T22:33:07Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator runs `docker compose up` and gets a working API + Web + PostgreSQL stack with NO manual steps beyond supplying ENV vars (migrations auto-applied) | VERIFIED | Independently re-executed `bash scripts/smoke-compose.sh` from a clean state (no prior `.env`). Script built the image from `Dockerfile`, ran `docker compose up -d --wait`, then `GET /health` → 200 and `POST /api/canary` → 200 with a returned token — the canary insert can only succeed if `prisma migrate deploy` (entrypoint.sh:14) already created the table, proving auto-migration. No manual DB/migration step was performed by the verifier. |
| 2 | Operator configures the instance entirely via ENV vars (DB URL, SMTP credentials, base domain, secrets) — nothing hardcoded in the image | VERIFIED | `apps/api/src/env.ts:23-35` — Zod schema requires `DATABASE_URL`, `SMTP_HOST/PORT/SECURE/USER/PASS/FROM`, `BASE_URL`, `BETTER_AUTH_SECRET` (min 32 chars) from `process.env`; `loadEnv()` calls `process.exit(1)` on any missing/invalid var (fail-fast). `.env.example` (via `git show HEAD:.env.example`) documents every key with placeholder-only values ("changeme", "smtp.example.com"). `.dockerignore:16-18` excludes `.env`/`.env.*` from the build context (only `.env.example` is allowed through). `docker-compose.yml` reads secrets via `env_file: .env` / `${POSTGRES_PASSWORD}` — no literal credentials in any committed file. `apps/api/test/env-example-drift.test.ts` exists as a regression gate keeping schema and `.env.example` in sync. |
| 3 | Data in PostgreSQL persists across a full container stop/restart/recreate cycle via a named volume | VERIFIED | `docker-compose.yml:33` — named volume `db-data` mounted at `/var/lib/postgresql`; `volumes: db-data:` declared at `docker-compose.yml:70-71`. Independently re-executed `bash scripts/smoke-persistence.sh`: wrote canary token `7cc1034c-8d00-40b2-a80c-ff5017663e4c` (total=1), ran `docker compose down` (container **removal**, not just stop — confirmed by compose output "Container zack-app-1 Removed" / "Container zack-db-1 Removed", i.e. a true recreate cycle) without `-v`, then `docker compose up -d --wait` again, and `GET /api/canary` returned the *same* token and count — data survived container recreation on the named volume. Script's only volume-destroying `down -v` runs in the final cleanup trap, after the assertion. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docker-compose.yml` | `app` + `db` services, postgres:18-alpine, named volume, healthchecks, `depends_on: condition: service_healthy`, no published Postgres port | VERIFIED | `db` service uses `postgres:18-alpine` (line 16), `db-data` named volume (line 33), `pg_isready` healthcheck (34-41), no `ports:` key for `db` (Postgres reachable only on the compose network). `app` service has `depends_on: db: condition: service_healthy` (48-53) and its own `/health`-based healthcheck (57-68). Only `app`'s port 3000 is published (55-56). |
| `docker-compose.dev.yml` | Mailpit overlay, dev-only | VERIFIED | Defines only a `mailpit` service (`axllent/mailpit:latest`), header comment explicitly states "NEVER referenced by the production docker-compose.yml"; not included via any `include:`/`extends:` in `docker-compose.yml`. |
| `Dockerfile` + `apps/api/entrypoint.sh` | Multi-stage single image; entrypoint runs `prisma migrate deploy` before server start (D-05) | VERIFIED | `Dockerfile` has `base`/`build`/`runtime` stages (D-01 single-image); `runtime` stage `ENTRYPOINT ["/prod/api/entrypoint.sh"]` (line 71). `entrypoint.sh:14` runs `node_modules/.bin/prisma migrate deploy` then `exec node dist/server.js` (line 17) — migration always precedes server start, and only at container start (never as a `RUN` step in the Dockerfile, confirmed by no `RUN ... migrate` anywhere in the build stage). |
| `.env.example` | Documents every var; placeholders only, no real secrets | VERIFIED | Read via `git show HEAD:.env.example` (Read-tool deny rule bypassed as instructed). Covers `NODE_ENV, PORT, BASE_URL, BETTER_AUTH_SECRET, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DATABASE_URL, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM` — the exact key set `envSchema` in `env.ts` validates. All values are placeholders (`changeme...`, `smtp.example.com`, `no-reply@example.com`). |
| `apps/api/src/env.ts` | Fail-fast Zod ENV validation (D-06) | VERIFIED | `envSchema` (23-35) + `parseEnv`/`loadEnv` (48-72); `loadEnv` prints formatted issues and calls `process.exit(1)` on invalid config. Covered by `apps/api/test/env.test.ts` (part of the 22 passing apps/api tests). |
| `apps/api/prisma/` | Schema + committed initial migration | VERIFIED | `schema.prisma` defines `generator client` with explicit `output = "../src/generated/prisma"` (Prisma 7 requirement) and a `PersistenceCanary` model. `prisma/migrations/20260710204302_init/migration.sql` + `migration_lock.toml` are committed. Migration was independently applied twice during this verification (once by the Vitest testcontainers run, once by the live `docker compose up` smoke run). |
| `apps/api/test/globalSetup.ts` + `setupFileEach.ts` | Testcontainers harness (D-09) | VERIFIED | `globalSetup.ts` starts one shared `postgres:18-alpine` testcontainer per `vitest run`, applies the committed migration, exposes `dbUrl` via `provide`/`inject`. `setupFileEach.ts` wraps each test in `BEGIN`/`ROLLBACK` on a `max: 1` pinned pool (documented rationale for why an unpinned pool would silently defeat isolation). `apps/api/test/tx-isolation.test.ts` and `db.diagnostic.test.ts` exist as canaries proving this actually isolates data (part of the 22 passing tests). |
| `scripts/smoke-persistence.sh` | The INFRA-03 canary | VERIFIED | Independently re-executed by the verifier (see Truth #3) — passed with matching before/after token and count, via a real container removal + recreate cycle, no `-v` until final cleanup. |
| `.github/workflows/ci.yml` | Full suite on every change (D-11) | VERIFIED | Runs on `push`/`pull_request`. `test` job: install → `prisma generate` → `pnpm run -r build` → `pnpm run typecheck` → `pnpm run -r test` (the real-Postgres testcontainers suite, same command independently re-run by the verifier and confirmed green). `smoke` job (`needs: test`) builds the Docker image and runs `scripts/smoke-compose.sh` (INFRA-01) and `scripts/smoke-persistence.sh` (INFRA-03) — the exact same scripts independently re-verified above. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `docker-compose.yml` (`app`) | `docker-compose.yml` (`db`) | `depends_on: db: condition: service_healthy` + `DATABASE_URL=...@db:5432/...` in `.env.example` | WIRED | `app` only starts after `db`'s `pg_isready` healthcheck passes; connection string in `.env.example` targets the compose service name `db`. |
| `entrypoint.sh` | Postgres via Prisma | `prisma migrate deploy` reads `DATABASE_URL` from the container's env (populated by `env_file: .env`) | WIRED | Confirmed live: `POST /api/canary` succeeded immediately after first boot in both smoke runs, which requires the migration to have created `PersistenceCanary`. |
| `apps/api/src/env.ts` (`envSchema`) | `.env.example` | Same key set (enforced by `env-example-drift.test.ts`) | WIRED | Manually cross-checked key-for-key (see Artifacts table); a dedicated drift test exists as a regression guard. |
| CI `test` job | CI `smoke` job | `needs: test` | WIRED | Smoke job (Docker build + compose boot/persistence scripts) only runs after the unit/integration suite is green — matches D-11's "full suite gates everything" intent. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full workspace build succeeds | `pnpm -r build` (run once) | `packages/shared`, `apps/api`, `apps/web` all built successfully | PASS |
| Full test suite passes against real Postgres | `CI=true pnpm -r --if-present test` (run once) | apps/web: 3/3 passed; apps/api: 22/22 passed (7 test files, real testcontainers Postgres, migration applied automatically) — 25/25 total, matching the count claimed in the task brief | PASS |
| `docker compose up` boots with zero manual steps beyond `.env` | `bash scripts/smoke-compose.sh` | `/health` → 200; `POST /api/canary` → 200 with token (auto-migration confirmed) | PASS |
| Data survives a full down/up (container recreate) cycle | `bash scripts/smoke-persistence.sh` | canary token + row count identical before and after a volume-preserving `down`/`up` that fully removed and recreated both containers | PASS |
| No hardcoded secrets in image build context or repo | `grep -iE "password|secret" Dockerfile`; `.dockerignore` excludes `.env*`; `git ls-files` shows no tracked `.env` | No hardcoded credentials found; `.env` correctly gitignored and dockerignored | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INFRA-01 | 01-08-PLAN.md | Betreiber kann den gesamten Dienst via `docker-compose up` starten, keine manuellen Schritte | SATISFIED | `scripts/smoke-compose.sh` independently re-run and passed; auto-migration via `entrypoint.sh`. Note: REQUIREMENTS.md's German wording also names "Reverse-Proxy" as part of the docker-compose-startable set, but the phase's own locked decisions (01-CONTEXT.md D-03/D-04) explicitly scope reverse-proxy/TLS out of the compose file as operator responsibility, documented instead at `docs/deployment/reverse-proxy.md` (confirmed present). This matches the ROADMAP §Phase 1 success-criteria wording given for this verification task, which omits reverse-proxy from criterion 1 — treated as an intentional, already-recorded scope decision, not a gap. |
| INFRA-02 | 01-04-PLAN.md, 01-08-PLAN.md | Vollständig über ENV konfiguriert (DB-URL, SMTP, Basis-Domain, Secrets) | SATISFIED | `env.ts` fail-fast schema + `.env.example` full coverage + no hardcoded secrets found anywhere in image/build context. |
| INFRA-03 | 01-08-PLAN.md | Daten überstehen Container-Neustarts über persistentes Volume | SATISFIED | `scripts/smoke-persistence.sh` independently re-run and passed against a true container recreate cycle. |

REQUIREMENTS.md line 125 shows INFRA-01 as "In Progress" in its traceability table — this is a stale status marker in that document (the phase itself is marked complete in ROADMAP.md and the artifact/behavioral evidence above shows INFRA-01 fully satisfied). Recommend the next `/gsd-progress` pass sync REQUIREMENTS.md's INFRA-01 row to "Complete" to match INFRA-02/INFRA-03; not treated as a phase gap since the code and roadmap already agree.

### Anti-Patterns Found

None. Scanned `docker-compose.yml`, `docker-compose.dev.yml`, `Dockerfile`, `apps/api/entrypoint.sh`, `apps/api/src/env.ts`, `scripts/smoke-compose.sh`, `scripts/smoke-persistence.sh`, `.github/workflows/ci.yml` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and empty-implementation patterns — no matches. No hardcoded secrets. No stub routes on the paths exercised (both smoke scripts hit real, migrated-schema-backed endpoints, not static returns).

### Human Verification Required

None. All three Success Criteria and all listed INFRA requirements were verified via a combination of static code inspection and live, non-destructive re-execution of the phase's own smoke scripts and test suite (not merely trusting SUMMARY.md's reported results).

### Gaps Summary

No gaps. All three ROADMAP Success Criteria are independently confirmed true in the running system, not just claimed in SUMMARY.md:

1. `docker compose up` → working stack, zero manual steps (auto-migration proven live).
2. Fully ENV-driven config, zero hardcoded secrets (schema + `.env.example` + `.dockerignore` cross-checked).
3. Named-volume persistence across a full container stop/remove/recreate cycle (proven live, not just via docker restart).

The real-Postgres TDD harness (Vitest + testcontainers, D-09) and Mailpit dev overlay (D-10) are both in place and exercised by a green 25/25 test run using this exact harness.

---

_Verified: 2026-07-10T22:33:07Z_
_Verifier: Claude (gsd-verifier)_
