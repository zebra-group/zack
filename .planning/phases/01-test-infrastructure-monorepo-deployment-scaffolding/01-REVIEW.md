---
phase: 01-test-infrastructure-monorepo-deployment-scaffolding
reviewed: 2026-07-11T08:47:55Z
depth: standard
files_reviewed: 38
files_reviewed_list:
  - apps/api/entrypoint.sh
  - apps/api/prisma.config.ts
  - apps/api/prisma/migrations/20260710204302_init/migration.sql
  - apps/api/prisma/schema.prisma
  - apps/api/src/app.ts
  - apps/api/src/db.ts
  - apps/api/src/env.ts
  - apps/api/src/plugins/cors.ts
  - apps/api/src/plugins/static.ts
  - apps/api/src/routes/canary.ts
  - apps/api/src/routes/health.ts
  - apps/api/src/routes/redirect.ts
  - apps/api/src/server.ts
  - apps/api/test/canary.integration.test.ts
  - apps/api/test/db.diagnostic.test.ts
  - apps/api/test/env-example-drift.test.ts
  - apps/api/test/env.test.ts
  - apps/api/test/globalSetup.ts
  - apps/api/test/prisma-generate.test.ts
  - apps/api/test/server.integration.test.ts
  - apps/api/test/setupFileEach.ts
  - apps/api/test/tx-isolation.test.ts
  - apps/api/tsup.config.ts
  - apps/api/vitest.config.ts
  - apps/web/src/api.ts
  - apps/web/src/App.vue
  - apps/web/src/main.ts
  - apps/web/src/vite-env.d.ts
  - apps/web/test/App.test.ts
  - apps/web/vite.config.ts
  - apps/web/vitest.config.ts
  - docker-compose.dev.yml
  - docker-compose.yml
  - Dockerfile
  - .github/workflows/ci.yml
  - packages/shared/src/index.ts
  - scripts/smoke-compose.sh
  - scripts/smoke-persistence.sh
findings:
  critical: 0
  warning: 7
  info: 3
  total: 10
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-11T08:47:55Z
**Depth:** standard
**Files Reviewed:** 38
**Status:** issues_found

## Summary

Reviewed the Phase 1 walking-skeleton scaffolding: Fastify app factory + route
ordering, Prisma 7 driver-adapter wiring, fail-fast ENV validation, the
testcontainers/transaction-rollback TDD harness, Docker/Compose deployment,
CI, and the minimal Vue shell. The core scaffolding claims hold up under
inspection: static/parametric route precedence genuinely protects
`/health` and `/api/*` from the SPA catch-all (verified against
`find-my-way`'s documented static-over-parametric priority, not just the
passing tests), the Postgres port is correctly unpublished in
`docker-compose.yml`, `entrypoint.sh` only ever runs the non-destructive
`prisma migrate deploy`, and the `max: 1` pool pinning in
`setupFileEach.ts` is the correct mitigation for the documented
BEGIN/ROLLBACK-different-connection hazard.

No Critical/Blocker-tier defects were found — nothing here causes data
loss, an auth bypass, or a crash in the code as shipped. However, several
Warning-tier gaps either contradict the project's own stated design
principles (fail-fast ENV validation, security-header hardening called out
in the stack doc) or create real operational risk if carried unaddressed
into later phases (unauthenticated public write endpoint, root container,
a placeholder secret that silently passes validation). These are
listed below.

## Warnings

### WR-01: `db.ts`'s production Prisma singleton silently falls back to an empty connection string, and is never exercised by any test

**File:** `apps/api/src/db.ts:24`
**Issue:** `new PrismaPg(process.env.DATABASE_URL ?? "")` reads `process.env.DATABASE_URL`
directly (not the validated `Env` object from `env.ts`) and silently substitutes `""`
if the variable is absent. This directly contradicts the project's own D-06
fail-fast philosophy — every other consumer of `DATABASE_URL` (`prisma.config.ts`,
`env.ts`'s `z.url()`) either validates it or fails loudly; this one path quietly
degrades instead. In practice this is currently masked because `server.ts` calls
`loadEnv()` (which exits the process on a missing `DATABASE_URL`) before
dynamically importing `app.js`/`db.js`, so the production path is safe — but no
test imports `db.ts` directly (confirmed via `grep -rn "from \"../src/db" apps/api/test`
— zero matches), so this fallback's behavior is entirely unverified, and every
test file that imports `app.ts` (e.g. `server.integration.test.ts`) unconditionally
constructs a second, real `PrismaPg` pool pointed at `""` purely as import-time
side effect, alongside the correctly-wired testcontainers pool.
**Fix:**
```ts
// db.ts — fail loudly instead of silently degrading, consistent with D-06
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set — db.ts must only be imported after env validation.");
}
const adapter = new PrismaPg(databaseUrl);
```
Also add a direct unit test for `db.ts`'s exported `prisma` singleton (constructed
against a valid placeholder URL, mirroring `prisma-generate.test.ts`'s pattern) so
this code path isn't the only one in the codebase with zero test coverage.

### WR-02: `POST /api/canary` is an unauthenticated, unrate-limited public write endpoint

**File:** `apps/api/src/routes/canary.ts:20-25`
**Issue:** The route is reachable at the app's public origin with no auth check
and no rate limiting (`@fastify/rate-limit` is not even installed —
confirmed absent from `apps/api/package.json`). Every `docker-compose.yml`
deployment publishes port 3000 to the host, so in a real (even accidental)
deployment this endpoint lets anyone repeatedly `INSERT` rows into
`PersistenceCanary` with no bound, growing the table indefinitely
(storage-exhaustion DoS). The header comment documents this as a
walking-skeleton/temporary endpoint, but nothing in code prevents it from
shipping to a real environment as-is.
**Fix:** Either gate this route behind `NODE_ENV !== 'production'` until it is
removed in a later phase, or add `@fastify/rate-limit` now (the stack doc
already calls for it) so at minimum the write path can't be hammered
unboundedly:
```ts
app.post("/canary", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async () => { ... });
```

### WR-03: Runtime container runs as root — no `USER` directive in the Dockerfile

**File:** `Dockerfile:55-71`
**Issue:** The `runtime` stage never switches away from the default root user
before `ENTRYPOINT`. `entrypoint.sh` runs `prisma migrate deploy` and
`node dist/server.js` as root inside the container. This is a standard
container-hardening gap: a Node process handling untrusted HTTP input
(even the current stub) should run as a non-root user so a future RCE-class
bug in a dependency has a materially smaller blast radius.
**Fix:**
```dockerfile
FROM base AS runtime
...
COPY --from=build --chown=node:node /prod/api /prod/api
COPY --chown=node:node apps/api/entrypoint.sh /prod/api/entrypoint.sh
RUN chmod +x /prod/api/entrypoint.sh
USER node
ENTRYPOINT ["/prod/api/entrypoint.sh"]
```
(`node:24-alpine` ships a built-in `node` user/group — no need to create one.)

### WR-04: `@fastify/helmet` is not installed or registered, despite the project's own stack doc calling it "mandatory baseline hardening for a public-facing redirect service"

**File:** `apps/api/src/app.ts:47-77` (registration list); `apps/api/package.json`
**Issue:** `app.ts`'s registration order comment enumerates CORS, API routes,
health, redirect stub, and static — `@fastify/helmet` never appears, and it
is not a dependency at all (`grep -n helmet apps/api/package.json` → no
match). The app is already publicly reachable (health, canary, redirect
stub, and the SPA shell all resolve today) with zero security headers
(no CSP, no `X-Frame-Options`, no HSTS).
**Fix:** Add `@fastify/helmet` and register it early in `buildApp()`, even
with conservative defaults now — tightening CSP later (Phase 5's OG-tag
rendering) is easier than retrofitting header hygiene after routes exist:
```ts
import helmet from "@fastify/helmet";
await app.register(helmet);
```

### WR-05: `dotenv` is a declared dependency but is never invoked — local `pnpm dev` cannot actually load `.env`

**File:** `apps/api/package.json:19`; `apps/api/src/server.ts` (no `dotenv/config` import anywhere in `apps/api/src`)
**Issue:** `.env.example`'s own header comment instructs "Copy this file to
`.env` and fill in real values," and `docker-compose.yml`'s `env_file: .env`
makes that true for the containerized path — but `dotenv` (declared in
`dependencies`) is never imported anywhere (`grep -rn dotenv apps/api/src`
→ zero matches). Running `pnpm --filter @kurzly/api dev` (`tsx watch
src/server.ts`) will not pick up `.env` at all; `loadEnv()` will fail fast
and `process.exit(1)` unless every required variable has already been
manually exported into the shell. This breaks the documented local dev
workflow implied by `.env.example`.
**Fix:** Either wire it in (`import "dotenv/config";` as the first line of
`server.ts`, before `loadEnv()` runs) or drop the unused dependency and
document that local dev requires `--env-file=.env` / manual exports.

### WR-06: `.env.example`'s placeholder `BETTER_AUTH_SECRET` passes schema validation as-is

**File:** `.env.example` (`BETTER_AUTH_SECRET=changeme-generate-a-real-32-plus-char-secret`); `apps/api/src/env.ts:34`
**Issue:** `envSchema` only checks `.min(32)` on `BETTER_AUTH_SECRET`. The
documented placeholder string is itself ≥32 characters, so an operator who
copies `.env.example` → `.env` without editing this specific line gets a
fully "valid" (per the fail-fast validator) but publicly-known,
non-random signing secret for session/token signing once better-auth wires
up in Phase 2. The fail-fast validator gives a false sense of security here
— it validates shape/length, not that the value was actually generated.
**Fix:** Add a denylist check in `envSchema` (or a `loadEnv()`-level check)
rejecting the literal example value:
```ts
BETTER_AUTH_SECRET: z.string().min(32).refine(
  (v) => v !== "changeme-generate-a-real-32-plus-char-secret",
  { message: "BETTER_AUTH_SECRET is still the .env.example placeholder — generate a real secret." },
),
```

### WR-07: `NODE_ENV` silently defaults to `"development"` when unset — CORS becomes permissive outside the Docker image's baked-in override

**File:** `apps/api/src/app.ts:48`; `apps/api/src/env.ts:24`; `apps/api/src/plugins/cors.ts:14-17`
**Issue:** Both `envSchema` (`.default("development")`) and `buildApp()`'s
own fallback (`options.nodeEnv ?? process.env.NODE_ENV ?? "development"`)
treat "unset" as "development." `registerCors` then registers
`@fastify/cors` with `origin: true` (reflects any origin) whenever
`nodeEnv !== "production"`. Today this is masked because the Dockerfile
bakes `ENV NODE_ENV=production` into the image, but that is the *only*
thing preventing an accidental permissive-CORS production boot — anyone
running the built `dist/server.js` directly (bare-metal, PM2, a different
container base, systemd unit) without explicitly setting `NODE_ENV` gets
silently-permissive CORS with no warning.
**Fix:** Flip the default posture — treat CORS as opt-in for known
non-production values rather than opt-out for `"production"`:
```ts
export async function registerCors(app: FastifyInstance, nodeEnv: string): Promise<void> {
  if (nodeEnv !== "development" && nodeEnv !== "test") return;
  await app.register(cors, { origin: true });
}
```

## Info

### IN-01: Stale one-time diagnostic `console.log` calls left in committed test files

**File:** `apps/api/test/db.diagnostic.test.ts:34-43`, `apps/api/test/tx-isolation.test.ts:28`
**Issue:** Both `console.log("[A3 diagnostic] ...")` calls exist to
empirically confirm the single-shared-testcontainer assumption (A3) one
time during Phase 1 execution. Their own comments say "resolves A3" /
"resolves A4" — the diagnostic value is one-shot, but the log lines are
committed permanently and will print on every future CI run indefinitely.
**Fix:** Now that A3/A4 are resolved (per the comments), either delete the
log lines or gate them behind a `DEBUG_HARNESS` env var so they don't add
permanent noise to every CI test run going forward.

### IN-02: `GET /api/canary`'s response shape is hand-duplicated on the frontend instead of shared via `@kurzly/shared`

**File:** `apps/web/src/api.ts:17-20` vs `apps/api/src/routes/canary.ts:27-33`
**Issue:** `packages/shared/src/index.ts` already exports `CanaryResult`
(`{ token, total }`) for the POST response, but the GET response shape
(`{ total, latest }`) is re-declared independently in `apps/web/src/api.ts`
as `CanaryStatus`, with only a code comment (not a type import) linking it
back to the route's actual return type. If the API route's shape drifts,
`apps/web` gets no compile-time signal.
**Fix:** Add a `CanaryStatus` type to `packages/shared` alongside
`CanaryResult` and have both `apps/api/src/routes/canary.ts`'s GET handler
and `apps/web/src/api.ts` import it, closing the loop the same way
`CanaryResult` already does for POST.

### IN-03: Dev CORS registers `origin: true` with `credentials` left unspecified — flag before Phase 2 wires session cookies

**File:** `apps/api/src/plugins/cors.ts:16`
**Issue:** Not a bug today (no auth cookies exist yet in Phase 1), but
worth flagging now since Phase 2 adds better-auth's cookie-based sessions:
`origin: true` reflects any request origin, and if a future change adds
`credentials: true` to this same config without also constraining `origin`
to an explicit allowlist, the combination becomes a session-hijack-by-any-origin
vector in dev. Leaving this note here so Phase 2's auth wiring revisits this
config deliberately rather than inheriting it unexamined.
**Fix:** When Phase 2 adds cookie-based sessions, ensure this file's
`origin` option is constrained to a concrete, ENV-configured dev origin
rather than `true` if `credentials: true` is ever added alongside it.

---

_Reviewed: 2026-07-11T08:47:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
