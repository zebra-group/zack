# Roadmap: Kurzly

## Overview

Kurzly ships as ten focused phases that build strictly bottom-up: a real-Postgres TDD harness and Docker-Compose scaffolding first, then magic-link auth plus the shared per-domain authorization layer (a hard blocker for everything domain-scoped), then multi-domain TLS routing, then Links management, then the Core Redirect Engine as its own dedicated phase (the product's stated Core Value, with the highest concentration of security-critical edge cases), then the three feature areas that only depend on Links — Tracking/Analytics, QR Codes, and UTM/OG metadata, each independently testable and parallelizable — and finally Team Management (where per-domain authorization is proven end-to-end against real Links/QR/Analytics resources) and OIDC/SSO (purely additive, scheduled last). Every phase ends with an end-to-end, observable capability, and the security/correctness-critical requirements (expiration, password-gate, no-leak, tracking-off, domain-scoped denial, QR decode-round-trip) each carry an explicit negative/canary test as part of their phase's success criteria.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding** - Docker-Compose-hostable stack, ENV-driven config, persistent Postgres volume, and the real-Postgres TDD harness every later phase depends on (completed 2026-07-10)
- [x] **Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core** - Users sign in via magic link into a pixel-accurate, theme-aware dashboard shell; the shared server-side domain-authorization helper is built here, ahead of anything it must gate (completed 2026-07-11)
- [x] **Phase 3: Domains & Multi-Domain TLS Routing** - Admins register and DNS-verify their own domains, gated on-demand TLS issuance, host-header validated (completed 2026-07-11)
- [x] **Phase 4: Links Management & Bulk Import** - Users create, search, edit, and bulk-CSV-import short links across their domains through one authorized creation path (completed 2026-07-11)
- [x] **Phase 5: Core Redirect Engine** - Every short-link visit resolves correctly, safely, and fast — expiration, password-gate, and bot/OG precedence enforced with zero premature leakage (completed 2026-07-12)
- [ ] **Phase 6: Internal Tracking & Analytics** - Privacy-first, per-link and global click analytics with a true zero-third-party, zero-rows-when-off guarantee
- [ ] **Phase 7: QR Codes (Static + Dynamic, QR Studio)** - Static and dynamic QR codes with logo overlay, styling, remap history, and decode-verified scannability
- [ ] **Phase 8: UTM Builder + Custom OG Metadata** - Campaign-parameter builder and custom social-preview tags, entirely user-typed (no server-side fetch/SSRF surface)
- [ ] **Phase 9: Team Management & Domain-Scoped Authorization Enforcement** - Admins manage invites, roles, and domain assignments; Member access to Links/QR/Analytics is provably restricted server-side
- [ ] **Phase 10: OIDC/SSO Integration** - Optional SSO login, additive on top of magic-link auth, with new SSO users safely defaulting to Member with zero domains

## Phase Details

### Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding

**Goal**: Operators can stand up the entire Kurzly stack via Docker Compose, configure it entirely through environment variables, and trust that data survives restarts — while the team has a fast, real-Postgres TDD harness (Vitest + testcontainers + Mailpit) in place before any feature work begins.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):

  1. Operator runs `docker-compose up` and gets a working API + Web + PostgreSQL + reverse-proxy stack with no manual steps beyond supplying environment variables.
  2. Operator configures the instance entirely via environment variables (DB URL, SMTP credentials, base domain, secrets) — nothing is hardcoded in the image.
  3. Data in PostgreSQL persists across a full container stop/restart/recreate cycle via a named volume.

**Plans**: 9/9 plans complete
**Wave 1**

- [x] 01-01-PLAN.md — Supply-chain package legitimacy gate (blocking-human checkpoint before first install)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — pnpm monorepo skeleton + dependency install + buildable shared package

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Prisma schema + [BLOCKING] initial migration + generated client
- [x] 01-04-PLAN.md — Fail-fast Zod ENV validation (D-06) + `.env.example` (D-07)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — Real-Postgres TDD harness (Vitest + testcontainers, D-09)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-06-PLAN.md — Fastify app: health, redirect stub, static SPA + real DB canary route

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-07-PLAN.md — Vue dashboard slice: interactive UI reads/writes live API data

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 01-08-PLAN.md — Docker image + Compose stack + entrypoint migration + persistence smoke (INFRA-01/02/03)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 01-09-PLAN.md — CI full-suite pipeline (D-11) + reverse-proxy/TLS docs (D-03/D-04)

### Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core

**Goal**: Users can securely sign in via magic link and land in a pixel-accurate, theme-aware dashboard shell; the shared `requireDomainAccess`/`scopedDomainIds` server-side authorization helper is built and unit-tested here, ahead of any Links/QR/Analytics/Team route that must depend on it.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):

  1. User requests a magic link by entering their email on the login page and receives a working, single-use, 15-minute-valid sign-in link.
  2. Clicking a valid magic link signs the user in; an expired or already-used link fails safely with a clear message instead of a raw error.
  3. The user's session survives a browser refresh, and the user can log out from any page in the app.
  4. Once signed in, the user navigates a persistent 212px sidebar + scrollable content shell matching the Hi-Fi prototype's design tokens (Geist typography, lime accent, spacing/radii) and can toggle between Light and Dark themes.

**Plans**: 6/6 plans complete
**UI hint**: yes

**Wave 1**

- [x] 02-01-PLAN.md — Supply-chain sign-off + install better-auth/@fastify-rate-limit/@fastify-helmet + INITIAL_ADMIN_EMAIL ENV (D-01/D-07)

**Wave 2** *(blocked on Wave 1)*

- [x] 02-02-PLAN.md — better-auth instance + minimal Domain/DomainMembership schema + [BLOCKING] migrate/generate + shared DTOs

**Wave 3** *(blocked on Wave 2)*

- [x] 02-03-PLAN.md — TDD authorization core: requireDomainAccess / scopedDomainIds (D-02, real Postgres)
- [x] 02-04-PLAN.md — Mount /api/auth/* + helmet + rate-limit + admin seed + AUTH-01..04 + D-01 neutral-response integration tests
- [x] 02-05-PLAN.md — Theme tokens/fonts/store + authSession store + Login (Idle/Sent) + magic-link error views

**Wave 4** *(blocked on Wave 3)*

- [x] 02-06-PLAN.md — App Shell (212px sidebar) + Dashboard + Coming-soon + router auth guard + logout wiring

### Phase 3: Domains & Multi-Domain TLS Routing

**Goal**: Admins can register their own domains/subdomains, verify DNS, and have TLS certificates issued on demand once verified — via operator-delegated TLS (per D-01): Kurzly exposes the verified-status `ask` endpoint that the operator's reverse proxy (Caddy/Traefik) queries to obtain certificates only for verified domains; Kurzly terminates no TLS itself — establishing the domain layer the redirect engine will resolve every request against.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: DOMAIN-01, DOMAIN-02, DOMAIN-03, DOMAIN-04
**Success Criteria** (what must be TRUE):

  1. Admin registers a domain/subdomain, which is created with status "DNS pending."
  2. Admin triggers a DNS check; a correctly configured CNAME flips the domain to "Active," while an incorrect one leaves it pending.
  3. Admin sees the required CNAME target/instructions for each domain, and Kurzly exposes an `ask`/status endpoint (`GET /api/tls-check?domain=<host>` → 200 for "Active", 404 otherwise) that the operator's reverse proxy queries to issue TLS certificates on-demand (Let's Encrypt) only for domains that have reached "Active" status — Kurzly terminates no certificates itself (operator-delegated per D-01).
  4. A request carrying a spoofed or unregistered `Host`/`X-Forwarded-Host` header is rejected rather than silently matched to any domain.

**Plans**: 4/4 plans complete
**UI hint**: yes

**Wave 1**

- [x] 03-01-PLAN.md — Domain schema extension + enums + [BLOCKING] migrate/generate + owner-bootstrap create/list (DOMAIN-01)

**Wave 2** *(blocked on Wave 1)*

- [x] 03-02-PLAN.md — Injectable SSRF-safe DNS verification + verify/delete/instructions routes (DOMAIN-02, DOMAIN-04)

**Wave 3** *(blocked on Wave 2)*

- [x] 03-03-PLAN.md — tls-check ask endpoint + resolveActiveDomainByHost host-guard + reverse-proxy docs (DOMAIN-03)
- [x] 03-04-PLAN.md — DomainsView frontend + typed api client + /domains route swap (DOMAIN-01/02/04 UI)

### Phase 4: Links Management & Bulk Import

**Goal**: Users can create, organize, search, and bulk-import short links across their domains through one consistent, authorized creation path — bulk CSV import reuses the exact same validation/authorization/reserved-slug rules as manual creation, never a separate bypass path.
**Mode:** mvp
**Depends on**: Phase 3, Phase 2
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, UI-06
**Success Criteria** (what must be TRUE):

  1. User creates a short link by choosing a domain + destination URL (a blank slug auto-generates one; a custom slug can be supplied instead).
  2. User searches/filters the link list by domain, copies a link's full URL to the clipboard (with a toast confirmation), opens its detail page (attributes + stats), edits its settings, or deletes it.
  3. User bulk-imports links from a CSV (`ziel_url, slug, domain`) with a live validation preview (N valid / M skipped); rows using a reserved slug or a domain the importing user isn't authorized for are skipped exactly as manual creation would reject them.

**Plans**: 5/5 plans complete
**UI hint**: yes

**Wave 1**

- [x] 04-01-PLAN.md — Supply-chain sign-off + install csv-parse/nanoid (blocking-human checkpoint)

**Wave 2** *(blocked on Wave 1)*

- [x] 04-02-PLAN.md — Link schema + [BLOCKING] migrate + DTOs + validateLinkInput/createLink/previewLink/updateLink core + POST/GET /api/links (LINK-01/02/03)

**Wave 3** *(blocked on Wave 2)*

- [x] 04-03-PLAN.md — Link-by-id detail/edit/delete with IDOR guard (LINK-05/06/07, D-04)

**Wave 4** *(blocked on Wave 3)*

- [x] 04-04-PLAN.md — CSV import preview+commit, two-phase, D-01 no-bypass proof (LINK-08)

**Wave 5** *(blocked on Wave 4)*

- [x] 04-05-PLAN.md — Links frontend: list/search/filter, create/edit/delete, detail, import (LINK-03/04/05/06/07/08, UI-06)

### Phase 5: Core Redirect Engine

**Goal**: Every visit to a short link resolves correctly, safely, and fast — the product's stated Core Value — with the exact status-code precedence (expiration → password-gate → bot/OG branch → redirect) enforced and zero premature leakage of protected destinations.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: REDIR-01, REDIR-02, REDIR-03, REDIR-04, REDIR-05, UI-04, UI-05
**Success Criteria** (what must be TRUE):

  1. Visiting a valid short link issues an HTTP 302 to the correct destination, resolved correctly per the specific custom domain it was visited on (host-based scoping).
  2. Visiting an expired link returns HTTP 410 Gone with the branded public expiration page — never a redirect, and the destination URL never appears in the response.
  3. Visiting a password-protected link shows the branded public password page; the destination is served only after the server verifies the (hashed) password, and never appears in any pre-unlock HTML/JSON/header — proven by an automated no-leak canary test using a distinctive target URL.
  4. A social/bot crawler requesting a protected or expired link receives injected generic OG tags without ever seeing that link's real target or being redirected; a crawler requesting a normal link receives its custom OG tags.

**Plans**: 6/6 plans complete
**UI hint**: yes

**Wave 1**

- [x] 05-01-PLAN.md — Supply-chain sign-off + install bcryptjs/isbot/@fastify-cookie + BRAND_NAME/BRAND_ACCENT/PASSWORD_HASH_COST env (D-02/D-04/D-10)

**Wave 2** *(blocked on Wave 1)*

- [x] 05-02-PLAN.md — Link schema + [BLOCKING] migrate/generate + bcrypt hashing through single write path + shared DTOs (REDIR-03/04, D-01/D-02/D-03/D-12)
- [x] 05-03-PLAN.md — Shared server-rendered public HTML layer: escapeHtml + password/expiry/404/bot-OG renderers (UI-04/05, D-09/D-11)

**Wave 3** *(blocked on Wave 2)*

- [x] 05-04-PLAN.md — Pure engine helpers: resolveLinkState/mergeQuery + isBotRequest + unlock cookie + rate-limit configs (D-13/D-14/D-15/D-16)
- [x] 05-05-PLAN.md — Link form Security accordion (password/expiry) + forwardQuery toggle wired end-to-end (D-01/D-03/D-12)

**Wave 4** *(blocked on Wave 3)*

- [x] 05-06-PLAN.md — Redirect precedence engine route + @fastify/cookie wiring + no-leak canary suite (REDIR-01..05, UI-04/05, D-06/D-07/D-14/D-17/D-18)

### Phase 6: Internal Tracking & Analytics

**Goal**: Users get privacy-first, internal click analytics per link and account-wide — with tracking turned off for a link producing a true zero-rows-written guarantee, never a display-only filter, and no third-party service ever called.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: TRACK-01, TRACK-02, TRACK-03, TRACK-04, TRACK-05
**Success Criteria** (what must be TRUE):

  1. User toggles internal click tracking on/off per link (default on).
  2. When tracking is off for a link, zero click-event rows exist in the database for that link after any number of redirects through it — verified directly against the database, not just the analytics UI.
  3. A tracked link records click count, referrer, and country (derived locally, no third-party API calls) for each visit.
  4. User views per-link analytics (total clicks, 30-day time series, top referrers, countries) and a global analytics overview (clicks, unique visitors, active links, QR scans, top links, referrers).

**Plans**: 1/8 plans executed
**UI hint**: yes

**Wave 1**

- [x] 06-01-PLAN.md — Supply-chain sign-off + install maxmind + GEOIP_DB_PATH/CLICK_RETENTION_DAYS env (TRACK-03)
- [ ] 06-02-PLAN.md — Data model + [BLOCKING] migration (ClickEvent/ScanSource/DailySalt/Link fields) + trackingEnabled write path (TRACK-01)

**Wave 2** *(blocked on Wave 1)*

- [ ] 06-03-PLAN.md — Privacy helpers (referrer/visitorHash/geoip) + Docker GeoIP .mmdb bake (TRACK-03)
- [ ] 06-05-PLAN.md — lib/analytics.ts SQL aggregation + IDOR-guarded analytics endpoints (TRACK-04/05)
- [ ] 06-06-PLAN.md — LinkFormModal tracking toggle + Links-table Klicks column/badge (TRACK-01)

**Wave 3** *(blocked on Wave 2)*

- [ ] 06-04-PLAN.md — recordClickHook body: zero-rows guarantee + atomic click write + retention (TRACK-02/03)
- [ ] 06-07-PLAN.md — Per-link analytics UI: tracking card + 4-state analytics section (TRACK-01/04)

**Wave 4** *(blocked on Wave 3)*

- [ ] 06-08-PLAN.md — Global analytics view (AnalyticsView) + /analytics router swap (TRACK-05)

### Phase 7: QR Codes (Static + Dynamic, QR Studio)

**Goal**: Users can generate scannable static and dynamic QR codes for their links, including centered logo overlays and styling, with dynamic codes staying valid across target changes.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: QR-01, QR-02, QR-03, QR-04, QR-05, QR-06, QR-07
**Success Criteria** (what must be TRUE):

  1. User generates a static QR code for a short link and exports it as both PNG and SVG.
  2. User creates a dynamic QR code with its own short URL (`/q/xxxx`), later re-points it to a different link, and the originally printed/exported code keeps working — with a visible remap history.
  3. User adds a centered logo to a QR code; the exported PNG and SVG both still decode correctly to the right destination (error-correction level H enforced automatically whenever a logo is enabled), proven by an automated decode-round-trip test on both formats.
  4. User customizes QR color and rounded-module style in the QR Studio, and sees the code's scan count.

**Plans**: TBD
**UI hint**: yes

### Phase 8: UTM Builder + Custom OG Metadata

**Goal**: Users can enrich links with campaign-tracking parameters and custom social-preview metadata, entirely through user-typed fields — no server-side fetching of the destination, sidestepping the SSRF surface entirely.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: META-01, META-02
**Success Criteria** (what must be TRUE):

  1. User builds UTM parameters (source/medium/campaign) for a link and sees a live preview of the final destination URL with parameters appended.
  2. User sets a custom OG title/description/image for a link and sees a live social-card preview; these user-typed values (never auto-fetched from the real destination) are exactly what bots/crawlers receive.

**Plans**: TBD
**UI hint**: yes

### Phase 9: Team Management & Domain-Scoped Authorization Enforcement

**Goal**: Admins can manage the team's membership, roles, and per-domain access — and every Member's access to Links, QR codes, and Analytics is provably restricted to their assigned domains, enforced server-side on every request, not just hidden in the UI.
**Mode:** mvp
**Depends on**: Phase 2, Phase 4, Phase 6, Phase 7
**Requirements**: TEAM-01, TEAM-02, TEAM-03, TEAM-04, TEAM-05, TEAM-06
**Success Criteria** (what must be TRUE):

  1. Admin invites a user by email with a chosen role (Admin or Member); the invitee shows as "Pending" until their first successful login, then "Active."
  2. Admin assigns specific domains to a Member, changes a user's role (switching to Admin clears domain assignments), and removes a user entirely.
  3. A Member sees and can edit only the domains (and their Links/QR codes/Analytics) assigned to them in the dashboard.
  4. A Member's direct API request for a Link, QR code, or Analytics resource belonging to a domain they are NOT assigned to is rejected (403/404) server-side — even when guessing a valid resource ID — proven by an automated denial-test suite covering every link/QR/analytics endpoint.

**Plans**: TBD
**UI hint**: yes

### Phase 10: OIDC/SSO Integration

**Goal**: Admins can optionally enable OIDC/SSO login, purely additive on top of magic-link auth, with new SSO-provisioned users safely defaulting to the least-privileged role.
**Mode:** mvp
**Depends on**: Phase 2, Phase 9
**Requirements**: AUTH-05, AUTH-06, AUTH-07
**Success Criteria** (what must be TRUE):

  1. Admin enables OIDC/SSO by entering an Issuer URL, Client ID, and Client Secret.
  2. A user signs in through the configured OIDC provider once SSO is active, while magic-link login keeps working unchanged.
  3. A user newly created via SSO automatically receives the "Member" role with zero domain assignments — verified by an automated test — never inheriting Admin by default.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
(Phases 6, 7, and 8 depend only on Phase 4 and are independently parallelizable once it lands.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Infrastructure, Monorepo & Deployment Scaffolding | 9/9 | Complete    | 2026-07-10 |
| 2. Magic-Link Auth, App Shell & Domain Authorization Core | 6/6 | Complete    | 2026-07-11 |
| 3. Domains & Multi-Domain TLS Routing | 4/4 | Complete    | 2026-07-11 |
| 4. Links Management & Bulk Import | 5/5 | Complete    | 2026-07-11 |
| 5. Core Redirect Engine | 6/6 | Complete    | 2026-07-12 |
| 6. Internal Tracking & Analytics | 1/8 | In Progress|  |
| 7. QR Codes (Static + Dynamic, QR Studio) | 0/TBD | Not started | - |
| 8. UTM Builder + Custom OG Metadata | 0/TBD | Not started | - |
| 9. Team Management & Domain-Scoped Authorization Enforcement | 0/TBD | Not started | - |
| 10. OIDC/SSO Integration | 0/TBD | Not started | - |

---
*Roadmap created: 2026-07-10*
*Granularity: fine (10 phases)*
