import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
    // NOTE: no globalSetup here yet — the testcontainers Postgres globalSetup
    // (D-09) is wired in plan 01-05, once integration tests exist that need
    // a real database.
  },
});
