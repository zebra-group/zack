# Phase 5: Core Redirect Engine - Research

**Researched:** 2026-07-12
**Domain:** Fastify public HTTP redirect engine — host/slug resolution, password-gate with signed cookies, bot/OG branching, no-leak security contract
**Confidence:** MEDIUM (core patterns grounded in this codebase's frozen signatures + verified npm registry versions; specific package choices are `[ASSUMED]` — no Context7/MCP docs provider available this session, see Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Password **and** expiry date are fully integrated into the existing Link create/edit form (Phase 4) in Phase 5 — not backend-only. Goal: the redirect engine is immediately end-to-end usable (real users create real protected/expiring links).
- **D-02:** Link passwords are hashed server-side with **bcrypt** (cost factor configurable). Never stored or served in plaintext.
- **D-03:** `expiresAt` has **day granularity** (date-only picker); link expires at the end of the chosen day. Server-side expiry comparison. Timezone handling (end of which day / UTC vs. local) = Planner's discretion.
- **D-04:** Crawler detection via an **established User-Agent library** (isbot-style) — covers facebookexternalhit, Twitterbot, Slackbot, WhatsApp, LinkedInBot, Googlebot, Discordbot, etc. Concrete library = Researcher/Planner's choice.
- **D-05:** A normal link serves bots **generic, branded Kurzly OG tags** in Phase 5 (no custom OG — that's META-02 later). REDIR-05 is satisfied this way without pulling META-02 forward.
- **D-06:** A detected bot is **NEVER redirected via 302** — it always gets a **200 HTML page with OG tags**. Only real browsers get the 302 to target. For protected/expired links, the bot gets generic OG tags **without** the real target/redirect (no-leak).
- **D-07:** Flow: **GET** of a protected link URL shows the password page (target **not** in HTML). Form does **POST to a verify endpoint**; on correct bcrypt match, server sets a cookie and responds with 302. Wrong password → same page with error, **no** target leak.
- **D-08:** After correct password, a **short-lived, strictly link-bound cookie/token** is set. A subsequent call/reload within validity does not re-prompt. **TTL = browser session** (session cookie), link-bound.
- **D-09:** Password (UI-04), expiry (UI-05), and 404 pages are delivered as **standalone, server-rendered HTML** by Fastify — **no** SPA bundle, no auth, no client-side embedding of target data. Same render layer as the bot-OG-HTML path.
- **D-10:** Design follows the Kurzly prototype (Geist typography, lime accent `#d7ff01`, light/dark); brand name/accent stay configurable via existing prototype props/ENV.
- **D-11:** Unknown slug on a domain → **generic, branded 404 page** (no target, no info disclosure); "doesn't exist" and "no access" are indistinguishable to the visitor.
- **D-12:** New link field **`forwardQuery` (Boolean, default: off)** + checkbox "forward query parameters to target URL" in the link form. On → incoming query params are merged onto the stored target URL; off → target exactly as stored.
- **D-13:** Merge conflict rule: **target URL wins** — params already baked into the target URL (e.g. Phase 4's UTM params) are untouched; only incoming params not already present are appended.
- **D-14:** Fixed evaluation order: **expiry (410) → password-gate → bot/OG branch → 302 redirect.** A protected/expired target must never appear in any response (HTML/JSON/header) before the check passes — verified by a **no-leak canary test** with a distinctive target URL.
- **D-15:** The password-verify endpoint is brute-force-protected **per (IP, Link)** (`@fastify/rate-limit`, already in the stack) — a few failed attempts/minute with backoff, without penalizing legitimate visitors of other links. Thresholds = discretion.
- **D-16:** The public redirect handler (302 path) gets a **generous per-IP abuse/DoS limit** that real users never feel — the redirect is the core value and must stay fast/available.
- **D-17:** Phase 5 structures the successful-redirect path so Phase 6 can cleanly hook in **click tracking** (a clearly defined "here tracking would happen" point), but writes **no** tracking data itself.
- **D-18:** All redirect responses (302) plus expiry/password/404 pages set **`Cache-Control: no-store`/no-cache**, so retargeted destinations (later dynamic QR remapping) take effect immediately and browsers/CDNs never cache a stale or leak-sensitive result.

### Claude's Discretion

- Exact bcrypt cost-factor choice; timezone/"end of day" semantics for `expiresAt`; concrete UA bot library; exact endpoint structure of the verify path (one route vs. separate); rate-limit thresholds/backoff values; exact cache-header combination; exact cookie attributes (HttpOnly/SameSite/Secure/Path) and naming scheme; query-merge encoding edge cases; the concrete render technique for server-rendered HTML pages (template strings vs. lightweight view engine).

### Deferred Ideas (OUT OF SCOPE)

- **META-02 — Custom OG tags per link** (title/description/image) in the dashboard + social-card preview → UTM/OG-metadata phase. Phase 5 deliberately serves only generic OG tags; custom values hook in there.
- **Actual click tracking / analytics** → Phase 6 (Phase 5 only provides the seam).
- **Dynamic QR codes / remapping** → QR phase (`no-store` is the preparation).
- **Query-merge fine control** beyond the simple "target URL wins" rule (e.g. allow/deny-list of individual params) → later phase if needed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REDIR-01 | Valid short link issues HTTP 302 to the correct target | `resolveActiveDomainByHost()` + compound-unique `domainId_slug` lookup (Architecture Patterns §Precedence Engine); Code Examples §Redirect Handler Skeleton |
| REDIR-02 | Redirect resolution is host-scoped per custom domain | Reuses frozen `resolveActiveDomainByHost()` verbatim (no re-derivation) — Architecture Patterns §Host Resolution Reuse |
| REDIR-03 | Expired link → HTTP 410 Gone with expiry page, never a redirect | Precedence Engine stage 1; Code Examples §Expiry Check |
| REDIR-04 | Password-protected link shows password page; target served only after server-verified hashed password | Architecture Patterns §Password-Gate + Link-Bound Cookie; Package Legitimacy Audit (bcryptjs) |
| REDIR-05 | Bots get injected generic OG tags without redirect; protected/expired targets never disclosed pre-check | Architecture Patterns §Bot/OG Branch Placement (resolves the D-06/D-14 ordering ambiguity — see Open Questions Q1); Package Legitimacy Audit (isbot) |
| UI-04 | Public password page | 05-UI-SPEC.md is the binding visual contract; this document covers the server-side render/no-leak mechanics only |
| UI-05 | Public expiry page | 05-UI-SPEC.md is the binding visual contract; this document covers the server-side render/no-leak mechanics only |
</phase_requirements>

## Summary

Phase 5 replaces `apps/api/src/routes/redirect.ts`'s 404 stub with the real engine. The engine's shape is almost entirely dictated by code that already exists and is explicitly frozen: `resolveActiveDomainByHost()` (host→Domain, deny-by-default) is the mandatory entry point, and `Link`'s `@@unique([domainId, slug])` index is the mandatory slug lookup key — no new resolution logic should be invented. The phase's actual complexity is concentrated in three areas: (1) a strict, testable precedence chain (expiry → password → bot/OG → redirect) that must degrade safely (generic 404/no-leak) at every branch; (2) a link-bound, cookie-based unlock session that self-invalidates when a password changes (recommended: sign a digest of the current `passwordHash` into the cookie, not a bare boolean); (3) a single shared, dependency-free HTML render layer (tagged template strings, no view engine) reused by all four public response types (password, expiry, 404, bot-OG) that must HTML-escape every user-controlled value it interpolates — the incoming URL slug is attacker-controlled on every single request (including on a 404), making this the phase's most concrete injection risk.

Three new npm packages are needed: `bcryptjs` (password hashing — chosen over native `bcrypt` specifically because the project's Docker base image is `node:24-alpine` and the project has an established pattern of avoiding native/postinstall-script dependencies in Alpine, see CLAUDE.md's `sharp`-over-`canvas` precedent), `isbot` (UA-based bot detection), and `@fastify/cookie` (signed cookies for the link-unlock session — already named at the exact pinned version in `.claude/CLAUDE.md`'s supporting-libraries table). All three passed the registry legitimacy check with no suspicious postinstall scripts, but two (`isbot`, `@fastify/cookie`) were flagged `SUS` by the automated gate purely on a "recently published" signal despite tens of millions of weekly downloads — see Package Legitimacy Audit for the full readout and required checkpoint.

**Primary recommendation:** Build `resolveLinkState()` (expiry/password/normal classification via the existing `domainId_slug` unique index) as a pure function, then branch on bot-detection *at each state*, not as a single top-level gate — this is the only reading of D-06 + D-14 together that doesn't contradict either decision (see Open Questions Q1). Use `bcryptjs` + `@fastify/cookie` + `isbot`, extend `lib/links.ts`'s single validated write path (never a second write path) with the three new fields, and share one escaping-safe HTML template module across all four public response types.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Host → Domain resolution | API/Backend | — | Already built (Phase 3), frozen signature — no tier change |
| Slug → Link resolution + precedence classification | API/Backend | — | Pure DB read + in-memory state machine, no client trust boundary crosses here |
| Password verification (bcrypt compare) | API/Backend | — | Never move a hash comparison to the client |
| Link-unlock session cookie issuance/check | API/Backend | Browser/Client | Server issues + verifies the signed cookie; browser only stores/replays it opaquely |
| Public HTML rendering (password/expiry/404/bot-OG pages) | API/Backend | — | Server-rendered outside the SPA/Vite bundle (D-09) — this is Fastify's own render, not a separate SSR tier |
| Bot/crawler detection | API/Backend | — | UA header inspection is server-only; never trust a client-asserted "I am a bot" flag |
| Link form security fields (password/expiry/forwardQuery inputs) | Browser/Client | API/Backend | Vue SPA form UI is client-tier; validation/hashing/persistence is backend-tier via the existing single write path |
| Query-parameter forwarding merge | API/Backend | — | Must run server-side against the already-validated stored target, never client-side |
| Rate limiting (verify + redirect paths) | API/Backend | — | `@fastify/rate-limit`, already registered at the Fastify instance level |
| Click-tracking seam (D-17) | API/Backend | — | A single call-site placeholder on the successful-redirect path; Phase 6 fills in the Database tier behind it |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bcryptjs` [ASSUMED] | `^3.0.3` | Password hashing for `Link.passwordHash` (D-02) | Pure-JS, zero native build step — no `node-gyp`/prebuilt-binary risk on the project's `node:24-alpine` Docker base (`Dockerfile:19`), and needs no new `pnpm-workspace.yaml` `allowBuilds` entry (unlike native `bcrypt`, which has a postinstall compile step). Directly mirrors CLAUDE.md's own `sharp`-over-`canvas` rationale ("avoid `node-gyp` builds against Alpine's musl libc"). |
| `isbot` [ASSUMED] | `^5.2.0` | Server-side UA-string bot/crawler detection (D-04) | Regex-matched against a maintained, regularly-updated bot-signature list (facebookexternalhit, Twitterbot, Slackbot, WhatsApp, LinkedInBot, Googlebot, Discordbot, etc. — exactly D-04's coverage list); framework-agnostic, takes a raw UA string so it drops into Fastify with zero adapter code. |
| `@fastify/cookie` [ASSUMED] | `^11.1.1` | Link-bound unlock session cookie (D-07/D-08) | Already named at this exact pinned version in `.claude/CLAUDE.md`'s Supporting Libraries table (there noted as optional/auth-unrelated — this phase is precisely that "auth-unrelated" use case: a non-auth, per-link unlock cookie, not a second session-management system competing with better-auth). Provides `reply.setCookie()`/`request.cookies` plus built-in HMAC-signed cookie support so the unlock token cannot be client-forged. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` (already installed) | `^4.4.3` | Validate `password`/`expiresAt`/`forwardQuery` fields on the create/update request body | Extend `createLinkSchema`/`updateLinkSchema` in `routes/links.ts` exactly like the existing allowlist pattern — do not introduce a second validation library. |
| WHATWG `URL`/`URLSearchParams` (Node built-in) | n/a (runtime built-in) | Query-parameter merge (D-12/D-13) | No library needed — see Code Examples §Query Forwarding. Already the project's established idiom (`lib/links.ts`'s `targetUrlSchema` uses `z.url()`, itself WHATWG-URL-backed). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bcryptjs` | native `bcrypt` | Faster hashing, but requires a compiled native addon whose Alpine/musl prebuilt-binary coverage is best-effort only (not "current stable + supported LTS" guaranteed) — would need a new `allowBuilds` entry in `pnpm-workspace.yaml`, breaking the project's established "no blanket lifecycle-script enablement" posture (T-01-02). Only worth it if a load test later shows `bcryptjs`'s pure-JS cost genuinely bottlenecks the verify endpoint (see Common Pitfalls §bcryptjs Event-Loop Cost). |
| `isbot` | `ua-parser-js` | `ua-parser-js` is a general-purpose UA parser (browser/OS/device breakdown) — much heavier than needed for a single boolean "is this a bot" check; `isbot` is purpose-built for exactly this. |
| `@fastify/cookie` | Hand-rolled `Set-Cookie`/`Cookie` header parsing | Avoids one dependency, but reimplements HMAC signing (needed to stop cookie forgery) — exactly the kind of "don't hand-roll crypto" case CLAUDE.md's Security constraints and this project's V6 ASVS posture argue against. Not worth it given the package is already CLAUDE.md-approved. |

**Installation:**
```bash
pnpm --filter @kurzly/api add bcryptjs isbot @fastify/cookie
```

**Version verification:** confirmed live against the npm registry (2026-07-12):
```
$ npm view bcryptjs version        → 3.0.3
$ npm view bcrypt version          → 6.0.0   (alternative considered, not selected)
$ npm view isbot version           → 5.2.0
$ npm view @fastify/cookie version → 11.1.1  (matches CLAUDE.md's pinned ^11.1.1)
```
None of the four packages declare a `postinstall` script (`npm view <pkg> scripts.postinstall` returned empty for all).

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm bcryptjs bcrypt isbot @fastify/cookie`:

| Package | Registry | Age (last publish) | Weekly Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------------|-------------------|--------------|---------|-------------|
| `bcryptjs` | npm | 2025-11-02 | ~11.6M | github.com/dcodeIO/bcrypt.js | OK | Approved |
| `bcrypt` | npm | 2025-05-11 | ~4.5M | github.com/kelektiv/node.bcrypt.js | OK | Approved (not selected — see Alternatives Considered) |
| `isbot` | npm | 2026-07-07 | ~22.3M | github.com/omrilotan/isbot | **SUS** ("too-new") | Flagged — planner must add `checkpoint:human-verify` before install |
| `@fastify/cookie` | npm | 2026-07-09 | ~1.86M | github.com/fastify/fastify-cookie | **SUS** ("too-new") | Flagged — planner must add `checkpoint:human-verify` before install |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `isbot`, `@fastify/cookie` — both flagged solely on the gate's "published very recently" heuristic. In both cases this reads as a false positive: `isbot` ships frequent releases because its entire value proposition is a continuously-updated bot-signature list (a several-times-a-month cadence is *expected*, not anomalous, for this specific package), and `@fastify/cookie`'s `11.1.1` is the exact version already named and approved in `.claude/CLAUDE.md`'s own Supporting Libraries table, under the official `fastify` GitHub org. Neither package has a `postinstall` script, both have very high sustained download counts, and both resolve to their well-known official repos. Recommend the planner add a lightweight `checkpoint:human-verify` before the `pnpm add` step (operator confirms repo/version match this table) rather than blocking on it — consistent with Phase 1/2/4's existing supply-chain-gate pattern (`01-01-PLAN.md`, `02-01-PLAN.md`, `04-01-PLAN.md`).

*All four package names were discovered via WebSearch/training knowledge in this session (no Context7/MCP docs provider was available) — per the provenance rule, they are tagged `[ASSUMED]` in the Standard Stack table above regardless of their `OK`/`SUS` registry verdict. See Assumptions Log.*

## Architecture Patterns

### System Architecture Diagram

```
Browser / Bot / QR-scanner
        │  GET https://{customDomain}/{slug}[?query]
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Fastify app.ts  (registered AFTER /api/links, BEFORE @fastify/     │
│ static + notFoundHandler — same slot the current stub occupies)    │
│                                                                     │
│  redirectRoute(prisma)                                             │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 1. resolveActiveDomainByHost(prisma, request.hostname)       │  │
│  │    → null? ──────────────────────────────────────► 404 page │  │
│  │ 2. prisma.link.findUnique({domainId_slug})                   │  │
│  │    → null? ──────────────────────────────────────► 404 page │  │
│  │ 3. resolveLinkState(link) → "expired" | "protected" | "ok"   │  │
│  │                                                                │  │
│  │        ┌── expired ──► isBot? ──yes──► 200 generic-OG HTML   │  │
│  │        │                     └──no───► 410 expiry HTML       │  │
│  │        │                                                      │  │
│  │        ├── protected, no valid unlock cookie                  │  │
│  │        │        (GET)  ──► isBot? ──yes──► 200 generic-OG    │  │
│  │        │                        └──no───► 200 password HTML  │  │
│  │        │        (POST /verify, rate-limited D-15)             │  │
│  │        │              wrong pw ──► 200 password HTML (error) │  │
│  │        │              right pw ──► Set-Cookie + 302 → target │  │
│  │        │                                                      │  │
│  │        └── ok (normal, or protected+unlocked)                 │  │
│  │                 isBot? ──yes──► 200 generic-OG HTML          │  │
│  │                       └──no───► [D-17 tracking seam, no-op]  │  │
│  │                                 → mergeQuery() if forwardQuery│  │
│  │                                 → 302 Location: target        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  Every response above: Cache-Control: no-store (D-18)              │
└───────────────────────────────────────────────────────────────────┘
        │                                              │
        ▼                                              ▼
   PostgreSQL (Domain, Link)                shared publicHtml.ts renderer
                                             (escapeHtml() on every interpolation)
```

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   ├── links.ts              # EXTEND: validateLinkInput/createLink/updateLink gain
│   │                          #   password/expiresAt/forwardQuery (hash here, D-02)
│   ├── redirectEngine.ts     # NEW: resolveLinkState(), mergeQuery(), the pure
│   │                          #   precedence logic — unit-testable without Fastify
│   ├── botDetection.ts       # NEW: thin isbot wrapper (isBotRequest(userAgent))
│   ├── unlockCookie.ts       # NEW: sign/verify the link-bound unlock cookie value
│   └── publicHtml.ts         # NEW: escapeHtml() + the 4 shared page templates
│                              #   (password/expiry/404/bot-OG), one render layer
├── routes/
│   └── redirect.ts           # REPLACED: GET /:slug, POST /:slug/verify
├── prisma/schema.prisma      # EXTEND: Link.passwordHash/expiresAt/forwardQuery
└── env.ts                    # EXTEND: BRAND_NAME, BRAND_ACCENT, PASSWORD_HASH_COST
```

### Pattern 1: Host Resolution Reuse (REDIR-02)
**What:** The redirect handler's very first line calls the frozen `resolveActiveDomainByHost(prisma, request.hostname)` — never `request.headers.host` string-compared directly, never `X-Forwarded-Host` read ad hoc.
**When to use:** Every branch of the redirect engine, no exceptions.
**Example:**
```typescript
// mirrors apps/api/src/routes/tlsCheck.ts's exact call shape
import { resolveActiveDomainByHost } from "../lib/domainResolution.js";

app.get("/:slug", async (request, reply) => {
  const domain = await resolveActiveDomainByHost(prisma, request.hostname);
  if (!domain) return sendNotFound(reply, { domain: request.hostname, slug: request.params.slug });
  // ...
});
```
`request.hostname` (not `request.host`) is correct here — Fastify's `request.hostname` is already port-stripped, and `resolveActiveDomainByHost` additionally strips a trailing `:port` defensively. Fastify's `request.protocol`/`request.host` spoofing issue (CVE-2026-3635, fixed in Fastify 5.8.3) does not affect this call because `resolveActiveDomainByHost` never trusts the raw value directly — it always routes through the exact-match, ACTIVE-status DB lookup. The project's installed `fastify@^5.10.0` is already past the patched `5.8.3`.

### Pattern 2: Precedence Engine as a Pure Function (D-14, REDIR-03/04/05)
**What:** Classify link state (`"expired" | "protected" | "ok"`) with zero Fastify/HTTP awareness, then let the route layer decide HTTP status/rendering. Keeps the security-critical ordering unit-testable without `fastify.inject`.
**When to use:** Any time expiry/password/bot logic needs to compose (which is every request).
**Example:**
```typescript
// lib/redirectEngine.ts
export type LinkState = "expired" | "protected" | "ok";

export function resolveLinkState(link: Link, hasValidUnlockCookie: boolean): LinkState {
  // D-14: expiry is checked FIRST and unconditionally — an expired+protected
  // link is ALWAYS "expired", never "protected" (UI-SPEC's explicit rule).
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return "expired";
  if (link.passwordHash && !hasValidUnlockCookie) return "protected";
  return "ok";
}
```

### Pattern 3: Bot Detection Applied *Per State*, Not as a Top-Level Gate
**What:** D-06 requires a bot hitting a protected/expired link to get a generic-OG 200 (never the human 410/password page, never a redirect). D-14 lists the bot/OG branch textually *after* expiry/password in the precedence chain. Read literally as a single top-level "if bot, always show OG page regardless of state" gate, these two decisions are consistent with each other — but only if bot-detection is evaluated **inside each state branch**, not once at the very top (a top-level "if bot → OG, else → run the state machine" gate also produces the exact same observable behavior and is simpler to implement/test — recommend this shape). See Open Questions Q1 for the reasoning and why this doesn't contradict D-14's stated ordering.
**Example:**
```typescript
const domain = await resolveActiveDomainByHost(prisma, request.hostname);
if (!domain) return sendNotFound(reply, ctx);

const link = await prisma.link.findUnique({ where: { domainId_slug: { domainId: domain.id, slug } } });
if (!link) return sendNotFound(reply, ctx);

const bot = isBotRequest(request.headers["user-agent"]);
const state = resolveLinkState(link, hasValidUnlockCookie(request, link));

if (bot) {
  // ALWAYS 200 + generic OG, regardless of state — D-06, no exceptions.
  return sendGenericOgPage(reply, ctx);
}

switch (state) {
  case "expired":   return sendExpiredPage(reply, ctx, link);           // 410, REDIR-03
  case "protected": return sendPasswordPage(reply, ctx, { error: false }); // 200, REDIR-04
  case "ok":         return sendRedirect(reply, link, request.query);   // 302, REDIR-01
}
```
Unknown-slug 404s are **not** routed through the bot branch at all — a 404 has no target to leak either way, so bots and humans get the identical generic 404 page (D-11's "indistinguishable" rule applies to visitor type here too, not just cause).

### Pattern 4: Link-Bound Unlock Cookie, Self-Invalidating on Password Change (D-07/D-08)
**What:** A signed cookie per link whose *payload* is a digest of the link's **current** `passwordHash`, not a bare boolean. This makes the cookie automatically worthless the moment an admin changes or removes the link's password — no separate revocation bookkeeping needed.
**When to use:** Issued on `POST /:slug/verify` success; checked on every `GET /:slug` for a `protected`-state link.
**Example:**
```typescript
// lib/unlockCookie.ts
import { createHash } from "node:crypto";

const COOKIE_PREFIX = "kurzly_unlock_";

function cookieName(linkId: string): string {
  return `${COOKIE_PREFIX}${linkId}`;
}

/** Short digest of the CURRENT passwordHash — changes whenever the password changes/clears. */
function unlockPayload(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 32);
}

export function issueUnlockCookie(reply: FastifyReply, linkId: string, slug: string, passwordHash: string): void {
  reply.setCookie(cookieName(linkId), unlockPayload(passwordHash), {
    signed: true,       // @fastify/cookie HMAC-signs — client cannot forge the payload
    httpOnly: true,
    sameSite: "strict",  // form POST is same-origin/top-level, Strict is safe and tighter
    path: `/${slug}`,    // scoped to this exact link's path only
    // no `maxAge`/`expires` → browser-session cookie, matches D-08's TTL
  });
}

export function hasValidUnlockCookie(request: FastifyRequest, link: Link): boolean {
  if (!link.passwordHash) return false;
  const raw = request.cookies[cookieName(link.id)];
  if (!raw) return false;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value === unlockPayload(link.passwordHash);
}
```
`Secure` attribute: gate on `process.env.NODE_ENV === "production"`, not on `request.protocol` — TLS is entirely operator-delegated (Phase 3's Caddy/Traefik `ask` model) and Fastify itself never terminates TLS, so relying on `request.protocol` would require `TRUST_PROXY=true` plus a correctly-forwarding reverse proxy just to set one cookie flag correctly; `NODE_ENV` is simpler and matches how the rest of this codebase gates environment-specific behavior (e.g. `app.ts`'s `logger` config).

### Pattern 5: Query Forwarding — Target Wins on Conflict (D-12/D-13)
**What:** Merge incoming query params onto the stored (already-validated) target URL, only adding keys the target doesn't already define.
**Example:**
```typescript
// lib/redirectEngine.ts
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

// call site (route layer):
const finalUrl = link.forwardQuery
  ? mergeQuery(link.targetUrl, new URL(request.url, "http://placeholder").search)
  : link.targetUrl;
```
This introduces **no open-redirect surface**: `mergeQuery` can only ever append query-string keys, never change `target`'s scheme/host/path — the target URL's origin was already validated `http(s)`-only at write time by `validateTargetUrl` (`lib/links.ts`), and nothing in this merge can touch that.

### Pattern 6: Shared, Escaping-Safe HTML Render Layer (D-09)
**What:** One module, one `escapeHtml()` helper, four thin template functions (password/expiry/404/bot-OG) built from tagged template strings — no view-engine dependency, matches 05-UI-SPEC.md's "raw server-rendered HTML5 documents" contract.
**Example:**
```typescript
// lib/publicHtml.ts
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPasswordPage(ctx: { domain: string; slug: string; errorState: boolean }): string {
  const safeDomain = escapeHtml(ctx.domain);
  const safeSlug = escapeHtml(ctx.slug);
  return `<!doctype html>...<div class="url-chip">${safeDomain}/${safeSlug}</div>...`;
}
```
**Every** interpolated value that ever originates from the incoming request (the URL's `:slug` path segment, above all) MUST go through `escapeHtml()` — see Common Pitfalls §Reflected XSS via Slug Echo, this is the phase's single highest-value security check.

### Anti-Patterns to Avoid
- **A second `prisma.link.update` call site for password hashing:** `lib/links.ts`'s `updateLink`/`createLink` are the D-01-established sole write paths — hash the incoming plaintext password *inside* `validateLinkInput`/`createLink`/`updateLink`, never in the route layer or a parallel helper. A route-layer `prisma.link.update({ data: { passwordHash: ... } })` would silently reintroduce the exact bypass pattern this codebase's header comments repeatedly warn against.
- **Comparing plaintext passwords or storing them anywhere, even transiently in logs:** never `console.log`/log the raw `password` field; Fastify's default logger will otherwise happily serialize request bodies containing it.
- **A boolean unlock cookie (`unlocked=true`):** trivially copy-pasteable between browsers/sessions for the same link and does not self-invalidate on password change — use Pattern 4's hash-digest-bound payload instead.
- **Rendering the 410/password pages for a bot:** violates D-06 explicitly — bots always get the generic-OG 200 shape, never the human error-state pages, even though both are technically "no leak."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Password hashing | A custom PBKDF2/SHA-256-with-salt scheme | `bcryptjs` | bcrypt's built-in per-hash salt + tunable cost factor is the industry baseline (ASVS V6); a hand-rolled scheme is exactly the kind of security-critical reinvention CLAUDE.md's Security constraints warn against. |
| Cookie signing/tamper-proofing | Manual HMAC over a raw cookie string | `@fastify/cookie`'s `signed: true` option | One well-tested code path instead of a bespoke sign/verify implementation that has to get constant-time comparison right too. |
| Bot/crawler UA matching | A hand-maintained regex of bot user-agent substrings | `isbot` | The set of crawler UAs changes constantly (new social platforms, new AI crawlers); `isbot` ships regular signature updates — a hand-rolled list goes stale immediately and under-covers D-04's explicit crawler list. |
| Query-string parsing/merging | String-splitting on `&`/`=` with manual percent-decoding | WHATWG `URLSearchParams` | Handles encoding edge cases (repeated keys, `+` vs `%20`, malformed sequences) that a hand-rolled splitter reliably gets wrong; already the project's established idiom via `z.url()`. |

**Key insight:** every "don't hand-roll" item above is either cryptographic (password hashing, cookie signing) or an ever-changing external signature list (bot UAs) — both categories where a bespoke implementation's bugs are invisible until exploited, unlike a typical application logic bug that fails loudly.

## Common Pitfalls

### Pitfall 1: Reflected XSS via Unescaped Slug Echo
**What goes wrong:** All three public pages (password/expiry/404) and 05-UI-SPEC.md's markup contract render `{{domain}}/{{slug}}` as a "you requested this URL" chip. `{{slug}}` on the 404 page is the raw incoming URL path segment for **any** string a requester sends — `GET /:slug` never validates the value against `customSlugSchema` before it reaches the 404 branch (a request for a slug that was never a valid Link slug shape is exactly the 404 case).
**Why it happens:** The template-string render approach (Pattern 6) has no automatic escaping the way a view-engine or Vue template would — string interpolation into HTML is raw by default.
**How to avoid:** Route every user-controlled value — the incoming slug above all, but also anything else derived from the raw request — through `escapeHtml()` before interpolation. Persisted `Link.slug` values are already shape-validated at write time (`customSlugSchema`, `[a-zA-Z0-9_-]` only) and therefore inherently safe, but the *incoming URL segment on a 404* is never validated against that shape, so it must still be escaped defensively.
**Warning signs:** A test requesting `GET /%3Cscript%3Ealert(1)%3C%2Fscript%3E` (URL-encoded `<script>alert(1)</script>`) on an active domain should return a 404 page whose HTML contains the string `&lt;script&gt;`, never a raw `<script>` tag.

### Pitfall 2: bcryptjs Event-Loop Cost on a "Must Stay Fast" Hot Path
**What goes wrong:** The project's stated 2026 default cost factor for bcrypt-family hashing is 12 (~250–500ms of CPU per hash on modern hardware, per the cited source). `bcryptjs` is pure JavaScript — its async API's actual event-loop-blocking behavior at high cost factors was not independently verifiable in this research session (no Context7/official-docs access). If the async hash/compare implementation does not yield cooperatively, a cost-12 hash on the verify endpoint could stall the Node event loop for hundreds of milliseconds, directly hurting REDIR-01's "fast redirect" success criterion for any concurrent request arriving during that window.
**Why it happens:** Pure-JS crypto implementations trade native-code speed for portability; "async" only guarantees a `Promise`-based API, not non-blocking computation.
**How to avoid:** Start conservative — cost factor 10–11, not 12 — and make it ENV-configurable (`PASSWORD_HASH_COST`, optional with a fail-safe default, mirroring `CNAME_TARGET`'s pattern in `env.ts`). Verify empirically during implementation (a quick synthetic load test hashing/comparing concurrently with a redirect request) before locking the default higher.
**Warning signs:** p99 latency on `GET /:slug` (normal redirect path) measurably spikes during concurrent `POST /:slug/verify` traffic.

### Pitfall 3: Prisma Migration — This One Is Likely Additive, Not the ALTER-Workaround Case
**What goes wrong / clarification:** Phase 3's `03-01-SUMMARY.md` documents that `prisma migrate dev` refuses to run non-interactively whenever it detects *any* confirmation-shaped warning — even a genuinely non-destructive one (that case: a new unique constraint on an empty table). It's tempting to assume every schema change in this project needs the `migrate diff` + throwaway-shadow-container + `migrate deploy` workaround.
**Why it happens:** Prisma's confirmation heuristic is triggered by the *shape* of the change (new constraints, non-nullable columns without defaults, etc.), not by actual data-loss risk.
**How to avoid:** Phase 5's three new `Link` columns are all additive and safe by construction — `passwordHash String?` (nullable), `expiresAt DateTime?` (nullable), `forwardQuery Boolean @default(false)` (defaulted) — none require a confirmation-shaped warning the way a new `UNIQUE` constraint or non-nullable column would. Try plain `prisma migrate dev` first (mirrors `04-02-SUMMARY.md`'s precedent: the Link table's own `CREATE TABLE` ran non-interactively without issue). Keep the `03-01` workaround procedure as a documented fallback only if Prisma's confirmation gate fires unexpectedly.
**Warning signs:** `prisma migrate dev` prints "Prisma Migrate has detected that the environment is non-interactive" — only then fall back to the `migrate diff --script` + throwaway `shadowDatabaseUrl` container + `migrate deploy` procedure.

### Pitfall 4: Rate-Limit Key Collision Across Domains With the Same Slug
**What goes wrong:** `@fastify/rate-limit`'s `keyGenerator` for the `POST /:slug/verify` endpoint (D-15, "per IP, Link") must not key on `slug` alone — two different custom domains can legitimately have identically-named slugs pointing at two different `Link` rows, and keying by `${ip}:${slug}` would collapse their rate-limit buckets together (an attacker brute-forcing domain A's `/promo` would also throttle domain B's unrelated `/promo`).
**Why it happens:** The slug alone isn't a unique identifier — `@@unique([domainId, slug])` is.
**How to avoid:** Key by `${request.ip}:${request.hostname}:${slug}` (no extra DB lookup needed inside `keyGenerator` — `request.hostname` and the route's `:slug` param are both already available at hook time from the routing match, before the handler runs).
**Warning signs:** A rate-limit test using two domains with the same slug value shows cross-domain throttling.

## Code Examples

### Redirect Handler Skeleton
```typescript
// routes/redirect.ts — replaces the Phase 1 stub
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { resolveActiveDomainByHost } from "../lib/domainResolution.js";
import { resolveLinkState, mergeQuery } from "../lib/redirectEngine.js";
import { isBotRequest } from "../lib/botDetection.js";
import { hasValidUnlockCookie, issueUnlockCookie } from "../lib/unlockCookie.js";
import { renderPasswordPage, renderExpiredPage, renderNotFoundPage, renderBotOgPage } from "../lib/publicHtml.js";
import { REDIRECT_RATE_LIMIT, VERIFY_RATE_LIMIT_PER_LINK } from "../plugins/rateLimit.js";
import bcrypt from "bcryptjs";

export function redirectRoute(prisma: PrismaClient) {
  return async function registerRedirectRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/:slug",
      config: { rateLimit: REDIRECT_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store"); // D-18, every branch
        const { slug } = request.params as { slug: string };

        const domain = await resolveActiveDomainByHost(prisma, request.hostname);
        if (!domain) return reply.code(404).type("text/html").send(renderNotFoundPage({ domain: request.hostname, slug }));

        const link = await prisma.link.findUnique({ where: { domainId_slug: { domainId: domain.id, slug } } });
        if (!link) return reply.code(404).type("text/html").send(renderNotFoundPage({ domain: request.hostname, slug }));

        const bot = isBotRequest(request.headers["user-agent"]);
        const state = resolveLinkState(link, hasValidUnlockCookie(request, link));

        if (bot) return reply.code(200).type("text/html").send(renderBotOgPage({ domain: request.hostname, slug }));

        if (state === "expired") {
          return reply.code(410).type("text/html").send(renderExpiredPage({ domain: request.hostname, slug, expiresAt: link.expiresAt! }));
        }
        if (state === "protected") {
          return reply.code(200).type("text/html").send(renderPasswordPage({ domain: request.hostname, slug, errorState: false }));
        }

        // D-17 seam: Phase 6 inserts its click-write here. No-op today.
        await recordClickHook({ linkId: link.id });

        const target = link.forwardQuery
          ? mergeQuery(link.targetUrl, new URL(request.url, "http://x").search)
          : link.targetUrl;
        return reply.code(302).redirect(target);
      },
    });

    app.route({
      method: "POST",
      url: "/:slug/verify",
      config: { rateLimit: VERIFY_RATE_LIMIT_PER_LINK },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store");
        const { slug } = request.params as { slug: string };
        const { password } = request.body as { password?: string };

        const domain = await resolveActiveDomainByHost(prisma, request.hostname);
        const link = domain
          ? await prisma.link.findUnique({ where: { domainId_slug: { domainId: domain.id, slug } } })
          : null;
        if (!domain || !link || !link.passwordHash) {
          return reply.code(404).type("text/html").send(renderNotFoundPage({ domain: request.hostname, slug }));
        }
        if (resolveLinkState(link, false) === "expired") {
          return reply.code(410).type("text/html").send(renderExpiredPage({ domain: request.hostname, slug, expiresAt: link.expiresAt! }));
        }

        const ok = password ? await bcrypt.compare(password, link.passwordHash) : false;
        if (!ok) {
          return reply.code(200).type("text/html").send(renderPasswordPage({ domain: request.hostname, slug, errorState: true }));
        }

        issueUnlockCookie(reply, link.id, slug, link.passwordHash);
        return reply.code(302).redirect(link.targetUrl);
      },
    });
  };
}

/** D-17 seam — Phase 6 replaces this body with a real click-event write. Signature stays stable. */
async function recordClickHook(_ctx: { linkId: string }): Promise<void> {
  // intentionally empty — see lib/redirectEngine.ts header comment for the contract
}
```

### DTO Extension (never leak the hash)
```typescript
// packages/shared/src/index.ts — extend LinkDTO
export type LinkDTO = {
  id: string;
  domainId: string;
  slug: string;
  targetUrl: string;
  title: string | null;
  passwordProtected: boolean;   // NEW — derived boolean, NEVER the hash itself
  expiresAt: string | null;     // NEW — ISO date string
  forwardQuery: boolean;        // NEW
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// apps/api/src/lib/links.ts — toLinkDto()
export function toLinkDto(link: Link) {
  return {
    // ...existing fields...
    passwordProtected: link.passwordHash !== null,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    forwardQuery: link.forwardQuery,
  };
}
```

### Prisma Schema Extension
```prisma
model Link {
  // ...existing fields...
  passwordHash  String?
  expiresAt     DateTime?
  forwardQuery  Boolean  @default(false)
  // ...existing relations/indexes unchanged...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|----------------|--------|
| Native `bcrypt` as the default Node password-hashing choice | Pure-JS `bcryptjs` preferred specifically for musl/Alpine Docker targets | Ongoing (Alpine-first container images have been standard for years) | Avoids native-addon build fragility in `node:*-alpine` images — directly relevant given this project's `node:24-alpine` base. |
| Rolling a custom bot-detection regex | Purpose-built, regularly-updated packages (`isbot`) | Long-standing best practice | Keeps up with new crawler UAs (social platforms, AI crawlers) without manual maintenance. |

**Deprecated/outdated:**
- `fastify-cookie` (unscoped package name): deprecated in favor of the scoped `@fastify/cookie` — already what this project references.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `bcryptjs` (not native `bcrypt`) is the right password-hashing package for this project | Standard Stack, Alternatives Considered | If wrong, planner should swap to native `bcrypt` and add a `pnpm-workspace.yaml` `allowBuilds` entry + verify Alpine musl prebuilt-binary availability before relying on it in the Docker build. |
| A2 | `isbot` is the right bot-detection package (flagged `SUS` by the legitimacy gate on a "too-new" signal only) | Standard Stack, Package Legitimacy Audit | Low — high download count, no postinstall script, well-known repo; still gate the install behind `checkpoint:human-verify` per the legitimacy protocol. |
| A3 | `@fastify/cookie` at `11.1.1` is the right cookie plugin (flagged `SUS`, "too-new" signal only) | Standard Stack, Package Legitimacy Audit | Low — exact version already pinned in `.claude/CLAUDE.md`'s own approved stack table; still gate the install behind `checkpoint:human-verify`. |
| A4 | `bcryptjs`'s async hash/compare API does not seriously block the Node event loop at cost factor 10–12 | Common Pitfalls §2 | Medium — could not verify bcryptjs's internal scheduling behavior without Context7/official-docs access this session. If wrong, the redirect hot path's latency could degrade under concurrent verify traffic; mitigated by starting at cost 10–11 and load-testing before raising it. |
| A5 | Bot-detection should short-circuit to the generic-OG branch for EVERY state (expired/protected/ok), evaluated per-branch rather than as a single top-level gate, to reconcile D-06 and D-14's literal ordering | Architecture Patterns §Pattern 3, Open Questions Q1 | Medium — this is a reasoned resolution of an apparent tension between two locked decisions, not something either decision states explicitly. If the planner/user intended something else (e.g. bots should see the literal 410/password page structure, just without the target), the branching logic in Pattern 3 needs to change. |
| A6 | Phase 5's three new `Link` columns will NOT trigger Prisma's non-interactive confirmation gate (unlike Phase 3's ALTER) | Common Pitfalls §3 | Low — worst case, the planner falls back to the already-proven `03-01` `migrate diff`/throwaway-container workaround; no functional risk, only a possible extra step. |
| A7 | `Secure` cookie attribute should gate on `NODE_ENV === "production"` rather than `request.protocol`/`TRUST_PROXY` | Architecture Patterns §Pattern 4 | Low — if the operator runs a non-HTTPS production deployment (discouraged, contradicts CLAUDE.md's TLS constraint), the cookie would still be marked `Secure` and silently fail to be set over plain HTTP. Acceptable given the project's stated TLS-required production posture. |

## Open Questions

1. **Does D-06's bot behavior for protected/expired links contradict D-14's literal precedence ordering?**
   - What we know: D-14 states the order textually as "expiry (410) → password-gate → bot/OG branch → 302 redirect" — read as a strict linear pipeline, bot detection would run *after* expiry/password are resolved to a human-facing page. D-06 explicitly states a bot hitting a protected/expired link gets generic OG tags, *never* the human error pages.
   - What's unclear: Whether "the bot/OG branch" in D-14's ordering is meant as a single top-level short-circuit (checked first, overriding state-specific rendering) or as one stage among several equally-weighted stages.
   - Recommendation: Implemented as Pattern 3 in this document — classify link state first (still respecting D-14's expiry-before-password ordering for the *state itself*), then apply bot-detection as the deciding factor for *how* that state is rendered (generic-OG 200 for a bot, state-appropriate page for a human). This satisfies both decisions literally. Flag to the user/planner for a one-line confirmation if there's any doubt — low implementation cost to change if wrong, since Pattern 3's `if (bot) return ...` short-circuit is a single, isolated code block.

2. **Exact `POST` verify endpoint path.**
   - What we know: 05-UI-SPEC.md's example form markup uses `action="/{{slug}}/verify"` but explicitly marks the concrete path as executor discretion.
   - What's unclear: Whether a single combined `redirectRoute` factory (GET + POST on related paths) or two separate route registrations is preferred.
   - Recommendation: `POST /:slug/verify` as shown in Code Examples — a fixed second path segment can never collide with a `GET /:slug` redirect target (slugs cannot contain `/`, enforced by `customSlugSchema`), and both routes conveniently share one Fastify-plugin factory.

3. **Timezone semantics for `expiresAt` "end of day" (D-03, marked Planner's discretion).**
   - What we know: Day-granularity picker, server-side comparison.
   - What's unclear: Whether "end of day" means UTC midnight or a configurable operator timezone. This project has no existing timezone-configuration precedent to follow.
   - Recommendation: Simplest and most predictable for a self-hosted tool with no per-user timezone setting: treat the picked date as UTC end-of-day (`23:59:59.999Z`) — matches the existing convention of storing all other timestamps (`createdAt`, etc.) as UTC via Prisma's `DateTime`. Document this choice in the link form's helper text if it might surprise operators in non-UTC regions.

## Environment Availability

Skipped — Phase 5 introduces no new external service/runtime dependency beyond three npm packages (already covered in Standard Stack/Package Legitimacy Audit). The existing testcontainers-Postgres + Vitest harness (Phase 1, unchanged) fully covers this phase's test needs; no new Docker services, no new ENV-gated external integration.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.10` + `fastify.inject` (light-my-request) — same as Phases 1-4 |
| Config file | `apps/api/vitest.config.ts` + `apps/api/test/globalSetup.ts` (testcontainers Postgres) |
| Quick run command | `pnpm --filter @kurzly/api test -- redirect` |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| REDIR-01 | Valid link → 302 to target | integration (`fastify.inject`) | `pnpm --filter @kurzly/api test -- redirect.integration` | ❌ Wave 0 |
| REDIR-02 | Host-scoped resolution (same slug, two domains → two different links; unregistered host → 404) | integration | same file | ❌ Wave 0 |
| REDIR-03 | Expired link → 410, no `Location` header, body never contains target string | integration | same file | ❌ Wave 0 |
| REDIR-04 | Protected link: GET has no target in body; wrong password → same page, no leak; correct password → 302 + `Set-Cookie`; second GET with cookie → 302 without re-prompt | integration | same file | ❌ Wave 0 |
| REDIR-05 | Bot UA on normal link → 200 generic-OG, no redirect; bot UA on protected/expired link → 200 generic-OG, no target leak, no redirect | integration | same file | ❌ Wave 0 |
| **No-leak canary (D-14, all above)** | A distinctive target URL constant never appears in any pre-unlock response body/header across every branch | integration, shared `assertNoLeak()` helper | same file | ❌ Wave 0 |
| UI-04/UI-05 | Visual/copy fidelity to 05-UI-SPEC.md | manual (gsd-ui-review) + targeted string-presence assertions (locked copy strings, status-footer text) in the integration test above | same file (string assertions) + manual UI review | ❌ Wave 0 (assertions), N/A (manual review) |
| `resolveLinkState`/`mergeQuery` pure-function edge cases | unit | `pnpm --filter @kurzly/api test -- redirectEngine` | ❌ Wave 0 |
| Password hashing round-trip (`lib/links.ts` extension) | unit/integration | `pnpm --filter @kurzly/api test -- links` (extend existing file) | Wave 0 extension of existing `links.integration.test.ts` |

### Sampling Rate
- **Per task commit:** `pnpm --filter @kurzly/api test -- redirect`
- **Per wave merge:** `pnpm -r test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/test/redirect.integration.test.ts` — covers REDIR-01..05, no-leak canary, UI-04/05 copy-contract assertions
- [ ] `apps/api/test/redirectEngine.test.ts` — unit tests for `resolveLinkState()`/`mergeQuery()` (no Fastify/DB needed)
- [ ] Extend `apps/api/test/links.integration.test.ts` — password hashing on create/update, `forwardQuery`/`expiresAt` persistence, `passwordProtected` DTO boolean never exposes the hash
- [ ] Framework install: none — Vitest/testcontainers/`fastify.inject` all already in place from Phase 1

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No (not a user-authentication flow — public link password-gate is a shared-secret resource gate, not a user identity system) | n/a |
| V3 Session Management | Yes | The link-unlock cookie: `HttpOnly`, `SameSite=Strict`, `Secure` (prod), session-lifetime (no persistent `maxAge`), signed via `@fastify/cookie` (Pattern 4) |
| V4 Access Control | Partial | Domain-scoping is already enforced upstream by `resolveActiveDomainByHost`'s deny-by-default guard (Phase 3); this phase adds no new user-role access control (redirect endpoints are intentionally public/anonymous) |
| V5 Input Validation | Yes | Incoming slug/query treated as untrusted at every render site (`escapeHtml()`, Pattern 6); target URL validation already enforced at write time (`validateTargetUrl`, `lib/links.ts`) |
| V6 Cryptography | Yes | `bcryptjs` for password hashing (never hand-rolled, never plaintext at rest or in logs); `@fastify/cookie`'s HMAC signing for the unlock cookie (never hand-rolled) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Reflected XSS via the incoming `:slug` path segment echoed into the 404/password/expiry page's "requested URL" chip | Tampering / Information Disclosure | `escapeHtml()` on every user-controlled interpolation (Pitfall 1) |
| Unlock-cookie forgery to bypass the password gate | Tampering / Spoofing | HMAC-signed cookie (`@fastify/cookie`, `signed: true`) bound to a digest of the link's current `passwordHash` (Pattern 4) — a forged/stale cookie fails signature verification or payload-mismatch |
| Password brute-forcing on `POST /:slug/verify` | Spoofing | Per-(IP, hostname, slug) rate limit (D-15, Pitfall 4) + bcrypt/bcryptjs's inherent per-guess cost |
| Host-header spoofing to bypass per-domain scoping | Spoofing | `resolveActiveDomainByHost`'s deny-by-default exact-match lookup (already frozen, Phase 3); installed `fastify@^5.10.0` is past the CVE-2026-3635 patch (`5.8.3`) for `request.protocol`/`request.host` spoofing via forwarded headers |
| Distinguishing "slug never existed" vs. "slug existed but is on a domain I can't see" vs. "link was deleted" via response timing/shape | Information Disclosure | Single compound-unique-index (`domainId_slug`) lookup for all three cases, identical generic 404 body/status regardless of which is true (D-11) |
| Stale/cached redirect target served after an operator changes a link | Tampering (of cached state, not the request itself) | `Cache-Control: no-store` on every response (D-18) |
| Open redirect via the `forwardQuery` merge | Tampering | Structurally impossible — `mergeQuery` (Pattern 5) can only append query-string keys to the already-validated target URL, never alter its scheme/host/path |

## Project Constraints (from CLAUDE.md)

- **Backend stack is fixed:** Fastify v5, Prisma 7 (custom `output` path at `apps/api/src/generated/prisma`, import from there — not bare `@prisma/client`), PostgreSQL 18. No deviation.
- **TDD is mandatory:** every REDIR-01..05/UI-04/UI-05 behavior needs a green automated test before being considered done; security/correctness-critical paths (no-leak, expiry, password-gate) require an explicit negative/canary test — already reflected in this document's Validation Architecture.
- **`@fastify/session` must never be added** — better-auth already owns session state; the link-unlock cookie in this phase is a *separate, non-auth* cookie (a per-link unlock marker, not a login session) and does not conflict with this constraint, but must not be built on top of `@fastify/session` either.
- **No hand-rolled QR/crypto/password logic** — covered by this phase's `bcryptjs`/`@fastify/cookie` choices (Don't Hand-Roll section).
- **No native `canvas`-style Alpine-build-fragile dependencies** — directly informed the `bcryptjs`-over-`bcrypt` recommendation (Standard Stack, Alternatives Considered).
- **`pnpm-workspace.yaml`'s `allowBuilds` stays minimal** — no blanket lifecycle-script enablement (T-01-02 precedent); `bcryptjs`/`isbot`/`@fastify/cookie` need no new `allowBuilds` entries (none declare a `postinstall` script, verified via `npm view <pkg> scripts.postinstall`).
- **UI fidelity is pixel-accurate per 05-UI-SPEC.md** — this document defers all visual/copy contract details to that spec; it covers only the server-side rendering *mechanics* (escaping, response shape, status codes) needed to implement that contract safely.
- **i18n `'@'` escaping rule** — not applicable this phase; no new vue-i18n locale file edits (the public HTML pages are server-rendered German copy per 05-UI-SPEC.md, not routed through vue-i18n at all, since D-09 excludes them from the SPA).
- **`pnpm tsc --noEmit` after every change** — applies as usual; rebuild `packages/shared` after extending `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` before `apps/web` typechecks against the new fields.

## Sources

### Primary (HIGH confidence)
- This codebase, read directly this session: `apps/api/src/lib/domainResolution.ts`, `apps/api/src/lib/hostname.ts`, `apps/api/src/routes/redirect.ts`, `apps/api/src/routes/tlsCheck.ts`, `apps/api/src/lib/links.ts`, `apps/api/src/routes/links.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/plugins/{helmet,rateLimit}.ts`, `apps/api/src/lib/auth.ts`, `apps/api/test/setupFileEach.ts`, `apps/web/src/components/LinkFormModal.vue`, `packages/shared/src/index.ts`, `Dockerfile`, `pnpm-workspace.yaml`, `apps/api/package.json`.
- `gsd-tools query package-legitimacy check` (registry-verified signals for `bcryptjs`/`bcrypt`/`isbot`/`@fastify/cookie`).
- `npm view <pkg> version` / `npm view <pkg> scripts.postinstall` — direct registry queries, run this session.

### Secondary (MEDIUM confidence)
- WebSearch, cross-checked against `npm view` for exact version numbers: bcrypt/bcryptjs cost-factor guidance, isbot API surface, `@fastify/cookie` signed-cookie API, `@fastify/rate-limit` `keyGenerator` API, Fastify `request.hostname`/`request.host` semantics, Fastify CVE-2026-3635 patch version.

### Tertiary (LOW confidence)
- bcryptjs's internal event-loop-yielding behavior at high cost factors (Pitfall 2/Assumption A4) — not independently verified against official docs this session; flagged for empirical verification during implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — versions verified against npm registry directly; package *choice* provenance is WebSearch/training-knowledge only (no Context7 this session), hence `[ASSUMED]` tags throughout.
- Architecture: HIGH — precedence engine, host-resolution reuse, and DTO/migration patterns are all directly grounded in this codebase's existing frozen signatures and established conventions (D-01 single-write-path, deny-by-default, IDOR-guard timing discipline).
- Pitfalls: MEDIUM — XSS/migration/rate-limit-key pitfalls are grounded in direct code inspection; the bcryptjs event-loop pitfall is a flagged uncertainty, not a verified finding.

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (30 days — stable ecosystem, but re-verify `isbot`'s UA-signature freshness and the `bcryptjs` vs `bcrypt` Alpine-binary landscape if implementation starts materially later, since both shift over time)
