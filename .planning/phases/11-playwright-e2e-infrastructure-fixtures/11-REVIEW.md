---
phase: 11-playwright-e2e-infrastructure-fixtures
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - .github/workflows/ci.yml
  - apps/api/package.json
  - apps/api/src/plugins/rateLimit.ts
  - apps/api/test/rate-limit-bypass.test.ts
  - apps/e2e/global-setup.ts
  - apps/e2e/global-teardown.ts
  - apps/e2e/package.json
  - apps/e2e/playwright.config.ts
  - apps/e2e/src/db.ts
  - apps/e2e/src/mailpit.ts
  - apps/e2e/tests/auth.setup.ts
  - apps/e2e/tests/authed/storage-state.spec.ts
  - apps/e2e/tests/smoke/boot.spec.ts
  - apps/e2e/tests/smoke/db-isolation.spec.ts
  - apps/e2e/tests/smoke/mailpit-wiring.spec.ts
  - apps/e2e/tests/smoke/prisma-import.spike.spec.ts
  - apps/e2e/tests/smoke/rate-limit-bypass.spec.ts
  - apps/e2e/tsconfig.json
  - scripts/e2e-compose.sh
findings:
  critical: 4
  warning: 3
  info: 1
  total: 8
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-24
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the Playwright E2E infrastructure/fixtures phase: CI wiring, the `E2E_RATE_LIMIT_BYPASS_SECRET` mechanism, the DB truncate/reseed isolation helper, Mailpit retrieval, `auth.setup.ts`, and the associated smoke specs. The scoped-audit items requested (bypass secret absent from `envSchema`, compose overlay secret handling, Prisma-client subpath leakage) check out structurally — but tracing the actual runtime/CI behavior surfaced four Critical-tier defects that are load-bearing for this phase's stated guarantees:

1. `.github/workflows/ci.yml`'s primary `test` job (`pnpm run -r test`) will recurse into `@kurzly/e2e`'s own `"test": "playwright test"` script with no browsers installed and no server running — this is a structurally broken CI step, not a hypothetical.
2. The `E2E_RATE_LIMIT_BYPASS_SECRET` mechanism, while correctly absent from `envSchema`/`.env.example`, has **no runtime `NODE_ENV`/production gate** — it is read unconditionally from `process.env` in `rateLimit.ts`. "Structurally impossible to enable in production" is not actually true; it is only "not offered as a documented config knob."
3. `resetDb()`'s `pg_advisory_lock`/`pg_advisory_unlock` pair is issued as three independent `$executeRawUnsafe` calls with no transaction/connection pinning, so Prisma's connection pool is not guaranteed to route them to the same Postgres backend session — the lock can silently provide zero mutual exclusion.
4. Independent of (3), `db-isolation.spec.ts` runs 6 fully-parallel tests that each call the shared-table-truncating `resetDb()` mid-test, then create+read their own rows — the lock's critical section only covers the truncate itself, not the calling test's create/read, so a sibling test's later truncate can wipe a test's rows before it reads them back.

None of these were caught by "does it compile" style validation; they require tracing the actual execution model (pnpm recursive scripts, Fastify env wiring, Postgres connection pooling, Playwright's `fullyParallel` scheduling).

## Critical Issues

### CR-01: CI `test` job recurses into `@kurzly/e2e`'s Playwright suite with no browsers/server

**File:** `.github/workflows/ci.yml:62-63`, `apps/e2e/package.json:6-9`

**Issue:** The root `test` job's `Test` step runs `pnpm run -r test`, which recursively invokes the `"test"` script in every workspace package that defines one. `apps/e2e/package.json` defines `"test": "playwright test"` (present since the very first scaffolding commit, `59f6cbd`, and never adjusted when the dedicated `e2e` CI job was wired up in `f4ee392`). At the point the `test` job runs:
- No Chromium/browser binaries are installed (`playwright install --with-deps chromium` only happens later, inside the separate `e2e` job).
- No app is running at `http://localhost:3000` (the Docker image isn't even built yet in this job).
- None of `E2E_DATABASE_URL` / `MAILPIT_URL` / `PLAYWRIGHT_BASE_URL` are set.

`playwright test` under these conditions fails immediately (missing browser executable), which fails the whole recursive `pnpm run -r test` invocation (pnpm's recursive run bails on the first failing package by default) — i.e. the `test` job as written cannot pass. This also silently duplicates/races the dedicated `e2e` job's real run of the same suite.

**Fix:** Give `apps/e2e` a script name that isn't picked up by the generic recursive `test` script, and have the dedicated `e2e` job (already using `pnpm --filter @kurzly/e2e exec ...` / `scripts/e2e-compose.sh`'s `pnpm --filter @kurzly/e2e test`) keep targeting it explicitly:

```jsonc
// apps/e2e/package.json
"scripts": {
  "test:e2e": "playwright test",   // renamed away from the recursive "test" script
  "typecheck": "tsc --noEmit"
}
```

```bash
# scripts/e2e-compose.sh
pnpm --filter @kurzly/e2e test:e2e "$@"
```

Alternatively, keep the script name but exclude the package from the root recursive test step:
```yaml
- name: Test
  run: pnpm run -r --filter='!@kurzly/e2e' test
```

### CR-02: `E2E_RATE_LIMIT_BYPASS_SECRET` has no production/`NODE_ENV` gate — reads raw `process.env` unconditionally

**File:** `apps/api/src/plugins/rateLimit.ts:172-184`

**Issue:** `registerRateLimit` reads `process.env.E2E_RATE_LIMIT_BYPASS_SECRET` directly and, if truthy, installs an `allowList` that disables rate limiting for any request carrying the matching `x-e2e-bypass` header — with **no check on `NODE_ENV`/`nodeEnv`**. The header comment claims this is "structurally impossible to set via `.env`/`.env.example`/production config," which is only true for the *documented* configuration surface:

- `envSchema` (`apps/api/src/env.ts`) is a plain `z.object(...)` with no `.strict()`, so any unrecognized key — including `E2E_RATE_LIMIT_BYPASS_SECRET` — silently passes `envSchema.safeParse()` without error. Boot never rejects it.
- `registerRateLimit(app)` is called unconditionally from `buildApp()` (`apps/api/src/app.ts:154`) without the already-computed `nodeEnv` being threaded through (contrast `registerCors(app, nodeEnv)` on the line above, which *does* receive it).

If an operator (or a misconfigured hosting platform / copy-pasted `docker-compose.e2e.yml` snippet / leaked CI env var) ever sets this variable in a production environment, magic-link rate limiting is completely and silently disabled for anyone who also learns the header value — with zero server-side signal that this happened. This is exactly the class of defect the phase's own threat model (T-11-01) is supposed to close, and the mitigation as implemented does not actually close it — it only prevents the *documented*, `.env.example`-driven path.

**Fix:** Gate on `nodeEnv` explicitly, and thread it through like the other plugins:

```ts
// apps/api/src/plugins/rateLimit.ts
export async function registerRateLimit(app: FastifyInstance, nodeEnv: string): Promise<void> {
  const bypassSecret =
    nodeEnv === "production" ? undefined : process.env.E2E_RATE_LIMIT_BYPASS_SECRET;

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "15 minutes",
    allowList: bypassSecret
      ? (request) => request.headers["x-e2e-bypass"] === bypassSecret
      : undefined,
  });
}
```

```ts
// apps/api/src/app.ts
await registerRateLimit(app, nodeEnv);
```

Consider also adding a boot-time fail-loud check (mirroring the `BETTER_AUTH_SECRET` placeholder guard) that refuses to start if `NODE_ENV=production` and `E2E_RATE_LIMIT_BYPASS_SECRET` is set at all, so the misconfiguration is caught at boot rather than silently ignored.

### CR-03: `resetDb()`'s session-scoped advisory lock is not pinned to a single pooled connection

**File:** `apps/e2e/src/db.ts:134-144`

**Issue:** `resetDb()` issues three separate, unrelated `$executeRawUnsafe` calls:
```ts
await prisma.$executeRawUnsafe(`SELECT pg_advisory_lock(${RESET_DB_ADVISORY_LOCK_KEY})`);
try {
  await prisma.$executeRawUnsafe('TRUNCATE ... RESTART IDENTITY CASCADE');
  await reseedBaselineDomainMembership(prisma);
} finally {
  await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${RESET_DB_ADVISORY_LOCK_KEY})`);
}
```
`pg_advisory_lock`/`pg_advisory_unlock` are **session-scoped**: the lock is held by whichever specific Postgres backend connection issued the `pg_advisory_lock()` call, and must be released by that same connection. `@prisma/adapter-pg` wraps a `pg` connection pool; outside of an explicit `$transaction`, Prisma is free to route each of these three independent statements to any available pooled connection. There is no guarantee (and, under real concurrent load from 6 parallel Playwright tests, no realistic likelihood over time) that all three statements above land on the same physical connection. If the `TRUNCATE` lands on a different connection than the `pg_advisory_lock()` call, it runs completely unguarded by the lock; if `pg_advisory_unlock()` lands on yet another connection, it silently no-ops (returns `false`, no error) while the original lock-holding connection keeps the lock until that connection is closed or the session ends — at which point a *different* caller's advisory lock acquisition can succeed while a truncate from the original caller may still be in flight.

This directly undermines the phase's own stated invariant ("two parallel worker spec files can never interleave their truncate/reseed against each other" — `db.ts:127-132`) and is the root cause enabling CR-04 below.

**Fix:** Use the transaction-scoped variant inside a single `$transaction`, which guarantees one connection for the whole critical section and auto-releases the lock at commit/rollback:

```ts
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${RESET_DB_ADVISORY_LOCK_KEY})`);
    await tx.$executeRawUnsafe(
      'TRUNCATE "QrRemapHistory", "QrCode", "ClickEvent", "Link", "DomainMembership" RESTART IDENTITY CASCADE',
    );
    await reseedBaselineDomainMembership(tx);
  });
}
```
(`reseedBaselineDomainMembership` needs to accept the transaction client type, not just `PrismaClient`.)

### CR-04: `db-isolation.spec.ts`'s 6 parallel tests race each other via shared-table truncation

**File:** `apps/e2e/tests/smoke/db-isolation.spec.ts:25-66`, `apps/e2e/src/db.ts:134-144`

**Issue:** Even assuming CR-03 is fixed and the lock genuinely provides mutual exclusion, its critical section (per `resetDb()`) only wraps the `TRUNCATE` + baseline reseed — **not** the calling test's subsequent `link.create` / `qrCode.create` / `findUniqueOrThrow` calls. `db-isolation.spec.ts` spins up 6 tests via a plain `for` loop (deliberately not `describe.serial`, per its own header comment, specifically to force genuine concurrency under `fullyParallel: true`). Each test independently does:

```
resetDb(prisma)          // lock, TRUNCATE Link/QrCode/..., reseed membership, unlock
  -> create Link
  -> create QrCode
  -> read back Link/QrCode
```

Because the lock is released as soon as `resetDb()` returns, nothing prevents a *different* concurrently-running test's `resetDb()` call from starting (and completing its `TRUNCATE`) **after** an earlier test has already released its own lock but **before** that earlier test has finished creating/reading its own rows. The later test's `TRUNCATE` will wipe the earlier test's freshly-created `Link`/`QrCode` rows out from under it, causing an intermittent `findUniqueOrThrow` "record not found" failure — the opposite of what this file exists to prove ("proving the advisory-locked truncate sequence in `resetDb()` never corrupts a concurrently in-flight test's writes" — line 20-21 of the file's own header). This is a genuine source of CI flakiness, not merely a hypothetical: with 6 tests racing under `fullyParallel: true` and no coordination beyond the narrow truncate-only lock, the failure window is real and will manifest non-deterministically depending on scheduling.

**Fix:** Either (a) widen the critical section so the *entire* per-test reset+create+read cycle runs under a single held lock/transaction (e.g. expose a `withResetDbLock(prisma, callback)` helper that keeps the advisory lock held for the callback's duration), or (b) redesign the smoke test so concurrent tests don't share a `TRUNCATE`-based reset at all (e.g. call `resetDb()` once at file scope via a serialized `test.beforeAll`, then have the 6 tests only create+read distinct, non-colliding rows without each independently truncating shared tables mid-run).

## Warnings

### WR-01: `release` job does not depend on the `e2e` job

**File:** `.github/workflows/ci.yml:164-167`

**Issue:** `release` declares `needs: [test, smoke]` but not `e2e`. Since `e2e` and `release` both only depend on `[test, smoke]`, they run in parallel — a failing (or the currently-broken, see CR-01/CR-04) Playwright E2E suite does not block `release` from cutting a version and publishing the versioned image to GHCR. Given this project's stated Core Value is precisely what the E2E suite is meant to validate (the redirect handler behaving correctly *as deployed*), this is a meaningful release-safety gap.

**Fix:**
```yaml
release:
  needs: [test, smoke, e2e]
```

### WR-02: No ordering between the `setup` and `smoke` Playwright projects sharing the same seeded email addresses

**File:** `apps/e2e/playwright.config.ts:31-55`, `apps/e2e/tests/auth.setup.ts`, `apps/e2e/tests/smoke/mailpit-wiring.spec.ts`

**Issue:** `chromium-admin`/`chromium-member` declare `dependencies: ["setup"]`, but the `smoke` project declares no dependency relationship to `setup` at all. Playwright is therefore free to run `smoke` and `setup` concurrently. `mailpit-wiring.spec.ts` (in `smoke`) and `auth.setup.ts` (in `setup`) both request magic-link emails to the exact same `ADMIN_EMAIL`/`MEMBER_EMAIL` constants (`src/db.ts`) and both resolve them via `findMagicLinkUrl`, which only hard-asserts the recipient address, not which specific request triggered the message. If both projects fire a magic-link request for the same address around the same time, either side's `findMagicLinkUrl` call can non-deterministically consume the *other* project's message instead of its own, undermining the "provably resolves what I asked for" guarantee both files' comments claim, and creating flaky-test risk.

**Fix:** Either give `smoke`'s `mailpit-wiring.spec.ts` its own dedicated probe email addresses distinct from `ADMIN_EMAIL`/`MEMBER_EMAIL` (mirroring the pattern already used in `rate-limit-bypass.spec.ts`'s `PROBE_EMAIL`), or add an explicit `dependencies` ordering between the two projects.

### WR-03: `envSchema` silently accepts unknown/mistyped environment variables

**File:** `apps/api/src/env.ts:37-116`

**Issue:** `envSchema` is a plain `z.object({...})` with no `.strict()`. Any environment variable not declared in the schema — a typo'd key, or `E2E_RATE_LIMIT_BYPASS_SECRET` itself — passes `envSchema.safeParse()` silently with no warning, contradicting this file's own stated design goal ("a missing `DATABASE_URL` or a weak `BETTER_AUTH_SECRET` ... must fail loudly at boot" — file header). This compounds CR-02: there is no boot-time signal at all if a production deployment happens to carry the bypass variable (or any other unexpected secret-shaped variable) in its environment.

**Fix:** Consider `.strict()` (with an explicit passthrough allowlist for genuinely optional infra vars like `PATH`/`HOME` if needed via `.catchall()` tuning), or at minimum add a targeted `superRefine` that fails loudly if `NODE_ENV === "production"` and `E2E_RATE_LIMIT_BYPASS_SECRET` is present in `source`.

## Info

### IN-01: `apps/e2e/tsconfig.json`'s `include: ["."]` is unusually broad

**File:** `apps/e2e/tsconfig.json:6`

**Issue:** `"include": ["."]` includes the entire package root rather than a scoped glob (e.g. `["**/*.ts"]` or `["src", "tests", "*.ts"]`). TypeScript's default extension filtering means non-`.ts` files (generated `playwright-report/`, `test-results/`, `playwright/.auth/*.json`) aren't actually type-checked, so this isn't a functional bug today, but it's a looser convention than the rest of the workspace and could silently pull in stray `.ts` files dropped anywhere in the package root as the suite grows.

**Fix:** Scope explicitly, e.g. `"include": ["*.ts", "tests/**/*.ts", "src/**/*.ts"]`.

---

_Reviewed: 2026-07-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
