import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
    // Vitest's 5s default is too tight for this suite: the first test in each
    // file pays for the Fastify app build plus the first real round-trip to the
    // testcontainers Postgres, and under parallel worker contention that alone
    // exceeded 5s — producing timeout failures that looked like logic errors
    // but passed when the file was run on its own.
    testTimeout: 30_000,
    // Real-Postgres TDD harness (D-09, RESEARCH Pattern 5): one shared
    // testcontainers Postgres started once via globalSetup, connection URI
    // handed to every test file via provide/inject. setupFileEach wraps
    // each individual test in a BEGIN/ROLLBACK for fast per-test isolation.
    // Defaulting to Vitest's single shared globalSetup invocation rather
    // than per-worker container plumbing (RESEARCH Pitfall 5 / Open
    // Question 1) — see test/db.diagnostic.test.ts for the empirical
    // confirmation (A3).
    globalSetup: "./test/globalSetup.ts",
    setupFiles: ["./test/setupFileEach.ts"],
    // `src/db.ts` fails fast if DATABASE_URL is unset (D-06 — see the fix
    // for REVIEW.md WR-01). Test files that import `src/app.ts` (which
    // statically imports `db.ts` for its default Prisma singleton) never
    // actually query through that singleton — routes under test always
    // receive the real testcontainers-backed, transaction-wrapped client
    // via `buildApp({ prisma })` — so a syntactically-valid placeholder
    // (same one used by the Dockerfile's `prisma generate` step and CI)
    // is enough to satisfy the fail-fast check without a real DB
    // connection at import time.
    //
    // Phase 2 (02-04): `src/app.ts` now transitively imports
    // `src/lib/auth.ts` (via `routes/auth.js`) for EVERY test file that
    // calls `buildApp()`, not just auth-specific ones — and `lib/auth.ts` /
    // `lib/mailer.ts` read `BASE_URL` / `BETTER_AUTH_SECRET` / `SMTP_*`
    // directly from `process.env` at module-import time (see those files'
    // header comments — same "don't call loadEnv() here" rationale as
    // `db.ts`). These placeholders satisfy that fail-fast read; no real
    // SMTP/BASE_URL config is required for tests, since
    // `auth.integration.test.ts` mocks `lib/mailer.ts`'s
    // `sendMagicLinkEmail` rather than performing a real SMTP send.
    env: {
      DATABASE_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
      BASE_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "vitest-test-secret-do-not-use-in-production-32-chars-min",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      SMTP_FROM: "test@zack.test",
    },
  },
});
