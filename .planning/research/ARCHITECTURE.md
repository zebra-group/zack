# Architecture Research

**Domain:** Self-hosted URL shortener / link-management SaaS-in-a-box (Kurzly)
**Researched:** 2026-07-10
**Confidence:** MEDIUM-HIGH (system-design patterns and Caddy/better-auth/qrcode specifics cross-checked via web search at MEDIUM confidence; Fastify/Prisma/Vue composition choices are well-established HIGH-confidence conventions, not novel claims)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Reverse Proxy / TLS terminator (Caddy)                                   │
│  - host-based routing: dashboard domain -> SPA+API ; customer domains -> │
│    redirect route                                                        │
│  - On-Demand TLS w/ "ask" endpoint hitting API's domain-verify lookup    │
├──────────────────────────────────────────────────────────────────────────┤
│                         Fastify process (single deployable)              │
│  ┌────────────────────────────┐   ┌───────────────────────────────────┐ │
│  │ Redirect scope (public)     │   │ Dashboard API scope (authed)      │ │
│  │  GET /:slug  (any domain)   │   │  /api/links, /api/qr, /api/domains│ │
│  │  GET /q/:code (dynamic QR)  │   │  /api/analytics, /api/team        │ │
│  │  - no auth, no session      │   │  - better-auth session required   │ │
│  │  - in-process hot-slug cache│   │  - per-domain authorization guard │ │
│  │  - password/expiry checks   │   │  - Prisma queries (full ORM)      │ │
│  │  - OG-tag injection for bots│   │                                    │ │
│  │  - fire-and-forget click log│   │                                    │ │
│  └──────────────┬───────────────┘   └────────────────┬──────────────────┘ │
├─────────────────┴────────────────────────────────────┴────────────────────┤
│                    Shared service/data-access layer (Prisma)              │
│   LinkService · DomainAuthService · QrService · ClickEventService         │
├──────────────────────────────────────────────────────────────────────────┤
│                          PostgreSQL (single instance)                     │
│   users/sessions (better-auth) · domains · domain_members · links        │
│   qr_codes · qr_remap_history · click_events                             │
├──────────────────────────────────────────────────────────────────────────┤
│  Vue 3 SPA (static build) — served by Caddy as static files on the       │
│  dashboard domain; calls the same Fastify API over /api                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| Caddy (edge) | TLS termination for dashboard domain (static cert) and N customer domains (On-Demand TLS gated by an "ask" endpoint), host-based routing to SPA vs Fastify | `docker-compose` service, `Caddyfile` with `tls { on_demand }` + `ask http://api:3000/internal/domain-verify` |
| Vue 3 SPA | Dashboard UI only (12 screens); never resolves redirects itself | Vite build → static files, served by Caddy or a tiny static file server |
| Fastify: redirect scope | Public, unauthenticated, host+slug → target resolution; password/expiry/OG logic; the one path that must never be slow or down | Fastify plugin registered with `fastify.register(redirectPlugin, { prefix: '/' })`, no session/auth hooks in its chain |
| Fastify: dashboard API scope | All authenticated CRUD (links, domains, QR, team, analytics) | Fastify plugin registered under `/api`, `preHandler` hooks for session + domain-authorization |
| Domain-authorization service | Central, single source of truth for "can this user touch this domain/link/qr/analytics row" | Pure function/service called from every dashboard route's `preHandler`, never re-implemented per-route |
| Hot-slug cache | Reduce DB round-trips for the redirect path's read-heavy traffic | In-process LRU (e.g. `lru-cache`) keyed by `host:slug`, or Redis if horizontally scaled later |
| Click-event pipeline | Record clicks without blocking the redirect response | Fire-and-forget `INSERT` (not awaited before responding), aggregated on read |
| QR generation | Turn dynamic/static QR config into scannable PNG/SVG with optional logo | Server-side `qrcode` (npm) + `sharp`/`canvas` for logo compositing, level-H error correction |
| better-auth | Session, magic link, OIDC | Mounted as a Fastify plugin at `/api/auth/*`, backed by Prisma adapter |
| PostgreSQL | System of record | Single instance in compose for v1; Prisma migrations |

## Recommended Project Structure

```
kurzly/
├── apps/
│   ├── web/                      # Vue 3 SPA (dashboard only)
│   │   ├── src/
│   │   │   ├── views/            # Links, LinkDetail, Qr, Analytics, Domains, Team
│   │   │   ├── stores/           # Pinia: auth, links, qr, domains, team, ui(theme/toast)
│   │   │   ├── api/              # typed fetch client (shares types from packages/shared)
│   │   │   └── components/
│   │   └── vite.config.ts
│   └── api/                      # Fastify backend (single deployable)
│       ├── src/
│       │   ├── redirect/         # PUBLIC scope — slug resolution, password/expiry, OG, cache
│       │   │   ├── plugin.ts
│       │   │   ├── resolve-slug.ts
│       │   │   ├── og-inject.ts
│       │   │   └── hot-cache.ts
│       │   ├── dashboard/        # AUTHED scope — one folder per resource
│       │   │   ├── links/
│       │   │   ├── qr/
│       │   │   ├── domains/
│       │   │   ├── analytics/
│       │   │   └── team/
│       │   ├── auth/             # better-auth plugin wiring, OIDC config
│       │   ├── authz/            # domain-authorization service (THE guard, used everywhere)
│       │   ├── click-tracking/   # event writer + aggregation queries
│       │   ├── qr-render/        # server-side PNG/SVG generation
│       │   └── plugins/          # prisma client decoration, cors, rate-limit, etc.
│       └── prisma/
│           └── schema.prisma
├── packages/
│   └── shared/                   # types shared between web & api (Link, Domain, Qr, Role...)
├── docker-compose.yml            # postgres, caddy, api (serves /api + redirect), web (static)
├── Caddyfile
└── Dockerfile(s)
```

### Structure Rationale

- **Monorepo, two apps (`web`, `api`), one shared package:** the SPA and API have different runtimes and deploy artifacts (static bundle vs Node process), but share types (Link, Domain, Role, Qr) and evolve together for a small OSS project — a monorepo with a shared-types package avoids drift without the overhead of separate repos/publish cycles. This is the standard pattern for Vue+Fastify+Prisma stacks distributed as a single docker-compose project.
- **`redirect/` vs `dashboard/` as separate Fastify plugin scopes, not separate services (v1):** see "The Critical Split" below — logical separation now, physical separation later if needed, with zero rewrite cost because both scopes already only talk to the DB through the same service layer.
- **`authz/` is its own module, not scattered per-route:** the spec's hard requirement ("EVERY link/qr/analytics operation must be authorized server-side against `user.domains[]`") is best enforced structurally — one `requireDomainAccess(user, domainId)` helper wired into every dashboard route's `preHandler`, so a missed check is a code-review-visible omission, not a scattered bug class.
- **`prisma/schema.prisma` lives inside `apps/api`:** the API is the only consumer of the DB; keeping the schema next to its consumer avoids a third "packages/db" package for a single-writer system.

## The Critical Split: Redirect Handler vs Dashboard API

**Recommendation: one Fastify service (one Node process, one docker image), two logically separated route trees — not two separate services for v1.**

Reasoning:
- The redirect path (`GET /:slug` on arbitrary customer domains) and the dashboard API (`/api/*` on the dashboard domain) have very different traffic profiles — redirect is unauthenticated, read-heavy, latency-critical (core value: "muss der Redirect-Handler korrekt und schnell funktionieren"); dashboard API is authenticated, low-volume, CRUD-shaped. This is the same read:write imbalance (~100:1 reads) that public URL-shortener system-design writeups converge on, and the standard mitigation is architectural separation of the hot path from the management path — but *separation of concerns*, not necessarily separation of *deployables*, at self-hosted single-tenant-per-instance scale.
- Splitting into two Node processes/services in a docker-compose self-hosted product adds real operational cost (two images to build/update, two health checks, inter-service auth for shared Prisma access or a shared DB pool) that is not justified until traffic actually requires independent scaling. Kurzly is one org's self-hosted instance serving that org's own domains — not multi-tenant bit.ly-at-scale. A single Fastify process comfortably serves both if the redirect path is engineered correctly (see below).
- **Non-negotiable engineering rules to keep the redirect path fast regardless of process topology:**
  1. The redirect route registers **no** session/auth `preHandler` chain — it must not touch better-auth's session lookup at all.
  2. Slug resolution goes through an **in-process hot-slug cache** (LRU, e.g. `lru-cache`, keyed by `${host}:${slug}`) in front of Prisma; cache invalidated on link update/delete/expire-toggle. This directly follows the standard "cache-then-DB-fallback" redirect design pattern.
  3. Click-event writes are **fire-and-forget** (`clickEventService.record(...)` called without `await`ing before the redirect response is sent, wrapped in a try/catch that only logs) — tracking must never add latency or become a failure mode for the redirect itself.
  4. Password/expiration checks are pure, synchronous-feeling logic against already-cached link data — no extra joins beyond what the slug lookup already fetched.
  5. OG-tag injection for bots (checking `User-Agent` against a known crawler list — Slackbot, Twitterbot, facebookexternalhit, LinkedInBot, Discordbot, etc.) renders a minimal HTML page with `<meta property="og:*">` tags instead of issuing the 302; human requests get the plain redirect. This branch must not fetch or reveal the real target for password-protected/expired links (explicit spec requirement) — OG injection and password/expiry checks share one gate: resolve → check protected/expired → only then decide "bot → OG page" or "human → 302".
- **Escape hatch (documented, not built now):** because both scopes already go through the same service layer (`LinkService`, `ClickEventService`) rather than inlined DB calls, splitting the redirect scope into its own Fastify instance/deployable later (e.g. if one customer domain gets slammed) is a deployment change, not a rewrite — same code, mounted under a second `apps/api` entrypoint (`redirect-only.ts`) reusing the `redirect/` plugin.
- **Caching for hot slugs, concretely:** v1 = in-process LRU per Fastify worker (simplest, zero extra infra, correct for single-instance self-hosted deployments which is the default in the compose file). If/when the deployment scales to multiple API replicas behind a load balancer, swap the LRU for Redis (shared cache) — call this out explicitly as a phase-specific "if you outgrow single-instance" note, not a v1 requirement, since a Redis dependency in the default docker-compose raises the self-hosting bar for no v1 benefit.

## Multi-Domain Routing & TLS

- **Host-based routing at the edge (Caddy):** the dashboard's own domain (e.g. `app.kurzly.example`) routes to the SPA (static files) + `/api/*`. Every other verified customer domain (`s.meinefirma.de`, `acme.io`, ...) routes to the Fastify redirect scope only — the API never needs to know "which domain routing config" beyond a `domains` table lookup on each request, because host routing happens *before* Fastify (Caddy) or, if Fastify handles multiple hostnames itself, via a single catch-all route that reads `request.hostname` and looks up `domains` in Postgres.
- **TLS strategy — per-domain certs via On-Demand TLS, not wildcard:** customer domains are arbitrary third-party domains/subdomains the operator doesn't control DNS for as a wildcard zone (`s.meinefirma.de` is *their* subdomain, pointed via CNAME at the Kurzly instance) — wildcard certs are not applicable across domains you don't own. Caddy's **On-Demand TLS** is the fitting pattern: Caddy requests a cert during the *first* TLS handshake for a previously unknown hostname, gated by an internal "ask" endpoint that Caddy calls to confirm the hostname is an actually-registered-and-DNS-verified domain in Kurzly before issuing — this both implements the spec's "TLS wird nach DNS-Verifizierung automatisch ausgestellt" requirement and prevents abuse (anyone pointing a random domain at the server would otherwise burn Let's Encrypt rate limits). The Domains screen's "DNS prüfen" action is exactly the trigger that flips a domain's status to verified/allowed in that ask-endpoint's backing table.
- **Rate-limit awareness:** Let's Encrypt allows 300 new cert orders per account per 3 hours and 50 certs per registered domain per week — comfortably sufficient for the expected scale of a self-hosted team tool's domain list, but worth a one-line pitfall note (batch-adding hundreds of domains at once would need throttling).
- **The dashboard domain itself** can use a normal static Caddy TLS entry (automatic HTTPS, not on-demand) since it's known at config time; only customer redirect-domains go through the on-demand path.

## Data Model (Prisma Schema Outline)

```prisma
// --- better-auth tables (managed via better-auth's Prisma adapter/generator) ---
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  role          Role     @default(MEMBER)   // admin | member — app-level, drives authz
  status        UserStatus @default(PENDING) // pending until first successful login
  createdAt     DateTime @default(now())

  sessions      Session[]
  accounts      Account[]        // better-auth: credential/oidc account links
  domainAccess  DomainMember[]   // domain scoping for MEMBER role
}

enum Role { ADMIN MEMBER }
enum UserStatus { PENDING ACTIVE }

model Session { /* better-auth managed: id, userId, token, expiresAt, ipAddress, userAgent */ }
model Account { /* better-auth managed: id, userId, providerId, accountId, oidc tokens */ }
model Verification { /* better-auth managed: magic-link / OTP tokens */ }

// --- domain/link core ---
model Domain {
  id         String   @id @default(cuid())
  hostname   String   @unique               // e.g. "s.meinefirma.de"
  status     DomainStatus @default(PENDING)  // pending | active
  createdAt  DateTime @default(now())

  members    DomainMember[]
  links      Link[]
}
enum DomainStatus { PENDING ACTIVE }

model DomainMember {                        // MEMBER-role scoping: user.domains[]
  id        String  @id @default(cuid())
  userId    String
  domainId  String
  user      User    @relation(fields: [userId], references: [id])
  domain    Domain  @relation(fields: [domainId], references: [id])
  @@unique([userId, domainId])
}

model Link {
  id            String    @id @default(cuid())
  domainId      String
  slug          String
  target        String
  createdById   String
  passwordHash  String?                      // hashed, never the plaintext
  expiresAt     DateTime?
  trackingOn    Boolean   @default(true)
  utmSource     String?
  utmMedium     String?
  utmCampaign   String?
  ogTitle       String?
  ogDescription String?
  ogImageUrl    String?
  createdAt     DateTime  @default(now())

  domain        Domain    @relation(fields: [domainId], references: [id])
  qrCodes       QrCode[]
  clickEvents   ClickEvent[]
  @@unique([domainId, slug])
  @@index([domainId, slug])                  // hot path lookup
}

model QrCode {
  id           String   @id @default(cuid())
  code         String   @unique              // the /q/:code slug
  name         String
  dynamic      Boolean  @default(true)
  linkId       String?                       // current target link (null for static-only codes)
  color        String?  @default("#17170f")
  logoUrl      String?
  logoEnabled  Boolean  @default(false)
  roundedModules Boolean @default(false)
  scans        Int      @default(0)
  createdAt    DateTime @default(now())

  link         Link?    @relation(fields: [linkId], references: [id])
  remapHistory QrRemapHistory[]
}

model QrRemapHistory {
  id         String   @id @default(cuid())
  qrCodeId   String
  fromLinkId String?
  toLinkId   String
  changedAt  DateTime @default(now())
  qrCode     QrCode   @relation(fields: [qrCodeId], references: [id])
}

model ClickEvent {
  id         String   @id @default(cuid())
  linkId     String
  occurredAt DateTime @default(now())
  referrer   String?
  country    String?                          // derived via geoip-lite, no third-party call
  userAgent  String?
  link       Link     @relation(fields: [linkId], references: [id])
  @@index([linkId, occurredAt])                // aggregation queries filter+sort on this
}
```

Notes on the sketch:
- `User.role` + `DomainMember` is the whole authorization model: `ADMIN` bypasses `DomainMember` entirely; `MEMBER` is scoped to the domains they have a `DomainMember` row for. This directly maps to the spec's two-role, domain-assignment model — no need for a generic RBAC/permissions table, which would be over-engineering for exactly two roles.
- `better-auth`'s own tables (`Session`, `Account`, `Verification`) are generated/managed by better-auth's Prisma adapter — do not hand-rewrite their shape; run better-auth's schema generator and extend `User` with the app-specific `role`/`status`/`domainAccess` fields it supports as "additional fields."
- `QrCode.linkId` nullable + `QrRemapHistory` gives the "printed code stays valid, target is swappable" behavior and the remap audit trail the Team/QR screens display.
- No separate `AggregatedClick`/rollup table in the v1 sketch — see the Click Tracking Pipeline section for why on-read aggregation is the right v1 default and when to add one.

## Server-Side Authorization Layer

**Rule: every dashboard route (links, qr, domains-for-members, analytics, team) resolves the authenticated user, then calls one shared `authz` check before touching Prisma — never trust the UI's domain filter.**

```typescript
// apps/api/src/authz/domain-access.ts
export async function requireDomainAccess(
  user: SessionUser,
  domainId: string,
  prisma: PrismaClient
): Promise<void> {
  if (user.role === 'ADMIN') return; // admins bypass — full access
  const membership = await prisma.domainMember.findUnique({
    where: { userId_domainId: { userId: user.id, domainId } },
  });
  if (!membership) throw new ForbiddenError('No access to this domain');
}

// used in every dashboard route's preHandler, e.g.:
fastify.get('/api/links/:id', {
  preHandler: [requireSession, resolveDomainOfLink, requireDomainAccessFromParam],
}, handler);
```

- For **list** endpoints (e.g. `GET /api/links`), the authorization layer doesn't filter client-side — the Prisma query itself is scoped: `WHERE domainId IN (adminBypass ? allDomainIds : memberDomainIds)`. A helper `scopedDomainIds(user)` returns either "all" (admin) or the member's `DomainMember` domain list, and every list query for links/qr/analytics is built through that helper — this is what keeps "Mitglied sieht nur zugewiesene Domains" true even for aggregate/analytics endpoints, not just single-resource fetches.
- For **write/mutate** operations on an existing resource (link/qr update, password change, tracking toggle), resolve the resource's `domainId` first, then call `requireDomainAccess` — never rely on the request body's claimed domain.
- Team management routes (invite, change role, assign domains) are **admin-only**, enforced by a simple `requireRole('ADMIN')` preHandler, no domain scoping needed there.
- OIDC-provisioned users default to `MEMBER` with no domain assignments (per spec) — an admin must explicitly grant domain access afterward; this is enforced by setting `role: MEMBER, domains: []` at account-creation time in the better-auth OIDC user-created hook, not left to a default DB column value alone (so the empty-array intent is explicit code, easy to audit).

## Click Tracking Pipeline

**Write path:** on every resolved redirect where `link.trackingOn === true`, fire-and-forget insert into `click_events` (referrer from `Referer` header, country via local IP→country lookup, user agent). If `trackingOn === false`, skip entirely — no event is written, satisfying "bei aus werden keine Klickdaten gespeichert."

**Country derivation without third-party services:** use `geoip-lite` (or `geoip-country`) — both bundle a MaxMind-GeoLite2-derived database inside the npm package/on-disk file, so country lookup is a pure in-process function call with zero network calls at request time (no external API dependency, consistent with the "kein Drittanbieter-Tracking" requirement). Trade-off to note: the bundled database is a point-in-time snapshot that ages between package updates — acceptable for country-level accuracy in this product; document a periodic `npm update geoip-lite` (or equivalent DB refresh) as a maintenance task, not a blocker.

**Referrer derivation:** parse the standard `Referer` request header (present when redirected from a link on another page/app; often absent for direct/QR-code scans — bucket those as "Direct").

**Aggregation strategy — on-read for v1, not on-write:** at self-hosted single-org scale (dozens to low-thousands of clicks/day per instance, not internet-scale), aggregating from raw `click_events` at query time (`GROUP BY DATE(occurredAt)`, `GROUP BY country`, `GROUP BY referrer`, filtered by `linkId IN (...)` and a date range) with the `@@index([linkId, occurredAt])` index is fast enough and avoids building a second write path (rollup table + upsert-increment logic) that only pays off past a scale this product isn't targeting. Build it this way for v1; call out an **explicit scaling trigger** for later: if a single instance's `click_events` table grows into the tens of millions of rows and dashboard queries slow down, introduce a nightly/hourly rollup table (`click_daily_stats(linkId, day, country, referrer, count)`) populated by a scheduled job, and have analytics endpoints read from the rollup for historical ranges + raw table for "today." Do not build the rollup path in v1 — it's premature complexity for the stated scale and adds a second source of truth to keep consistent.

## QR Export Architecture

**Recommendation: server-side generation.**

- The Fastify API exposes render endpoints (e.g. `GET /api/qr/:id/export.png`, `GET /api/qr/:id/export.svg`) that take the QR's stored config (color, logo on/off + logoUrl, rounded modules) and generate the file on demand using the `qrcode` npm package (industry-standard, supports `png`/`svg`/`utf8` output and error-correction levels `L/M/Q/H`).
- **Error correction level H** is used whenever a logo overlay is enabled (per spec: "Fehlerkorrektur-Level entsprechend hoch wählen") — QR codes retain scannability with up to ~30% of modules obscured/incorrect at level H, which is what allows a centered logo to sit "under" the code without breaking decodability.
- **SVG path:** `qrcode`'s SVG output is markup, so injecting a `<image>` element for the logo and adjusting module `rx`/`ry` for "rounded modules" is straightforward string/DOM manipulation — no extra imaging dependency.
- **PNG path:** compositing a logo bitmap onto the generated PNG raster needs an imaging library (`sharp` recommended — already a common self-hosted-friendly dependency, faster and lighter than `node-canvas` which needs native Cairo bindings that complicate Docker images) to draw the QR PNG, then the logo PNG centered on top, then flatten to one PNG buffer.
- **Why server-side over client-side:** (1) consistent, print-quality output regardless of browser/canvas quirks; (2) the same generation code produces both the on-screen QR-Studio preview and the downloadable export — no drift between preview and file; (3) keeps the SPA free of imaging dependencies/bundle size; (4) server-side is what "echter Export" in the spec's Assets note calls for (prototype fakes exports, production needs a real library) — client-only generation would still need a QR *library* in the browser anyway, so centralizing in the API is strictly less duplication.
- The **QR-Studio preview** in the Vue SPA can call the same `export` endpoint with query params reflecting live control state (debounced) and render the returned image inline — one code path, no duplicate client-side QR rendering logic.

## Suggested Build Order / Component Dependencies

```
1. Prisma schema + migrations + better-auth Prisma adapter wiring
      └─▶ 2. better-auth plugin: magic-link login, session middleware
              └─▶ 3. Domains: CRUD + status (pending/active) + Caddy on-demand
                     "ask" endpoint stub (DNS-verify can be simulated first,
                     real DNS lookup + Caddy wiring can follow)
                        │
                        ├─▶ 4. Authorization layer (authz/domain-access.ts) +
                        │      DomainMember model — build this BEFORE any
                        │      link/qr/analytics route, since every one of
                        │      those routes depends on it (core spec requirement)
                        │
                        └─▶ 5. Links CRUD (create/list/detail) — gated by (4)
                               │
                               ├─▶ 6. Redirect handler (slug→target, hot-cache,
                               │      password check, expiry→410, OG injection
                               │      for bots) — THIS is the core-value path;
                               │      build and harden it right after Links
                               │      CRUD exists, ahead of QR/analytics polish
                               │
                               ├─▶ 7. Click-tracking write path (fire-and-forget
                               │      on redirect) + on-read aggregation queries
                               │      + Analytics screens (global + per-link)
                               │
                               ├─▶ 8. QR codes: schema + server-side render
                               │      endpoints + remap + history — depends on
                               │      Links existing (QR maps to a Link)
                               │
                               └─▶ 9. UTM builder + OG-tag custom fields — pure
                                      Link metadata + Vue form additions, low
                                      risk, can be done in parallel with 7/8

10. Team management (invite, roles, domain assignment UI) — depends on (4)
       └─▶ 11. OIDC/SSO integration (optional, additive) — depends on (2) & (10)
              (defaultRole/organizationProvisioning wiring for new SSO users)

12. Vue SPA shell + all 12 screens — can start in parallel from step 1 against
    a mocked API client, but each screen's *real* data wiring is gated by its
    corresponding backend step above (Links screen needs 5, Redirect-adjacent
    password/expiry public pages need 6, Analytics needs 7, QR needs 8, Team
    needs 10/11).
```

Key dependency takeaways for roadmap phasing:
- **Authorization (step 4) is a hard blocker for steps 5, 7, 8, 10** — do not schedule any link/qr/analytics/team phase before the domain-scoping guard exists, or those phases will need rework to retrofit checks (exactly the failure mode the spec explicitly warns against: "nicht nur UI-seitig ausblenden").
- **The redirect handler (step 6) is the product's stated core value** and has the fewest upstream dependencies (just Links existing) — it should be treated as an early, dedicated phase rather than bundled into general "Links feature" work, so its correctness/performance gets focused attention and testing (password-protection, expiration→410, OG-bot-detection, cache invalidation on link edit are each nontrivial edge cases worth their own test suite).
- **Click tracking (7) and QR (8) are independent of each other** and can be parallelized once (5)/(4) land.
- **OIDC (11) is strictly additive** on top of magic-link auth and Team management — safe to schedule last without blocking anything else.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Splitting redirect and dashboard into separate services on day one
**What people do:** Reach for a "microservices from the start" design because system-design writeups about bit.ly-scale services describe separate redirect/API services with Kafka-based analytics pipelines.
**Why it's wrong:** Adds Docker images, inter-service networking, and duplicated Prisma clients/connections for a self-hosted single-tenant product that will never see bit.ly-scale traffic; slows down v1 delivery for no measurable benefit.
**Instead:** One Fastify process, two plugin scopes, a shared service layer designed so the split is *possible* later without a rewrite (see "Critical Split" section).

### Anti-Pattern 2: UI-only domain filtering for MEMBER role
**What people do:** Filter the domain dropdown/tabs client-side and assume the API "obviously" only returns what the UI asked for.
**Why it's wrong:** Any direct API call (curl, modified request) from a MEMBER account would read/write another domain's links, QR codes, or analytics — a real data-leak/privilege-escalation bug, and the spec explicitly calls this out as a must-not-happen.
**Instead:** Every dashboard route enforces `requireDomainAccess`/`scopedDomainIds` server-side, independent of what the client requested; treat the UI filter as UX convenience only.

### Anti-Pattern 3: Awaiting click-event writes before responding to the redirect
**What people do:** `await prisma.clickEvent.create(...)` before sending the 302, because it's the simplest code to write.
**Why it's wrong:** Couples the product's core-value latency (the redirect) to database write latency and to tracking being enabled/healthy at all — a slow or failing analytics write should never slow down or break a redirect.
**Instead:** Fire-and-forget the write (call it, don't await it before responding; catch/log errors separately) — or, if stronger durability is desired later, push to an in-memory queue flushed on an interval, but never block the redirect on it.

### Anti-Pattern 4: Building a wildcard-cert / single shared cert strategy for customer domains
**What people do:** Try to get one certificate to cover all customer domains to "simplify" TLS.
**Why it's wrong:** Customer domains are arbitrary third-party domains the operator doesn't control DNS for as a single wildcard zone — a wildcard cert only covers `*.onedomain.tld`, not unrelated domains brought by different customers.
**Instead:** Per-domain certs via Caddy On-Demand TLS, gated by an ask-endpoint tied to the `Domain.status === ACTIVE` check that the "DNS prüfen" flow sets.

## Scaling Considerations

| Concern | Single self-hosted instance (v1 target) | Growing team / many domains | Heavy public-facing redirect traffic |
|---------|------------------------------------------|------------------------------|----------------------------------------|
| Redirect caching | In-process LRU cache | Same, tuned cache size | Add Redis as shared cache across replicas |
| DB | Single Postgres container in compose | Same, add read replica only if needed | Connection pooling (PgBouncer), consider read replica |
| Click aggregation | On-read `GROUP BY` queries | Same, watch query latency | Add scheduled rollup table (`click_daily_stats`) |
| Redirect vs API | One Fastify process, two plugin scopes | Same | Split redirect scope into its own replica set behind Caddy, keep dashboard API separate |
| TLS | Caddy On-Demand TLS, one instance | Same | Multiple Caddy/edge replicas sharing cert storage (Caddy supports distributed storage backends) |

Realistically, for a self-hosted team tool, the first bottleneck (if any) is dashboard analytics query latency on the raw `click_events` table once a link accumulates a very large history — mitigated by the index already in the schema sketch and, if needed later, the rollup table. The redirect path itself, with an in-process cache, will comfortably outperform what a single self-hosted team's traffic requires.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| SMTP (for magic-link email) | better-auth's email hook → `nodemailer` transport configured via ENV vars | Provider-neutral per spec; no vendor lock-in |
| OIDC provider (Keycloak/Authentik/Azure AD, optional) | better-auth generic-OIDC/SSO plugin, `organizationProvisioning.defaultRole` for new users | Callback path `/api/auth/callback/oidc` per spec |
| Let's Encrypt | Caddy On-Demand TLS + ACME, gated by internal "ask" endpoint | Respect LE rate limits (300 orders/3h, 50 certs/domain/week) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Vue SPA ↔ Fastify dashboard API | REST/JSON over `/api/*`, session cookie from better-auth | Typed via shared `packages/shared` types |
| Redirect scope ↔ shared service layer | Direct in-process function calls (same Node process) | Never route through `/api/*` internally — no self-HTTP-calls |
| Fastify ↔ Prisma/Postgres | Prisma Client, one pool shared by both scopes | Redirect-path queries must be indexed/cache-fronted; dashboard queries can be less latency-sensitive |
| Caddy ↔ Fastify (ask endpoint) | Internal HTTP call, not exposed publicly | Should live under an internal-only route, not `/api/*` public surface |

## Sources

- [Better Auth — SSO plugin (organizationProvisioning.defaultRole)](https://better-auth.com/docs/plugins/sso) — MEDIUM confidence (web search, cross-checked against multiple better-auth doc pages)
- [Better Auth — Generic OAuth plugin](https://better-auth.com/docs/plugins/generic-oauth) — MEDIUM confidence
- [Caddy — On-Demand TLS](https://caddyserver.com/on-demand-tls) — MEDIUM confidence (official Caddy docs, corroborated by multiple independent write-ups)
- [Caddy — Automatic HTTPS](https://caddyserver.com/docs/automatic-https) — MEDIUM confidence
- [Caddy Community — On-Demand TLS multi-container multi-domain reverse proxy](https://caddy.community/t/on-demand-tls-multi-container-reverse-proxy-with-different-domains-to-be-validated/23000) — MEDIUM confidence
- [Honeybadger — How to serve secure custom domains with Caddy](https://www.honeybadger.io/blog/secure-custom-domains-caddy/) — MEDIUM confidence
- [npm — qrcode (soldair/node-qrcode)](https://www.npmjs.com/package/qrcode) — MEDIUM confidence
- [GitHub — soldair/node-qrcode](https://github.com/soldair/node-qrcode) — MEDIUM confidence
- [Hello Interview — Design a URL Shortener Like Bitly](https://www.hellointerview.com/learn/system-design/problem-breakdowns/bitly) — MEDIUM confidence (general system-design pattern, adapted down for self-hosted single-tenant scale — see Anti-Pattern 1)
- [System Design Handbook — Design a URL Shortener Like Bit.ly](https://www.systemdesignhandbook.com/guides/design-bitly/) — MEDIUM confidence
- [npm — geoip-lite](https://github.com/geoip-lite/node-geoip) / [geoip-country](https://www.npmjs.com/package/geoip-country) — MEDIUM confidence
- Project spec: `design_handoff_url_shortener/README.md` (authoritative product requirements, HIGH confidence — primary source)
- Project context: `.planning/PROJECT.md` (authoritative project constraints, HIGH confidence — primary source)

---
*Architecture research for: self-hosted URL shortener (Kurzly) — Vue 3 + Fastify + PostgreSQL/Prisma + better-auth, docker-compose deployment*
*Researched: 2026-07-10*
