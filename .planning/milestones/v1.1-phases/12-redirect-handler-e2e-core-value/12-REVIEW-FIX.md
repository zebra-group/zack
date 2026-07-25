---
phase: 12-redirect-handler-e2e-core-value
fixed_at: 2026-07-24T21:58:02Z
review_path: .planning/phases/12-redirect-handler-e2e-core-value/12-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-07-24T21:58:02Z
**Source review:** .planning/phases/12-redirect-handler-e2e-core-value/12-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (Warning only — no Critical/Blocker findings this round; Info findings excluded per `fix_scope: critical_warning`)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### WR-01: `fetchWithFixtureRaceRetry` applied inconsistently

**Files modified:** `apps/e2e/src/links.ts`, `apps/e2e/tests/smoke/redirect-password-gate.spec.ts`, `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts`
**Commit:** `2ec16df`
**Applied fix:** Generalized `fetchWithFixtureRaceRetry` from a Playwright-`APIResponse`-specific signature to a generic `<T>` one, since `redirect-password-gate.spec.ts` needed it to also wrap `page.goto` navigations (`playwright.Response | null`), not only `page.request`/`request` calls. Then:
- `redirect-password-gate.spec.ts`: both tests now wrap their entire create-fixture-then-HTTP sequence in the retry helper. The first test wraps fixture-create + `page.goto`. The second (4-step: initial GET, wrong verify, correct verify, cookie-carried GET) wraps the WHOLE flow — not just the first step — since the truncate race can strike at any point across the sequence; intermediate bodies/responses are captured via closure variables re-assigned on each attempt so all of the original per-step assertions are preserved and always evaluate the attempt that actually matched (or, on exhaustion, the last attempt made).
- `redirect-bot-og-render.spec.ts`'s first test: the previously-unwrapped second (`browserResponse`) request now creates its OWN fresh fixture inside a second `fetchWithFixtureRaceRetry` call (rather than reusing the first request's now-multiple-requests-old slug), so it is independently protected against the same race.

### WR-02: `fetchWithFixtureRaceRetry` had no dedicated unit test

**Files modified:** `apps/e2e/tests/smoke/links-fixture.spec.ts`
**Commit:** `0ec3bb9`
**Applied fix:** Added a `test.describe("fetchWithFixtureRaceRetry")` block (matching this file's existing per-helper convention) asserting the three contract points the review called out: (1) returns immediately on a first-try match without a second `attempt()` call, (2) retries up to `maxAttempts` times on persistent mismatch and returns the last response rather than throwing, (3) `maxAttempts` defaults to 3 when omitted.

### WR-03: Retry predicate/discard behavior gave no diagnostic signal and never inspected discarded attempts

**Files modified:** `apps/e2e/src/links.ts`, `apps/e2e/tests/smoke/links-fixture.spec.ts`, `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts`
**Commit:** `a4e09c0`
**Applied fix:** Added a `console.warn` on every discarded attempt (attempt number, best-effort extracted status, and whether a retry will follow or retries are exhausted) so CI output can distinguish "the documented db-isolation truncate race fired" from a genuinely flaky/regressed response. Added an optional `onDiscardedAttempt(response, attemptNumber)` callback parameter, invoked for every non-matching attempt (including the final exhausted one). Wired this into all three `fetchWithFixtureRaceRetry` calls in `redirect-bot-og-render.spec.ts`'s no-leak tests (bot-normal, bot-protected, bot-expired), each now running `assertNoLeak` against every discarded intermediate attempt's body/headers too, not only the one that finally matched — so a genuinely leaking intermediate response can no longer hide behind a later, clean retry. Added two more unit tests in `links-fixture.spec.ts` proving `onDiscardedAttempt` fires for every mismatched attempt (including on exhaustion) and never for the matching one. Did not implement the deeper "narrow the retry condition by symptom" alternative the review floated — the review's own wording ("at minimum... and consider...") frames logging + discard-inspection as the baseline fix, with symptom-narrowing as optional further hardening; narrowing further would require Fastify-level distinction between "row genuinely missing due to truncation" vs. "genuine 404/500 regression" that isn't safely inferable from the HTTP response alone without new signal from the app.

### WR-04: No regression test proved `addContentTypeParser` stays scoped to `POST /:slug/verify`

**Files modified:** `apps/api/test/redirect.integration.test.ts`
**Commit:** `8109765`
**Applied fix:** Added an integration test asserting `POST /api/links` (a sibling, JSON-only route registered after `redirectRoute` in `app.ts`) still returns `415 Unsupported Media Type` for an unauthenticated `application/x-www-form-urlencoded` request. Body parsing happens before the route handler's own auth check runs, so a `415` here can only originate from Fastify's own "no parser registered for this content type on this route" rejection — never from the handler (which would 401). If a future refactor wrapped `redirectRoute` in `fastify-plugin` (or hoisted the parser to `app.ts`), this test would start failing because the body would parse successfully and the handler would return 401 instead of 415.

## Verification

- `pnpm --filter @kurzly/api exec tsc --noEmit` — clean (no errors in modified files; two workspace-generated-artifact directories, `apps/api/src/generated/prisma` and `packages/shared/dist`, had to be copied into this run's isolated git worktree from the main working tree to reproduce the main repo's pre-existing build state — both are gitignored build outputs unrelated to this fix, not new dependencies).
- `pnpm --filter @kurzly/api exec vitest run test/redirect.integration.test.ts` — 33/33 passed (32 pre-existing + the new WR-04 regression test), including a real run of the WR-04 test against a live testcontainers Postgres instance.
- `pnpm --filter @kurzly/e2e exec tsc --noEmit` — clean (no errors in any modified file). The same worktree-artifact caveat applies (`@types/node` resolution and `@kurzly/api/prisma-client` required the same locally-copied generated-artifact workaround to type-check at all in the isolated worktree — this is an environment quirk of running tsc from `/tmp`, not a code issue).

**Not re-verified live:** The Playwright `smoke` project (which exercises the actual fixed specs — `redirect-password-gate.spec.ts`, `redirect-bot-og-render.spec.ts`, `links-fixture.spec.ts`'s new unit tests) requires the full docker-compose stack (real Postgres on `:5433`, the built app image, Mailpit) and is documented in prior 12-0x SUMMARYs as expensive/port-conflict-prone on this dev machine. Per this fix pass's explicit scope, only static/typecheck verification was performed for the E2E-side changes — flagged for live re-verification.

## Post-fix live re-verification (orchestrator, 2026-07-24T22:15Z)

Rebuilt the image and ran the full `apps/e2e` suite live against the built compose stack (alternate project `kurzly-e2e-verify`, remapped `db`/`mailpit` ports only, same non-invasive workaround used throughout this milestone). Result: **34/36 passed**. `redirect-slug-redirect.spec.ts`, `redirect-expiry.spec.ts`, `redirect-bot-og-render.spec.ts`, `redirect-utm-merge.spec.ts` (WR-01's changes to the bot-og-render spec included) — all green, both at `--workers=1` and `--workers=4`, zero P2002.

**2 failures, both in `redirect-password-gate.spec.ts`, both a genuine local-environment artifact — NOT a code regression:**

Root-caused via direct investigation (not assumed): `lsof -iTCP:3000` revealed a **second, unrelated process** — a `tsx watch src/server.ts` dev server from a **completely different project** (`/Users/jonas.koenig/Documents/Projects/INTERN/product-catalog/apps/api`, running continuously since 2026-07-07, over two weeks before this session) — bound to host port 3000 alongside Docker's own port-forward for the `app` container. `curl` requests to `localhost:3000`/`127.0.0.1:3000` correctly reached the Kurzly container every time (confirmed repeatedly), but Chromium's `--host-resolver-rules=MAP e2e.kurzly.local 127.0.0.1` flag in this one spec file's `test.use()` block causes its navigation to be captured by the OTHER project's rogue process instead (a macOS/Docker-Desktop port-forwarding interaction specific to that flag, not reproducible via curl or any other spec in this suite — no other file sets this flag).

**Proof this is not a WR-01 regression:** re-ran the ORIGINAL, pre-fix version of `redirect-password-gate.spec.ts` (`git show 4d5877b:...`) against the identical running environment — it failed identically, with the exact same "Route GET:/... not found" response from the rogue process. The WR-01 diff is not the cause.

Per this project's established policy (never touch another project's running process without explicit instruction — the same discipline already applied throughout this milestone to `zbr-brain-postgres-1`/`ddev-router`), the rogue `product-catalog` dev server was left untouched. The test file's own author had already anticipated exactly this class of port conflict (`E2E_APP_PORT` env var, documented in the file's own header comment) — attempting to use it surfaced a second-order issue (the container's baked-in `BASE_URL=http://localhost:3000` breaks the `setup` project's magic-link navigation when the app's host port is remapped), which is outside this fix pass's scope to resolve.

**Conclusion:** `redirect-password-gate.spec.ts` remains statically verified (typecheck clean) and was live-verified successfully in its original 12-05 execution session (documented in `12-05-SUMMARY.md`, 35/36 passing) before this rogue process became a factor for a `--host-resolver-rules`-based test. Recommend: kill the stray `product-catalog` dev server (not this session's to kill) or run on a clean machine/CI for final live confirmation of this one file. Not a phase-blocking issue.

---

_Fixed: 2026-07-24T21:58:02Z_
_Fixer: Claude (gsd-code-fixer); live re-verification: orchestrator (autonomous mode)_
_Iteration: 1_
