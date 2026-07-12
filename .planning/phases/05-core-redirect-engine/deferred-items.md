# Deferred Items — Phase 05 (core-redirect-engine)

Items observed during execution but out of scope for the plan that surfaced them (per executor SCOPE BOUNDARY — only auto-fix issues directly caused by the current task's changes).

## 05-04: Full-suite flakiness unrelated to this plan's files

**Observed during:** 05-04 verification (`pnpm exec vitest run` across the full `apps/api` suite, run twice for sanity).

**What:** Two consecutive full-suite runs each showed 2 unrelated test failures, but in *different* files each time:
- Run 1: `test/auth.integration.test.ts` — a timeout + a `sendMagicLinkEmail` call-count mismatch (called twice instead of once).
- Run 2: `test/canary.integration.test.ts` — the real-DB round-trip assertions (`POST`/`GET /api/canary`).

Neither file is in this plan's `files_modified` scope (`redirectEngine.ts`, `botDetection.ts`, `unlockCookie.ts`, `plugins/rateLimit.ts`, `test/redirectEngine.test.ts`). `test/redirectEngine.test.ts` itself passed 24/24 in every isolated run (`vitest run redirectEngine`), and `pnpm -r typecheck` is clean.

**Why it's out of scope:** The failures move between unrelated files across runs, consistent with resource-contention/timing flakiness under full-suite parallel load (shared testcontainers Postgres + many integration suites running concurrently), not a regression introduced by this plan's pure-function additions (which touch no DB, no email, no auth code).

**Action:** Not fixed here — logged per the executor's scope-boundary rule. Revisit if this flakiness recurs consistently or starts blocking CI; worth a follow-up look at `globalSetup.ts`/`setupFileEach.ts`'s connection-pool sizing under full-suite concurrency.
