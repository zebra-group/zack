---
phase: 12-redirect-handler-e2e-core-value
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/api/src/routes/redirect.ts
  - apps/api/test/redirect.integration.test.ts
  - apps/e2e/package.json
  - apps/e2e/src/links.ts
  - apps/e2e/tests/smoke/host-header.spike.spec.ts
  - apps/e2e/tests/smoke/links-fixture.spec.ts
  - apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts
  - apps/e2e/tests/smoke/redirect-expiry.spec.ts
  - apps/e2e/tests/smoke/redirect-password-gate.spec.ts
  - apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts
  - apps/e2e/tests/smoke/redirect-utm-merge.spec.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-07-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the redirect-precedence-engine production change (the new plugin-scoped
`addContentTypeParser` for `application/x-www-form-urlencoded` on `POST
/:slug/verify`) plus the full Phase 12 E2E suite (host-header spike, fixture
helper, and five feature specs) that exercises `apps/api/src/routes/redirect.ts`
against the built compose image.

`git log` confirms the *only* production change to `redirect.ts` this phase is
the 24-line `addContentTypeParser` addition (commit `f2a39e3`); everything else
in that file predates Phase 12. That change is sound: it is registered inside
`registerRedirectRoute` (a plain `app.register(...)` call with no
`fastify-plugin` wrapper), so Fastify's default encapsulation genuinely scopes
it to this plugin's own routes — confirmed against `app.ts`'s registration
call. `Object.fromEntries(new URLSearchParams(body))` builds a flat object via
`CreateDataPropertyOrThrow` (own-property definition, not `[[Set]]`), so a
`__proto__`/`constructor` key in the submitted body cannot pollute
`Object.prototype` — no injection risk. Body size stays bounded by `app.ts`'s
global 2 MiB `bodyLimit` (Fastify enforces this for any `parseAs: "string"`
custom parser, not just the built-in JSON one), so there's no new DoS surface.
The existing JSON-based `fastify.inject({ payload: {...} })` tests are
unaffected, since `payload:` objects still default to `application/json` and
match a different content-type entry than the newly registered one; the new
"accepts a REAL browser form submission" integration test explicitly exercises
the urlencoded path side by side with the JSON ones. No Critical issues found
in this change.

The one substantive concern is on the E2E test-reliability side:
`fetchWithFixtureRaceRetry` is a reasonable, bounded (3-attempt, no-delay)
mitigation for a real, well-diagnosed race — `db-isolation.spec.ts`'s advisory-
locked `TRUNCATE ... "Link" ...` running fully-parallel against feature specs
that create-then-immediately-HTTP-read a `Link` row on an unguarded connection
— but it is applied inconsistently across the phase's own specs, has no
dedicated unit test of its own despite being non-trivial new logic (breaking
this file's own established convention of directly unit-testing every exported
helper), and silently discards the responses of failed attempts rather than
logging them, which weakens its value as a diagnostic signal and, for the
no-leak specs in particular, means a genuinely leaking *intermediate* attempt
would never be inspected once a later attempt happens to match the expected
status. The password-gate spec's `page.request`-instead-of-DOM-form
workaround is well-reasoned and still meaningfully proves REDIRECT-E2E-02 (see
below) — it is not a tautological check.

## Warnings

### WR-01: `fetchWithFixtureRaceRetry` is applied inconsistently, leaving some requests still exposed to the exact race it exists to close

**File:** `apps/e2e/tests/smoke/redirect-password-gate.spec.ts:159-246`
**File:** `apps/e2e/tests/smoke/redirect-bot-og-render.spec.ts:67-73`
**Issue:** `apps/e2e/src/links.ts`'s `fetchWithFixtureRaceRetry` documents a
real, diagnosed race: `db-isolation.spec.ts` runs 6 concurrent
`withResetDbLock` cycles that each `TRUNCATE ... "Link" ... RESTART IDENTITY
CASCADE` from a different spec file, and a plain `createE2eLink` immediately
followed by a real HTTP request (over the app server's own DB connection, not
the test's) can lose its just-created row to that truncate in the gap between
the two steps. The fix is sound in principle, but it is not applied
everywhere it needs to be:
- `redirect-password-gate.spec.ts` (REDIRECT-E2E-02 — the file the review
  brief specifically calls out) never uses `fetchWithFixtureRaceRetry` at all,
  despite creating a fixture via the same unguarded `createE2eLink(prisma,
  ...)` call and then immediately `page.goto`-ing / `page.request.post`-ing
  against it. This spec is exactly as exposed to the truncate race as the
  ones that were fixed, but has no protection against it.
- `redirect-bot-og-render.spec.ts`'s first test wraps only the *first*
  request (the bot UA fetch) in the retry helper; the very next line reuses
  the SAME freshly-created `slug` for a second, unwrapped
  `request.get(...)` (the browser-UA / 302 assertion). That second request is
  just as susceptible to the identical truncate race as the first, but has no
  retry coverage.

Both gaps mean the documented race can still manifest as an intermittent,
unrelated-to-any-real-bug CI failure in exactly the specs this pattern was
introduced to protect.

**Fix:** Either wrap every HTTP call made against a freshly-created,
truncate-vulnerable fixture in `fetchWithFixtureRaceRetry` (including the
second `request.get` in `redirect-bot-og-render.spec.ts` and all of
`redirect-password-gate.spec.ts`'s `page.goto`/`page.request` calls, which
will require a `page`-shaped `attempt`/`isExpected` overload or a thin
Playwright-`page`-aware variant), or address the root cause once — e.g. give
`db-isolation.spec.ts` its own `test.describe.serial` / dedicated worker so it
never truncates `Link` while other spec files are mid-flight, which would let
this retry helper (and its inconsistent application) be removed entirely.

### WR-02: `fetchWithFixtureRaceRetry` has no unit test of its own

**File:** `apps/e2e/src/links.ts:181-192`
**Issue:** This is new, non-trivial control-flow logic (bounded loop,
early-return-on-match, fallback-return-on-exhaustion) added mid-phase to fix a
real bug. Every other exported helper in this same file —
`derivePasswordHash`, `deriveExpiresAt`, `createE2eLink` — has a direct,
dedicated test in `apps/e2e/tests/smoke/links-fixture.spec.ts` proving its
behavior in isolation. `fetchWithFixtureRaceRetry` has none: it is only ever
exercised indirectly, through the "happy path" of real feature specs (where
`isExpected` typically matches on the first attempt), which never proves the
retry-and-eventually-give-up behavior, the early-return-on-match behavior, or
that it returns (rather than throws) the last response after exhausting
`maxAttempts`. This is also a direct instance of the project's own CLAUDE.md
mandate ("kein Commit von Funktionslogik ohne begleitenden Unit-Test") not
being followed for a genuinely new function.
**Fix:** Add a small unit test (Vitest, or a Playwright `test()` with a fake
`attempt`/`isExpected`) asserting: (1) it returns immediately on a first-try
match without calling `attempt` again, (2) it retries up to `maxAttempts`
times on persistent mismatch and then returns the last response rather than
throwing, and (3) the default `maxAttempts` is 3.

### WR-03: The retry predicate matches on "not what I expected" rather than the specific race symptom, and discards failed-attempt responses with no logging

**File:** `apps/e2e/src/links.ts:181-192`
**Issue:** `isExpected` is invoked with only a boolean "does this match",
never told *why* a prior attempt didn't match, and the function never logs or
surfaces a retry happening. Two consequences: (a) this makes the helper
equally willing to paper over a genuine, unrelated intermittent bug in the
redirect handler (e.g., an occasional 500) as it is the documented 404-from-
truncation race — a real regression that only reproduces on 1-of-3 attempts
would silently disappear into a "passing" CI run instead of surfacing; (b)
for the no-leak specs specifically (`redirect-bot-og-render.spec.ts`'s
`assertNoLeak` calls), only the FINAL, matching response is ever inspected
for a leak — a failed intermediate attempt's body/headers are read via
`.text()`/`.headers()` but never checked, so if that discarded attempt had
actually leaked `CANARY_TARGET` (a real security defect), this pattern would
never notice.
**Fix:** At minimum, `console.warn`/log when a retry occurs (attempt number +
actual status) so CI output distinguishes "the known race fired" from "this
is genuinely flaky", and consider running the no-leak assertions against
every discarded attempt's response too (not just the one that finally
matched), so a leaking intermediate response can't hide behind a
subsequently-successful retry.

### WR-04: No regression test proves the new `addContentTypeParser` stays scoped to `POST /:slug/verify` and doesn't leak app-wide

**File:** `apps/api/src/routes/redirect.ts:253-263`
**Issue:** The code comment explicitly asserts the scoping invariant this
change depends on for safety ("Scoped to THIS plugin's own encapsulation
context ... so it only ever applies to `POST /:slug/verify` and cannot affect
any other route's content-type handling"). That claim is currently true only
because `redirectRoute(prisma)` happens to be registered via a plain
`app.register(...)` call in `app.ts` with no `fastify-plugin` wrapper. Nothing
in the test suite actually asserts this — there is no test that POSTs
`application/x-www-form-urlencoded` to a sibling route (e.g. an `/api/*`
endpoint) and confirms it is *not* parsed by this new parser (still 415, or
whatever that route's own contract is). If a future refactor wraps
`redirectRoute` in `fastify-plugin` (a one-line change, easy to make
accidentally when e.g. hoisting a shared decorator), this scoping would
silently break and every other JSON-only endpoint in the app would start
accepting form-encoded bodies, with no test catching the regression.
**Fix:** Add one integration test asserting a non-redirect route (or a
synthetic sibling route registered after `redirectRoute` in the same `app.ts`
wiring) still rejects/ignores `application/x-www-form-urlencoded` the way it
did before this change.

## Info

### IN-01: `host-header.spike.spec.ts` is explicitly documented as throwaway but left as a permanent part of the suite

**File:** `apps/e2e/tests/smoke/host-header.spike.spec.ts:1-75`
**Issue:** The file's own header comment says "Throwaway: proves the
mechanism once, is not part of the feature suite going forward," but it
remains in `tests/smoke/` and will keep running on every CI invocation
indefinitely. Not harmful, just a minor documentation/reality mismatch.
**Fix:** Either remove it now that 12-03/12-04/12-05's feature specs
independently prove the same host-header mechanism through real usage, or
update the comment to stop calling it throwaway if it's being kept
intentionally as a regression guard.

### IN-02: Duplicate `bcrypt` hash-cost / UA / canary constants across two files, by design but worth a shared-constants note

**File:** `apps/e2e/src/links.ts:45-49,137-140`
**Issue:** `resolvePasswordHashCost`, `CANARY_TARGET`, `BOT_UA`, and
`BROWSER_UA` are intentionally duplicated (per this file's own header
comment) from `apps/api/src/lib/links.ts` and
`apps/api/test/redirect.integration.test.ts` respectively, since
`apps/e2e` cannot import `apps/api`'s internal, unexported modules. This is a
reasonable, documented trade-off given the `exports` map constraint, but it
is a drift risk: if `PASSWORD_HASH_COST_DEFAULT` or the browser/bot UA
strings ever change on the API side, this file's copies won't be updated
automatically and `isbot`/bcrypt-cost assumptions could silently diverge.
**Fix:** No action required now; consider a shared `packages/e2e-fixtures`
(or similar) constants module if a future phase needs to keep these in sync
more than twice.

---

_Reviewed: 2026-07-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
