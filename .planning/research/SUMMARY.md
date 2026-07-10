# Project Research Summary

**Project:** Kurzly
**Domain:** Self-hosted, open-source URL shortener / link-management platform (bit.ly/dub.co-class, multi-domain, team-based)
**Researched:** 2026-07-10
**Confidence:** MEDIUM-HIGH

## Executive Summary

Kurzly is a self-hosted, full-scope-v1 URL shortener competing on "self-hosted + privacy-first + on-prem control" against SaaS incumbents (dub.co, bit.ly) and thinner self-hosted alternatives (Shlink, Kutt, YOURLS). The stack is fixed by the project owner (Vue 3, Fastify, PostgreSQL/Prisma, better-auth), and research confirms this is a coherent, well-supported combination for 2026 — with one important scaffolding decision to nail early: Prisma 7's new mandatory custom `output` path for its generated client, which both the app code and better-auth's Prisma adapter must share. The recommended architecture is a single Fastify process with two logically separated route trees — a public, unauthenticated, latency-critical redirect scope and an authenticated, low-volume dashboard API scope — sharing one service/data-access layer, so a later physical split is possible without a rewrite. This avoids the common over-engineering trap of building bit.ly-scale microservices for a single-tenant self-hosted tool.

The single largest risk in this project is not the stack or feature set (both are well-trodden ground) — it's correctness and security discipline around a handful of narrow, easy-to-get-subtly-wrong flows: (1) the redirect handler's precedence order (expiration → password → bot-detection → redirect) and its exact status codes (302 happy path, 410 expired, 404 never-existed, 200 password-prompt); (2) never leaking the real target URL in any response before a password/expiry gate passes; (3) enforcing per-domain Member authorization server-side on literally every link/QR/analytics/domain endpoint, never trusting the UI filter; and (4) making the tracking-off toggle a true "zero rows written" guarantee at the point of write, not a read-time filter. All four of these map directly onto explicit product promises in PROJECT.md and are exactly the kind of thing that "looks done" in a demo but silently fails a curl/devtools inspection — which is precisely why this project's mandatory TDD constraint matters here: these are best expressed as tests-written-first (canary-URL no-leak tests, authz-denial tests per endpoint, zero-click-events-when-tracking-off tests, QR decode-round-trip tests) rather than caught in code review.

The recommended mitigation is architectural, not just diligence: build the `authz/` domain-access helper and the redirect-handler status-code contract as dedicated early-phase deliverables with their own test suites, before any Links/QR/Analytics/Team feature work begins, since Links/QR/Analytics/Team all structurally depend on authorization existing first (confirmed independently by both ARCHITECTURE.md's build-order analysis and PITFALLS.md's pitfall-to-phase mapping). Given the mandatory TDD constraint, the first phase of the roadmap should stand up the test infrastructure itself (Vitest, `@vue/test-utils`, Playwright, testcontainers-backed Postgres, Mailpit SMTP catcher) as a first-class deliverable — not an incidental side effect of the first feature phase — since every subsequent phase's "definition of done" depends on this harness existing and being fast enough to run on every change.

## Key Findings

### Recommended Stack

Node 24 (Active LTS), Fastify 5, PostgreSQL 18, Prisma 7 (TS/Wasm engine — note the mandatory custom `output` path breaking change), Vue 3.5 (Composition API/`<script setup>`), Vite 8, better-auth 1.6 (magicLink + `sso`/`genericOAuth` plugin), Pinia 3, Vue Router 4 (not v5 — not justified for ~7 fixed screens). QR generation via `qrcode` (npm) + `sharp` for logo compositing (avoid `canvas` — flaky Alpine/musl native builds). Testing stack: Vitest 4 + `@vitest/coverage-v8`, `@vue/test-utils`, `@playwright/test` for critical E2E flows, `@testcontainers/postgresql` for real-Postgres integration tests (never mock Prisma for integration-layer tests), Mailpit/MailHog as an SMTP test double (dev/CI only, never production).

**Core technologies:**
- Fastify 5 — backend HTTP framework — schema-based validation/plugin encapsulation fits the domain-scoped authorization model well
- Prisma 7 — ORM/migrations — 3x faster queries, smaller client, but requires explicit `output` path decided at Phase 1 scaffolding
- better-auth 1.6 — auth (magicLink + SSO) — plugin architecture matches the exact spec shape (magic-link-only login, optional OIDC toggle); use the `sso` plugin over `genericOAuth` for mainstream IdPs (Keycloak/Authentik/Azure AD)
- `qrcode` + `sharp` — QR generation + logo compositing — mature, Docker-friendly, full control over PNG/SVG/level-H requirements
- Vitest + Playwright + testcontainers — TDD backbone — real-Postgres integration tests, `fastify.inject` for API tests without a real socket, Playwright reserved for true critical-flow E2E (magic-link round-trip, redirect handler, password gate, QR remap)

### Expected Features

Kurzly's 12 requirements are fixed, full-scope v1 (no MVP cut) — the value of this research is placing them against the market and surfacing under-specified sub-behaviors, not deciding what to build.

**Must have (table stakes, already spec'd but with gaps to close):**
- Custom + auto-generated slug (collision handling for autogenerate is unspecified — needs a decision)
- Multi-domain link creation (slug uniqueness is per-domain, not global — `UNIQUE(domain_id, slug)`)
- Redirect handler (status code/precedence order under-specified — see Architecture/Pitfalls)
- Click count, copy-to-clipboard, static QR, search/filter, link expiration (410), password protection, CSV bulk import, team roles, dark/light theme

**Should have (differentiators — Kurzly's actual competitive edge):**
- Dynamic QR codes with own short URL + remap audit-trail history (no competitor in this class has this polished)
- Privacy-first internal tracking, true zero-third-party, toggleable per link — the stated Core Value; must be architecturally enforced, not a display filter
- Per-domain role scoping (finer-grained than dub's workspace model) — fits the agency/multi-client persona
- Free OIDC/SSO on a self-hosted OSS tool (usually enterprise-paywalled elsewhere)
- Custom OG-tags with bot-branching serve logic; UTM builder with live preview (modeled on dub)

**Defer (explicitly out of scope, do not let creep in):**
- Device/geo-targeted conditional redirects, A/B testing, plugin/extension marketplace, roles beyond Admin/Member, CAPTCHA gating, third-party fingerprinting analytics

### Architecture Approach

One Fastify process, two plugin scopes (public redirect vs. authenticated dashboard API) sharing one Prisma-backed service layer, fronted by Caddy for host-based routing and per-domain On-Demand TLS (not wildcard — customer domains are arbitrary third-party domains). The redirect path must never touch better-auth's session machinery, must resolve slugs through an in-process LRU hot-cache, and must fire-and-forget click-event writes so tracking never adds latency or becomes a failure mode for the core redirect.

**Major components:**
1. **Redirect scope** (public, unauthenticated) — slug resolution via hot-cache, password/expiry gate, bot-detection → OG page, fire-and-forget click logging
2. **Dashboard API scope** (authenticated) — Links/QR/Domains/Analytics/Team CRUD, gated by a single shared `authz` service on every route
3. **`authz` / domain-access service** — one `requireDomainAccess(user, domainId)` helper used everywhere; the single most important structural component in the whole system
4. **Caddy edge** — host-based routing + On-Demand TLS gated by an internal "ask" endpoint tied to DB-verified domain status
5. **QR render service** — server-side `qrcode` + `sharp`, shared geometry source for PNG/SVG so exports never diverge

### Critical Pitfalls

1. **Target leakage before password/expiry unlock** — server must never serialize `target` in any response until the gate passes; write the "no-leak" canary-URL test first (TDD).
2. **Member authorization enforced only in the UI** — every link/QR/analytics/domain endpoint must call a shared server-side `authz` helper; write a denial-test suite independent of feature tests, covering every endpoint.
3. **Tracking-off toggle only filters at read time instead of gating the write** — the redirect handler must check `trackingOn` before ever creating a click-event row; test asserts zero DB rows after N redirects through a tracking-off link.
4. **Wrong status codes / precedence order in the redirect handler** — expiration (410) must be checked before password gate, both before bot-detection branching; get this order wrong and a spoofed-bot-UA request can see OG metadata for a protected/expired link.
5. **QR logo overlay with default (M) error correction** — must force `errorCorrectionLevel: 'H'` whenever a logo is present, cap logo size (~20-25% of code area), and add a decode-round-trip test (generate → decode) for both PNG and SVG exports — not just a visual/snapshot test.

## Implications for Roadmap

Based on combined research (architecture build-order, pitfall-to-phase mapping, and feature dependency graph all converge on the same sequencing), the suggested phase structure:

### Phase 0: Test Infrastructure & Project Scaffolding
**Rationale:** TDD is mandatory per PROJECT.md — every subsequent phase's definition of done depends on a working, fast test harness existing first, not being bolted on incidentally to Phase 1's feature work.
**Delivers:** pnpm workspace monorepo (`apps/web`, `apps/api`, `packages/shared`); Vitest + `@vue/test-utils` + `@playwright/test` wired with CI; `@testcontainers/postgresql` global setup for real-Postgres integration tests; Mailpit SMTP test double in `docker-compose.dev.yml`; Prisma schema scaffolding with the explicit `output` path decided (shared between app code and better-auth's adapter); ESLint + `tsc --noEmit` in CI.
**Addresses:** the "mandatory TDD" constraint itself — nothing feature-specific yet.
**Avoids:** the failure mode of writing tests against mocked Prisma (gives false confidence — real bugs hide in migrations/constraints/multi-tenant queries).

### Phase 1: Auth (Magic Link) + Domain-Access Authorization Layer
**Rationale:** Both ARCHITECTURE.md's build order and PITFALLS.md's pitfall map independently place authorization as a hard blocker for Links/QR/Analytics/Team phases — building it after those phases means retrofitting checks into already-shipped code, exactly the failure mode the spec explicitly warns against.
**Delivers:** better-auth wired with `magicLink()` (explicit `expiresIn: 900` to match spec's 15-minute UI copy, "Confirm sign-in" button to defend against scanner-bot token consumption), `User`/`Session`/`Account`/`Verification` tables, `Domain`/`DomainMember` models, the shared `requireDomainAccess`/`scopedDomainIds` authz helper.
**Addresses:** "Authentifizierung via better-auth" and "Benutzerverwaltung mit domainspezifischen Rollen" requirements.
**Avoids:** Pitfall 4 (UI-only authorization) and Pitfall 9 (magic-link expiry/scanner-bot gotchas) — write the authz denial-test suite and the magic-link E2E round-trip test before building dependent features.

### Phase 2: Domains & Multi-Domain Routing/TLS
**Rationale:** The redirect handler cannot resolve a slug without first resolving which domain the request is on — multi-domain support is an architectural prerequisite for the redirect handler, not a parallel workstream.
**Delivers:** Domain CRUD + DNS verification flow, Caddy On-Demand TLS wiring gated by an internal "ask" endpoint tied to DB `active` status, host-header validation against the verified-domains table.
**Addresses:** "Link-Kürzung mit eigenen Domains/Subdomains", "Docker-hostbar" requirements.
**Avoids:** Pitfall 13 (Let's Encrypt rate-limit exhaustion via ungated on-demand issuance) and Pitfall 14 (host-header spoofing/domain confusion) — both are hard prerequisites, not later hardening passes.

### Phase 3: Links CRUD + Core Redirect Engine
**Rationale:** This is the product's stated Core Value ("muss der Redirect-Handler korrekt und schnell funktionieren") and has the fewest remaining upstream dependencies (Auth + Domains). Research strongly recommends this be its own dedicated, focused phase — not bundled into general "Links feature" work — given how many nontrivial edge cases converge here.
**Delivers:** Link create/list/detail (gated by authz), redirect handler with explicit status-code state machine (404 not-found / 410 expired / 200 password-prompt / 302 valid), reserved-slug validation, slug entropy (nanoid ≥7-8 chars), in-process LRU hot-cache, fire-and-forget click-event stub, per-route-class rate limiting (redirect vs. creation vs. magic-link).
**Addresses:** redirect handler, custom slug + autogenerate, password protection, expiration requirements.
**Avoids:** Pitfall 1 (open redirect/phishing), Pitfall 3 (target leakage before unlock — write the no-leak canary test FIRST per TDD), Pitfall 5 (slug enumeration), Pitfall 6 (undifferentiated rate limiting), Pitfall 7 (wrong status codes), Pitfall 8 (reserved-slug collisions, including reserving `q` ahead of the QR phase).

### Phase 4: Internal Privacy-First Tracking & Analytics
**Rationale:** Tracking is gated entirely by the Links phase existing (click events attach to links) and is independent of QR — can run in parallel with Phase 5 once Phase 3 lands.
**Delivers:** Tracking-toggle-gated click-event writes (zero rows when off, enforced at write time, not query time), local GeoIP country derivation (no third-party calls, raw IP never persisted), referrer capture/normalization, on-read aggregation queries (`GROUP BY` with `@@index([linkId, occurredAt])`), Analytics screens.
**Addresses:** "Internes Klick-Tracking... kein Drittanbieter" — the second half of the product's Core Value.
**Avoids:** Pitfall 15 (tracking-off still collecting data) — write the "zero click_events rows when tracking off" test as the very first test in this phase, before the analytics dashboard itself.

### Phase 5: QR Codes (Static + Dynamic)
**Rationale:** A dynamic QR always points at a Link (`qrs[].mapsTo → linkId`), so this phase structurally depends on Phase 3's Links existing; independent of Phase 4's tracking work, so the two can be parallelized.
**Delivers:** `QrCode`/`QrRemapHistory` models (append-only audit trail, not an overwritten field), server-side PNG/SVG render endpoints sharing one logo-mask geometry source, forced `errorCorrectionLevel: 'H'` whenever a logo is enabled, logo-size clamping (~20-25% of code area), `/q/:code` dynamic redirect-resolution path with its own scan counter.
**Addresses:** static + dynamic QR requirements, the project's clearest differentiator vs. Shlink/Kutt/YOURLS.
**Avoids:** Pitfall 11 (default error-correction breaks scannability with logo — write the decode-round-trip test before implementing the logo overlay) and Pitfall 12 (PNG/SVG export divergence — test both formats, inline SVG logos as base64 data URIs).

### Phase 6: UTM Builder + Custom OG-Tags
**Rationale:** Low-risk, mostly Link metadata + Vue form additions; can run in parallel with Phases 4/5 since it has no hard dependency beyond Links (Phase 3) existing.
**Delivers:** UTM param builder with live preview (`URLSearchParams` manipulation at creation time), custom OG-tag fields (user-typed, NOT auto-fetched — sidesteps SSRF surface entirely per spec), bot-detection branching in the redirect handler serving generic OG tags for protected/expired links.
**Addresses:** UTM builder and custom OG-tags requirements.
**Avoids:** Pitfall 2 (SSRF via OG fetching) — explicitly decide OG data is 100% user-typed before implementation starts, not auto-scraped.

### Phase 7: Bulk CSV Import
**Rationale:** Reuses the Links creation/validation/slug-generation path from Phase 3 — must not be a separate code path that bypasses authz/reserved-slug/rate-limit rules.
**Delivers:** CSV upload + validation preview UI, partial-failure handling (N valid / M skipped), per-import rate limiting independent of the per-link create limit.
**Addresses:** bulk CSV import requirement.
**Avoids:** the "looks done" gap where bulk import validates format but skips the same authorization/reserved-slug checks manual creation enforces.

### Phase 8: Team Management (Invite, Roles, Domain Assignment)
**Rationale:** Depends on Phase 1's Auth + authz model already existing; invitations/pending-status all build on magic-link infrastructure.
**Delivers:** Admin-only invite/role/domain-assignment routes, Team screen UI.
**Addresses:** "Benutzerverwaltung mit domainspezifischen Rollen" (UI/workflow side, authz backbone already built in Phase 1).

### Phase 9: OIDC/SSO Integration
**Rationale:** Strictly additive on top of magic-link auth and Team management — safe to schedule last without blocking anything else.
**Delivers:** `sso` (preferred) or `genericOAuth` plugin wiring, callback path config, explicit `user.create` hook forcing `role: 'member'` and zero domain assignments for new SSO users (do not rely on `mapProfileToUser` alone).
**Addresses:** "OIDC / SSO-Integration (optional)" requirement.
**Avoids:** Pitfall 10 (default role not actually applied via `mapProfileToUser`, callback URL mismatches) — test that a freshly-provisioned SSO user has `role === 'member'` and zero domains; verify the callback URL end-to-end through the reverse proxy, not just in isolation.

### Phase 10 (cross-cutting, throughout): Dashboard UI — 12 Screens
**Rationale:** Can start in parallel from Phase 0 against a mocked API client, but each screen's real data wiring is gated by its corresponding backend phase (Links screen needs Phase 3, Analytics needs Phase 4, QR needs Phase 5, Team needs Phase 8/9).
**Delivers:** Vue 3 SPA shell, Pinia stores, pixel-accurate implementation of the Hi-Fi prototype (Light/Dark, Geist typography, lime accent tokens).

### Phase Ordering Rationale

- Authorization (Phase 1) is a hard blocker for Links/QR/Analytics/Team phases — both ARCHITECTURE.md and PITFALLS.md independently converge on this being the single most important sequencing decision; scheduling any of those phases before authz exists risks exactly the retrofit-cost failure the spec calls out.
- Domains (Phase 2) must precede the redirect handler (Phase 3) because slug resolution requires knowing which domain a request belongs to.
- The redirect handler (Phase 3) is deliberately its own phase, not folded into general Links CRUD, because it is the stated Core Value and carries the highest concentration of Critical pitfalls (1, 3, 5, 6, 7, 8).
- Tracking (Phase 4) and QR (Phase 5) are mutually independent once Links (Phase 3) lands, so they can be parallelized to shorten the critical path.
- OIDC/SSO (Phase 9) is scheduled last since it's purely additive and has zero downstream dependents.

### Research Flags

Phases likely needing deeper research during planning (`--research-phase`):
- **Phase 2 (Domains & TLS):** Caddy On-Demand TLS "ask" endpoint wiring and Let's Encrypt rate-limit-safe gating is infra-specific and easy to get subtly wrong; PITFALLS.md flags this as MEDIUM confidence from web search, worth a deeper look at implementation time.
- **Phase 3 (Redirect Engine):** the exact precedence/state-machine (404/410/200-locked/302) and reserved-slug list should be written as an explicit contract/table during phase planning, not discovered mid-implementation.
- **Phase 5 (QR Codes):** SVG/PNG shared-geometry logo-mask implementation and the decode-round-trip test setup (which QR-decoding library to use in tests) warrants a quick research pass.
- **Phase 9 (OIDC/SSO):** better-auth's `mapProfileToUser` vs. `user.create` hook semantics for default-role assignment is a known community gotcha (GitHub discussions, not official docs) — verify against the installed better-auth version's exact behavior before implementing.

Phases with standard, well-documented patterns (safe to skip research-phase):
- **Phase 0 (Test Infrastructure):** Vitest/Playwright/testcontainers setup is extremely well-documented, standard tooling.
- **Phase 1 (Auth/Authz core):** better-auth's magicLink plugin and a single `requireDomainAccess` helper are both conventional patterns with official docs.
- **Phase 4 (Tracking/Analytics):** on-read aggregation over an indexed `click_events` table is a standard, well-understood pattern at this scale.
- **Phase 6/7/8 (UTM/OG, CSV import, Team UI):** conventional CRUD/form patterns, no novel engineering.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Versions cross-checked directly against npm registry `dist-tags.latest` and official docs via web search; no Context7/MCP doc tools available, so treat exact patch versions as a snapshot to re-verify at `npm install` time |
| Features | MEDIUM | Competitor feature sets confirmed via multiple current sources (dub, Shlink, Kutt, YOURLS, bit.ly); some edge-case sub-behaviors (e.g. unique-visitor hashing method) are inferred best practice, not spec-mandated |
| Architecture | MEDIUM-HIGH | System-design patterns and Fastify/Prisma/Vue composition choices are well-established HIGH-confidence conventions; Caddy On-Demand TLS specifics are MEDIUM confidence (web search, cross-checked across multiple sources) |
| Pitfalls | MEDIUM-HIGH | Mix of HIGH-confidence OWASP security patterns and official better-auth/qrcode docs, and MEDIUM-confidence cross-checked web findings for infra topics (Let's Encrypt rate limits, Caddy on-demand gotchas) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Slug collision handling on autogenerate is unspecified** — decide the retry/longer-suffix strategy during Phase 3 planning, not left implicit.
- **Domain deletion/deactivation cascading behavior is unspecified** — recommend deactivate-not-delete (existing links keep resolving, slug creation blocked); flag as a decision needed during Phase 2 planning.
- **Unique-visitor counting method is not spec-mandated** — the daily-salt-hash pattern (Plausible/Fathom/Umami-style) is MEDIUM-confidence industry convention, not directly cited from an authoritative Kurzly-specific source; validate this approach explicitly during Phase 4 discussion.
- **Exact `sharp` prebuilt-binary compatibility with the chosen Node 24 + Alpine musl Docker base image** should be verified at Phase 0 scaffolding time, since sharp's binary support matrix shifts with new Node majors.
- **better-auth's exact behavior around custom-field propagation (`role`) from OIDC profile mapping into the session object** is sourced from GitHub discussions/issues rather than official docs — verify directly against the installed better-auth version before relying on the `user.create` hook pattern in Phase 9.

## Sources

### Primary (HIGH confidence)
- OWASP Foundation / Cheat Sheet Series — Open Redirect, SSRF
- better-auth.com official docs — magic-link, SSO, generic-OAuth, Prisma adapter
- `qrcode` npm official docs
- Project spec: `design_handoff_url_shortener/README.md` (internal, 12 requirements + 12 screens)
- Project context: `.planning/PROJECT.md` (internal)

### Secondary (MEDIUM confidence)
- npm registry `dist-tags.latest` direct fetches (fastify, prisma, vue, vite, pinia, vue-router, nodemailer, qrcode, vitest, playwright, @vue/test-utils, @fastify/* packages)
- prisma.io official blog/changelog ("Announcing Prisma ORM 7.0.0")
- postgresql.org / endoflife.date versioning pages
- Caddy official docs (On-Demand TLS, Automatic HTTPS) + Caddy Community threads
- Hello Interview / System Design Handbook — "Design a URL Shortener Like Bitly" (adapted down for self-hosted single-tenant scale)
- dub.co, Shlink, Kutt, YOURLS, bit.ly product/blog pages (competitor feature landscape)
- Plausible/Fathom/Umami privacy-analytics documentation (unique-visitor hashing pattern)
- better-auth GitHub Discussions #6985, #3517, #3290 (magic-link scanner-bot consumption, OIDC role mapping gotchas)

### Tertiary (LOW confidence)
- General web search synthesis for qrcode logo-overlay compositing patterns, Fastify+testcontainers integration patterns, and `@vue/test-utils` vs `@testing-library/vue` guidance — flagged for re-verification at implementation time via each library's own README/docs

---
*Research completed: 2026-07-10*
*Ready for roadmap: yes*
