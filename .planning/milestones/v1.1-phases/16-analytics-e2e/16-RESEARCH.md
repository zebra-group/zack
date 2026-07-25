# Phase 16: Analytics E2E - Research

**Researched:** 2026-07-25
**Domain:** Playwright E2E proof of a real click-tracking write path (redirect handler → `ClickEvent`/`Link.lifetimeClicks`) surfacing through two authenticated Vue analytics views, against a Fastify/Prisma/PostgreSQL backend
**Confidence:** HIGH — every claim below traces to a direct read of current repo source this session (`routes/redirect.ts`, `lib/analytics.ts`, `routes/analytics.ts`, `AnalyticsView.vue`, `LinkDetailView.vue`, `prisma/schema.prisma`, `apps/e2e/src/{links,db}.ts`, `playwright.config.ts`) — nothing here is inherited from CONTEXT.md's assumptions without independent re-verification.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Reuses Phase 12's redirect-handler infrastructure**: the actual click must be generated via a real HTTP request against the redirect handler (`GET /:slug` on a registered Domain), the same mechanism Phase 12's `redirect-slug-redirect.spec.ts` etc. already exercise — not a direct-Prisma tracking-row insert. Reuse `apps/e2e/src/links.ts`'s `createE2eLink`/`BROWSER_UA`/`BOT_UA` constants and the isbot-classification trap already documented (Phase 12/15 precedent: Playwright's default UA gets bot-classified, must set a real browser UA for a "real click" to register as one).
- **Reuses Phase 14's link fixture pattern**: a Link must exist (with tracking enabled or disabled) before a redirect click can be tracked against it.
- **Tracking-off must be a genuinely settable state** on the Link (per Phase 14 research: `trackingEnabled` field, confirmed already wired in `LinkFormModal.vue`/`LinkDetailView.vue` per Phase 14 investigation) — confirm the actual DB/route mechanics during phase research, do not assume the field name/semantics without re-verifying against current source.
- **Per-link analytics view vs. global overview**: two distinct UI surfaces to identify and read directly during research — the per-link click list/chart (ANALYTICS-E2E-01/02) and a cross-link rollup view (ANALYTICS-E2E-03, likely a dashboard/overview page aggregating multiple links' click counts).

### Claude's Discretion

- Exact tracking-event schema/table name (`ClickEvent`? `Analytics`? confirm via Prisma schema during research) and what fields are asserted (timestamp, referrer, UA-derived device/browser, geo — whatever the actual schema stores, do not invent fields).
- Whether "cross-link rollup" (ANALYTICS-E2E-03) is tested by generating clicks against 2+ real links via the redirect handler and checking the aggregate view sums them correctly, or whether seeding some clicks via Prisma is acceptable for the OTHER links (not the one link whose real click is required by ANALYTICS-E2E-01) to keep the test bounded — planner's call once the actual overview UI/query is understood.
- Spec file layout under `apps/e2e/tests/` — likely `tests/authed/` for the analytics VIEWING half (requires authenticated dashboard) but the CLICK-GENERATING half may need to hit the redirect handler unauthenticated (mirroring Phase 12's `tests/smoke/` pattern) — planner/researcher's call on whether one spec file can straddle both via `test.use()` overrides, or whether it needs two coordinated specs.

### Deferred Ideas (OUT OF SCOPE)

- Team/domain-scoped authorization on analytics views — Phase 17's job.
- Exhaustive analytics dimension coverage (device/browser/geo breakdowns beyond a basic click-count proof) — out of scope per this milestone's REQUIREMENTS.md Out-of-Scope table: "Analytics-Parsing-Edge-Cases (UA-/Referrer-Parsing, GeoIP-Grenzfälle) — reine Datentransformationslogik ohne Browser-Interaktionskomponente, gehört in Unit-Tests der Parser." This phase proves the pipeline works end-to-end, not exhaustive analytics-dimension correctness.
</user_constraints>

## Summary

This phase writes zero new application code — the entire click-tracking pipeline (`routes/redirect.ts`'s `recordClickHook`, `lib/analytics.ts`'s `getLinkAnalytics`/`getGlobalAnalytics`, `routes/analytics.ts`) already exists and is already unit/integration-tested (Phase 6). Phase 16's job is to re-prove three already-correct guarantees through the real network stack + real browser dashboard, exactly the same "re-proof of existing logic, not new logic discovery" shape as Phase 12.

**The single highest-risk unknown flagged in this phase's brief — is the tracking write synchronous or fire-and-forget? — is now resolved with certainty by reading `routes/redirect.ts` directly: it is fully `await`ed, not fire-and-forget.** The `GET /:slug` handler calls `await recordClickHook({...})` (line 349) and only returns the `302` response (line 379) after that `await` resolves. Inside `recordClickHook`, the `ClickEvent` insert and the `Link.lifetimeClicks` increment are batched into a single `prisma.$transaction([...])` that is itself awaited before the function returns. **By the time Playwright's HTTP response promise resolves, the `ClickEvent` row and the incremented `lifetimeClicks` counter are already committed to Postgres.** There is no polling/retry/wait-for-async-write pattern needed for the backend side of this phase. (A try/catch around the transaction swallows genuine DB errors so a tracking hiccup never breaks the redirect hot path — but this is an error-handling safety net, not a race condition; it does not reintroduce a timing risk for the test.)

The one **genuine timing consideration that DOES exist** is entirely on the frontend read side, not the backend write side: `LinkDetailView.vue`'s `loadAnalytics()` (which calls `GET /api/links/:id/analytics`) fires exactly once, inside `load()`, on route entry (component mount) — there is no polling, no `watch`, no auto-refresh. A test that generates a real click via HTTP and then asserts on an **already-mounted** `LinkDetailView.vue` page will see stale data (the click landed in the DB correctly, but the already-fetched `analytics` ref was never re-fetched). **The test must trigger a fresh `GET /api/links/:id/analytics` call after the click — via `page.goto()` (fresh navigation) or `page.reload()` — not assert against a page that was already open when the click fired.** `AnalyticsView.vue` (the global overview) has the identical one-shot `load()`-on-mount shape, so the same discipline applies there.

Three other structural facts, all confirmed by direct source reads:

1. **The tracking table is `ClickEvent`** (`prisma/schema.prisma`), not `Analytics` or anything else. Fields: `id`, `linkId`, `createdAt`, `country: String?`, `referrerHost: String?`, `visitorHash: String` (SHA-256-derived, non-reversible, no raw IP ever persisted), `source: ScanSource` (`"link" | "qr"`, default `"link"`). No PII beyond a coarse country and a daily-rotating-salted visitor hash — exactly matching Kurzly's "privacy-friendly, no third-party tracking" core value.
2. **`trackingEnabled` is confirmed, current, and structurally guards the write**: `recordClickHook`'s very first line is `if (!link.trackingEnabled) return;` — BEFORE any Prisma call. A tracking-off link produces a *structural* zero-rows guarantee (the code comment literally calls this out: "TRACK-02: structural guard, no Prisma call below this line when off"), not a display-time filter. `apps/e2e/src/links.ts`'s `createE2eLink` fixture already accepts a `trackingEnabled?: boolean` option, and `LinkDetailView.vue`'s real `.toggle` UI element (`role="switch"`, `@click="toggleTracking"`) PATCHes `trackingEnabled` through `updateLink` — both a fixture-level and a real-UI-level path exist for ANALYTICS-E2E-02.
3. **The global cross-link rollup is a server-side SQL aggregation, not a frontend sum-of-per-link-responses.** `getGlobalAnalytics(prisma, domainIds)` (`lib/analytics.ts`) issues its own raw-SQL `GROUP BY`/`COUNT`/`JOIN` queries scoped to `domainId IN (...)` directly against `ClickEvent`/`Link` — `AnalyticsView.vue` calls exactly one endpoint (`GET /api/analytics`) and renders the DTO verbatim. This resolves CONTEXT.md's open discretion point: the "rollup" logic under test lives entirely in `lib/analytics.ts`'s SQL, not in any client-side reduce/sum — proving it correctly requires clicks to exist across ≥2 real Links scoped to the same domain, which the real-redirect-click mechanism (cheap, a second `request.get()` call) can produce directly with no extra UI cost.

**Primary recommendation:** Generate every click this phase needs via real HTTP against the redirect handler (mirroring Phase 12's `fetchWithFixtureRaceRetry` + `BROWSER_UA` + `Host: e2e.kurzly.local` pattern exactly) — for ANALYTICS-E2E-03's multi-link rollup, this is cheap enough (two or three extra `request.get()` calls) that there is no need to fall back to CONTEXT.md's "seed via Prisma for the OTHER links" discretion allowance; real HTTP for every contributing click keeps the whole phase's proof uniformly strong.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Click-event write (`ClickEvent` insert + `lifetimeClicks` increment) | API/Backend (`recordClickHook`, `routes/redirect.ts`) | Database/Storage (`$transaction`) | Pure server-side, awaited, atomic; the E2E test only supplies the real HTTP request that triggers it — no client-side tracking logic exists (no beacon/pixel, by design — server already knows the click happened). |
| Tracking-off enforcement | API/Backend (`recordClickHook`'s early-return guard) | — | Structural: the guard runs before any Prisma call. The `.toggle` UI element only flips the `Link.trackingEnabled` column via the existing `updateLink` write path (Phase 14's D-01 sole write path) — it does not independently gate anything. |
| Per-link analytics read (`totalClicks`, 30-day series, top referrers/countries) | API/Backend (`getLinkAnalytics`, `routes/analytics.ts`) | Browser/Client (`LinkDetailView.vue`'s one-shot `loadAnalytics()`) | `totalClicks` is read from the pruning-resistant `Link.lifetimeClicks` counter, never a live `COUNT(ClickEvent)` — the view is a thin renderer of an already-aggregated DTO; the ONE client-side timing concern (mount-once fetch, no polling) lives here. |
| Global/cross-link analytics read + rollup | API/Backend (`getGlobalAnalytics`, `routes/analytics.ts`) | Browser/Client (`AnalyticsView.vue`'s one-shot `load()`) | All aggregation (`clicks30Days`, `uniqueVisitors`, `topLinks`, `topReferrers`) happens in raw parameterized SQL scoped to `scopedDomainIds` — the Vue view performs zero client-side summation across links. |
| Test fixture seeding (Link rows, tracking-state) | Database/Storage (`apps/e2e/src/links.ts`'s `createE2eLink`, direct Prisma) | — | Reused verbatim from Phase 12/14 — the one deliberate "talk directly to Postgres" exception this whole E2E suite already documents and justifies. |
| Click generation (the phase's actual subject) | Client/Test Harness (Playwright `request` fixture, real HTTP `GET /:slug`) | — | Per CONTEXT.md's locked decision: MUST be a real HTTP hit against the redirect handler, never a direct `ClickEvent` insert — this is the one thing this phase's tests are actually proving. |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANALYTICS-E2E-01 | A real redirect-handler click — generated by hitting the public endpoint, not by seeding a DB row — appears in the per-link analytics view | `recordClickHook`'s fully-awaited `$transaction` (no async-write race); `LinkDetailView.vue`'s `.stat-card`/`.stat-value` markup (`Klicks gesamt`) fed by `totalClicks` (`Link.lifetimeClicks`); Pitfall 1 (must re-navigate/reload to see the update) documented below |
| ANALYTICS-E2E-02 | With tracking toggled off, a redirect provably creates no new tracking row (true zero-rows, asserted at the database) | `recordClickHook`'s structural early-return guard (`if (!link.trackingEnabled) return;`, before any Prisma call); `createE2eLink`'s existing `trackingEnabled?: boolean` option AND `LinkDetailView.vue`'s real `.toggle` UI element (both viable mechanisms); direct-Prisma `prisma.clickEvent.count({ where: { linkId } })` as the DB-level zero-rows assertion |
| ANALYTICS-E2E-03 | The global cross-link analytics overview correctly rolls up numbers from multiple links | `getGlobalAnalytics`'s server-side SQL `GROUP BY`/`JOIN` scoped to `domainIds` (not a frontend sum); `AnalyticsView.vue`'s `.stat-card`(`Klicks (30 Tage)`)/`.list-row` (Top Links) markup; real clicks against ≥2 Links on the baseline domain is the recommended fixture shape (see Summary point 3) |

## Standard Stack

No new packages are introduced by this phase — it is pure test-authoring against infrastructure Phase 11/12/14 already built and dependencies already pinned in the workspace lockfile.

| Library | Version (as pinned in this repo) | Purpose | Why no change needed |
|---------|---------|---------|--------------|
| `@playwright/test` | `^1.61.1` (`apps/e2e/package.json`) | Test runner, `APIRequestContext` (click generation), `page` (analytics-view navigation) | Already installed by Phase 11; this phase only authors new spec files. |
| `@kurzly/api/prisma-client` (workspace subpath export) | n/a (workspace) | Direct-Prisma `ClickEvent`/`Link` assertions (ANALYTICS-E2E-02's "asserted at the database" requirement) | Reuse `apps/e2e/src/db.ts`'s `createE2ePrisma()` — do not add a second DB client. |

**Installation:** none required — `pnpm install` at the workspace root already covers everything this phase touches.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new external packages — every capability (real HTTP click generation, DB assertion, real-browser navigation) is covered by already-installed, already-audited dependencies (`@playwright/test`, `@kurzly/api/prisma-client`, `bcryptjs` transitively via `createE2eLink`, all vetted in Phase 11/12's research and STATE.md's `sharp`/Phase 15 precedent for false-positive freshness flags). No legitimacy check was run because there is nothing new to check.

## Architecture Patterns

### System Architecture Diagram

```
Playwright test (chromium-admin project, apps/e2e)
        |
        | 1. createE2eLink(prisma, { slug, targetUrl, trackingEnabled: true/false })
        |    (direct Prisma fixture -- Phase 12/14 reused pattern)
        v
PostgreSQL (Link row, tracking flag set)
        |
        | 2. request.get(`/${slug}`, { headers: { host: BASELINE_DOMAIN_HOSTNAME,
        |                                          "user-agent": BROWSER_UA },
        |                                maxRedirects: 0 })
        |    -- THE PHASE'S ACTUAL SUBJECT: a real HTTP hit, not a DB insert
        v
routes/redirect.ts  GET /:slug
        |
        | resolveActiveDomainByHost -> prisma.link.findUnique
        | isBotRequest(user-agent)? -- BROWSER_UA => false, proceeds
        | resolveLinkState -> "ok" (no password/expiry on the fixture)
        v
await recordClickHook({ prisma, link, ip, userAgent, referer, source: "link" })
        |
        | if (!link.trackingEnabled) return;  <-- TRACK-02 structural zero-rows guard
        |    (ANALYTICS-E2E-02: this line alone is the entire mechanism under test)
        v
await prisma.$transaction([
  clickEvent.create({ linkId, country, referrerHost, visitorHash, source }),
  link.update({ lifetimeClicks: { increment: 1 } }),
])
        |
        | <-- FULLY AWAITED. Both rows are committed BEFORE the next line runs.
        v
reply.code(302).redirect(target)   -- Playwright's response promise resolves
                                       ONLY after the above transaction commits
        |
        | 3. page.goto("/links/:id")  -- FRESH navigation, authenticated
        |    (chromium-admin storageState) -- must NOT reuse an already-mounted page
        v
LinkDetailView.vue  load() -> loadAnalytics() (fires ONCE, on mount)
        |
        | GET /api/links/:id/analytics
        v
routes/analytics.ts -> resolveOwnedLink (IDOR) -> lib/analytics.ts getLinkAnalytics(linkId)
        |
        | totalClicks = Link.lifetimeClicks (pruning-resistant counter, NOT live COUNT)
        | dailySeries = 30-day generate_series LEFT JOIN ClickEvent
        v
.stat-card:has(.stat-label "Klicks gesamt") .stat-value  -- renders totalClicks
        |
        | Playwright asserts this DOM text reflects the incremented count


Cross-link rollup (ANALYTICS-E2E-03), same click-generation mechanism, 2+ Links:

request.get(`/${slugA}`, {...BROWSER_UA})  ---\
request.get(`/${slugB}`, {...BROWSER_UA})  ---+--> both go through the SAME
                                                    recordClickHook path above
        |
        | page.goto("/analytics")  -- fresh navigation, authenticated
        v
AnalyticsView.vue  load() -> GET /api/analytics
        v
routes/analytics.ts -> scopedDomainIds(userId) -> lib/analytics.ts getGlobalAnalytics(domainIds)
        |
        | SERVER-SIDE SQL SUM across ALL Links in domainIds (GROUP BY, JOIN) --
        | NOT a frontend reduce() over per-link responses
        v
.stat-card "Klicks (30 Tage)" / .list-row "Top Links"  -- renders clicks30Days/topLinks
```

A reader can trace ANALYTICS-E2E-01 by following the top path start-to-finish: fixture → real HTTP click → awaited DB transaction → fresh authenticated navigation → rendered stat. ANALYTICS-E2E-02 is the SAME diagram with the early-return guard firing instead of the transaction. ANALYTICS-E2E-03 reuses the identical click-generation step against two Links, then follows the global-overview branch at the bottom.

### Recommended Project Structure

```
apps/e2e/tests/authed/
├── analytics-real-click.spec.ts     # ANALYTICS-E2E-01: real redirect click -> per-link view
├── analytics-tracking-off.spec.ts   # ANALYTICS-E2E-02: tracking off -> zero ClickEvent rows (DB-asserted)
└── analytics-global-rollup.spec.ts  # ANALYTICS-E2E-03: 2+ real clicks across 2 Links -> global overview sums correctly
```

**Placement rationale (resolves CONTEXT.md's open discretion point on spec layout):** all three specs belong under `tests/authed/`, NOT `tests/smoke/`, even though the click-GENERATING half of each test uses the unauthenticated `request` fixture. `playwright.config.ts`'s `chromium-admin`/`chromium-member` projects are hard-wired via `testMatch: /authed\/.*\.spec\.ts$/` — every spec in this phase needs an authenticated `page` to reach `/links/:id` or `/analytics` (both routes have `meta: { requiresAuth: true }`), so the whole file must live under `tests/authed/` regardless of the fact that one step within it hits a public endpoint. This mirrors `qr-dynamic-remap.spec.ts`'s existing precedent exactly: that spec's `request.get('/q/:code', ...)` calls are unauthenticated-shaped requests living inside an authenticated-project spec file, using the SAME `request` fixture Playwright automatically provides per-test (not a separate unauthenticated context) — no `test.use()` override or dual-spec-file split is needed. **One file per behavior is sufficient; no straddling mechanism beyond what `qr-dynamic-remap.spec.ts` already demonstrates is required.**

### Pattern 1: Real click generation — reuse Phase 12's exact fixture/request shape

```typescript
// Source: apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts (Phase 12, reused verbatim)
import { randomUUID } from "node:crypto";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import { createE2eLink, BROWSER_UA, fetchWithFixtureRaceRetry } from "../../src/links.js";

const prisma = createE2ePrisma();
const slug = `analytics-click-${randomUUID()}`;
const link = await createE2eLink(prisma, {
  slug,
  targetUrl: "https://example.com/analytics-target",
  // trackingEnabled omitted -> Prisma column default (true), OR explicitly
  // `trackingEnabled: false` for ANALYTICS-E2E-02.
});

const response = await fetchWithFixtureRaceRetry(
  () => request.get(`/${slug}`, {
    headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
    maxRedirects: 0,
  }),
  (r) => r.status() === 302,
);
expect(response.status()).toBe(302);
// By the time this line runs, ClickEvent + lifetimeClicks are ALREADY committed
// (recordClickHook is fully awaited server-side before the 302 is sent) --
// no polling/wait/retry is needed for the DB write itself.
```

**Why `fetchWithFixtureRaceRetry` still applies here:** the SAME cross-file `db-isolation.spec.ts` truncate race Phase 12 documented (concurrent `TRUNCATE ... "Link" ...` from a sibling spec file under `fullyParallel`) applies identically to this phase's fixtures — reuse the helper rather than re-deriving retry logic.

### Pattern 2: Forcing a fresh analytics read — never assert against an already-mounted page

```typescript
// WRONG (will read stale pre-click data -- loadAnalytics() already resolved on mount):
await page.goto(`/links/${link.id}`); // mounted BEFORE the click
// ... generate click via request.get() ...
await expect(page.locator(".stat-value").first()).toHaveText("1"); // FLAKY/WRONG -- no re-fetch happened

// CORRECT -- generate the click FIRST, THEN navigate (or reload if already mounted):
// ... generate click via request.get() first ...
await page.goto(`/links/${link.id}`); // loadAnalytics() fires fresh, AFTER the click landed
await expect(
  page.locator(".stat-card", { hasText: "Klicks gesamt" }).locator(".stat-value"),
).toHaveText("1");
```

**Scoping the `.stat-value` locator:** `LinkDetailView.vue`'s data-section renders three `.stat-card`s ("Klicks gesamt", "Letzte 7 Tage", "Top Referrer") with an IDENTICAL `.stat-value` class on each — an unscoped `.locator(".stat-value").first()` is fragile if markup order ever changes. Always scope via `.stat-card` + `hasText` on the label, exactly as shown above.

### Pattern 3: DB-level zero-rows assertion for ANALYTICS-E2E-02

```typescript
// Source: apps/e2e/src/db.ts's createE2ePrisma() (Phase 11/12, reused verbatim)
const link = await createE2eLink(prisma, {
  slug,
  targetUrl: "https://example.com/no-tracking",
  trackingEnabled: false,
});
await request.get(`/${slug}`, {
  headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
  maxRedirects: 0,
});
// The redirect itself MUST still succeed (302) -- tracking-off does not
// break the redirect, only the tracking write (recordClickHook's own
// try/catch + early-return discipline).
const rowCount = await prisma.clickEvent.count({ where: { linkId: link.id } });
expect(rowCount).toBe(0); // true zero-rows, DB-asserted -- not a display-time filter
const reloaded = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
expect(reloaded.lifetimeClicks).toBe(0); // the counter itself never incremented either
```

**Two mechanisms available for toggling `trackingEnabled` off — pick one:**
1. **Fixture-level** (shown above): `createE2eLink(prisma, { trackingEnabled: false })` — simplest, and the phase's subject is the redirect handler's write-suppression, not the toggle UI.
2. **Real-UI-level** (stronger proof the mechanism is "genuinely settable" per CONTEXT.md's locked decision): create a Link with tracking ON via the fixture, `page.goto('/links/:id')`, click `.tracking-card .toggle` (real PATCH round-trip via `toggleTracking()`/`updateLink`), THEN generate the real click and assert zero rows. This proves the full toggle-through-UI path, not just the column value. **Recommendation: use the real-UI toggle** — it costs one extra `page.goto` + `click` + `waitForResponse` and directly satisfies CONTEXT.md's "genuinely settable state" language, versus the fixture-only path which only proves the column-level guard (already covered by Phase 6's own integration tests).

### Anti-Patterns to Avoid

- **Asserting analytics data on a page that was open before the click fired:** see Pattern 2 — `loadAnalytics()`/`AnalyticsView.vue`'s `load()` are one-shot, mount-time fetches with no polling. This is the single most important structural fact this research adds beyond CONTEXT.md's assumptions.
- **Using Playwright's default User-Agent for the click-generating request:** identical Pitfall 1 from Phase 12/15 — the default UA is bot-classified by the installed `isbot`, which would route the request to the bot/OG 200 branch, which returns BEFORE `recordClickHook` is ever called (the bot check in `routes/redirect.ts` happens before the state/tracking logic) — the "click" would silently never be tracked, and the redirect itself wouldn't even 302.
- **Testing a click against a password-protected or expired Link without accounting for state precedence:** `recordClickHook` is only reached on the `state === "ok"` branch (after the `bot`/`expired`/`protected` early returns) — a fixture Link for ANALYTICS-E2E-01/03 must have no `password`/`expiresAt` set, or the click will never reach the tracking write at all (a DIFFERENT, already-Phase-12-tested code path, not a bug).
- **Building a polling/wait-for-async-write helper:** unnecessary — the write is fully synchronous relative to the HTTP response (see Summary). Do not add a `waitForClickEventRow`-style retry loop; a single direct-Prisma read immediately after the `302` response resolves is always correct here (contrast with `recordClickHook`'s own try/catch, which only matters for genuine DB-error resilience, not timing).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Click generation | A direct `prisma.clickEvent.create()` fixture "click" | A real `request.get('/:slug', { headers: { host, 'user-agent': BROWSER_UA } })` | CONTEXT.md's own locked decision — this phase's entire point is proving the REAL pipeline, not a substitute. A direct insert would test nothing new versus Phase 6's existing unit tests. |
| Waiting for the tracking write to "settle" | A `waitForClickEventRow`/polling retry helper | Nothing — read directly after the `302` response resolves | The write is fully `await`ed server-side before the response is sent (see Summary) — a wait helper would be solving a race that does not exist, adding complexity and hiding the real timing fact (frontend one-shot-fetch, not backend async-write) that DOES need handling. |
| Cross-link rollup verification | Manually summing each link's `getLinkAnalytics` response client-side in the test to "predict" the global total | Direct-Prisma `prisma.clickEvent.count({ where: { linkId: { in: [...] } } })` scoped to the SAME domain, compared against the rendered `clicks30Days`/`topLinks` DOM values | Matches how `getGlobalAnalytics` itself works (server-side SQL, not a client reduce) — the test's own verification should mirror the production aggregation's actual scope (domain-scoped `ClickEvent` count), not re-implement client-side summation logic that doesn't exist in the app. |
| Bot/UA classification | A custom regex/allowlist for "is this a bot" | Reuse `BOT_UA`/`BROWSER_UA` from `apps/e2e/src/links.ts` (already pinned against the actually-installed `isbot`) | Identical Don't-Hand-Roll guidance already established in 12-RESEARCH.md — no reason to re-derive. |

**Key insight:** This phase needs almost no new fixture infrastructure — `apps/e2e/src/links.ts` (`createE2eLink`, `BROWSER_UA`, `fetchWithFixtureRaceRetry`) and `apps/e2e/src/db.ts` (`createE2ePrisma`, `BASELINE_DOMAIN_HOSTNAME`, and `ClickEvent` already present in `withResetDbLock`'s truncate list) already cover every need. Zero new `apps/e2e/src/*.ts` helper files are anticipated.

## Runtime State Inventory

Not applicable — this is a greenfield test-authoring phase (new Playwright spec files only), not a rename/refactor/migration. No existing runtime state, stored data, or registered OS/service state is being renamed or moved.

## Common Pitfalls

### Pitfall 1: Analytics views fetch once on mount — no polling, no reactivity to a click that happens after the page is already open
**What goes wrong:** A test that opens `/links/:id` (or `/analytics`) BEFORE generating the real click, then asserts the click count updated in-place without a reload/re-navigation, will see stale data and fail (or silently pass on a `0` it never meant to assert against).
**Why it happens:** `LinkDetailView.vue`'s `load()` calls `loadAnalytics()` exactly once, inside the `async function load()` invoked at the bottom of the `<script setup>` block (component mount) — there is no `setInterval`, no `watch` on a route param re-triggering it after initial mount, no WebSocket/SSE push. `AnalyticsView.vue`'s `load()` is the identical one-shot shape.
**How to avoid:** Always generate the click(s) FIRST, then `page.goto()` (fresh navigation) to the analytics view. If the test needs to assert a page that's already open, use `page.reload()` before asserting, not `page.waitForTimeout()`.
**Warning signs:** A test that intermittently reads `0` where `1` was expected, or that only passes when steps happen to execute in a lucky order.

### Pitfall 2: A "click" against a gated/expired Link never reaches the tracking write at all
**What goes wrong:** Building the ANALYTICS-E2E-01/03 fixture Link with a `password` or `expiresAt` set (e.g. copy-pasting from a Phase 12 password-gate fixture) means the redirect handler returns at the `protected`/`expired` branch, BEFORE `recordClickHook` is ever called — the test would see a 200 (password page) or 410 (expired), never a 302, and zero `ClickEvent` rows would be created for a completely different, already-correct reason (D-14 precedence, not a tracking bug).
**Why it happens:** `routes/redirect.ts`'s `GET /:slug` handler checks `bot` → `expired` → `protected` → (only then) `state === "ok"` → `recordClickHook`. Tracking is the LAST step in the chain, not an independent hook fired unconditionally on every request.
**How to avoid:** Fixture Links for this phase's specs must have no `password`/`expiresAt` set (the `createE2eLink` defaults — simply omit those options).
**Warning signs:** A test asserting `expect(response.status()).toBe(302)` fails with `200` or `410` instead — that's this pitfall, not a tracking regression.

### Pitfall 3: Bot-classified requests never reach `recordClickHook` either
**What goes wrong:** Same class of bug as Pitfall 2 — if the click-generating request omits an explicit `user-agent: BROWSER_UA` header, Playwright's default UA is bot-classified by the installed `isbot`, and the redirect handler's `if (bot)` branch returns the OG-page 200 response BEFORE `recordClickHook` runs at all.
**Why it happens:** Identical root cause to 12-RESEARCH.md's Pitfall 1 (Phase 12) and 15-RESEARCH.md's documented Rule-1 fix (Phase 15) — Playwright's own default `User-Agent` contains `Playwright/<version>`, which the actually-installed `isbot@5.2.0` flags as a bot.
**How to avoid:** Every click-generating request in this phase MUST explicitly set `headers: { "user-agent": BROWSER_UA }` (imported from `apps/e2e/src/links.ts`), exactly as every prior phase's redirect/QR specs already do.
**Warning signs:** A "real click" test whose redirect response unexpectedly contains OG meta tags / is a 200 instead of a 302.

### Pitfall 4: `.stat-value` class collision within a single `LinkDetailView.vue` render
**What goes wrong:** `LinkDetailView.vue`'s data section renders THREE `.stat-card > .stat-value` pairs ("Klicks gesamt", "Letzte 7 Tage", "Top Referrer") — an unscoped `page.locator('.stat-value').first()` locator is fragile to markup-order changes and doesn't self-document which metric it's asserting.
**Why it happens:** No `data-testid` exists anywhere in `apps/web/src` (confirmed Phase 14/15 precedent, re-confirmed this session for `LinkDetailView.vue`/`AnalyticsView.vue`) — every stat card shares the same two CSS classes (`.stat-card`, `.stat-value`), distinguished only by an adjacent `.stat-label` text node.
**How to avoid:** Always scope via `page.locator('.stat-card', { hasText: 'Klicks gesamt' }).locator('.stat-value')` (see Pattern 2) — never a bare `.stat-value` locator with a positional `.first()`/`.nth()`.
**Warning signs:** A test that passes today but silently starts asserting the wrong metric after an unrelated markup reorder.

## Code Examples

### `recordClickHook` — the fully-awaited write this phase's tests rely on (no race)
```typescript
// Source: apps/api/src/routes/redirect.ts (read directly, current source)
export async function recordClickHook(ctx: {
  prisma: PrismaClient; link: Link; ip: string;
  userAgent: string | undefined; referer: string | undefined;
  log: FastifyBaseLogger; source: ScanSource;
}): Promise<void> {
  const { prisma, link, ip, userAgent, referer, log, source } = ctx;
  if (!link.trackingEnabled) return; // TRACK-02: structural guard, zero Prisma calls below when off.
  try {
    const country = await getCountryForIp(ip);
    const referrerHost = normalizeReferrer(referer);
    const salt = await resolveDailySalt(prisma);
    const visitorHash = computeVisitorHash(salt, ip, userAgent ?? "", link.id);
    await prisma.$transaction([
      prisma.clickEvent.create({ data: { linkId: link.id, country, referrerHost, visitorHash, source } }),
      prisma.link.update({ where: { id: link.id }, data: { lifetimeClicks: { increment: 1 } } }),
    ]);
  } catch (err) {
    log?.warn({ err, linkId: link.id }, "recordClickHook: tracking write failed, swallowed");
  }
}
// Caller (same file): `await recordClickHook({...})` runs BEFORE
// `return reply.code(302).redirect(target)` -- the HTTP response cannot be
// sent until this await resolves, which is exactly what makes the write
// synchronous from the test's perspective.
```

### `getLinkAnalytics`'s `totalClicks` source — never a live COUNT
```typescript
// Source: apps/api/src/lib/analytics.ts (read directly, current source)
const link = await prisma.link.findUnique({ where: { id: linkId }, select: { lifetimeClicks: true } });
const totalClicks = link?.lifetimeClicks ?? 0;
```
A test asserting the per-link view's "Klicks gesamt" tile is really asserting this `lifetimeClicks` counter, incremented atomically inside the SAME `$transaction` as the `ClickEvent` insert — the two can never drift.

### DB-level zero-rows assertion (ANALYTICS-E2E-02)
```typescript
// Source: apps/e2e/src/db.ts's createE2ePrisma() (Phase 11/12, reused verbatim)
const rowCount = await prisma.clickEvent.count({ where: { linkId: link.id } });
expect(rowCount).toBe(0);
```

### `ClickEvent` Prisma model — exact fields available to assert
```prisma
// Source: apps/api/prisma/schema.prisma (read directly, current source)
model ClickEvent {
  id           String     @id @default(cuid())
  linkId       String
  createdAt    DateTime   @default(now())
  country      String?
  referrerHost String?
  visitorHash  String
  source       ScanSource @default(link)

  link Link @relation(fields: [linkId], references: [id], onDelete: Cascade)

  @@index([linkId])
  @@index([createdAt])
  @@index([source])
}
```
No raw IP address field exists anywhere on this model (privacy-by-design) — do not write a test asserting an IP value; `country`/`referrerHost`/`visitorHash` are the only per-visit dimensions, and per REQUIREMENTS.md's Out-of-Scope table, exhaustive correctness of THEIR derivation (UA/referrer parsing, GeoIP edge cases) is explicitly out of scope for this phase — only the row's existence/absence and the `totalClicks`/`clicks30Days` counters need asserting.

## State of the Art

Not applicable in the "old vs. new approach" sense — this phase re-proves existing, already-shipped Phase 6 logic at the E2E layer, not a library/pattern upgrade. The one CONTEXT.md assumption this research corrects (not "state of the art" but worth flagging identically to Phase 14's precedent):

| CONTEXT.md's phrasing | Confirmed reality this session | Impact |
|------------------------|-------------------------------|--------|
| "the actual click must be generated via a real HTTP request... matters for test correctness (a bot-UA request must NOT create a tracking row, or the test needs to account for that)" | Confirmed: a bot-classified request returns at the `if (bot)` branch, BEFORE `recordClickHook` is ever reached — it's not merely "excluded from tracking", the tracking function is never invoked at all for a bot request | Test authors must use `BROWSER_UA` for every click-generating request in this phase, exactly as Phase 12/15 already established — no new handling needed beyond that existing discipline |
| "determine what npm-free technique (if any) is needed to wait for the async tracking write to complete" | Resolved: the write is NOT async/fire-and-forget relative to the HTTP response — it is fully `await`ed before the `302` is sent. No wait/poll technique of any kind is needed for the backend write. | The only genuine wait/retry concern in this phase is on the FRONTEND read side (Pitfall 1: one-shot mount fetch), not the backend write side — this reframes where the phase's actual risk lives |

**Deprecated/outdated:** none.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The real-UI tracking-toggle path (clicking `.tracking-card .toggle` then generating a click) is the recommended mechanism for ANALYTICS-E2E-02 over the fixture-only `trackingEnabled: false` path | Pattern 3 | Low — both mechanisms are already confirmed to exist and work identically at the DB-guard level (the toggle only PATCHes the same `trackingEnabled` column `createE2eLink` sets directly); this is a "which is the stronger test" judgment call, not an unverified technical claim. The planner/executor can freely choose the fixture-only path if the real-UI toggle proves awkward to sequence, with no loss of correctness — only a slightly weaker "genuinely settable" proof. |
| A2 | Two real HTTP clicks against two different Links (rather than one real + Prisma-seeded others) is sufficient and preferable for ANALYTICS-E2E-03's rollup proof | Summary point 3, Recommended Project Structure | Low — this is a cost/thoroughness tradeoff recommendation, not a claim about how the code behaves; CONTEXT.md's own discretion note explicitly permits a Prisma-seeded fallback if the planner judges the all-real approach too test-heavy. |

**If this table is empty:** N/A — the two entries above are low-risk test-design recommendations, not unverified factual claims. Every claim about code behavior (recordClickHook's await chain, trackingEnabled's guard, getGlobalAnalytics's server-side SQL, the ClickEvent schema, the one-shot mount-fetch views) was verified by direct source reads this session.

## Open Questions

1. **Should ANALYTICS-E2E-02 use the fixture-level `trackingEnabled: false` or the real-UI `.toggle` click path?**
   - What we know: both mechanisms write to the identical `Link.trackingEnabled` column that `recordClickHook`'s guard reads; both are equally valid at the DB-correctness level.
   - What's unclear: only a test-design preference, not a code-behavior gap — see Assumption A1.
   - Recommendation: use the real-UI toggle (stronger proof of CONTEXT.md's "genuinely settable state" language) unless the planner finds it adds meaningful spec complexity, in which case the fixture-only path is an equally correct fallback.

2. **Does ANALYTICS-E2E-03 need clicks on Links across the SAME domain, or would a second Domain add value?**
   - What we know: `getGlobalAnalytics` scopes strictly to `scopedDomainIds(userId)` — the baseline E2E seed has exactly one Domain (`e2e.kurzly.local`), and this milestone's Deferred Ideas explicitly exclude cross-domain/multi-team authorization testing (Phase 17's job).
   - What's unclear: nothing structurally — a second Domain would add setup cost with zero incremental proof value for THIS phase's rollup-correctness goal (the rollup logic doesn't care how many domains contribute, only that `domainId IN (...)` scoping is correct, which is already Phase 9's tested territory).
   - Recommendation: use 2 (or 3) Links on the single baseline domain — matches CONTEXT.md's Deferred Ideas boundary exactly.

## Environment Availability

Not applicable — this phase adds no new external dependency (no new npm package, no new Docker service, no new tool, no email/SMTP dependency). It reuses the entire Phase 11–15 E2E harness (compose stack, published `:5433` Postgres) as-is; Mailpit is not needed since no email flow is involved in this phase.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` 1.61.1 |
| Config file | `apps/e2e/playwright.config.ts` |
| Quick run command | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/analytics-real-click.spec.ts --project=chromium-admin` (adjust filename once the planner finalizes spec names) |
| Full suite command | `./scripts/e2e-compose.sh` (boots the compose stack, runs `pnpm --filter @kurzly/e2e test`, always tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ANALYTICS-E2E-01 | Real HTTP click (BROWSER_UA, no gates) -> ClickEvent row + lifetimeClicks increment (awaited, no race) -> fresh navigation to `/links/:id` -> `.stat-card "Klicks gesamt"` reflects the new count | e2e (real HTTP + real authenticated browser navigation) | `playwright test tests/authed/analytics-real-click.spec.ts --project=chromium-admin` | ❌ Wave 0 |
| ANALYTICS-E2E-02 | `trackingEnabled` off (fixture or real `.toggle` UI) -> real HTTP click still 302s -> `prisma.clickEvent.count` is exactly 0, `Link.lifetimeClicks` unchanged | e2e (real HTTP + direct-Prisma DB assertion) | `playwright test tests/authed/analytics-tracking-off.spec.ts --project=chromium-admin` | ❌ Wave 0 |
| ANALYTICS-E2E-03 | 2+ real HTTP clicks across 2 Links on the baseline domain -> fresh navigation to `/analytics` -> `clicks30Days`/`topLinks` correctly reflect the sum, server-side-aggregated | e2e (real HTTP + real authenticated browser navigation) | `playwright test tests/authed/analytics-global-rollup.spec.ts --project=chromium-admin` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted spec file only, against a running local compose stack (e.g. `playwright test tests/authed/analytics-real-click.spec.ts --project=chromium-admin`).
- **Per wave merge:** full `tests/authed/` directory at the CI's configured parallelism, to catch any new cross-file `db-isolation.spec.ts`/`ClickEvent`-truncate race this phase's specs introduce (mirrors Phase 12/14/15's own discipline — `ClickEvent` is already in `withResetDbLock`'s truncate list, so no new isolation code is needed, only awareness that the SAME race documented for `Link` applies here).
- **Phase gate:** full E2E suite (`./scripts/e2e-compose.sh`) green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/e2e/tests/authed/analytics-real-click.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/analytics-tracking-off.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/analytics-global-rollup.spec.ts` — does not exist yet.
- [ ] No new `apps/e2e/src/*.ts` fixture helper needed — `createE2eLink`, `BROWSER_UA`, `fetchWithFixtureRaceRetry`, `createE2ePrisma`, `BASELINE_DOMAIN_HOSTNAME` (all existing) cover every fixture/assertion need this phase has.
- [ ] No `apps/api/src` or `apps/web/src` production-code changes are anticipated — this phase is test-authoring only, confirmed by full reads of `routes/redirect.ts`, `lib/analytics.ts`, `routes/analytics.ts`, `AnalyticsView.vue`, `LinkDetailView.vue` this session.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | Yes (indirect) | Specs run under the existing `chromium-admin` `storageState` fixture (Phase 11) for the analytics-VIEWING half; the click-GENERATING half hits the intentionally-public, unauthenticated redirect endpoint (unchanged from Phase 12's scope). |
| V3 Session Management | No (unchanged) | This phase adds no session-management code. |
| V4 Access Control | Yes (existing, tested incidentally) | `resolveOwnedLink`'s IDOR guard (`routes/analytics.ts`, identical shape to `routes/links.ts`) and `scopedDomainIds` are exercised naturally by every analytics call this phase's specs make — full member-role-scoped visibility enforcement is explicitly deferred to Phase 9/17 (already documented in `routes/analytics.ts`'s own header comment, T-06-GLOBALSCOPE), not this phase's job. |
| V5 Input Validation | N/A | No new user input surface — this phase reads existing, already-validated Link fixtures and asserts on already-computed DTOs. |
| V6 Cryptography | Yes (existing, not re-tested) | `visitorHash` is a non-reversible, daily-salted derivation (`computeVisitorHash`/`resolveDailySalt`) — already implemented and out of this phase's re-test scope (exhaustive hash-derivation correctness is a unit-test concern, per REQUIREMENTS.md's Out-of-Scope table on analytics-parsing edge cases). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant analytics leakage (a caller seeing another domain's click data) | Information Disclosure | `scopedDomainIds`/`resolveOwnedLink` already enforce domain scoping server-side — this phase's specs exercise the happy path only; the full denial matrix is explicitly Phase 17's job (AUTHZ-E2E-01 names "Analytics" as one of its three representative resource types). |
| Raw IP/PII persistence in click logs | Information Disclosure | `ClickEvent` structurally has no IP column — only a derived `visitorHash` and coarse `country` — already implemented, this phase's assertions should never expect/assert a raw IP anywhere. |
| SQL injection via raw `$queryRaw` analytics queries | Tampering | Every query in `lib/analytics.ts` uses parameterized `Prisma.sql`/`Prisma.join` tagged templates, never `$queryRawUnsafe` with string interpolation — already implemented (T-06-SQLI), not modified by this phase. |

## Sources

### Primary (HIGH confidence — direct repo source read in this session)
- `apps/api/src/routes/redirect.ts` — full read, this session (click-tracking hook, state precedence, bot branch)
- `apps/api/src/lib/analytics.ts` — full read, this session (`getLinkAnalytics`, `getGlobalAnalytics`)
- `apps/api/src/routes/analytics.ts` — full read, this session (IDOR guard, domain scoping)
- `apps/api/prisma/schema.prisma` — targeted read, this session (`Link.trackingEnabled`/`lifetimeClicks`, `ClickEvent` model)
- `apps/web/src/views/AnalyticsView.vue` — full read, this session (global overview, one-shot `load()`)
- `apps/web/src/views/LinkDetailView.vue` — full read (script + template), this session (per-link analytics surface, `.toggle`, `.stat-card` markup, one-shot `loadAnalytics()`)
- `apps/web/src/api.ts` — targeted read, this session (`getLinkAnalytics`/`getGlobalAnalytics` client functions)
- `apps/web/src/router/index.ts` — targeted read, this session (`/links/:id`, `/analytics` route names/paths)
- `apps/e2e/src/links.ts`, `apps/e2e/src/db.ts` — full reads, this session (`createE2eLink`'s `trackingEnabled` option, `BROWSER_UA`, `fetchWithFixtureRaceRetry`, `ClickEvent` already in `withResetDbLock`'s truncate list)
- `apps/e2e/playwright.config.ts` — full read, this session (`testMatch` project routing)
- `apps/e2e/tests/smoke/redirect-slug-redirect.spec.ts` — full read, this session (reference click-generation pattern)
- `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts` — full read, this session (precedent for an authed-project spec straddling an unauthenticated `request` call and an authenticated `page` navigation in one file)
- `.planning/phases/12-redirect-handler-e2e-core-value/12-RESEARCH.md`, `.planning/phases/14-links-csv-import-e2e/14-RESEARCH.md` — read for RESEARCH.md structural/style precedent and reusable fixture vocabulary
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/16-analytics-e2e/16-CONTEXT.md` — read for phase scope/requirements/decisions

### Secondary (MEDIUM confidence)
- None this pass — every claim in this document traces to a direct source read above.

### Tertiary (LOW confidence)
- None this pass.

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new dependency, everything already pinned/installed and read directly.
- Architecture: HIGH — every route/component/schema field read in full this session; the phase brief's single highest-risk unknown (synchronous vs. fire-and-forget tracking write) is now closed with certainty (fully awaited), not assumption.
- Pitfalls: HIGH — every pitfall traces to specific code read this session (one-shot mount fetch, state-precedence ordering, isbot UA classification), not generic Playwright folklore.

**Research date:** 2026-07-25
**Valid until:** 30 days (stable, code-verified; revisit only if `routes/redirect.ts`/`lib/analytics.ts`/`routes/analytics.ts`/`AnalyticsView.vue`/`LinkDetailView.vue` change before planning completes)
