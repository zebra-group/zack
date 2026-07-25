# Phase 12: Redirect Handler E2E (Core Value) - Research

**Researched:** 2026-07-24
**Domain:** Playwright E2E testing of a Fastify public redirect handler (host-scoped resolution, password gate, expiry, bot/OG branching, UTM/query merge) against a built Docker image
**Confidence:** HIGH for all real-source-verified claims (redirect handler behavior, UTM ordering, bot UA matching); MEDIUM for Playwright Host-header behavior (verified against Playwright's own source on GitHub, not executed in this repo); LOW/flagged for outbound network reachability from the compose stack (genuinely unverifiable without a live run — see Assumptions Log)

## Summary

This phase writes zero new application code — the entire redirect engine (`routes/redirect.ts`, `lib/redirectEngine.ts`, `lib/botDetection.ts`, `lib/publicHtml.ts`, `lib/unlockCookie.ts`) already exists and is already proven correct at the `fastify.inject` integration level by `apps/api/test/redirect.integration.test.ts`. Phase 12's job is purely to re-prove the same five guarantees through the real network stack, against the real built Docker image, from Playwright's `apps/e2e` workspace — the one thing `fastify.inject` structurally cannot prove (no real TCP, no real cookie jar, no real multi-domain Host resolution over the wire).

Every question this research was asked to resolve had a concrete, verifiable answer sitting directly in the repo's own source or its own prior integration test, rather than requiring net-new design decisions:

- The exact bot vs. human User-Agent strings to pin are already battle-tested constants in `apps/api/test/redirect.integration.test.ts` (`BOT_UA`, `BROWSER_UA`) — confirmed against the actually-installed `isbot@5.2.0` in this session (not merely assumed).
- The exact canonical UTM query-string ordering (`utm_source`, `utm_medium`, `utm_campaign`, in that order, target-wins-then-append) is directly asserted in that same integration test (`?utm_source=newsletter&utm_medium=email&utm_campaign=fall`) and traced to `applyUtmParams`'s explicit delete-then-set ordering in `lib/redirectEngine.ts`.
- **`createLink`/`updateLink` are NOT importable from `apps/e2e` — confirmed by directly reading `apps/api/package.json`'s `exports` map, which declares exactly two entries: `"."` (→ `./dist/server.js`, the built server entrypoint) and `"./prisma-client"` (→ `./src/generated/prisma/client.ts`). There is no subpath exposing `lib/links.ts`.** Node's package-exports enforcement blocks any import path outside the declared map (e.g. `@kurzly/api/lib/links.js` would fail to resolve), so CONTEXT.md's own pre-approved fallback — a raw `prisma.link.create` scoped to this phase's own spec files, using the baseline seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` user's id as `createdBy` — is the answer to Q2 below, not merely a contingency. This is a definitively resolved finding, not an open question.
- Playwright's own `fetch.ts` source (server-side implementation backing `APIRequestContext`) shows it only rewrites the `host` header on a redirect **to the new redirect target's host** — it never strips or forbids a caller-supplied `host` header on the *initial* request, unlike a browser's Fetch API forbidden-header list. This is strong evidence the Host-header approach works, but CONTEXT.md's own mandate for an empirical Wave-0 spike stands: this is read-only evidence from Playwright's GitHub source, not an execution proof against Fastify in this repo.
- A previously-undocumented pitfall was discovered and empirically verified in this session: Playwright's own default `User-Agent` (when a test doesn't explicitly override it) contains the literal substring `Playwright/<version>`, and `isbot@5.2.0` (the version actually installed in this repo) flags any User-Agent containing that substring as a bot — exactly mirroring the codebase's own already-documented `lightMyRequest` trap for `fastify.inject`. Every "human visitor" `APIRequestContext` call in this phase's specs (REDIRECT-E2E-01, 03, 05, and the browser-UA half of 04) **must** explicitly set `BROWSER_UA`, never rely on Playwright's default.

**Primary recommendation:** Reuse `apps/api/test/redirect.integration.test.ts`'s fixture and assertion vocabulary (`CANARY_TARGET`, `assertNoLeak`, `BOT_UA`/`BROWSER_UA`, the exact UTM ordering string) verbatim in the E2E layer instead of re-deriving them — this phase is a network-transport-fidelity re-proof of already-correct logic, not new logic discovery.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Host → Domain → Link resolution | API/Backend (`resolveActiveDomainByHost`, `domainResolution.ts`) | — | Pure server-side DB lookup keyed on the incoming `Host` header; no client-side logic |
| Redirect-state precedence (expired/protected/ok) | API/Backend (`resolveLinkState`, `redirectEngine.ts`) | — | Pure function, zero HTTP/DB awareness, composed by the route layer |
| Password gate rendering + verification | API/Backend (`renderPasswordPage`, `POST /:slug/verify`) | Browser/Client (form submission, cookie jar) | Server renders/validates; the E2E test's `page` fixture is the ONLY place a real browser cookie jar matters (CONTEXT.md's decision to use `page` not `request` here) |
| Bot/OG branching | API/Backend (`isBotRequest`, `renderBotOgPage`) | — | Header-driven server branch; the E2E test only supplies the `User-Agent` header, no client logic |
| UTM/query merge | API/Backend (`applyUtmParams`, `mergeQuery`) | — | Pure functions; E2E only asserts the final `Location` header string |
| Test fixture seeding (Link rows) | Database/Storage (`apps/e2e/src/db.ts` + `@kurzly/api`'s `createLink`) | — | E2E process talks directly to Postgres via the reused Prisma client — the ONE deliberate exception to "test only through HTTP" this phase's CONTEXT.md already documents and justifies (mirrors Phase 11) |
| Test assertion / orchestration | Client/Test Harness (`apps/e2e`, Playwright `APIRequestContext` + `page`) | — | Not a production tier — the Playwright process itself, running on the host, talking to the built image over real HTTP |

**Why this matters for planning:** every capability this phase exercises already lives correctly in the API/Backend tier (Phase 5/6/7/8 built and unit/integration-tested it). No task in this phase's plan should touch `apps/api/src` production code — a plan that proposes modifying `redirect.ts`/`redirectEngine.ts`/`botDetection.ts`/`publicHtml.ts`/`unlockCookie.ts` is out of scope for this phase and is a signal something is being mis-scoped (the one narrow exception: if the Host-header spike in Q1 below fails, see its documented fallback).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REDIRECT-E2E-01 | Happy-path redirect: 3xx + exact `Location` header via `APIRequestContext` with `maxRedirects: 0` | `routes/redirect.ts`'s `GET /:slug` handler (302 + exact `link.targetUrl` after UTM/query composition) is fully read and quoted below; `redirect.integration.test.ts`'s REDIR-01 test is the exact assertion shape to mirror over real HTTP |
| REDIRECT-E2E-02 | Password gate — wrong/correct password, no-leak | `unlockCookie.ts` (self-invalidating cookie mechanics), `publicHtml.ts`'s `renderPasswordPage` (no `target` field, structural no-leak), and the integration test's three password-gate cases (GET shows page, POST-wrong re-shows LOCKED error, POST-correct issues cookie + 302) are the exact flow to reproduce via `page` |
| REDIRECT-E2E-03 | Expiry 410, distinct from 404, no leak | `resolveLinkState`'s D-14 precedence (expiry checked FIRST, unconditionally) fully quoted below; `renderExpiredPage` has no `target` field |
| REDIRECT-E2E-04 | Bot vs. human UA branching, bot never leaks target, still respects gates | `botDetection.ts`'s `isBotRequest` (thin `isbot` wrapper) + the route's `if (bot)` branch runs BEFORE the expiry/password checks in code order but is D-06-documented to apply "regardless of state" — verified against the integration test's bot+protected and bot+expired cases, both still 200-with-OG, never a redirect nor the human error pages |
| REDIRECT-E2E-05 | UTM + request-time query merge on final redirect URL | `applyUtmParams`/`mergeQuery` fully quoted below with the EXACT canonical ordering (`utm_source`, `utm_medium`, `utm_campaign`) proven by a real integration-test assertion string |

## Standard Stack

No new packages are introduced by this phase — it is pure test-authoring against infrastructure Phase 11 already built and dependencies already pinned in the workspace lockfile.

| Library | Version (as pinned in this repo) | Purpose | Why no change needed |
|---------|---------|---------|--------------|
| `@playwright/test` | `^1.61.1` (`apps/e2e/package.json`) | Test runner, `APIRequestContext`, `page` browser fixture | Already installed by Phase 11; this phase only authors new spec files under the existing `apps/e2e` workspace |
| `isbot` | `^5.2.0` (`apps/api/package.json`) | Bot/crawler UA matching (production dependency, not a test dependency) | Already the production bot-detection library; this phase only needs to pick a real matching UA string from it, not add anything |
| `@prisma/adapter-pg` | `^7.8.0` (`apps/e2e/package.json`) | E2E Prisma client driver adapter | Already installed by Phase 11's `apps/e2e/src/db.ts` |

**Installation:** none required — `pnpm install` at the workspace root already covers everything this phase touches.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new external packages (see Standard Stack above — every dependency used is already pinned and installed by Phase 11). No legitimacy check was run because there is nothing new to check.

## Architecture Patterns

### System Architecture Diagram

```
Playwright test process (apps/e2e, host machine)
    │
    ├─(A) APIRequestContext.get/post ──► built app container :3000 ──► Fastify
    │        (Host header override,            │
    │         maxRedirects:0)                   ▼
    │                                    resolveActiveDomainByHost(hostname)
    │                                            │
    │                                   found? ──┴── not found → 404 (or SPA fallback if own host)
    │                                            │
    │                                   prisma.link.findUnique(domainId, slug)
    │                                            │
    │                                   found? ──┴── not found → 404
    │                                            │
    │                                   isBotRequest(User-Agent)?
    │                                     │                  │
    │                                    yes                 no
    │                                     │                  │
    │                            renderBotOgPage        resolveLinkState(link, cookie)
    │                            (200, OG meta,           │        │         │
    │                             NEVER target)        expired  protected    ok
    │                                                     │        │         │
    │                                                   410      200        302
    │                                              renderExpired  password  Location:
    │                                                             page      applyUtmParams
    │                                                                       → mergeQuery(if
    │                                                                          forwardQuery)
    │
    └─(B) page.goto/page.click (real browser + cookie jar) ──► same Fastify handler,
             used ONLY for the password-gate flow (form POST + Set-Cookie + follow-redirect)
                                            │
                                   POST /:slug/verify ──► bcrypt.compare ──► issueUnlockCookie
                                            │                                       │
                                     wrong: 200 + LOCKED error            correct: 302 + Set-Cookie
```

A reader can trace REDIRECT-E2E-01/03/04/05 by following path (A) — pure `APIRequestContext`, no cookie jar, no navigation. REDIRECT-E2E-02 is the one path that must additionally follow (B) because a signed, `httpOnly`, path-scoped cookie round-trip is most naturally proven by a real browser session (CONTEXT.md's own locked decision).

### Recommended Project Structure

```
apps/e2e/tests/redirect/
├── host-header.spike.spec.ts   # Wave 0 ONLY — throwaway proof of Q1 below, same pattern
│                                 as tests/smoke/prisma-import.spike.spec.ts
├── slug-redirect.spec.ts        # REDIRECT-E2E-01 (happy path, 3xx + exact Location)
├── password-gate.spec.ts        # REDIRECT-E2E-02 (page fixture, wrong/correct, no-leak)
├── expiry.spec.ts               # REDIRECT-E2E-03 (410 distinct from 404, no-leak)
├── bot-og-render.spec.ts        # REDIRECT-E2E-04 (bot vs human, gates respected)
└── utm-merge.spec.ts            # REDIRECT-E2E-05 (UTM + query merge, exact ordering)
```

This mirrors CONTEXT.md's "Claude's Discretion" default layout (one file per ROADMAP success criterion) plus the spike file the Host-header decision requires. All five feature specs plus the spike run in Playwright's existing `smoke` project (`testMatch: /smoke\/.*\.spec\.ts$/` in `apps/e2e/playwright.config.ts`) — **unless** the plan places them under a new directory outside `smoke/`'s glob, in which case `playwright.config.ts` needs a new project/`testMatch` entry. Given the directory above is `tests/redirect/`, NOT `tests/smoke/`, **the plan must either (a) move these files under `tests/smoke/redirect-*.spec.ts` to match the existing glob with zero config changes, or (b) add a new Playwright project entry.** Recommendation: (a) — flatten into `tests/smoke/` with a `redirect-` filename prefix, avoiding a config change entirely, since these specs share `smoke`'s exact characteristics (public, unauthenticated, no `dependencies: ["setup"]` needed) that the existing project already declares.

### Pattern 1: Reusing the integration test's exact fixture builder shape, adapted to real HTTP

```typescript
// Source: apps/api/test/redirect.integration.test.ts (existing, already-proven pattern)
const CANARY_TARGET = "https://canary-leak-marker.example.net/super-secret-target-xyz123";

const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function assertNoLeak(body: string, headers: Record<string, string>, canary: string): void {
  expect(body).not.toContain(canary);
  for (const value of Object.values(headers)) {
    expect(String(value ?? "")).not.toContain(canary);
  }
}
```

Adapt this by fetching `response.headers()` (Playwright's `APIResponse.headers()`, a plain object) and `await response.text()` instead of `fastify.inject`'s synchronous `.body`/`.headers`.

### Pattern 2: Always pin an explicit User-Agent — Playwright's own default is bot-shaped

```typescript
// VERIFIED in this session against the actually-installed isbot@5.2.0:
// isbot("Playwright/1.61.1 (Windows NT; x64)") === true
//
// Any APIRequestContext call intended to exercise the HUMAN branch (REDIRECT-E2E-01,
// -03, -05, and the browser-UA half of -04) MUST set an explicit browser UA — never
// rely on Playwright's own default User-Agent, which contains the literal substring
// "Playwright/<version>" and is itself bot-classified by the production isbot version
// this app actually uses.
const response = await request.get("/some-slug", {
  headers: { host: "e2e.kurzly.local", "user-agent": BROWSER_UA },
  maxRedirects: 0,
});
```

### Pattern 3: `maxRedirects: 0` + status/Location assertion (REDIRECT-E2E-01/03/05)

```typescript
// Source: Playwright APIRequestContext options (request.get(url, { maxRedirects: 0 }))
// combined with the exact assertion shape from redirect.integration.test.ts's REDIR-01 case.
const response = await request.get("/go", {
  headers: { host: "e2e.kurzly.local", "user-agent": BROWSER_UA },
  maxRedirects: 0,
});
expect(response.status()).toBe(302);
expect(response.headers()["location"]).toBe("https://destination.example.com/landing");
expect(response.headers()["cache-control"]).toBe("no-store");
```

### Anti-Patterns to Avoid

- **Re-deriving the bot UA or UTM ordering by guessing:** both are already pinned, real, working constants in `apps/api/test/redirect.integration.test.ts` — copy them, do not invent new ones.
- **Using `fastify.inject`-style default UA assumptions in a real-HTTP context:** Playwright's `APIRequestContext` does NOT default to `"lightMyRequest"` (that's specific to Fastify's own `.inject()`); it defaults to a `Playwright/<version>`-shaped UA instead, which is a DIFFERENT bot-trap with the SAME practical consequence (see Pattern 2).
- **Testing the redirect handler against `localhost` as the Host header:** per CR-07 (Phase 11), the app's OWN host (`BASE_URL`) falls through to the SPA, NOT the redirect engine — every spec in this phase must send `Host: e2e.kurzly.local`, never `localhost`, or it will silently exercise the wrong code path and pass for the wrong reason.
- **Skipping `maxRedirects: 0`:** without it, `APIRequestContext` follows the 302 itself and the test only sees the FINAL landing response, never the actual status code/`Location` header contract REDIRECT-E2E-01 requires proving.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bot/crawler UA matching | A custom regex/allowlist for "is this a bot" | Pin `BOT_UA`/`BROWSER_UA` string constants from the ALREADY-INSTALLED `isbot@5.2.0` the app itself uses | The app's own `botDetection.ts` already delegates to `isbot` for exactly this reason (signature lists change constantly) — the E2E layer should pick real strings THAT LIBRARY recognizes today, not construct its own heuristic |
| No-leak assertion helper | A bespoke body/header scanner per spec file | Copy `assertNoLeak`'s exact shape from `redirect.integration.test.ts` | Already proven, already covers both body AND every header value — duplicating it with subtly different coverage risks a false-negative no-leak "pass" |
| Password-gate cookie handling | Manual `Set-Cookie` header parsing/reassembly for the browser flow | Playwright's `page` fixture's built-in cookie jar (real browser context) | CONTEXT.md's own locked decision — a real browser session naturally carries the signed `httpOnly` unlock cookie on the next navigation; hand-parsing `Set-Cookie` (the way the INTEGRATION test's `toCookieHeader` helper does, because `fastify.inject` has no cookie jar) is unnecessary extra code once a real `page` is available |
| Query-string merge/ordering assertions | Manual string-splitting on `&`/`=` to check UTM params | `new URL(response.headers()["location"]).searchParams.get(...)` (WHATWG `URLSearchParams`, same mechanism the app itself uses) | Matches the app's own `mergeQuery`/`applyUtmParams` encoding discipline exactly — a hand-rolled string check risks false mismatches on encoding/ordering that don't actually violate the contract |

**Key insight:** every "don't hand-roll" item in this phase already has a proven, working reference implementation sitting in the SAME repository (`redirect.integration.test.ts`) — this phase's job is disciplined reuse across a different transport layer, not net-new design.

## Common Pitfalls

### Pitfall 1: Playwright's default User-Agent is itself bot-classified
**What goes wrong:** A spec that omits an explicit `user-agent` header on an `APIRequestContext` call intended to test the HUMAN path (redirect, expiry, UTM merge) will silently exercise the BOT branch instead, producing a 200-with-OG-meta response where a 302/410 was expected.
**Why it happens:** Playwright's own default `User-Agent` for `APIRequestContext` contains the literal substring `Playwright/<version>`, and `isbot@5.2.0` — the exact version this repo has installed — flags any UA containing that substring as a bot. Empirically confirmed in this research session by running `isbot("Playwright/1.61.1 (Windows NT; x64)")` against the actually-installed package, which returned `true`.
**How to avoid:** Every non-bot-branch request in this phase's specs must explicitly set `headers: { "user-agent": BROWSER_UA }`. Never omit the header "because it's the default/happy path" — that assumption is backwards here.
**Warning signs:** A "happy path redirect" test unexpectedly asserting `og:title` in the body, or getting `200` instead of `302`/`410`.

### Pitfall 2: Testing against the wrong Host silently exercises the SPA fallback, not the redirect engine
**What goes wrong:** A request with `Host: localhost:3000` (or no explicit Host override at all, since `PLAYWRIGHT_BASE_URL` is `http://localhost:3000`) never reaches `resolveActiveDomainByHost`'s real lookup — it hits the CR-07 `isAppOwnHost` exemption and falls through to the SPA's `index.html` (200, generic HTML), which can masquerade as an unrelated "pass" or "fail" depending on the assertion.
**Why it happens:** `routes/redirect.ts`'s `isAppOwnHost()` check (added in Phase 11 as CR-07) deliberately treats the app's own `BASE_URL` host as a dashboard route, not a redirect target — by design, so a hard-reload on `/team` doesn't get the redirect engine's branded 404.
**How to avoid:** Every spec in this phase must send `Host: e2e.kurzly.local` (the Phase 11 baseline seeded Domain), confirmed reachable via the Q1 spike below.
**Warning signs:** A 200 response body containing the Vue SPA's `index.html` shell instead of the expected 302/410/200-password-page/200-OG-page.

### Pitfall 3: Expiry-beats-password precedence must be tested with BOTH set, not each alone
**What goes wrong:** Testing expiry and password-gate as fully independent scenarios can miss that an expired+protected link must ALWAYS show 410, never the password page — the single highest-value security check in this file per `redirectEngine.ts`'s own header comment (D-14).
**Why it happens:** `resolveLinkState` checks `expiresAt` unconditionally FIRST, before `passwordHash` — reordering these two `if` branches (or testing them independently without a combined case) would let a regression slip through both individual test files.
**How to avoid:** Include (or confirm coverage of) a link that is BOTH expired AND password-protected, asserting 410 and NOT the password-page copy — the integration test's "Precedence (D-14): expiry beats the password gate" describe block is the exact shape to mirror.
**Warning signs:** Green suite that never actually exercises the interaction between REDIRECT-E2E-02 and REDIRECT-E2E-03's fixtures together.

### Pitfall 4: `createLink`/`updateLink` are unreachable from `apps/e2e` at all — a raw insert must still respect the SAME invariants those functions would have enforced
**What goes wrong:** Since `@kurzly/api`'s `exports` map (verified this session) exposes only `.` and `./prisma-client` — never `lib/links.ts` — `apps/e2e` cannot call the real `createLink`/`updateLink` core. A naive raw `prisma.link.create({ data: { targetUrl, slug, domainId, password: "plaintext" } } )` fixture will silently violate invariants those functions normally guarantee: `passwordHash` must be a REAL bcrypt hash (not the plaintext password — `POST /:slug/verify`'s `bcrypt.compare(password, link.passwordHash)` will simply always fail against a non-hash string), and `expiresAt` must be the UTC end-of-day instant (`${date}T23:59:59.999Z`), not a bare date.
**Why it happens:** `apps/e2e` is a pure Prisma consumer once it falls back to raw inserts (per Q2's resolved finding) — there is no validation core standing between the test file and the database anymore, so every invariant `validateLinkInput`/`derivePasswordHash`/`deriveExpiresAt` normally enforces must be reproduced by hand in the fixture helper.
**How to avoid:** Build one small shared `apps/e2e/src/links.ts` fixture helper (mirroring the SHAPE of `lib/links.ts`'s derivation functions, not the full authorization/validation core) that hashes passwords with `bcryptjs` (already a transitive/available dependency via `@kurzly/api`) before inserting, and computes `expiresAt` the same UTC-end-of-day way. Use `ADMIN_EMAIL`'s or `MEMBER_EMAIL`'s seeded `User.id` (both already exist per Phase 11's `seedBaseline`) as `createdBy`.
**Warning signs:** A password-gate spec where even the CORRECT password never unlocks (because `passwordHash` was stored as plaintext), or an expiry spec that's off-by-hours around midnight UTC.

## Code Examples

### `resolveLinkState` — the precedence this phase's fixtures must exercise

```typescript
// Source: apps/api/src/lib/redirectEngine.ts (read directly, current source)
export function resolveLinkState(
  link: LinkStateInput,
  hasValidUnlockCookie: boolean,
): LinkState {
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return "expired";
  if (link.passwordHash && !hasValidUnlockCookie) return "protected";
  return "ok";
}
```

### `applyUtmParams` — exact canonical ordering (REDIRECT-E2E-05)

```typescript
// Source: apps/api/src/lib/redirectEngine.ts (read directly, current source)
// Locked order: source, medium, campaign. Each is delete-then-set, so a
// pre-existing occurrence in targetUrl is removed and the key re-appends
// at the END in this canonical order — verified end-to-end by:
//   redirect.integration.test.ts: expect(location.search).toBe(
//     "?utm_source=newsletter&utm_medium=email&utm_campaign=fall")
if (isSetUtmValue(utm.utmSource)) {
  target.searchParams.delete("utm_source");
  target.searchParams.set("utm_source", utm.utmSource as string);
}
if (isSetUtmValue(utm.utmMedium)) {
  target.searchParams.delete("utm_medium");
  target.searchParams.set("utm_medium", utm.utmMedium as string);
}
if (isSetUtmValue(utm.utmCampaign)) {
  target.searchParams.delete("utm_campaign");
  target.searchParams.set("utm_campaign", utm.utmCampaign as string);
}
```

### `mergeQuery` — target-wins visitor-query append (REDIRECT-E2E-05, second stage)

```typescript
// Source: apps/api/src/lib/redirectEngine.ts (read directly, current source)
export function mergeQuery(targetUrl: string, incomingSearch: string): string {
  const target = new URL(targetUrl);
  const incoming = new URLSearchParams(incomingSearch);
  for (const [key, value] of incoming) {
    if (!target.searchParams.has(key)) {
      target.searchParams.append(key, value);
    }
  }
  return target.toString();
}
```
Composition order the route layer actually uses (`routes/redirect.ts`): `applyUtmParams(link.targetUrl, link)` FIRST, then — only if `link.forwardQuery` is `true` — `mergeQuery(utmTarget, forwarded)` where `forwarded` is the incoming request's query string with the internal `qr` marker stripped. For a link with `utmSource="flyer"`, `forwardQuery: true`, requesting `/promo?extra=1`, the final `Location` is `?utm_source=flyer&extra=1` (UTM first, in canonical order; visitor's non-conflicting param appended after).

### `isBotRequest` — the thin wrapper this phase pins real UAs against

```typescript
// Source: apps/api/src/lib/botDetection.ts (read directly, current source)
import { isbot } from "isbot";
export function isBotRequest(userAgent: string | undefined): boolean {
  return isbot(userAgent);
}
```

### `unlockCookie.ts` — self-invalidating mechanism the password-gate spec proves

```typescript
// Source: apps/api/src/lib/unlockCookie.ts (read directly, current source)
export function unlockPayload(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 32);
}
// issued via reply.setCookie(cookieName(linkId), unlockPayload(passwordHash), {
//   signed: true, httpOnly: true, sameSite: "strict", path: cookiePath,
//   secure: process.env.NODE_ENV === "production" }); // no maxAge -> session cookie
```
The password-gate spec's real assertion is behavioral, not cookie-content-inspection: after a correct `POST /:slug/verify` via `page`, the SAME browser context's subsequent `page.goto("/secret")` must redirect straight through without re-prompting (the cookie jar carries the signed, `httpOnly` cookie automatically — Playwright's `page` API cannot read `httpOnly` cookie VALUES directly by design, so assert on navigation OUTCOME, not on inspecting the cookie's raw value).

## State of the Art

Not applicable in the traditional "old approach vs. new approach" sense — this phase is testing existing, already-shipped v1.0 logic (Phases 5–8) at a different test layer, not adopting a newer library version or pattern. No deprecated/outdated approach exists to document.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Playwright's `APIRequestContext` (built on Playwright's own Node-side `fetch.ts`, not a browser's Fetch API) allows a caller-supplied `Host` header to reach the outbound request unmodified on the FIRST request (not just after a redirect) — based on reading Playwright's own `packages/playwright-core/src/server/fetch.ts` source via WebFetch, which shows `host` is only rewritten to `locationURL.host` on redirect-following, with no evidence of stripping/forbidding a caller-supplied `host` on the initial request | Q1 / Architecture Patterns / CONTEXT.md's own Wave-0 spike mandate | If wrong, EVERY spec in this phase needs a different host-targeting mechanism (raw `http.request`, or registering `localhost` as a second Domain row — CONTEXT.md's explicitly rejected fallback). This is exactly why CONTEXT.md already mandates an empirical spike as the FIRST task — this research does not remove that requirement, it only raises confidence the spike will pass. |
| A2 | The compose stack's `app` container has outbound internet access, sufficient to redirect a real browser to a genuinely external, stable target URL for the password-gate test's final-redirect assertion | REDIRECT-E2E-02 / Environment Availability | No compose stack was actually booted during this research session (Docker port conflicts on this dev machine are pre-documented in 11-06-SUMMARY.md as blocking every live-run attempt in Phase 11 too) — outbound reachability from `app` was NOT empirically tested. See Environment Availability section below for the recommended same-stack-internal fallback that avoids this assumption entirely. |
| A3 | ~~`apps/e2e` can call `createLink`/`updateLink` directly~~ — **RESOLVED, not an assumption**: verified by directly reading `apps/api/package.json`'s `exports` map in this session, which confirms only `.` and `./prisma-client` are exposed. `apps/e2e` must use a raw `prisma.link.create` fixture helper instead (see Q2, Pitfall 4). | Q2 / Don't Hand-Roll / Pitfall 4 | None — this is settled, not a residual risk. The only remaining care point is that the raw-insert helper must reproduce `derivePasswordHash`/`deriveExpiresAt`'s exact behavior by hand (bcrypt-hash, UTC end-of-day), which Pitfall 4 documents. |

## Open Questions

1. **Does a caller-supplied `Host` header on Playwright's `APIRequestContext` actually arrive at Fastify's `request.hostname` unmodified?**
   - What we know: Playwright's own server-side `fetch.ts` source only rewrites `host` on redirect-following (to the new location's host), never strips it on the initial request; Fastify's `trustProxy` is `false` in this app (confirmed in `app.ts`), so `request.hostname` is derived directly from the raw incoming `Host` header with no reverse-proxy involved; `resolveActiveDomainByHost` already strips a trailing `:port` before its lookup (`domainResolution.ts`), so a `Host: e2e.kurzly.local` (no port) or `Host: e2e.kurzly.local:3000` header should both resolve correctly if delivered.
   - What's unclear: whether Playwright's TypeScript-level `headers` option for `request.get()`/`request.post()` passes an explicit `host` key through to its own internal fetch layer without being silently overridden by Playwright's own connection-establishment code (which necessarily also knows the REAL host:port it's connecting to, `localhost:3000`) — this is a code-path interaction internal to `playwright-core` that reading the public API docs alone cannot settle.
   - Recommendation: exactly as CONTEXT.md already mandates — the FIRST task of this phase's first plan must be a throwaway spike (`tests/smoke/host-header.spike.spec.ts`, same pattern as Phase 11's `prisma-import.spike.spec.ts`) that sends `request.get("/", { headers: { host: BASELINE_DOMAIN_HOSTNAME } })` against a fixture Link on that domain and asserts the response actually reflects that domain's resolution (e.g., a 404 with the seeded domain's hostname echoed in the branded page body, vs. the SPA-fallback 200 for `localhost`). If it fails, fall back to Node's raw `http.request` (still callable from within a Playwright test file) before considering a second Domain row for `localhost`.

2. **Is `lib/links.ts`'s `createLink`/`updateLink` reasonably importable from `apps/e2e`? — RESOLVED (not an open question, kept here for traceability).**
   - What we know, verified in this session: `apps/api/package.json`'s `exports` map is exactly `{ ".": "./dist/server.js", "./prisma-client": "./src/generated/prisma/client.ts" }` — no third subpath exists for `lib/links.ts` or any other `src/lib/*` module. Node's ESM package-exports enforcement means `import { createLink } from "@kurzly/api/lib/links.js"` (or any similar path) will fail to resolve at runtime, exactly the way importing anything outside a declared `exports` map always fails under Node's package resolution algorithm.
   - What's unclear: nothing further — this is a definitively answered, verified finding, not a gap.
   - Recommendation: use CONTEXT.md's own pre-approved fallback directly, with no exploratory task needed first: a raw `prisma.link.create` call scoped to `apps/e2e`'s own fixture-creation helper (e.g. a new `apps/e2e/src/links.ts`), seeding `createdBy` with the baseline `ADMIN_EMAIL` or `MEMBER_EMAIL` user's id (both already exist and hold appropriate `DomainMembership`/admin status per Phase 11's `seedBaseline`), and mirroring `createLink`'s OWN validated defaults where it matters for this phase's fixtures (e.g. bcrypt-hash the password the same way `derivePasswordHash`/`resolvePasswordHashCost` do, not a plaintext string, since `POST /:slug/verify`'s `bcrypt.compare` expects a real bcrypt hash in `passwordHash`). Note this deviation explicitly in the plan/summary, exactly as CONTEXT.md instructs — this was already anticipated as the likely outcome and is a non-blocking implementation detail, not an architectural gap.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + docker compose | Booting the 3-file compose stack (`scripts/e2e-compose.sh`) | ✓ (proven working by Phase 11's CI job; this dev sandbox has pre-existing port conflicts on 5433/8025 from unrelated projects, documented in 11-06-SUMMARY.md, not a blocker for CI) | — | — |
| `jq`, `openssl` | `scripts/e2e-compose.sh`'s own preflight checks | ✓ (same script Phase 11 already uses successfully in CI) | — | — |
| Outbound internet access from the `app` container | REDIRECT-E2E-02's password-gate browser test, IF it redirects to a genuinely external target URL | **Unverified** — no compose stack was booted in this research session; docker-compose.yml/dev.yml/e2e.yml declare no explicit network restriction (no `network_mode: none`, no egress firewall rule), and GitHub Actions `ubuntu-latest` runners (where this suite's CI job actually executes, per `.github/workflows/ci.yml`) have outbound internet access by default — but this is inference, not an executed proof | **Recommended: avoid the dependency entirely.** Create the password-protected link's `targetUrl` as the built app's OWN `/health` endpoint (`http://e2e.kurzly.local:3000/health` is NOT correct — `/health` isn't a redirect-domain concern; instead point the target at a SECOND, already-registered, always-reachable in-stack address such as `http://localhost:3000/health` reachable from the SAME host the Playwright test process itself runs on, since the test's browser `page` navigates from the HOST machine, not from inside the `app` container — the outbound-egress concern only applies to a target the APP CONTAINER itself would need to fetch, and this redirect handler never fetches the target server-side (SSRF-safe by design, per PROJECT.md's OG-preview constraint) — the browser follows the 302 itself, from the host. This means A2 above is actually a NON-ISSUE for a real 302 redirect (the browser, not the app container, makes the follow-up request) — but STILL recommend a same-stack target (`http://localhost:3000/health`, or any other host-reachable stable address) over a real external domain, purely to keep the test hermetic/offline-runnable and avoid CI flakiness from a third-party domain's own uptime. |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** outbound internet reachability is not actually required once the SSRF-safe redirect architecture is understood correctly (the browser follows the redirect, not the app) — but the recommended same-stack target keeps the test fully offline-runnable regardless.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` ^1.61.1 (already configured, `apps/e2e/playwright.config.ts`) |
| Config file | `apps/e2e/playwright.config.ts` (existing — `smoke` project's `testMatch: /smoke\/.*\.spec\.ts$/` covers this phase's specs if placed under `tests/smoke/`) |
| Quick run command | `pnpm --filter @kurzly/e2e exec playwright test --project=smoke tests/smoke/redirect-*.spec.ts` (requires the compose stack already up — see `scripts/e2e-compose.sh` for the full boot sequence) |
| Full suite command | `./scripts/e2e-compose.sh` (boots stack, runs full Playwright suite, always tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REDIRECT-E2E-01 | `APIRequestContext`, `maxRedirects:0`, exact 3xx + `Location` for a slug → target happy path | e2e (real HTTP, real container) | `pnpm --filter @kurzly/e2e exec playwright test tests/smoke/redirect-slug-redirect.spec.ts` | ❌ Wave 0 — new file this phase |
| REDIRECT-E2E-02 | Password gate: wrong password rejected, correct password frees, target never in any pre-unlock response | e2e (real browser `page`, real cookie jar) | `pnpm --filter @kurzly/e2e exec playwright test tests/smoke/redirect-password-gate.spec.ts` | ❌ Wave 0 — new file this phase |
| REDIRECT-E2E-03 | Expired link → 410, distinct from 404, no leak | e2e (`APIRequestContext`) | `pnpm --filter @kurzly/e2e exec playwright test tests/smoke/redirect-expiry.spec.ts` | ❌ Wave 0 — new file this phase |
| REDIRECT-E2E-04 | Bot UA → custom OG, never target, still gated; browser UA → real redirect | e2e (`APIRequestContext`, two pinned UAs) | `pnpm --filter @kurzly/e2e exec playwright test tests/smoke/redirect-bot-og-render.spec.ts` | ❌ Wave 0 — new file this phase |
| REDIRECT-E2E-05 | Owner UTM + request-time query merge correctly ordered on final `Location` | e2e (`APIRequestContext`) | `pnpm --filter @kurzly/e2e exec playwright test tests/smoke/redirect-utm-merge.spec.ts` | ❌ Wave 0 — new file this phase |

### Sampling Rate

- **Per task commit:** run the single new spec file in isolation against an already-booted stack (`pnpm --filter @kurzly/e2e exec playwright test <file>` with `PLAYWRIGHT_BASE_URL`/`E2E_DATABASE_URL`/`MAILPIT_URL` already exported by a prior `scripts/e2e-compose.sh` boot, or re-run the full script per task if no stack is left running).
- **Per wave merge:** `./scripts/e2e-compose.sh` (full suite — boots stack, runs everything under `apps/e2e/tests/`, always tears down) so this phase's specs are proven alongside Phase 11's existing smoke suite with zero interference (both share the DB-isolation/truncate discipline in `apps/e2e/src/db.ts`).
- **Phase gate:** full suite green (`./scripts/e2e-compose.sh` exits 0) before `/gsd-verify-work`, exactly as `.github/workflows/ci.yml`'s `e2e` job already gates `release` on.

### Wave 0 Gaps

- [ ] `apps/e2e/tests/smoke/host-header.spike.spec.ts` — resolves Q1 (Host-header override empirical proof), same throwaway-spike pattern as `prisma-import.spike.spec.ts`. Must run and pass BEFORE any other spec in this phase depends on Host-header targeting.
- [ ] `apps/e2e/tests/smoke/redirect-*.spec.ts` (five files) — all net-new, see Phase Requirements → Test Map above.
- [ ] Fixture-creation helper `apps/e2e/src/links.ts` — a raw `prisma.link.create` wrapper that hashes passwords via `bcryptjs` and computes UTC-end-of-day `expiresAt` (Q2 is RESOLVED: `createLink`/`updateLink` are confirmed unreachable via `@kurzly/api`'s `exports` map, so this raw-insert helper is required, not optional). Needed before any of the five feature specs, all of which create fixture Links.
- [ ] No new test-framework install needed — `@playwright/test` and its Chromium browser install are already wired by Phase 11's CI job (`playwright install --with-deps chromium`).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase's redirect handler is deliberately public/unauthenticated (ROADMAP goal: "no dependency on authentication") |
| V3 Session Management | Partial | The password-gate's unlock cookie (`unlockCookie.ts`) is a link-scoped, self-invalidating, signed session artifact — already implemented; this phase only re-proves it over real HTTP/cookie-jar semantics, does not change it |
| V4 Access Control | No | No domain-scoped authorization applies to the public redirect path (that's the v1.0 Denial-Suite's job, explicitly out of scope for this milestone per REQUIREMENTS.md) |
| V5 Input Validation | Yes | Slug/Host values are already escaped (`escapeHtml` in `publicHtml.ts`) and validated (`normalizeHostname`, `resolveActiveDomainByHost`'s exact-match-only lookup) — this phase's specs should include at least one reflected-XSS-guard-style slug (mirroring the existing integration test's `<script>alert(1)</script>` case) if not already covered elsewhere, to prove the guarantee holds over real HTTP too |
| V6 Cryptography | Yes | `unlockCookie.ts`'s cookie payload is a SHA-256 digest of `passwordHash`, HMAC-signed via `@fastify/cookie`'s `signed: true` — already implemented, never hand-rolled; this phase must not attempt to read/forge the cookie's raw value in a test (Playwright's `page.context().cookies()` can enumerate the cookie's NAME but not decode an `httpOnly`, signed value — assert on navigation/redirect OUTCOME instead, per Code Examples' `unlockCookie.ts` note) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Target-URL leak via HTML/header before password/expiry check | Information Disclosure | Structural no-`target`-field render contexts (`publicHtml.ts`) — this phase's `assertNoLeak` pattern is the test-side proof this mitigation actually holds over real HTTP |
| Open redirect via visitor-supplied query hijacking the target | Tampering | `mergeQuery`'s target-wins rule (visitor can only APPEND non-conflicting keys, never touch scheme/host/path) — REDIRECT-E2E-05 is exactly the test that proves this over real HTTP |
| Cookie forgery / cross-link cookie reuse | Spoofing | HMAC-signed, path-scoped (`/${slug}`), self-invalidating-on-password-rotation unlock cookie — REDIRECT-E2E-02's real-browser round-trip is the strongest possible proof this holds (a forged/tampered cookie value would fail `request.unsignCookie(raw).valid`) |
| Reflected XSS via slug path segment in error pages | Tampering (of rendered content) | `escapeHtml()` applied to every user-controlled interpolation in `publicHtml.ts` — worth a real-HTTP XSS-guard case in this phase's `slug-redirect.spec.ts` or a dedicated case, mirroring the integration test's existing coverage |

## Sources

### Primary (HIGH confidence — direct repo source read in this session)
- `apps/api/src/routes/redirect.ts` — full route handler, both `GET /:slug` and `POST /:slug/verify`
- `apps/api/src/lib/redirectEngine.ts` — `resolveLinkState`, `mergeQuery`, `applyUtmParams`, `QR_SCAN_PARAM`
- `apps/api/src/lib/botDetection.ts` — `isBotRequest`
- `apps/api/src/lib/publicHtml.ts` — `renderPasswordPage`, `renderExpiredPage`, `renderNotFoundPage`, `renderBotOgPage`
- `apps/api/src/lib/unlockCookie.ts` — `issueUnlockCookie`, `hasValidUnlockCookie`, `unlockPayload`
- `apps/api/src/lib/links.ts` — `createLink`, `updateLink`, `validateLinkInput`
- `apps/api/test/redirect.integration.test.ts` — the exact fixture/assertion vocabulary this phase mirrors, including the real `BOT_UA`/`BROWSER_UA` constants and the real UTM-ordering assertion string
- `apps/api/src/lib/domainResolution.ts`, `apps/api/src/lib/hostname.ts` — Host-header resolution + normalization
- `apps/e2e/src/db.ts`, `apps/e2e/playwright.config.ts`, `apps/e2e/tests/smoke/prisma-import.spike.spec.ts`, `apps/e2e/tests/smoke/rate-limit-bypass.spec.ts` — Phase 11's established patterns this phase reuses
- `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.e2e.yml`, `.github/workflows/ci.yml`, `scripts/e2e-compose.sh` — deployment/CI topology
- `.planning/phases/11-playwright-e2e-infrastructure-fixtures/11-06-SUMMARY.md` — documented pre-existing local port-conflict constraint on live-stack verification
- Direct execution in this session: `node -e "isbot(...)"` against the actually-installed `isbot@5.2.0` in `node_modules/.pnpm/isbot@5.2.0` — confirmed `BOT_UA`/`BROWSER_UA` classify correctly, AND confirmed a `Playwright/1.61.1 (...)`-shaped UA classifies as a bot (Pitfall 1)

### Secondary (MEDIUM confidence)
- Playwright's `packages/playwright-core/src/server/fetch.ts` (read via WebFetch against the `main` branch on GitHub) — shows `host` header is only rewritten on redirect-following, not stripped/forbidden on the initial request; strong supporting evidence for Q1, not an executed proof in this repo

### Tertiary (LOW confidence, flagged for the Wave-0 spike to settle)
- General WebSearch synthesis on Playwright `APIRequestContext` Host-header behavior — results were inconsistent (one search's AI summary incorrectly claimed Host is a forbidden header for `APIRequestContext`, contradicted by the actual source read above) — this is exactly why the empirical spike, not documentation, is the load-bearing verification step for Q1

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all versions read directly from `package.json`/lockfile
- Architecture: HIGH — every pattern quoted is read directly from current repo source, cross-checked against an already-passing integration test
- Pitfalls: HIGH (Pitfall 1, isbot UA trap) / HIGH (Pitfall 2, CR-07 host trap, already documented in the codebase) / MEDIUM (Pitfall 4, Q2's import-path caveat)
- Security: HIGH — all controls already implemented and integration-tested; this phase re-proves, does not design new controls

**Research date:** 2026-07-24
**Valid until:** 30 days (stable, no dependency version churn expected — this phase adds no new packages). Q2 (`@kurzly/api` exports map) is fully resolved and verified in this session — no re-check needed. Q1 (Host-header override) remains genuinely open and MUST be re-verified via the mandated Wave-0 spike at actual plan-execution time, since it was reasoned about from Playwright's own source, not executed against this repo's Fastify server in this session.
