# Pitfalls Research

**Domain:** Adding Playwright E2E test coverage to an existing, already-shipped Fastify + Vue + Postgres + better-auth(magic-link) + Docker/Compose system (Kurzly v1.1 milestone)
**Researched:** 2026-07-24
**Confidence:** LOW-MEDIUM (general web synthesis, no MCP docs provider / Context7 available in this environment; no project-specific prior art found — treat as directional, re-verify against Playwright's own docs and better-auth's own test helpers at implementation time)

## Critical Pitfalls

### Pitfall 1: Shared/global inbox polling makes magic-link E2E tests flaky

**What goes wrong:**
Multiple Playwright workers (or multiple tests within one worker) hit a single shared Mailpit inbox. Whichever test polls the inbox API first "steals" the email meant for a different test, or a later test sees a stale email from an earlier run. Symptoms: intermittent "magic link not found" or "wrong link clicked" failures that don't reproduce when run alone (`--workers=1` passes, parallel run fails).

**Why it happens:**
Mailpit/MailHog give you one mailbox surface, not per-test isolation, out of the box. Teams naively poll `GET /api/v1/messages` and grab "the latest message" instead of scoping by recipient.

**How to avoid:**
Generate a unique recipient address per test (e.g. `e2e+${testInfo.testId}@kurzly.test` or `+workerIndex` tagging if your invite-only user model requires pre-provisioned addresses — Kurzly is invite-only, so seed one dedicated test user per worker rather than per test). Filter the Mailpit search API by `to:` address, not "most recent message." Poll with a bounded timeout (20-30s) and fail fast — don't `sleep()`, don't infinite-retry. Delete/consume the message after reading so a later test in the same mailbox can't accidentally match it.

**Warning signs:**
Tests pass solo but fail under `fullyParallel: true`; failures cluster around auth-adjacent specs; CI failure rate is nonzero but not reproducible locally.

**Phase to address:**
Playwright infrastructure/fixtures phase (the "Mailpit + auth fixture" work), before any auth-dependent spec is written — get this primitive right once, every other E2E spec depends on it via `storageState`.

---

### Pitfall 2: `storageState` reuse silently produces unauthenticated tests

**What goes wrong:**
Team builds a `storageState`-based auth fixture (log in once via magic link, save session, reuse across all specs) to avoid re-running the full email round-trip per test — good instinct, since Kurzly's is invite-only + magic-link-only (no password fallback to shortcut through). But `storageState` only persists cookies + `localStorage`. If better-auth's client SDK or any app code touches `sessionStorage` for anything session-related, the saved state silently omits it and tests run "logged out" while assertions on cookie presence still pass.

**Why it happens:**
better-auth's session is primarily cookie-based (its Fetch-API handler sets `Set-Cookie` directly), so this specific case is lower-risk than a typical JWT-in-`sessionStorage` SPA — but any Pinia-persisted UI state or app-level "remember last domain filter" convenience state living in `sessionStorage` will not survive the `storageState` snapshot, causing flaky post-login UI assertions that look like an auth bug but aren't.

**How to avoid:**
Confirm explicitly (via a quick manual check or a dedicated small test) exactly what better-auth's client stores and where before building the shared fixture. Build the auth fixture as a Playwright "setup project" that runs once per worker, performs the real magic-link round-trip against Mailpit, and writes `storageState` to a per-worker file; other specs declare it as a dependency. Use a fresh `browser.newContext()` per test file even when reusing `storageState`, to avoid cross-test cookie/session leakage.

**Warning signs:**
Tests fail with "redirected to login" only in specific specs that touch UI state normally hydrated at boot; the failure doesn't correlate with auth session expiry timing.

**Phase to address:**
Same fixtures phase as Pitfall 1 — validate the `storageState` fixture with a dedicated smoke test ("session survives a fresh context + page reload") before other specs depend on it.

---

### Pitfall 3: Playwright auto-follows redirects, hiding the status code your redirect handler actually returned

**What goes wrong:**
`page.goto()` and normal browser navigation transparently follow 301/302/307/308 (and Kurzly's 410-on-expired is a terminal, non-redirect response, but the *redirect itself* — slug → target — is exactly the case that gets silently swallowed). A test asserting "did it redirect to the right target" via `page.url()` after `goto()` looks correct, but a test asserting the *intermediate* status code (e.g. "is this a 301 vs 302", which matters for SEO/caching semantics) will find `response.status()` on the final page is 200, not 301/302, because Playwright resolved the whole chain before returning.

**Why it happens:**
Browser-level navigation APIs model final rendered state, not the HTTP transaction, by design.

**How to avoid:**
For asserting the actual redirect status code, either listen on `page.on('response', ...)` for the *first* response in the navigation and check its `.status()` before the chain resolves, or bypass the browser entirely and use `request.fetch(url, { maxRedirects: 0 })` via Playwright's `APIRequestContext` — this is the more deterministic option for the redirect-handler spec, since it lets you assert status + `Location` header directly without a rendered page in the loop. Use `response.request().redirectedFrom()/redirectedTo()` to walk the chain if you need to prove there was exactly one hop (not an unintended double-redirect).

**Warning signs:**
Redirect specs "pass" but never actually assert a 301/302/410 status code anywhere, only the final landing URL — a coverage gap that looks green but tests nothing about the handler's HTTP contract.

**Phase to address:**
Redirect-handler E2E phase — write the 410-expired and password-gate specs using `APIRequestContext` first (fast, deterministic, no browser needed) for the status-code contract, then layer a smaller number of full-browser specs on top only for the actually-rendered HTML/bot-OG cases.

---

### Pitfall 4: Testing "bot renders OG tags, browser gets redirected" is easy to get backwards

**What goes wrong:**
Kurzly's redirect handler must serve bot-rendered OG-preview HTML to crawlers (Slack/Twitter/Facebook unfurlers) but issue a real redirect to human browsers — and per the project's security constraint, must never leak the protected/expired target before password/expiry checks. A naive E2E setup either (a) always looks like a bot to the handler because vanilla Playwright's default UA/fingerprint gets misclassified by a permissive bot-sniffing regex, silently testing the wrong code path in every "normal user" spec, or (b) the reverse — crafts a bot UA that isn't actually on the handler's allowlist, so the "bot gets OG HTML" spec is a false pass because it hit the same code path as a normal browser.

**Why it happens:**
Bot detection here is a Kurzly-owned UA/heuristic check, not a general "am I automated" adversarial problem — but Playwright headless defaults (a `HeadlessChrome` marker historically, now varies by Chromium channel) can coincidentally match or miss naive substring checks in ways that have nothing to do with the test's intent.

**How to avoid:**
Read the actual bot-detection implementation (User-Agent allowlist/regex) before writing specs. Explicitly set `userAgent` per test via `browser.newContext({ userAgent: '...' })` — one context using a real known bot UA string (e.g. `facebookexternalhit/1.1`, `Twitterbot/1.0`) to assert the OG-HTML path, and one using a normal desktop Chrome UA string (not Playwright's default) to assert the real-redirect path. Never rely on Playwright's unmodified default UA for the "normal user" case — pin it explicitly so the test's intent is legible and doesn't silently change if Playwright bumps its default UA string in a future release.

**Warning signs:**
The "bot sees preview, human gets redirected" spec passes without ever setting `userAgent` on the context — it's very likely both paths are exercising the same branch.

**Phase to address:**
Redirect-handler E2E phase — pair with Pitfall 3; this is the other half of that same spec set (OG-preview-before-unlock security assertion is a named project constraint, so this deserves its own explicit spec, not an incidental check).

---

### Pitfall 5: Shared Postgres + parallel workers collide on unique constraints (slug-per-domain, user email, domain name)

**What goes wrong:**
Kurzly enforces unique-slug-per-domain and other constraints at the DB level. Two Playwright workers running concurrently both try to create a link with slug `test` on the same domain, or invite the same test-user email, and one worker's test fails with a Prisma unique-constraint violation that has nothing to do with the feature under test.

**Why it happens:**
E2E tests exercise the app through real HTTP against a real running server + real Postgres — unlike the existing Vitest integration suite's per-file cloned-DB / testcontainers isolation (already a hard-won lesson recorded in this project's Key Decisions: "Postgres kennt keine verschachtelten Transaktionen... in Phase 7 entdeckt & behoben"), Playwright specs can't wrap requests in a rolled-back transaction because the assertions happen from the browser/API-request side, several process hops away from the DB connection.

**How to avoid:**
Two viable strategies, pick one explicitly rather than improvising per-spec: **(a)** give each Playwright worker its own database/schema (spin up N throwaway Postgres databases or schemas keyed by `process.env.TEST_PARALLEL_INDEX`, matching the granularity already used for the Vitest testcontainers harness, and point that worker's app instance/connection string at it), or **(b)** keep one shared test database but make every fixture generate globally-unique identifiers (slug, email, domain name) suffixed with `testInfo.workerIndex + Date.now() + random`, and always clean up via `afterEach`/`afterAll` deletes scoped to that test's own created rows (never truncate/reset shared tables). Given the project already has a working per-worker-database mental model from the Vitest harness, prefer (a) for consistency and to sidestep flaky manual cleanup entirely; reserve (b) only if running N parallel Postgres instances is too heavy for the CI runner.

**Warning signs:**
Intermittent `P2002` (Prisma unique constraint) errors in CI only, tests fail more often as parallelism (`workers`) increases, failures reference slugs/emails/domain-names that look like literal fixture strings ("acme.io", "test@example.com") rather than generated ones.

**Phase to address:**
Playwright infrastructure/fixtures phase — decide and document the DB-isolation strategy before any CRUD/QR/analytics spec is written, since retrofitting unique-ID generation into 50+ already-written specs is expensive; get it into the base fixture once.

---

### Pitfall 6: `@fastify/rate-limit` throttles E2E specs that hammer the same IP/endpoint

**What goes wrong:**
Kurzly's spec (per the project's own stack doc) rate-limits the magic-link-request endpoint, the link-password-check endpoint, and the public redirect handler specifically to prevent abuse. A Playwright spec suite that runs dozens of magic-link logins, password-gate attempts, or redirect hits back-to-back from the same test runner IP trips those same limits mid-run, and unrelated specs start failing with 429s that have nothing to do with what they're testing.

**Why it happens:**
Rate-limit windows are usually keyed by IP by default; in CI, every worker/spec originates from the same container IP, so the limiter can't distinguish "100 legitimate different users" from "one test suite running fast."

**How to avoid:**
Do not simply disable the plugin globally under `NODE_ENV=test` — that would leave the rate-limiter itself untested and could mask a regression in production. Instead: gate a bypass behind a narrow, explicit test-only mechanism (e.g. an allowlisted test header or IP checked only when a `E2E_TEST` env flag is set at boot, or a much higher limit configured specifically for the E2E environment's Fastify instance) and write one small, dedicated rate-limit spec that intentionally exceeds the limit to assert the 429 contract still works. Keep that one spec isolated (own file, `test.describe.serial`, run first) so it doesn't get raced by parallel workers that would otherwise trip its own counter unpredictably.

**Warning signs:**
Auth/password-gate specs fail progressively more often as more specs are added to the suite, or fail only when run in full-suite mode but pass individually; failures show HTTP 429 in the response.

**Phase to address:**
Playwright infrastructure phase (env/config setup) — decide the bypass mechanism up front, and write the "rate limit really works" spec explicitly rather than let its coverage happen by accident.

---

### Pitfall 7: CI-only flakiness from container resource limits, browser install caching, and service startup ordering

**What goes wrong:**
Specs pass locally but fail intermittently or hard-crash only in CI. Common root causes for this exact stack: (1) Chromium under Docker's default 64MB `/dev/shm` crashes under memory pressure — CI runners are more resource-constrained than dev machines; (2) `npx playwright install` re-downloads ~500MB of browser binaries every run if the cache isn't keyed to the Playwright version, adding minutes and occasional network-flake failures; (3) the Playwright `webServer`/`globalSetup` starts hitting the API before Postgres/Mailpit inside `docker-compose` are actually ready — `depends_on` alone only waits for container *start*, not for the service inside to be healthy; (4) port collisions between the existing Vitest testcontainers-Postgres harness (which picks ephemeral ports per worker) and a fixed-port Playwright-facing Postgres/compose stack running in the same CI job.

**Why it happens:**
These are infra concerns nobody owns until E2E is added — the existing Vitest suite's testcontainers harness solves DB provisioning for unit/integration tests, but that's a *separate* mechanism from whatever Postgres instance the Playwright-driven Fastify+Vue app itself talks to, and the two can conflict if not deliberately kept apart (different compose project names, different port ranges, or run in separate CI jobs).

**How to avoid:**
Run CI containers with `--shm-size=1gb` (or run Chromium with `--disable-dev-shm-usage`). Cache the Playwright browser install directory keyed to the exact `@playwright/test` version in `package.json` (invalidate the cache key on version bump). Use `depends_on: { condition: service_healthy }` with real healthchecks (Postgres: `pg_isready`; Mailpit: HTTP GET on its API; the API itself: a `/health` endpoint) in the E2E-specific compose file, not bare `depends_on`. Keep the E2E compose stack's Postgres port and the Vitest testcontainers' ephemeral port ranges non-overlapping and run them as separate CI jobs/stages if possible, so a testcontainers port allocation never collides with the E2E stack's fixed port.

**Warning signs:**
CI failures reference browser crashes ("Target closed", "Protocol error") with no clear application-level cause; first spec in a run fails with connection-refused against Postgres/Mailpit but later specs succeed; CI is measurably slower on cache-miss runs.

**Phase to address:**
Playwright CI-wiring phase (the docker-compose.dev.yml + CI pipeline work explicitly called out in this milestone's target features) — get healthchecks and shm sizing right before any spec authoring begins, since debugging "is this my test or the infra" wastes the most time here.

---

### Pitfall 8: Retrofitting full-suite E2E onto an already-shipped system by trying to cover everything at once

**What goes wrong:**
Given v1.0 already has 53 requirements and ~37k LOC shipped, the temptation is to write E2E specs for every screen/flow simultaneously. Teams doing this on legacy/already-shipped systems consistently report the opposite of the intended outcome: the suite becomes slow, chronically flaky, and — because the causes are usually a handful of shared infra problems (email polling, DB isolation, rate limiting; Pitfalls 1, 5, 6 above) rather than N independent bugs — patching failures one at a time for months doesn't improve reliability and developers stop trusting or running the suite.

**Why it happens:**
Without diagnosing shared root causes first, every new flaky spec looks like an unrelated one-off, and effort gets spent symptom-by-symptom instead of on the (few) underlying fixtures.

**How to avoid:**
Sequence the milestone as: infra fixtures + CI reliability first (Pitfalls 1, 2, 5, 6, 7 all resolved and proven via a couple of throwaway smoke specs) → then only the explicitly named critical flows in priority order matching the project's own "Core Value" statement (redirect handler correctness is Kurzly's stated single most important behavior, so redirect-handler specs should be the first real coverage after infra, ahead of QR/analytics/team-management breadth). Resist bundling any production code refactors into the same phase/PRs as test-infra additions — isolate "add tests" work from "change behavior" work so a red test always means one or the other, not both.

**Warning signs:**
Roadmap for this milestone lists screen-by-screen E2E coverage with no dedicated "fixtures/infra" phase before it; PRs in this milestone start touching non-test application code "while we're in there."

**Phase to address:**
Roadmap-level — this is the argument for structuring v1.1 as: Phase 1 (Playwright infra: config, fixtures, Mailpit wiring, DB isolation strategy, CI healthchecks) → Phase 2 (redirect-handler + auth, the two flows the project's own Core Value statement prioritizes) → later phases (Links/QR/CSV, Analytics, Team-management/domain-scoped authorization breadth).

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Disabling `@fastify/rate-limit` entirely under `NODE_ENV=test` | Fast, zero-config, no 429 flakiness | Rate-limiter regressions ship undetected in production | Never for the app's actual test env; only acceptable for throwaway local dev exploration, not CI |
| Single shared test Postgres DB with cleanup-by-convention (`afterEach` deletes) instead of per-worker DB | Simpler compose setup, one DB to manage | Any missed cleanup path leaks rows that break a later, unrelated spec — non-deterministic failures that are expensive to bisect | Acceptable early in the milestone (e.g. Phase 1 smoke tests) if parallelism is kept at 1 worker; must be revisited before enabling `fullyParallel` |
| Hardcoded `sleep()`/`waitForTimeout()` waiting for Mailpit email instead of API polling | Quick to write, "just works" locally | Either too short (flaky) or too long (slow suite); doesn't fail fast on genuine SMTP outage | Never — polling with a bounded timeout is barely more code |
| Testing redirect status only via final `page.url()` after `goto()`, skipping status-code assertions | Fewer lines, "looks like it redirected" | Silent gap: a handler bug that returns 200-with-JS-redirect instead of a real 301/302 (bad for SEO/caching, arguably a spec violation) would never be caught | Acceptable only for exploratory/manual smoke checks, never as the sole automated coverage of the redirect contract |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Mailpit/MailHog SMTP catcher | Polling "most recent message" across a shared inbox | Filter by unique `to:` recipient per test/worker; consume/delete after reading |
| better-auth session (`storageState`) | Assuming `storageState` captures all session data | Verify what better-auth's client actually persists (cookies vs. localStorage vs. sessionStorage) before building the shared auth fixture |
| Custom-domain redirect handler | Testing multiple "custom domains" without real hostname resolution | Wire `/etc/hosts` entries (or a CI-local DNS override) so each test domain actually resolves to the app under test; browser contexts won't rewrite Host headers for you |
| `@fastify/rate-limit` | Blanket-disabling in all test environments | Narrow, explicit test-only bypass (header/IP allowlist gated by an env flag) + one dedicated spec proving the limiter itself still works |
| Existing Vitest testcontainers-Postgres harness | Reusing the exact same harness/port range for Playwright's app-under-test DB | Keep E2E's Postgres instance and port range separate from the Vitest harness's ephemeral testcontainers ports; run as separate CI jobs if feasible |
| Docker Compose service startup (Postgres, Mailpit, API) | Relying on plain `depends_on` (waits for container start, not readiness) | Add real healthchecks (`pg_isready`, Mailpit API GET, app `/health`) and use `depends_on: condition: service_healthy` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Full UI-driven login in every spec instead of `storageState` reuse | Suite runtime balloons as spec count grows (each login = full email round-trip) | One-time-per-worker auth setup project + `storageState` reuse | Noticeable once the suite exceeds roughly a few dozen specs |
| One shared Postgres instance for all Playwright workers without per-worker DB | Parallelism has to be capped low (or disabled) to avoid constraint collisions, making CI slow | Per-worker throwaway DB/schema, matching the Vitest harness's existing model | Becomes a bottleneck as soon as `fullyParallel`/multiple workers are enabled |
| Re-downloading Playwright browsers every CI run | Minutes added per run, occasional flaky network failures inflate as CI runs multiply | Cache browser install dir keyed to `@playwright/test` version | Immediately, from the first CI run — cheap fix, no reason to defer |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing a captured `storageState` file (containing real session cookies) into the repo or CI artifacts for reuse across runs | Leaked session credential, effectively a live auth bypass token if the app's session lifetime is long | Regenerate `storageState` fresh per CI run via the real login fixture; treat any persisted state file as a secret, exclude from VCS, short-lived artifact only |
| Weakening the OG-preview "never leak the protected/expired target before unlock" guarantee to make bot-path E2E assertions easier to write | Violates an explicit project security constraint (no OG-preview of destination before unlock) | Write the bot-detection spec against the real, unmodified handler behavior — assert the *absence* of the real target in the bot-rendered HTML, don't special-case test mode to skip the check |
| Using real, production-realistic SMTP credentials for E2E email tests | Real emails sent, potential cost/rate-limit/leak during automated CI runs | Mailpit/MailHog only in dev/CI compose, never wired to a real SMTP provider for test runs (already a project convention per the v1.0 stack doc — must be preserved for E2E, not just Vitest) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| E2E specs assert only that a UI element exists, not that domain-scoped data is actually correct (e.g. table shows *a* row, not the *right* row for the logged-in Member's domains) | A regression that leaks or hides the wrong domain's data would pass this test | Assert on the actual content/count/domain-attribution of rendered rows, not just "the table isn't empty" |
| Toast/error message specs check for "an error appeared" rather than the specific denial/validation message | A confusing or wrong error message ships unnoticed (e.g. a 403 domain-denial showing a generic "something went wrong" instead of a clear reason) | Assert on the actual message text/testid for authorization-denial and validation-error paths, matching the specific UX the design handoff specifies |

## "Looks Done But Isn't" Checklist

- [ ] **Magic-link E2E spec:** Often missing a check that a *stale/already-used* magic-link token is rejected — verify a spec re-visits a consumed link and asserts it's denied, not just that the happy-path login works once
- [ ] **Redirect-handler E2E spec:** Often missing the actual HTTP status-code assertion (301/302/410) via `APIRequestContext`, only checking final landing URL through a browser — verify at least one spec inspects `response.status()` on the first hop
- [ ] **Password-gated link spec:** Often missing a check that the target is genuinely absent from the HTML/network response *before* the correct password is submitted — verify by inspecting response body/DOM pre-unlock, not just that a password form is shown
- [ ] **QR PNG/SVG export spec:** Often missing content-level verification (decode the QR, confirm it points at the right URL) — verify beyond "a file downloaded with the right extension"
- [ ] **CSV import spec:** Often missing an assertion that a deliberately malformed/duplicate-slug row in the CSV is rejected with a clear per-row error, not just that a well-formed CSV succeeds
- [ ] **Rate-limit spec:** Often entirely absent because the plugin is disabled in test mode — verify a dedicated spec exists that intentionally trips the 429 and checks it
- [ ] **Domain-scoped authorization E2E:** Often only checks that a Member *can* act inside their own domain — verify a paired spec proves a Member is denied acting on a domain they're not scoped to, end-to-end through the UI (not just at the API/unit-test layer, since that's already covered by v1.0's "Denial-Suite")

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|-----------------|
| Suite already flaky from shared-inbox/shared-DB pollution | MEDIUM | Freeze new spec authoring; introduce per-worker DB + per-test unique email/slug generation as a dedicated fixture refactor; re-run full suite at `workers>1` repeatedly to confirm flake rate drops before resuming feature specs |
| Rate-limit 429s discovered mid-milestone after many specs already assume unlimited requests | LOW-MEDIUM | Add the env-gated bypass centrally in one fixture/setup file rather than patching each spec; add the one dedicated rate-limit-still-works spec as a follow-up, not a blocker |
| CI flake traced to `/dev/shm`/container resource limits after specs already written | LOW | Pure CI-config fix (`--shm-size`, healthchecks, cache keys) — no spec rewrites needed, just infra config in the compose/CI-pipeline files |
| Redirect specs shipped without real status-code assertions | LOW-MEDIUM | Add a parallel `APIRequestContext`-based assertion layer to existing redirect specs rather than rewriting them; can be done incrementally per spec file |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Shared-inbox flakiness (1) | Playwright infra/fixtures phase | A smoke spec runs the same auth fixture concurrently across N workers with zero cross-test email mismatches |
| `storageState` sessionStorage gap (2) | Playwright infra/fixtures phase | Auth fixture spec confirms a fresh context loaded from `storageState` reaches an authenticated page without re-login |
| Redirect status hidden by auto-follow (3) | Redirect-handler E2E phase | At least one spec per redirect type (slug→target, 410-expired, password-gate) asserts status code via `APIRequestContext`, not just final URL |
| Bot-path/human-path test ambiguity (4) | Redirect-handler E2E phase | Two explicit specs with pinned `userAgent` values, one asserting OG-HTML-served, one asserting real-redirect, both referencing the actual bot-detection allowlist |
| DB unique-constraint collisions under parallelism (5) | Playwright infra/fixtures phase | Full suite passes identically at `workers=1` and `workers=N` (N = CI's configured parallelism) with no `P2002`-style failures |
| Rate-limit 429s breaking unrelated specs (6) | Playwright infra/env-config phase | Full suite passes with rate-limiting plugin still registered/active; separate spec proves 429 still fires under intentional overload |
| CI-only container/startup flakiness (7) | Playwright CI-wiring phase (docker-compose.dev.yml + pipeline) | 10 consecutive full CI runs with zero infra-attributable failures before merging feature specs on top |
| Trying to cover everything at once (8) | Roadmap/phase sequencing (this milestone's own phase design) | Roadmap shows a dedicated infra-first phase before any flow-coverage phase, with redirect-handler prioritized per the project's stated Core Value |

## Sources

- [Optimizing Cypress/Playwright E2E Tests: Testing Real Email Flows](https://earezki.com/ai-news/2026-06-19-testing-email-flows-in-cypress-without-a-mail-server/) — confidence LOW (general web synthesis)
- [How to test email verification flows in Playwright (Mailpit, MailHog)](https://dev.to/zerodrop/how-to-test-email-verification-flows-in-playwright-mailpit-mailhog-and-a-no-setup-alternative-2444) — confidence LOW
- [Playwright official docs: Authentication](https://playwright.dev/docs/auth) — confidence LOW (surfaced via web search synthesis, not fetched directly through a docs MCP provider; re-verify against the live docs page at implementation time)
- [Using Playwright's storageState | BrowserStack](https://www.browserstack.com/guide/playwright-storage-state) — confidence LOW
- [GitHub microsoft/playwright#27992 — validate 301 status using request.fetch()](https://github.com/microsoft/playwright/issues/27992) — confidence LOW
- [How do I test a website that has a page redirect with Playwright?](https://playwrightsolutions.com/how-do-i-test-a-website-that-has-a-page-redirect-with-playwright/) — confidence LOW
- [Detecting Vanilla Playwright - An In-Depth Analysis | ScrapingAnt](https://scrapingant.com/blog/detect-playwright-bot) — confidence LOW
- [Playwright issue #33699 — how to write isolated Playwright tests against a real database](https://github.com/microsoft/playwright/issues/33699) — confidence LOW
- [Playwright Parallel Execution: Workers & fullyParallel Guide | TestDino](https://testdino.com/blog/playwright-parallel-execution) — confidence LOW
- [Playwright File Download Testing Guide with waitForEvent and saveAs | QASkills.sh](https://qaskills.sh/blog/playwright-file-download-testing-guide-2026) — confidence LOW
- [opencrvs/opencrvs-core issue #7386 — Rate limit should be disabled when running e2e in QA environment](https://github.com/opencrvs/opencrvs-core/issues/7386) — confidence LOW
- [Playwright in Docker: The Browser Path Gotcha That'll Waste Your Afternoon](https://dev.to/mackmoneymaker/playwright-in-docker-the-browser-path-gotcha-thatll-waste-your-afternoon-3m35) — confidence LOW
- [Achieve Reliable Native E2E Tests Beyond Fixing Flakes | Docker Blog](https://www.docker.com/blog/native-e2e-test-reliability/) — confidence LOW
- [E2E Tests, Legacy, and Static Analysis: Making Refactoring Safe | Gett Tech](https://medium.com/gett-engineering/e2e-tests-legacy-and-static-analysis-making-refactoring-safe-part-i-the-introduction-44ece51f812a) — confidence LOW
- [Onboarding Tests into Legacy Project | JetThoughts Blog](https://jetthoughts.com/blog/onboarding-tests-into-legacy-project-testing-startup/) — confidence LOW
- Kurzly project's own `.claude/CLAUDE.md` stack doc and `.planning/PROJECT.md` — confidence HIGH (primary project source, used for the Pitfall 5 cross-reference to the existing Vitest testcontainers/per-file-cloned-DB decision and the Pitfall 8 "Core Value" prioritization)

---
*Pitfalls research for: Adding Playwright E2E testing to an existing Fastify+Vue+Postgres+better-auth+Docker system (Kurzly v1.1)*
*Researched: 2026-07-24*
