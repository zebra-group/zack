import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
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
    env: {
      DATABASE_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    },
  },
});
