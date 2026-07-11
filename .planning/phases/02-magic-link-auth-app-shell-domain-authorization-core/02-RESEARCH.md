# Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core - Research

**Researched:** 2026-07-11
**Domain:** Passwordless auth (better-auth magicLink on Fastify 5), server-side domain-scoped authorization core, Vue 3 themed app shell
**Confidence:** MEDIUM — better-auth is a fast-moving, actively-developed library; official Fastify integration guidance and the invite-only/enumeration pattern were reconstructed from docs + community sources (no Context7 MCP available this session) rather than a single authoritative code sample. The authorization-core data model and Fastify route-order patterns are HIGH confidence (reuse of Phase 1's own verified, in-repo patterns).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Signup/Admin-Policy):** No open public signup. The first admin is created via `INITIAL_ADMIN_EMAIL` (ENV): seeded at boot as Owner/Admin, or recognized on first login. After that, access is invite-only — an admin adds allowed email addresses in-app; only those can then sign in via magic link. A magic-link request for a non-allowed/unknown email gets a **neutral** response (identical "link sent if eligible" response — no account enumeration).
- **D-02 (Authorization model — core of this phase):** Role model **owner / admin / member**, domain-scoped membership (hierarchy owner > admin > member). Server-side helpers:
  - `requireDomainAccess(userId, domainId, minRole)` — denies/throws if the user is not a member of the domain with at least `minRole`.
  - `scopedDomainIds(userId)` — returns the set of domain IDs the user has access to (for list/query scoping).
  Both are **built and unit-tested here** (against real Postgres via the Phase-1 testcontainers harness), so all later feature routes use them as the single authorization path.
- **D-02b:** Phase 2 introduces the **minimal schema** the helper needs: `User`, better-auth `Session`/`Account`/Verification tables, a `DomainMembership` (user ↔ domain ↔ role), and a minimal `Domain` reference. Full domain lifecycle (registration, DNS verification, TLS) stays Phase 3.
- **D-03 (App Shell):** **Full sidebar nav** per the Hi-Fi prototype (212px, scrollable content). All final nav items are visible; not-yet-built feature screens are visible **"Coming soon" placeholders** (the shell feels complete). Landing after login = Dashboard/Overview.
- **D-04:** **Pixel-accurate design tokens** from the prototype (Geist typography, lime accent `#d7ff01`, spacing, radii) — UI-03. **Light/Dark theme toggle** (UI-02); theme preference persisted client-side in `localStorage`.
- **D-05 (Magic-link error UX):** Expired / already-used / invalid link → its own status page with a clear message and a "Request new link" button. No destination/account leak before verification.
- **D-06 (Session & Logout):** better-auth session cookie (httpOnly), survives browser refresh (AUTH-03). Logout action in the App Shell user menu, reachable from **every** page (AUTH-04).
- **D-07 (Security baseline — Phase-1 deferrals land here):** Phase 2 introduces **`@fastify/rate-limit`** (protects the magic-link-request and auth endpoints against email-bombing/brute-force) and **`@fastify/helmet`** (security-header baseline) — the two deliberately deferred findings WR-02/WR-04 from the Phase 1 code review. **Requires a new supply-chain approval** for the additional packages (Threat T-01-SC-Gate).

### Claude's Discretion

Exact better-auth configuration (`magicLink().sendMagicLink` → nodemailer transport from the Phase-1 SMTP ENV; Prisma adapter with the **same** generated client at `apps/api/src/generated/prisma`; `npx @better-auth/cli generate` for the auth tables), session cookie settings, Vue Router navigation guards, Pinia stores (`authSession`, `theme`), placement of the helpers (server-side in `apps/api`, DTOs in `packages/shared`), and the exact membership query — left to the researcher/planner based on CLAUDE.md's stack mandates.

### Deferred Ideas (OUT OF SCOPE)

- **Generic OIDC/SSO** — not in Phase 2 (roadmap lists only Magic Link AUTH-01…04). Later as an optional `sso` plugin toggle with Issuer URL/Client ID/Secret admin UI (Phase 10).
- **Full Team Management UI** (manage invites, assign roles in UI, list members) — its own later phase (Phase 9). Phase 2 builds only the authorization core + a minimal admin-invite path (add an allowed email).
- **Full Domain Lifecycle** (registration, DNS verification, on-demand TLS) — Phase 3.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User requests a magic link by entering their email on the login page | better-auth `magicLink()` `sendMagicLink` + nodemailer wiring; neutral-response pattern (§ Architecture Patterns, Pitfall 1) |
| AUTH-02 | User is signed in by clicking a valid, single-use, 15-minute magic link | `magicLink({expiresIn: 900})`; token consumed atomically on first verify; error page for expired/used/invalid (D-05) |
| AUTH-03 | Session survives browser refresh | better-auth session `expiresIn`/`updateAge` sliding-window default already satisfies this; httpOnly cookie + Pinia `authSession` store rehydration via `auth.api.getSession()` on app boot |
| AUTH-04 | User can log out from every page | Sidebar footer logout icon (UI-SPEC LOCKED layout) calling better-auth's sign-out endpoint from the persistent App Shell, present on every route |
| UI-01 | Persistent 212px sidebar + scrollable content App Shell | UI-SPEC "App-Shell — Layout Contract" (LOCKED); Vue 3 `<script setup>` layout component, no component library |
| UI-02 | Light/Dark theme toggle | Pinia `theme` store + `data-theme` attribute + `localStorage`, pre-paint hydration (§ Architecture Patterns, Pattern 3) |
| UI-03 | Pixel-accurate design tokens | UI-SPEC's full LOCKED token tables (spacing/typography/color) — implement CSS custom properties exactly as specified, no substitution |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `./.claude/CLAUDE.md` — binding, not open for re-litigation in this phase:

- better-auth `^1.6.x` with **`magicLink()` as the sole login method** — do NOT add an email/password plugin; `sso`/`genericOAuth` deliberately deferred to Phase 10.
- `prismaAdapter` from `better-auth/adapters/prisma` — bundled in the core `better-auth` package; CLAUDE.md explicitly says **do not** add a separate `@better-auth/prisma-adapter` package (flagged as an Open Question in this research since that package now genuinely exists on the registry — verify before deviating).
- Prisma adapter and `apps/api/src/db.ts` MUST import the client from the **same** generated path (`apps/api/src/generated/prisma`) — no second `PrismaClient` instance.
- nodemailer, configured entirely from ENV (`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`, already present in `env.ts`) — provider-neutral SMTP transport for `sendMagicLink`.
- `@fastify/rate-limit` on the magic-link-request and auth verify endpoints; `@fastify/helmet` as the security-header baseline — both explicitly named as this phase's job in CLAUDE.md and CONTEXT.md D-07.
- Do **NOT** add `@fastify/session` — better-auth owns session state exclusively; a second session plugin would create two competing sources of truth.
- Vue 3 Composition API `<script setup>` throughout; Pinia `^3.0.4` (not Vuex) for `authSession`/`theme` stores; Vue Router `^4.6.x` (not v5) for the App Shell's fixed ~7-screen nav.
- No component library / no Tailwind / no shadcn (per 02-UI-SPEC.md's Design System section) — hand-written scoped-CSS Vue SFCs with CSS custom properties, matching the locked prototype's inline-style approach.
- Test-Driven Development is mandatory project-wide: every requirement needs automated tests (unit + integration; critical flows E2E) before being considered done; `fastify.inject` is the default for backend integration tests; the real-Postgres testcontainers harness (not mocked Prisma) is mandatory for anything touching the DB — directly governs how `requireDomainAccess`/`scopedDomainIds` must be tested (D-02).
- User's **global** CLAUDE.md: run `pnpm tsc --noEmit` and rebuild `packages/shared` after any code change before declaring work done; escape literal `@` characters in any vue-i18n locale file (not yet in use this phase, but relevant if German UI copy strings are externalized to i18n JSON later).
- Security: passwords are out of scope entirely (no password login exists); protected/expired targets must never be embedded in HTML before verification — directly reinforced by D-05's generic error page for magic-link failures.

## Summary

Phase 2 has three intertwined deliverables that must be sequenced carefully: (1) a better-auth `magicLink()` integration mounted into the existing Fastify `buildApp()` factory ahead of the SPA fallback, backed by nodemailer and the same Prisma-7 generated client Phase 1 already established; (2) a domain-scoped authorization core (`requireDomainAccess`/`scopedDomainIds`) that is pure server-side logic, unit-tested against real Postgres via the Phase-1 testcontainers harness, with a schema (`DomainMembership`, minimal `Domain`) that exists purely to give the helper something real to query against — no domain UI yet; and (3) a pixel-accurate, theme-aware Vue App Shell that both hosts the login/error pages and gates all authenticated routes.

The trickiest correctness requirement is D-01's neutral response: better-auth's own documented behavior works in our favor here. The `signIn.magicLink` endpoint calls `sendMagicLink` unconditionally (it does not pre-check user existence before deciding whether to invoke the callback) and returns the same generic success response regardless of what happens inside that callback, as long as it does not throw. That means the allowlist check belongs entirely *inside* `sendMagicLink`: look up the email, and if it's not on the invite-only allowlist, silently return without sending mail or throwing — the HTTP response the client sees is identical either way. Combine this with `disableSignUp: true` so that even a stolen/guessed valid token can never create a new `User` row, and the seeded `INITIAL_ADMIN_EMAIL` account must therefore be pre-created (not just allowlisted) at boot, since disableSignUp blocks signup for everyone including the admin's first login.

The authorization core intentionally has zero feature routes depending on it yet (Phase 2 builds nothing that reads `DomainMembership` beyond its own tests) — this is a foundation phase. Because there's no Links/Domains UI to exercise it, its correctness must come entirely from the unit-test suite the CONTEXT.md and TDD mandate both require, run against the real-Postgres harness (`test/globalSetup.ts` + `test/setupFileEach.ts`), not from any integration test that would otherwise force premature Phase 3/4 scope in.

**Primary recommendation:** Use better-auth's own Fetch-API catch-all handler pattern (`fastify.route({method:['GET','POST'], url:'/api/auth/*', ...})`) registered before the static/SPA fallback, `magicLink({expiresIn: 900, disableSignUp: true, sendMagicLink: allowlistGatedSend})`, `prismaAdapter` imported from the bundled `better-auth/adapters/prisma` path (not the separate `@better-auth/prisma-adapter` npm package — see Package Legitimacy Audit), and build `requireDomainAccess`/`scopedDomainIds` as plain async functions in `apps/api/src/lib/authorization.ts` with a stable, minimal signature so Phases 3–9 can depend on it without churn.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Magic-link request/verify/session issuance | API / Backend | Database | better-auth owns token generation, hashing, cookie issuance server-side; Postgres persists Session/Account/Verification rows |
| Invite-only allowlist check | API / Backend | Database | Must happen server-side inside `sendMagicLink` — a client-side check would leak enumeration via timing/response differences |
| `requireDomainAccess` / `scopedDomainIds` | API / Backend | Database | Pure server-side authorization logic; queries `DomainMembership`. Never duplicated client-side — client only reflects what the API already filtered |
| Session cookie storage/refresh | Browser / Client | API / Backend | httpOnly cookie set by better-auth's Set-Cookie response header; browser auto-attaches it, cannot be read/manipulated by JS (XSS mitigation) |
| Auth-gating of App Shell routes | Browser / Client | API / Backend | Vue Router `beforeEach` guard is a UX convenience (fast redirect, no flash of protected content) — NOT a security boundary; the API independently re-checks session on every request |
| Theme persistence | Browser / Client | — | Pure client-side concern (`localStorage` + CSS custom properties); no server involvement per D-04 |
| App Shell layout/nav rendering | Browser / Client | — | Static Vue components per UI-SPEC's LOCKED layout contract |
| Domain/Membership minimal schema | Database | API / Backend | Schema exists to be queried by the authorization core; Prisma migration owns the DDL |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-auth | ^1.6.23 (latest stable; 1.7 is beta/rc — do not target) [VERIFIED: npm registry] | Auth framework — `magicLink()` plugin, session/cookie management | Fixed by project owner (CLAUDE.md); TypeScript-first, plugin architecture matches the exact shape needed (magicLink-only login, Prisma adapter, future SSO toggle) |
| `@better-auth/cli` | ^1.4.21 (latest; lags core's 1.6.x — this is the current published CLI version) [VERIFIED: npm registry] | `generate` command to scaffold the auth tables into `schema.prisma` | Official schema-generation tool; run once at implementation time via `npx @better-auth/cli generate`, then hand-verify the diff against the Prisma-7 custom `output` path before migrating |
| `@fastify/rate-limit` | ^11.1.0 [VERIFIED: npm registry] | Rate limiting on magic-link-request and auth endpoints (D-07, WR-02) | Official Fastify org plugin, matches Fastify 5's plugin-encapsulation major line (same major-version pairing already used in Phase 1 for `@fastify/cors`/`@fastify/static`) |
| `@fastify/helmet` | ^13.1.0 [VERIFIED: npm registry] | Security header baseline (CSP, HSTS, X-Frame-Options) (D-07, WR-04) | Official Fastify org plugin; same Fastify-5-targeted major line |
| Prisma ORM (existing) | ^7.8.0 (unchanged from Phase 1) [VERIFIED: npm registry] | Extend `schema.prisma` with `User`/`Session`/`Account`/`Verification`/`DomainMembership`/minimal `Domain` | Already locked in Phase 1; better-auth's Prisma adapter must import from the SAME `apps/api/src/generated/prisma` output path `db.ts` already uses |
| Vue Router | ^4.6.4 (existing) [VERIFIED: npm registry] | Client-side auth-gating, route meta (`requiresAuth`) | Already installed in `apps/web/package.json`; v4 per CLAUDE.md (not v5) |
| Pinia | ^3.0.4 (existing) [VERIFIED: npm registry] | `authSession` store (session/user/role state) + `theme` store | Already installed; official Vue-team state library |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nodemailer (existing) | ^9.0.3 | SMTP transport backing `sendMagicLink` | Already installed Phase 1; wire `createTransport({...SMTP_* from env.ts})` as the mail sender inside `sendMagicLink` |
| `@prisma/adapter-pg` (existing) | ^7.8.0 | Driver adapter Prisma 7 requires for `new PrismaClient({adapter})` | Already the pattern `db.ts` uses; better-auth's `prismaAdapter(prisma, {provider:'postgresql'})` wraps the SAME `prisma` instance, not a second client |
| zod (existing) | ^4.4.3 | Extend `envSchema` with `INITIAL_ADMIN_EMAIL` | Reuse the existing fail-fast `env.ts` pattern — add `.email()` validation, no new dependency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bundled `better-auth/adapters/prisma` import | Separate `@better-auth/prisma-adapter` npm package | The registry now shows this as a real, officially-maintained package (same maintainers as `better-auth` core, published within the last week — see Package Legitimacy Audit). CLAUDE.md's locked guidance explicitly says NOT to use it, based on an earlier research pass. This is flagged as an **Open Question** below — verify against the current better-auth docs at implementation time before committing to either import path, since the ecosystem may have shifted mid-project. |
| Fastify catch-all `fastify.route()` handler for better-auth | `toNodeHandler` + `reply.hijack()` | `reply.hijack()` bypasses Fastify's response lifecycle entirely, silently breaking `@fastify/helmet`/`@fastify/cors` header injection on auth routes — avoid it given D-07 mandates helmet on this exact surface |
| `disableSignUp: true` + in-callback allowlist check | A separate pre-check route that queries the allowlist before calling `auth.api.signInMagicLink` | A separate pre-check route would leak enumeration via response-time/shape differences between "allowed" and "not allowed" paths — the in-callback approach guarantees byte-identical responses because better-auth's own response is what's returned in both cases |

**Installation:**
```bash
# apps/api
pnpm --filter @kurzly/api add better-auth @fastify/rate-limit @fastify/helmet
pnpm --filter @kurzly/api add -D @better-auth/cli
```

**Version verification:** All versions above were checked via `npm view <pkg> version` against the live registry on 2026-07-11 (see Package Legitimacy Audit for full signal detail). `better-auth`'s `latest` dist-tag is `1.6.23`; a `1.7.0-rc.1`/`beta.10` line exists but is pre-release — do not target it for this phase.

## Package Legitimacy Audit

All packages checked via `gsd-tools query package-legitimacy check --ecosystem npm`.

| Package | Registry | Age signal | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-------------|-----------|--------------|---------|-------------|
| better-auth | npm | latest published 2026-06-29 | 4.5M/wk | github.com/better-auth/better-auth | SUS ("too-new") | Approved — see note below |
| @better-auth/cli | npm | latest published 2026-03-01 | 197K/wk | github.com/better-auth/better-auth | OK | Approved |
| @fastify/rate-limit | npm | latest published 2026-06-28 | 1.4M/wk | github.com/fastify/fastify-rate-limit | SUS ("too-new") | Approved — see note below |
| @fastify/helmet | npm | latest published 2026-07-08 | 1.7M/wk | github.com/fastify/fastify-helmet | SUS ("too-new") | Approved — see note below |
| nodemailer (existing dep) | npm | latest published 2026-06-30 | 14.5M/wk | github.com/nodemailer/nodemailer | SUS ("too-new") | Already approved in Phase 1; re-confirmed here since it's now load-bearing for AUTH-01 |
| @better-auth/prisma-adapter (NOT recommended — see Alternatives) | npm | latest published ~1 week ago | not queried (no download-count signal surfaced by the gate for this package) | github.com/better-auth/better-auth (same org as core) | Not run through the gate — surfaced via manual `npm view`, real official package, but excluded from Standard Stack per CLAUDE.md's locked guidance | Excluded — flagged as Open Question, not installed |

**Note on "too-new" SUS verdicts (better-auth, @fastify/rate-limit, @fastify/helmet, nodemailer):** identical situation to Phase 1's own audit — the heuristic flags packages whose *latest version* published recently, not brand-new/hallucinated packages. All four have multi-year-old GitHub repos under well-known orgs, weekly downloads from hundreds of thousands to millions, and match versions independently pinned in `.claude/CLAUDE.md`. Per the Package Legitimacy Gate protocol, **the planner must add one `checkpoint:human-verify` task before the first `pnpm add`** for this phase's new packages (better-auth, @fastify/rate-limit, @fastify/helmet, @better-auth/cli), consolidated rather than per-package, consistent with Phase 1's precedent.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** better-auth, @fastify/rate-limit, @fastify/helmet, nodemailer (re-confirmed) — all "too-new" only, not identity/trust concerns.

*The `@better-auth/prisma-adapter` package name was discovered via `npm view` (a direct registry check, not WebSearch/training data), so it is `[VERIFIED: npm registry]` to exist — but its recommendation status is `[ASSUMED]` uncertain: CLAUDE.md's locked guidance to avoid it predates this package's most recent publish, so the planner must gate this specific decision behind a `checkpoint:human-verify` (see Assumptions Log A1).*

## Architecture Patterns

### System Architecture Diagram

```
Browser (Vue 3 SPA, apps/web)
   │
   │  1. GET /login  →  App Shell not yet mounted (public auth route)
   │     user types email → POST /api/auth/sign-in/magic-link {email}
   ▼
┌───────────────────────────────────────────────────────────────────┐
│ Fastify buildApp() (apps/api/src/app.ts)                          │
│                                                                    │
│  Registration order (extends Phase 1's existing order):           │
│   1. Dev-only CORS (unchanged)                                    │
│   2. @fastify/helmet (NEW, D-07 — security headers, all routes)   │
│   3. @fastify/rate-limit (NEW, D-07 — global default + per-route  │
│      override tightened on /api/auth/sign-in/magic-link)          │
│   4. /api/* routes (existing canary + NEW authorization-consuming │
│      routes, though Phase 2 itself adds none beyond auth)         │
│   5. better-auth catch-all: /api/auth/*  (NEW — GET+POST)         │
│      ┌─────────────────────────────────────────────────────┐     │
│      │ auth.handler(req) — better-auth internal routing:    │     │
│      │  • POST .../sign-in/magic-link                        │     │
│      │      → sendMagicLink({email,url}):                    │     │
│      │          allowlisted? → nodemailer.sendMail(url)       │     │
│      │          not allowlisted? → no-op, return normally     │     │
│      │        (byte-identical HTTP response either way)       │     │
│      │  • GET  .../magic-link/verify?token=...                │     │
│      │      valid+unused+<15min → creates Session row,        │     │
│      │        Set-Cookie, redirect to callbackURL (/)         │     │
│      │      invalid/expired/used → redirect to                │     │
│      │        errorCallbackURL (/auth/error)                  │     │
│      │  • POST .../sign-out → clears Session, Set-Cookie       │     │
│      └─────────────────────────────────────────────────────┘     │
│   6. GET /health (existing)                                       │
│   7. GET /:slug redirect stub (existing, Phase 5 replaces)        │
│   8. @fastify/static (existing, wildcard:false)                   │
│   9. setNotFoundHandler: JSON 404 for /api/*, else index.html     │
└──────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
                 PostgreSQL (via Prisma 7 + @prisma/adapter-pg)
                   User | Session | Account | Verification
                   DomainMembership | Domain (minimal)
                            ▲
                            │  requireDomainAccess(userId, domainId, minRole)
                            │  scopedDomainIds(userId)
                            │  — plain async fns in apps/api/src/lib/
                            │    authorization.ts, ZERO callers yet
                            │    (Phase 2 only unit-tests them directly
                            │    against real Postgres via
                            │    test/globalSetup.ts)

Browser (after successful verify, cookie set):
   App Shell mounts (Vue Router beforeEach checks Pinia authSession,
   populated from GET /api/auth/get-session on boot)
   → Sidebar (212px) + Dashboard landing + "Coming soon" placeholders
   → Pinia theme store applies data-theme from localStorage pre-paint
```

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   ├── auth.ts              # betterAuth({...}) instance: magicLink, prismaAdapter, session config
│   └── authorization.ts     # requireDomainAccess(), scopedDomainIds(), Role hierarchy const
├── plugins/
│   ├── cors.ts               # existing
│   ├── static.ts             # existing
│   ├── helmet.ts             # NEW — registerHelmet(app)
│   └── rateLimit.ts          # NEW — registerRateLimit(app), tighter config on auth routes
├── routes/
│   ├── auth.ts               # NEW — mounts /api/auth/* catch-all to auth.handler
│   ├── canary.ts             # existing
│   ├── health.ts             # existing
│   └── redirect.ts           # existing stub
├── app.ts                    # extend registration order (helmet, rate-limit, auth route)
├── db.ts                     # unchanged — same generated Prisma client
├── env.ts                    # extend envSchema with INITIAL_ADMIN_EMAIL
└── server.ts                 # extend boot sequence: seed INITIAL_ADMIN_EMAIL after loadEnv(), before listen

apps/api/prisma/
└── schema.prisma             # extend: User, Session, Account, Verification (better-auth generated),
                               # DomainMembership, Domain (minimal) — new migration

apps/api/test/
├── authorization.test.ts     # NEW — requireDomainAccess/scopedDomainIds unit tests, real Postgres
├── auth.integration.test.ts  # NEW — magic-link round-trip via fastify.inject + Mailpit or a
│                              #       captured sendMagicLink spy
└── (existing harness files unchanged)

packages/shared/src/
└── index.ts                  # extend: Role enum/type, DomainMembership DTO shape,
                               # SessionUser DTO (id, email, role-agnostic — role is per-domain)

apps/web/src/
├── stores/
│   ├── authSession.ts        # NEW — Pinia store: user, isAuthenticated, fetchSession(), logout()
│   └── theme.ts               # NEW — Pinia store: theme ref, toggle(), localStorage sync
├── router/
│   └── index.ts               # NEW — routes + beforeEach guard (requiresAuth meta)
├── views/
│   ├── LoginView.vue          # NEW — Idle/Sent states (UI-SPEC Login Layout Contract)
│   ├── AuthErrorView.vue      # NEW — expired/used/invalid link (UI-SPEC Fehlerseite)
│   ├── DashboardView.vue      # NEW — landing screen
│   └── ComingSoonView.vue     # NEW — reusable placeholder for Links/QR/Analytics/Domains/Team
├── layouts/
│   └── AppShell.vue           # NEW — sidebar + content per UI-SPEC LOCKED layout
└── App.vue                    # extend — mount router-view under AppShell for authenticated routes
```

### Pattern 1: Fastify catch-all mount for better-auth (official pattern)
**What:** A single route registration that forwards to `auth.handler()`, converting Fastify's Node-style request into a Fetch API `Request` and the Fetch API `Response` back into a Fastify reply.
**When to use:** Always, for mounting better-auth on Fastify — this is better-auth's own documented integration approach for Fastify (not Express/Next.js, which use different adapters).
**Example:**
```typescript
// Source: better-auth.com/docs/integrations/fastify (WebFetch, MEDIUM confidence)
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

export async function authRoute(app: FastifyInstance): Promise<void> {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
```
Register this BEFORE `registerStatic()`/`setNotFoundHandler` in `app.ts`, mirroring the existing rule that API routes must never be shadowed by the SPA fallback (same rule Phase 1 already documented for `/api` and `/health`).

### Pattern 2: Neutral invite-only response (D-01)
**What:** Gate mail-sending inside `sendMagicLink`, never in a separate pre-check route.
**When to use:** Any time an allowlist/invite-only policy must not leak account existence via response differences.
**Example:**
```typescript
// Source: better-auth.com/docs/plugins/magic-link (WebFetch, MEDIUM confidence) +
// project-specific allowlist logic (this phase, LOW confidence — verify empirically in
// auth.integration.test.ts that both branches return byte-identical responses)
magicLink({
  expiresIn: 900, // 15 minutes — AUTH-02
  disableSignUp: true, // D-01: no auto-signup even for a valid future token
  sendMagicLink: async ({ email, url }) => {
    const allowed = await isEmailAllowed(prisma, email); // checks User.email (seeded/invited rows)
    if (!allowed) return; // silent no-op — DO NOT throw, DO NOT return an error object
    await mailer.sendMail({
      to: email,
      from: env.SMTP_FROM,
      subject: "Dein Kurzly Magic Link",
      html: magicLinkEmailHtml(url),
    });
  },
})
```
**Open question (see below):** whether `signIn.magicLink` internally short-circuits on `disableSignUp` BEFORE calling `sendMagicLink` for a truly nonexistent user is not confirmed by official docs in this research pass — write `auth.integration.test.ts` to assert the HTTP response body/status/timing is identical for an allowlisted vs. non-allowlisted email BEFORE relying on this pattern in the plan's verification steps.

### Pattern 3: Pre-paint theme hydration (UI-02, no FOUC)
**What:** Apply the persisted theme to the DOM before Vue mounts, so there's no flash of the wrong theme.
**When to use:** Always, for any `localStorage`-backed theme toggle.
**Example:**
```typescript
// Source: general Pinia/Vue theming pattern synthesis (WebSearch, MEDIUM confidence)
// apps/web/src/main.ts — runs synchronously before app.mount()
const stored = localStorage.getItem("kurzly-theme");
const theme = stored === "dark" || stored === "light" ? stored : "light";
document.body.dataset.theme = theme === "dark" ? "dark" : "";
```
The Pinia `theme` store then reads this same DOM state on init (avoiding a second source of truth), and a `watch()` on the store's theme ref keeps `document.body.dataset.theme` and `localStorage` in sync on toggle (UI-SPEC's LOCKED `body[data-theme="dark"]` CSS mechanism).

### Pattern 4: `requireDomainAccess`/`scopedDomainIds` stable signature
**What:** The single authorization path every Phase 3–9 route must call.
**When to use:** Any route touching a domain-scoped resource (from Phase 3 onward — Phase 2 has no such routes yet, only the helper + its tests).
**Example:**
```typescript
// apps/api/src/lib/authorization.ts — Phase 2 deliverable, zero callers yet
export const ROLE_RANK = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_RANK;

export class ForbiddenError extends Error {}

export async function requireDomainAccess(
  prisma: PrismaClient,
  userId: string,
  domainId: string,
  minRole: Role,
): Promise<void> {
  const membership = await prisma.domainMembership.findUnique({
    where: { userId_domainId: { userId, domainId } },
  });
  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(`User ${userId} lacks ${minRole}+ access to domain ${domainId}`);
  }
}

export async function scopedDomainIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const memberships = await prisma.domainMembership.findMany({
    where: { userId },
    select: { domainId: true },
  });
  return memberships.map((m) => m.domainId);
}
```
Keep the signature `(prisma, userId, domainId, minRole)` / `(prisma, userId)` stable — CONTEXT.md's Integration Points section explicitly calls out that Phases 3–9 depend on this exact shape not churning.

### Anti-Patterns to Avoid

- **Checking allowlist membership in a route BEFORE calling `auth.api.signInMagicLink`:** creates a response-shape/timing oracle for account enumeration — always gate inside `sendMagicLink` itself (Pattern 2).
- **`reply.hijack()` + `toNodeHandler`:** bypasses Fastify's plugin lifecycle, silently breaking `@fastify/helmet`'s header injection on auth routes — exactly the surface D-07 mandates helmet protect. Use the catch-all `fastify.route()` pattern instead (Pattern 1).
- **A second `PrismaClient` instance for better-auth:** must reuse the SAME client instance/generated-output path as `db.ts` — two separate clients against the same DB with the same schema risks connection-pool duplication and defeats the whole point of Phase 1's driver-adapter `max:1` pooling discipline used by the test harness.
- **Client-side-only route guards as the security boundary:** Vue Router's `beforeEach` is UX polish (avoid flashing protected content); it must never be the only check — every API route must independently verify the session server-side (this is what `auth.api.getSession()` / better-auth's session middleware does per-request).
- **Duplicating role-check logic ad hoc in future feature routes:** any Phase 3+ route that reimplements "is this user owner/admin of this domain" instead of calling `requireDomainAccess` violates D-02's single-authorization-path intent and creates drift risk.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Magic-link token generation, hashing, expiry, single-use enforcement | Custom crypto-random token + Postgres TTL table | better-auth `magicLink()` plugin | Token generation/hashing/atomic-consumption is exactly the kind of security-critical primitive that's easy to get subtly wrong (timing attacks on token comparison, race conditions on "used" flag) — better-auth already solved this and it's the project's locked auth framework |
| Session cookie signing/rotation/httpOnly/secure flags | Custom `express-session`-style cookie signing | better-auth's built-in session/cookie handling | Same rationale — cookie security flags and session-fixation protection are well-trodden, easy-to-misconfigure ground |
| Rate limiting (sliding window / token bucket) | Custom in-memory counter middleware | `@fastify/rate-limit` | Sliding-window rate limiting with proper `Retry-After` headers is nontrivial to get correct; official Fastify-org plugin already matches the project's Fastify-5 major line |
| Security headers (CSP, HSTS, X-Frame-Options, etc.) | Hand-set `reply.header(...)` calls per response | `@fastify/helmet` | Easy to miss headers or get CSP directive syntax wrong; helmet ships sane, auditable defaults that can be tuned |
| Role-hierarchy permission checks | Ad hoc `if (user.role === 'admin' || user.role === 'owner')` scattered across routes | Centralized `requireDomainAccess`/`scopedDomainIds` (D-02) | This is the exact problem D-02 exists to solve — scattering authorization logic is the #1 source of privilege-escalation bugs in multi-tenant apps (directly relevant to TEAM-06's later negative-test requirement) |

**Key insight:** Every "don't hand-roll" item above is either a security-critical primitive (auth/crypto/rate-limiting/headers) or the exact single-source-of-truth abstraction (D-02) the roadmap explicitly built this phase around. There is no discretionary hand-rolling risk in this phase's happy path — the risk is entirely in *bypassing* the chosen abstractions under time pressure in a later phase.

## Common Pitfalls

### Pitfall 1: `disableSignUp` blocks the seeded admin's own first login
**What goes wrong:** If `INITIAL_ADMIN_EMAIL` is only added to an "allowlist" table (not an actual `User` row) and `disableSignUp: true` is set, the admin's first magic-link click fails because better-auth refuses to auto-create the user.
**Why it happens:** `disableSignUp` is a blanket switch — it doesn't distinguish "first admin bootstrap" from "random invite-only signup attempt."
**How to avoid:** At boot (in `server.ts`, after `loadEnv()` and before `.listen()`), upsert a `User` row for `INITIAL_ADMIN_EMAIL` directly via Prisma (not via better-auth's signup flow) with `emailVerified: true`, then upsert an owner-level `DomainMembership`-equivalent admin flag (or however the "global admin" bit is modeled — see Open Questions). Verify this specific boot-then-login path with an integration test.
**Warning signs:** Admin's first magic-link click redirects to the generic error page instead of signing in; server logs show a `disableSignUp`/`signup disabled` rejection.

### Pitfall 2: Two Prisma clients pointed at the same database
**What goes wrong:** better-auth's `prismaAdapter(prisma, {...})` is initialized with a fresh `new PrismaClient()` (following a generic tutorial) instead of importing `db.ts`'s existing singleton — this silently creates a second connection pool and, worse, if the tutorial's client doesn't use the Prisma-7 `@prisma/adapter-pg` driver adapter, it won't even construct (`new PrismaClient()` without an adapter no longer type-checks per Phase 1's STATE.md finding).
**Why it happens:** Most better-auth+Prisma tutorials assume Prisma <7 and a default `@prisma/client` import; this project's Prisma 7 + custom generator output + driver-adapter combination is a superset most docs don't cover.
**How to avoid:** Import `prisma` from `apps/api/src/db.ts` directly into `apps/api/src/lib/auth.ts`; never construct a second `PrismaClient`.
**Warning signs:** TypeScript error on `new PrismaClient()` missing required `adapter`/`accelerateUrl`; duplicate connections visible in Postgres `pg_stat_activity` during dev.

### Pitfall 3: `@fastify/rate-limit` global default too permissive for the magic-link endpoint specifically
**What goes wrong:** Registering `@fastify/rate-limit` only with a single global `{max, timeWindow}` protects everything equally, but D-07's stated intent is specifically to stop email-bombing on the magic-link-request endpoint and brute-force on auth verify — a generic global limit (e.g. 100 req/min) does not meaningfully stop either.
**Why it happens:** Copy-pasting the simplest `@fastify/rate-limit` example (global registration only) satisfies "the plugin is installed" without satisfying the actual threat model.
**How to avoid:** Register a permissive global default, then apply a materially tighter per-route `config.rateLimit` override (Pattern 2's per-route config syntax) specifically on the `sign-in/magic-link` sub-path — e.g. 5 requests per 15 minutes per IP, matching the email-bombing threat this exists to stop.
**Warning signs:** Rate-limit is "on" per package.json but a scripted loop can still trigger dozens of magic-link emails per minute in a manual test.

### Pitfall 4: CSP breaking Google Fonts / inline styles the App Shell needs
**What goes wrong:** `@fastify/helmet`'s default CSP is `defaultSrc: ["'self'"]`-style strict, which blocks the Geist/Geist Mono Google Fonts `<link>` and any `style` attributes the hand-written Vue SFCs use, breaking UI-03's pixel-fidelity requirement at the CSP layer rather than the CSS layer.
**Why it happens:** Helmet's secure-by-default CSP doesn't know about this project's specific external font host or its no-Tailwind/no-CSS-framework hand-styled approach.
**How to avoid:** Explicitly allow `fonts.googleapis.com` (style-src) and `fonts.gstatic.com` (font-src) in the CSP directives when registering `@fastify/helmet`; verify the login page and App Shell render with the correct Geist fonts in a manual/browser check, not just an automated response-header assertion.
**Warning signs:** Fonts silently fall back to system sans-serif in the browser; DevTools console shows CSP violation errors for `fonts.googleapis.com`.

### Pitfall 5: Route order regression when adding the auth catch-all
**What goes wrong:** If `/api/auth/*` is registered AFTER `registerStatic()`/`setNotFoundHandler`, Fastify's SPA fallback (`index.html` for unmatched routes) could shadow auth routes, or — depending on exact registration order interplay with `wildcard: false` — auth requests could 404 instead of reaching `auth.handler()`.
**Why it happens:** Phase 1 established the "API routes before static fallback" rule for `/api` and `/health`, but it's easy to append the new auth route registration in the wrong spot in `app.ts` during a quick edit.
**How to avoid:** Register the auth catch-all inside the existing `/api` prefix scope (or immediately alongside it, before `registerStatic()`), matching the documented Phase 1 rule verbatim; add/extend `server.integration.test.ts` to assert a `GET /api/auth/ok`-style smoke request reaches the handler rather than falling through to the SPA shell.
**Warning signs:** `fastify.inject({url: '/api/auth/sign-in/magic-link', method: 'POST'})` in a test returns HTML (the SPA shell) instead of a JSON auth response.

## Code Examples

### Extending `envSchema` for `INITIAL_ADMIN_EMAIL`
```typescript
// Source: pattern extension of apps/api/src/env.ts (existing, HIGH confidence — direct reuse)
export const envSchema = z.object({
  // ...existing fields unchanged...
  INITIAL_ADMIN_EMAIL: z.email(),
});
```

### better-auth instance wiring (assembled from researched fragments — MEDIUM confidence, verify empirically)
```typescript
// apps/api/src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
import { prisma } from "../db.js";
import { mailer } from "./mailer.js";
import { isEmailAllowed } from "./allowlist.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7d — default, satisfies AUTH-03
    updateAge: 60 * 60 * 24,     // 1d sliding refresh
  },
  plugins: [
    magicLink({
      expiresIn: 900, // 15 min — AUTH-02
      disableSignUp: true, // D-01
      sendMagicLink: async ({ email, url }) => {
        if (!(await isEmailAllowed(prisma, email))) return; // neutral no-op
        await mailer.sendMail({ to: email, subject: "Dein Kurzly Magic Link", html: url });
      },
    }),
  ],
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| better-auth `toNodeHandler` for non-Next.js Node frameworks | Framework-specific catch-all adapters (Fastify's `fastify.route()` + `fromNodeHeaders`) recommended in current docs | Ongoing (better-auth is pre-1.0-cadence fast-moving even post-1.0) | `reply.hijack()`-based integrations found in older blog posts/tutorials are now explicitly discouraged because they break other Fastify plugins |
| `@better-auth/cli`'s bin invoked as `npx auth generate` in some docs pages vs. `npx @better-auth/cli generate` in others | Both resolve to the same installed CLI (`bin: better-auth`); prefer the explicit `@better-auth/cli` package name per CONTEXT.md's already-locked Claude's-Discretion wording | N/A — naming inconsistency across better-auth's own doc pages, not a version change | Cosmetic — either invocation works once `@better-auth/cli` is a devDependency; use the CONTEXT.md-specified form for consistency with the rest of this project's documentation |

**Deprecated/outdated:**
- `allowedAttempts` magicLink option: documented as deprecated/ignored — token consumption is now always atomic-on-first-attempt regardless of this setting. Do not configure it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `better-auth/adapters/prisma` (bundled) remains the correct import path rather than the newer standalone `@better-auth/prisma-adapter` npm package | Standard Stack, Alternatives Considered | If better-auth has actually migrated the Prisma adapter out of core in a version between CLAUDE.md's research pass and now, the bundled import could be missing/deprecated, breaking the build. Low likelihood (CLAUDE.md's own research already flagged and rejected the standalone package by name), but the standalone package's very recent publish date warrants a `checkpoint:human-verify` before implementation. |
| A2 | `sendMagicLink` fires unconditionally (no existence pre-check) even when `disableSignUp: true`, making the in-callback allowlist gate produce a byte-identical response for allowed vs. disallowed emails | Architecture Patterns Pattern 2 | If better-auth actually does pre-check existence when `disableSignUp` is set and returns a different response/status for unknown emails, D-01's neutral-response requirement is violated by default and needs an explicit response-normalizing wrapper around the route instead of relying on the plugin's native behavior. Must be verified with an integration test asserting response equality before relying on it. |
| A3 | The seeded `INITIAL_ADMIN_EMAIL` needs a directly-upserted `User` row (not just an allowlist entry) to survive `disableSignUp: true` on first login | Common Pitfalls, Pitfall 1 | If wrong, the bootstrap admin could be permanently locked out on first login in a fresh deployment — high severity for a self-hosted tool with no other admin escape hatch. Must be integration-tested end-to-end (seed → first magic-link login → session established) before considering AUTH-01–04 done for the admin path specifically. |
| A4 | better-auth's Fastify catch-all pattern (Pattern 1) is still the current-recommended approach and not superseded by a first-party Fastify plugin in the 1.6.x/1.7.x line | Architecture Patterns Pattern 1 | If better-auth ships an official `@better-auth/fastify` plugin between now and implementation, the hand-rolled catch-all becomes unnecessary boilerplate — not incorrect, just more code than needed. Low risk; worth a quick doc re-check at implementation time. |

**If this table is empty:** N/A — see entries above; all four require confirmation via integration tests or a fresh docs check before the planner treats them as settled.

## Open Questions

1. **Does `signIn.magicLink` short-circuit before invoking `sendMagicLink` when `disableSignUp: true` and the email has never signed up?**
   - What we know: Official docs describe `disableSignUp` as blocking *signup on verify*, and describe `sendMagicLink` as the mechanism invoked on *request*. No doc explicitly states the request-time code path's existence-check behavior.
   - What's unclear: Whether there's an early-return before `sendMagicLink` fires for a truly-never-seen email, which would produce a different response than the allowlisted path (violating D-01).
   - Recommendation: The plan's TDD verification step MUST include an integration test (`fastify.inject`) asserting HTTP status + response body are identical for a known-allowed vs. never-seen email. This is a P0 test, not optional polish — it directly verifies the security requirement D-01 exists to satisfy.

2. **Is `@better-auth/prisma-adapter` (the standalone npm package, confirmed to exist and be officially maintained) now the recommended path over the bundled `better-auth/adapters/prisma` import?**
   - What we know: The bundled import path is what CLAUDE.md locks in, based on an earlier research pass. The standalone package exists, is maintained by the same org/maintainers, and was published very recently (within the last week of this research date).
   - What's unclear: Whether better-auth has begun a migration toward per-ORM standalone adapter packages (common pattern as libraries mature) and whether the bundled path is now considered legacy/deprecated.
   - Recommendation: Before running `npx @better-auth/cli generate`, do a 2-minute check of the CURRENT `better-auth.com/docs/adapters/prisma` page's install instructions at implementation time (docs move faster than this research snapshot) — if it now says to install the standalone package, follow it and flag the CLAUDE.md discrepancy back to the user rather than silently deviating from a locked constraint.

3. **How should "global admin" (someone who can manage the allowlist/invites and isn't scoped to a single domain) be modeled given D-02's role model is domain-scoped (`DomainMembership`)?**
   - What we know: D-02 defines owner/admin/member as domain-scoped roles. D-01 talks about "an admin" adding allowed emails — implying at least one admin action that is NOT domain-scoped (managing the allowlist itself, which precedes any domain existing at all in Phase 2/3).
   - What's unclear: Whether Phase 2 needs a lightweight `User.isGlobalAdmin` boolean (or similar) separate from `DomainMembership`, or whether the seeded `INITIAL_ADMIN_EMAIL` is simply trusted as admin via some other mechanism (e.g. checked directly by email match) until Phase 3 introduces real domains to be an owner of.
   - Recommendation: Keep it minimal for Phase 2 — a `User.isAdmin` (or `role` on `User` itself, separate from the per-domain `DomainMembership.role`) boolean is the simplest model that satisfies D-01's "admin adds allowed emails" without overloading the domain-scoped role enum. Flag this schema decision explicitly in the plan for user/planner confirmation since CONTEXT.md's D-02b only mentions `DomainMembership` + minimal `Domain`, not a global-admin flag.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| SMTP transport (Mailpit, dev/test) | `sendMagicLink` integration tests (AUTH-01/02) | Not verified this session — assumed present per Phase 1's `docker-compose.dev.yml` (per CLAUDE.md's stack doc) | — | If absent, planner must add a Wave 0 task to stand up Mailpit locally before writing `auth.integration.test.ts` |
| Real-Postgres testcontainers harness | `authorization.test.ts` (D-02 unit tests) | ✓ (verified — `apps/api/test/globalSetup.ts` + `setupFileEach.ts` exist and are Phase-1-complete) | Postgres 18-alpine per Phase 1 | — |
| `better-auth`/`@better-auth/cli`/`@fastify/rate-limit`/`@fastify/helmet` | AUTH-01–04, D-07 | ✗ (not yet installed — this phase installs them) | See Standard Stack | None needed — installation is part of this phase's work; gated by the consolidated `checkpoint:human-verify` (Package Legitimacy Audit) |

**Missing dependencies with no fallback:** None — SMTP test double (Mailpit) has a documented fallback (stand it up as a Wave 0 task if not already running).

**Missing dependencies with fallback:** Mailpit/MailHog SMTP catcher — if not already running from Phase 1's dev compose file, the planner should add a small Wave 0 setup task rather than blocking the whole phase on it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.10 (apps/api and apps/web, both already configured per Phase 1) |
| Config file | `apps/api/vitest.config.ts` / `apps/web/vitest.config.ts` (existing — not read this session, assumed present per Phase 1's completed harness; confirm at plan time) |
| Quick run command | `pnpm --filter @kurzly/api test -- authorization.test.ts` (targeted) |
| Full suite command | `pnpm -r test` (matches Phase 1's CI full-suite pattern per STATE.md's 01-09 decision) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| AUTH-01 | Requesting a magic link for an allowlisted email triggers `sendMagicLink`/mail send | integration (`fastify.inject`) | `pnpm --filter @kurzly/api test -- auth.integration.test.ts` | ❌ Wave 0 |
| AUTH-01 (negative, D-01) | Requesting a magic link for a non-allowlisted email returns the SAME response as an allowlisted request, with no mail sent | integration, canary | same file, dedicated `test("neutral response for disallowed email", ...)` | ❌ Wave 0 |
| AUTH-02 | Clicking a valid, unused, <15-min token signs the user in (session cookie set) | integration | same file | ❌ Wave 0 |
| AUTH-02 (negative) | Expired / already-used / invalid token redirects to the error page, never leaks a target/account | integration + component (AuthErrorView renders correctly) | `auth.integration.test.ts` + `apps/web` component test | ❌ Wave 0 |
| AUTH-03 | Session persists across a simulated refresh (repeated `getSession()` calls within `updateAge` window) | integration | `auth.integration.test.ts` | ❌ Wave 0 |
| AUTH-04 | Sign-out clears the session; subsequent authenticated request is rejected | integration | `auth.integration.test.ts` | ❌ Wave 0 |
| D-02 `requireDomainAccess` | Denies access below `minRole`, allows at/above; unknown user/domain denies | unit, real Postgres | `pnpm --filter @kurzly/api test -- authorization.test.ts` | ❌ Wave 0 |
| D-02 `scopedDomainIds` | Returns exactly the domain IDs a user is a member of, empty array for a user with none | unit, real Postgres | `authorization.test.ts` | ❌ Wave 0 |
| UI-01/UI-02/UI-03 | App Shell renders sidebar/content per LOCKED layout; theme toggle flips `data-theme` + persists | component (`@vue/test-utils`) | `pnpm --filter @kurzly/web test -- AppShell.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `vitest run <file>` for the file(s) touched
- **Per wave merge:** `pnpm -r test` (both apps/api and apps/web full suites)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/test/authorization.test.ts` — covers D-02's `requireDomainAccess`/`scopedDomainIds` (no existing file; net-new)
- [ ] `apps/api/test/auth.integration.test.ts` — covers AUTH-01–04 + D-01's neutral-response canary (no existing file; net-new)
- [ ] `apps/api/src/lib/mailer.ts` test double / Mailpit wiring for asserting actual email content in integration tests, OR a `sendMagicLink` spy pattern if Mailpit isn't wired up yet
- [ ] `apps/web/test/AppShell.test.ts` (or equivalent) — covers UI-01/02/03 component-level assertions
- [ ] Confirm `apps/api/vitest.config.ts` and `apps/web/vitest.config.ts` exist and are wired to the same `globalSetup`/`setupFileEach` pattern already established (not re-verified in this research pass — read at plan time)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes | better-auth `magicLink()` — passwordless, single-use, short-TTL tokens (ASVS 2.1/2.5-aligned); no password storage in this phase at all |
| V3 Session Management | yes | better-auth httpOnly session cookie, `expiresIn`/`updateAge` sliding window, sign-out clearing session server-side (not just client cookie deletion) |
| V4 Access Control | yes | `requireDomainAccess`/`scopedDomainIds` — server-side, deny-by-default (unknown user/domain → denied); this phase builds the mechanism, TEAM-06 (Phase 9) proves it end-to-end |
| V5 Input Validation | yes | Existing `envSchema` (Zod) pattern extended for `INITIAL_ADMIN_EMAIL`; magic-link email input validated by better-auth's own schema before touching the allowlist check |
| V6 Cryptography | yes | Magic-link token generation/hashing delegated entirely to better-auth (`generateToken`/`storeToken` — do not hand-roll, see Don't Hand-Roll); `BETTER_AUTH_SECRET` already exists in `env.ts` from Phase 1 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Account enumeration via magic-link request endpoint | Information Disclosure | D-01's neutral response — allowlist check happens inside `sendMagicLink`, never in a separate pre-check route (Pattern 2); verified via canary test (Open Question 1) |
| Email-bombing / brute-force on magic-link request and verify endpoints | Denial of Service | `@fastify/rate-limit` with a tightened per-route config on `sign-in/magic-link` (D-07, Pitfall 3) |
| Session fixation / cookie theft | Spoofing / Information Disclosure | httpOnly + secure-in-production cookies (better-auth default); never expose the session token to client JS |
| Privilege escalation via missing/duplicated authorization checks in a future feature route | Elevation of Privilege | Centralized `requireDomainAccess`/`scopedDomainIds` as the single authorization path (D-02); this phase's unit tests are the first line of defense, TEAM-06's Phase 9 negative-test suite is the end-to-end proof |
| Missing security headers (clickjacking, MIME-sniffing, etc.) | Tampering / Spoofing | `@fastify/helmet` baseline (D-07), with CSP explicitly allowlisting the Google Fonts hosts this phase's UI needs (Pitfall 4) |
| Magic-link target/error leak before verification | Information Disclosure | D-05's generic error page — server never reveals WHY a token failed (expired vs. used vs. never-existed) in response body or timing |

## Sources

### Primary (HIGH confidence)
- `apps/api/src/app.ts`, `db.ts`, `env.ts`, `test/globalSetup.ts`, `test/setupFileEach.ts` (this repo, Phase 1 completed code) — route order, Prisma-7 driver-adapter pattern, real-Postgres TDD harness, all directly reused
- `npm view <pkg> version` direct registry checks (2026-07-11) for better-auth, @better-auth/cli, @fastify/rate-limit, @fastify/helmet, @better-auth/prisma-adapter
- `.planning/phases/01-.../01-RESEARCH.md` — Phase 1's own Package Legitimacy Audit format/precedent, route-order rationale

### Secondary (MEDIUM confidence)
- better-auth.com/docs/plugins/magic-link (WebFetch) — magicLink() plugin options, verify endpoint behavior
- better-auth.com/docs/integrations/fastify (WebFetch) — Fastify catch-all mounting pattern
- better-auth.com/docs/adapters/prisma (WebFetch) — Prisma adapter import path, Prisma 7 custom output note
- better-auth.com/docs/concepts/session-management, /docs/concepts/cookies (WebSearch synthesis) — session expiresIn/updateAge/cookieCache defaults
- better-auth.com/docs/concepts/cli (WebFetch) — generate command, `auth@latest` vs `@better-auth/cli` naming
- github.com/fastify/fastify-rate-limit, github.com/fastify/fastify-helmet READMEs (WebSearch synthesis) — per-route config syntax
- router.vuejs.org/guide/advanced/navigation-guards.html (WebSearch synthesis) — beforeEach + Pinia pattern

### Tertiary (LOW confidence)
- D-01 neutral-response mechanics (whether `sendMagicLink` fires unconditionally under `disableSignUp`) — reconstructed from doc wording, not an explicit statement; flagged in Assumptions Log A2 and Open Question 1, requires empirical test-driven confirmation
- Pinia theme-persistence pre-paint pattern — general web synthesis, not project-specific; standard enough to treat as low-risk despite LOW confidence tag

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH for existing/Phase-1-carried packages (Prisma, Vue Router, Pinia, nodemailer); MEDIUM for newly-introduced better-auth/@fastify/rate-limit/@fastify/helmet (versions verified via registry, integration patterns from docs/community sources without Context7)
- Architecture: MEDIUM — Fastify catch-all mounting and authorization-core design are well-grounded in official docs + Phase 1 precedent; the D-01 neutral-response mechanism specifically is an inference requiring empirical verification (see Open Question 1)
- Pitfalls: MEDIUM-HIGH — Pitfalls 2, 3, 5 are directly derived from this repo's own established patterns (high confidence); Pitfalls 1 and 4 are reasoned from documented plugin behavior + UI-SPEC constraints (medium confidence)

**Research date:** 2026-07-11
**Valid until:** 7 days — better-auth is explicitly a fast-moving library (1.7 beta/rc already exists alongside 1.6.23 stable at time of research) and this research's two lowest-confidence findings (Pattern 2's response-equality assumption, the standalone Prisma adapter package question) are exactly the kind of thing that can shift between research and implementation on this cadence.
