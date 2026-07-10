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
  },
});
