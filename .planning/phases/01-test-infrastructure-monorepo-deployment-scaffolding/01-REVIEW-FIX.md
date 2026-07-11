---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
fixed_at: 2026-07-11T09:09:48Z
review_path: .planning/phases/01-test-infrastructure-monorepo-deployment-scaffolding/01-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 5
skipped: 2
status: partial
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-07-11T09:09:48Z
**Source review:** .planning/phases/01-test-infrastructure-monorepo-deployment-scaffolding/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (Warning-tier only; REVIEW.md had 0 Critical findings; Info findings are out of scope for `fix_scope: critical_warning`)
- Fixed: 5
- Skipped: 2 (both blocked by a hard supply-chain constraint, not a code-context mismatch)

Every fix was verified beyond the minimum tier: `CI=true pnpm -r build`, `CI=true pnpm -r --if-present test` (28/28 passing — 25 apps/api incl. 3 new regression tests + 3 apps/web, up from the pre-fix 22 apps/api + 3 apps/web baseline), and `pnpm -r --if-present typecheck` all pass clean on the full fixed tree. WR-03's Dockerfile change was additionally verified with a real `docker build` + an end-to-end container run against a live `postgres:18-alpine` container: `prisma migrate deploy` and the server both ran successfully as the non-root `node` user (uid 1000), confirmed via `id` inside the running container and a successful `GET /health` round-trip.

## Fixed Issues

### WR-01: `db.ts`'s production Prisma singleton silently falls back to an empty connection string

**Files modified:** `apps/api/src/db.ts`, `apps/api/vitest.config.ts`, `apps/api/test/db.test.ts`
**Commit:** `8934ba8`
**Applied fix:** `db.ts` now throws immediately if `process.env.DATABASE_URL` is unset, instead of silently constructing a `PrismaPg` adapter against `""` (consistent with the project's D-06 fail-fast philosophy). Since `db.ts` is statically imported by `app.ts`, and the test process never set a bare `process.env.DATABASE_URL` (tests get their real DB URL via Vitest's `provide`/`inject` from `globalSetup.ts`, not via the process env), `vitest.config.ts` now sets `test.env.DATABASE_URL` to the same syntactically-valid placeholder connection string already used by the Dockerfile's `prisma generate` step and CI (`postgresql://placeholder:...`) — routes under test still exclusively use the real testcontainers-backed, transaction-wrapped `prisma` client via `buildApp({ prisma })`, so this placeholder is never actually connected to. Added `apps/api/test/db.test.ts` with direct unit coverage of both the fail-fast-throw path and the successful-construction path, closing the "zero test coverage" gap the finding called out.

### WR-03: Runtime container runs as root — no `USER` directive in the Dockerfile

**Files modified:** `Dockerfile`
**Commit:** `e15f0cd`
**Applied fix:** Added `--chown=node:node` to every `COPY` into the runtime stage and a `USER node` directive before `ENTRYPOINT`, exactly as suggested (`node:24-alpine` ships a built-in `node` user — no need to create one). Verified end-to-end with a real `docker build` + a live run against `postgres:18-alpine`: `prisma migrate deploy` succeeded, the server started and answered `GET /health` with 200, and `id` inside the running container confirmed `uid=1000(node) gid=1000(node)` — not root.

### WR-05: `dotenv` is declared but never invoked — local `pnpm dev` cannot load `.env`

**Files modified:** `apps/api/src/server.ts`
**Commit:** `e577d53`
**Applied fix:** Added `import "dotenv/config";` as the first line of `server.ts`, before `loadEnv()` runs — this is the "wire it in" option from the finding's two alternatives, chosen because it fixes the actual documented dev workflow (`.env.example`'s "copy to `.env`" instruction) without adding any new dependency (the package was already declared) and without changing production behavior: `.env` is excluded via `.dockerignore` and never present inside the built image, so `dotenv/config` finds nothing to load there and the container continues to get all config from real process env vars.

### WR-06: `.env.example`'s placeholder `BETTER_AUTH_SECRET` passes schema validation as-is

**Files modified:** `apps/api/src/env.ts`, `apps/api/test/env.test.ts`
**Commit:** `a768ee4`
**Applied fix:** Added the `.refine()` denylist check exactly as suggested, rejecting the literal `.env.example` placeholder value even though it satisfies `.min(32)`. Added a regression test in `env.test.ts` asserting `parseEnv()` fails when `BETTER_AUTH_SECRET` is that literal placeholder string. Confirmed the schema-shape drift guard (`env-example-drift.test.ts`) is unaffected — it only introspects `Object.keys(envSchema.shape)`, which the `.refine()` wrapper does not change.

### WR-07: `NODE_ENV` silently defaults to `"development"` — permissive CORS outside the Docker image's baked-in override

**Files modified:** `apps/api/src/plugins/cors.ts`
**Commit:** `4ebc8fc`
**Applied fix:** Flipped `registerCors`'s posture from opt-out (`nodeEnv === "production"` blocks CORS) to opt-in (`CORS_ENABLED_NODE_ENVS.has(nodeEnv)`, allowlisting only `"development"` and `"test"`), matching the finding's own suggested code exactly. **Caveat for the developer:** this closes the gap for any *unrecognized* `NODE_ENV` value (e.g. a typo'd `"staging"`), which now correctly disables CORS instead of enabling it — but it does **not** close the specific "fully unset `NODE_ENV`" scenario the finding also described, because `env.ts`'s Zod schema independently defaults unset `NODE_ENV` to `"development"` (by design, for local-dev ergonomics), and `server.ts` always passes that resolved value explicitly to `buildApp()`. Fully closing that gap would require removing `envSchema`'s `NODE_ENV` default and auditing every caller that currently relies on it (`buildApp()`'s own fallback, local dev, tests) — a larger, riskier refactor than this phase's hard constraints permit ("prefer not gating production CORS solely on an unset var... if a clean minimal fix isn't possible without a larger refactor, SKIP it"). Recorded here rather than silently declared "fully fixed."

## Skipped Issues

### WR-02: `POST /api/canary` is an unauthenticated, unrate-limited public write endpoint

**File:** `apps/api/src/routes/canary.ts:20-25`
**Reason:** Skipped per explicit hard constraint from the fixer's task spec: this finding's operational remedy (`@fastify/rate-limit`, already called out by name in the constraint as one of the two dependency-blocked findings) requires installing a new npm package, which is blocked by the Phase 1 supply-chain approval gate (threat T-01-SC) — the approved Phase 1 dependency set was human-approved, and adding a package now would bypass that gate. This is an intentional RESEARCH Open-Q2 deferral — helmet/rate-limit belong in the later phase that introduces the routes/sessions they protect. Tracked as a Phase 2 follow-up.
**Original issue:** The route is reachable at the app's public origin with no auth check and no rate limiting; every `docker-compose.yml` deployment publishes port 3000 to the host, so a real deployment lets anyone repeatedly `INSERT` rows into `PersistenceCanary` unbounded (storage-exhaustion DoS).

### WR-04: `@fastify/helmet` is not installed or registered

**File:** `apps/api/src/app.ts:47-77` (registration list); `apps/api/package.json`
**Reason:** Skipped per the same explicit hard constraint — `@fastify/helmet` is a new npm package, blocked by the Phase 1 supply-chain approval gate (threat T-01-SC). Intentional RESEARCH Open-Q2 deferral; tracked as a Phase 2 follow-up alongside WR-02.
**Original issue:** `app.ts`'s registration order never includes `@fastify/helmet`, and it is not a dependency at all — the app is already publicly reachable (health, canary, redirect stub, SPA shell) with zero security headers (no CSP, no `X-Frame-Options`, no HSTS).

---

_Fixed: 2026-07-11T09:09:48Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
