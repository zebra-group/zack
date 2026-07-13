# Deferred Items — Phase 06 (internal-tracking-analytics)

Issues discovered during execution that are out of scope for the discovering
plan (Scope Boundary rule) and therefore not auto-fixed. Logged here for
later triage.

## 06-01: Stale Phase-1 redirect-stub assertion in server.integration.test.ts

- **Found during:** 06-01 Task 2 verification (`pnpm --filter @kurzly/api test`)
- **File:** `apps/api/test/server.integration.test.ts`
- **Test:** `Fastify app route ordering (health, SPA fallback, 404, redirect stub) > GET /:slug (redirect stub) returns its documented placeholder status, not a real redirect`
- **Symptom:** `GET /some-slug` returns `500` instead of the expected `404` with a `message` matching `/Phase 5/`.
- **Root cause (not investigated further — out of scope for 06-01):** The test still asserts the Phase 1 placeholder-stub contract (`/:slug` → 404 "not implemented until Phase 5"). Phase 5 plan 05-06 (`feat(05-06): implement redirect precedence engine route with no-leak canary`) already replaced the stub with the real redirect precedence engine, so `/:slug` is no longer a stub — the test was not updated to match and now hits the real handler, which appears to 500 under the test's fixture state (no domain/link seeded for `localhost:80`/`some-slug`).
- **Why out of scope here:** 06-01 only touches `apps/api/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/api/src/env.ts`, and `.env.example` — none of which affect redirect routing. Confirmed reproducible in isolation (`pnpm exec vitest run test/server.integration.test.ts`) before and independent of this plan's changes.
- **Suggested owner:** Whichever Phase 6 plan next touches `apps/api/test/server.integration.test.ts` or the redirect route, or a dedicated Phase 5 test-debt fix. Likely just needs the test rewritten to seed a real domain/link fixture (or assert the new precedence-engine behavior) instead of the retired stub contract.
- **Status:** Deferred, not fixed.
