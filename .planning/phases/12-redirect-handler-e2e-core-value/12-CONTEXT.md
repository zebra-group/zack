# Phase 12: Redirect Handler E2E (Core Value) - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss — decisions below derived directly from the actual current codebase (redirect.ts, unlockCookie.ts, publicHtml.ts, redirectEngine.ts, botDetection.ts) since the user is AFK and asked to proceed without pausing for questions. This phase is public/unauthenticated and independent of Phase 11's auth fixtures, but reuses Phase 11's `apps/e2e` infra (Prisma client, baseline seed, compose stack) directly.

<domain>
## Phase Boundary

Prove the redirect handler — `GET /:slug` (+ `POST /:slug/verify`) — behaves correctly end-to-end against the built image, across every state: happy-path redirect, password gate (wrong/correct), expiry (410), bot vs. human branching (OG vs. redirect), and UTM/query-param merging. Public, unauthenticated — no dependency on Phase 11's `auth.setup.ts`/storageState fixtures. Uses Phase 11's baseline seeded Domain (`e2e.kurzly.local`) as the redirect-target host; does NOT create a second domain fixture.

</domain>

<decisions>
## Test target & fixtures

- **Seed Links directly via Prisma** (`apps/e2e/src/db.ts`'s reused client), not through the dashboard UI — this phase is about the PUBLIC redirect endpoint, not the Links-management UI (that's Phase 14's job). Use the actual service functions if reasonably reachable (`@kurzly/api`'s `lib/links.ts` `createLink`/`updateLink`) rather than a raw `prisma.link.create`, to stay on the same single-write-path this project's own Key Decisions table establishes (D-01) — mirrors how `apps/api/test/redirect.integration.test.ts` builds its own fixtures. If importing `lib/links.ts` from `apps/e2e` proves awkward (it's not exported via the `./prisma-client` subpath), fall back to a raw `prisma.link.create` scoped to this phase's own spec files only, and note the deviation in the plan/summary — do not block on this, it's an implementation-convenience question, not an architectural one.
- **Domain:** always `BASELINE_DOMAIN_HOSTNAME` ("e2e.kurzly.local") from `apps/e2e/src/db.ts` (Phase 11) — do not seed a second Domain for this phase.
- **Per-test isolation:** each spec creates its OWN Link(s) with a cryptographically-random slug (mirrors Phase 11's `db-isolation.spec.ts` pattern) inside a `withResetDbLock` callback if concurrent writes to shared tables are a concern, or a plain create if the test is read-only against its own unique slug and doesn't touch shared/truncated tables. Reuse `apps/e2e/src/db.ts`'s exported helpers; do not duplicate a second DB-reset mechanism.
- **Host header on requests:** Playwright's `APIRequestContext` (`request.get`/`request.post`) is a Node-side HTTP client, not restricted by the browser Fetch spec's forbidden-header list — it CAN set an explicit `Host` header even though the underlying TCP connection still goes to `localhost:3000`. This must be empirically confirmed as the FIRST task of this phase's first plan (a throwaway spike, same pattern as Phase 11's Prisma-subpath spike) before any other spec depends on it — if it turns out Playwright strips/ignores a manually-set `Host` header, the fallback is Node's raw `http.request` with the override, or (least preferred) actually registering `localhost` itself as a second Domain row (rejected as first choice: would reintroduce exactly the CR-07 class of host-collision risk this milestone just fixed in Phase 11).
- **Browser vs. API-only tests:** Use `request` (APIRequestContext, `maxRedirects: 0`) for every status-code/header-precision assertion (REDIRECT-E2E-01 happy path, REDIRECT-E2E-03 expiry 410, REDIRECT-E2E-04 bot/UA branching, REDIRECT-E2E-05 UTM merge) — exactly as the ROADMAP success criteria specify. Use a real `page` (browser) ONLY for REDIRECT-E2E-02's password gate, since submitting the password form and receiving the unlock cookie is most naturally proven end-to-end via actual browser form interaction + cookie jar behavior (mirrors a real visitor); an API-only version may be added as a secondary check if time allows but is not required.

## Password gate (REDIRECT-E2E-02)

- Flow: `page.goto("/promo-slug")` on a password-protected link → assert password-entry page rendered (no target string anywhere in the HTML) → submit WRONG password via the real form → assert still on the password page / target still absent → submit CORRECT password → assert the browser is redirected to the real target (or, if the target is an unreachable test URL, assert the `Location`/final navigation at least reaches the target's own host, e.g. via `page.waitForURL` or checking network response headers rather than requiring the target page itself to load — use an httpbin-style or `example.com`-class stable public target URL, or a self-hosted stub if network access from the test runner to the public internet is unavailable in CI; confirm outbound network reachability from the compose stack during planning, don't assume it).
- No-leak assertion: grep the full HTML body of every pre-unlock response for the literal configured target URL string — must never appear, mirroring `apps/api/test/redirect.integration.test.ts`'s own no-leak canary pattern.

## Bot/OG branching (REDIRECT-E2E-04)

- Pin two explicit `User-Agent` header values in the `APIRequestContext`: one from `apps/api/src/lib/botDetection.ts`'s actual recognized bot allowlist/pattern (read that file during planning to pick a real matching UA string, not a guessed one), one an ordinary browser UA. Assert the bot UA's response contains the link's configured custom OG title/description/image (never the real target), and the browser UA's response is a real 3xx redirect. Also assert the bot branch still respects password/expiry gates (a protected+bot-hit link must show the password page, not an OG preview of the real target) — this is an explicit no-leak requirement already called out in the ROADMAP goal and `publicHtml.ts`'s own header comments.

## UTM/query merge (REDIRECT-E2E-05)

- Create a Link with owner-configured UTM fields (source/medium/campaign) set via the link fixture. Request `/:slug?extra=1` (a request-time query param) and assert the final redirect `Location` contains BOTH the owner's UTM params AND `extra=1`, correctly merged/ordered per `lib/redirectEngine.ts`'s `applyUtmParams`/`mergeQuery` (read that file during planning for the exact canonical ordering/encoding to assert against, rather than guessing).

## Claude's Discretion

- Exact spec file/directory layout under `apps/e2e/tests/redirect/` (mirrors the milestone research's original suggested structure: `slug-redirect.spec.ts`, `password-gate.spec.ts`, `expiry.spec.ts`, `bot-og-render.spec.ts`, `utm-merge.spec.ts` — one file per ROADMAP success criterion is a reasonable default, adjust if a different grouping reads better).
- Whether to reuse a single seeded Link across an entire spec file's cases (read-only reuse) vs. one Link per test case — prefer one-per-test-case for full isolation unless it creates excessive setup boilerplate, in which case document the reuse rationale in the plan.
- Exact stable public target URL (or lack thereof / stub approach) for the password-gate browser test's final-redirect assertion — verify outbound network reachability from the compose stack empirically before committing to a real external URL.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/e2e/src/db.ts` (Phase 11): `createE2ePrisma()`, `seedBaseline()`, `withResetDbLock()`, `BASELINE_DOMAIN_HOSTNAME`, `ADMIN_EMAIL`/`MEMBER_EMAIL` constants — this phase is a pure consumer, adds no new DB-helper surface.
- `apps/api/test/redirect.integration.test.ts`: the exact fixture-building pattern (`seedDomainWithOwner`, `createLink`/`updateLink` calls, no-leak canary string convention) this phase's Prisma-level fixtures should mirror, adapted to a real HTTP client instead of `fastify.inject`.
- `apps/api/src/lib/botDetection.ts`, `apps/api/src/lib/redirectEngine.ts` (`resolveLinkState`, `mergeQuery`, `applyUtmParams`, `QR_SCAN_PARAM`), `apps/api/src/lib/publicHtml.ts` (`renderPasswordPage`, `renderExpiredPage`, `renderNotFoundPage`, `renderBotOgPage`) — read these directly during planning for exact real values/behavior to assert against (real bot UA patterns, real query-merge ordering, real page copy/markers), not assumptions.
- `apps/api/src/lib/unlockCookie.ts` — signed, httpOnly, path-scoped (`/${slug}`), self-invalidating (keyed on `passwordHash`) unlock cookie; the password-gate spec's success condition is that this cookie gets issued and the browser's subsequent request carries it.

### Established Patterns
- One spec file per ROADMAP success criterion / requirement ID (Phase 11's own layout convention: `tests/smoke/*.spec.ts` per concern).
- `test.describe.serial` only when tests genuinely share mutable state across cases (Phase 11's `rate-limit-bypass.spec.ts` precedent) — otherwise default Playwright parallel-within-file scheduling.
- Recipient/slug uniqueness via `randomUUID()`-derived values (Phase 11's `db-isolation.spec.ts` precedent) to keep fully-parallel tests collision-free.

### Integration Points
- This phase's specs run in the existing `smoke` Playwright project (public, unauthenticated, no `dependencies: ["setup"]` needed) — OR a new dedicated project if the plan decides redirect specs deserve their own grouping; either is acceptable, follow whichever the planner judges cleaner given the growing spec count.
- CR-07's fix (Phase 11) is directly relevant here: the redirect handler now falls through to the SPA for the app's OWN host (`BASE_URL`) but keeps the branded 404/gate pages for every OTHER host, including the baseline `e2e.kurzly.local` domain this phase's tests target — confirm this phase's specs send requests with the `e2e.kurzly.local` Host header (a REAL registered redirect domain), never `localhost`, so they exercise the actual redirect/password/expiry/OG code paths rather than the CR-07 SPA-fallback branch.

</code_context>

<specifics>
## Specific Ideas

None beyond what's captured above — this phase's behavior is fully specified by the ROADMAP success criteria plus the actual existing redirect-engine source, which planning should read directly rather than re-deriving from research.

</specifics>

<deferred>
## Deferred Ideas

- Full domain-scoped denial-matrix testing at the redirect layer — out of this milestone's scope per REQUIREMENTS.md's Out-of-Scope table (covered by v1.0's integration Denial-Suite).
- QR dynamic-redirect (`/q/:code`) equivalent of this phase's tests — that's Phase 15 (QR Studio E2E)'s job, though it will directly reuse whatever host/fixture patterns this phase establishes.

</deferred>
