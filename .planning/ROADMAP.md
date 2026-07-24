# Roadmap: Kurzly

## Milestones

- ✅ **v1.0 MVP** — Phases 1–10 (shipped 2026-07-23) — full v1 feature scope, 53/53 requirements
- 🚧 **v1.1 E2E Test Coverage** — Phases 11–17 (in progress) — Playwright E2E for all critical v1.0 flows

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–10) — SHIPPED 2026-07-23</summary>

Full phase details archived in [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md); requirements in [`milestones/v1.0-REQUIREMENTS.md`](milestones/v1.0-REQUIREMENTS.md); audit in [`milestones/v1.0-MILESTONE-AUDIT.md`](milestones/v1.0-MILESTONE-AUDIT.md).

- [x] Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding (9 plans) — completed 2026-07-11
- [x] Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core (6 plans) — completed 2026-07-11
- [x] Phase 3: Domains & Multi-Domain TLS Routing (4 plans) — completed 2026-07-11
- [x] Phase 4: Links Management & Bulk Import (5 plans) — completed 2026-07-11
- [x] Phase 5: Core Redirect Engine (6 plans) — completed 2026-07-12
- [x] Phase 6: Internal Tracking & Analytics (8 plans) — completed 2026-07-20
- [x] Phase 7: QR Codes (Static + Dynamic, QR Studio) (9 plans) — completed 2026-07-23
- [x] Phase 8: UTM Builder + Custom OG Metadata (6 plans) — completed 2026-07-23
- [x] Phase 9: Team Management & Domain-Scoped Authorization Enforcement (7 plans) — completed 2026-07-23
- [x] Phase 10: OIDC/SSO Integration (5 plans) — completed 2026-07-23

</details>

### 🚧 v1.1 E2E Test Coverage (In Progress)

**Milestone Goal:** Add a real Playwright E2E suite covering every critical v1.0 user flow, run against the built Docker image in production shape, complementing the existing 540 API + 256 web Vitest tests. No new product features — the "requirement" grain is E2E test scenario. Sequenced infrastructure-first so shared foundation bugs (email polling, DB isolation, rate-limiting) are solved once before any flow coverage is written.

- [x] **Phase 11: Playwright E2E Infrastructure & Fixtures** - Stable Playwright harness against the built image: Mailpit capture, DB isolation, per-role storageState fixtures, CI job, rate-limit bypass (completed 2026-07-24)
- [ ] **Phase 12: Redirect Handler E2E (Core Value)** - End-to-end proof of the redirect handler across every state (happy path, password gate, 410 expiry, bot/OG, UTM), auth-independent
- [ ] **Phase 13: Authentication & Session E2E** - Magic-link and OIDC/SSO login round-trips, session lifecycle, and route guarding — unlocks all dashboard-authenticated suites
- [ ] **Phase 14: Links & CSV Import E2E** - Canonical link CRUD journey plus the two-step CSV bulk-import (preview → commit) flow
- [ ] **Phase 15: QR Studio E2E** - Static QR with customization (decode round-trip), dynamic `/q/:code` remapping, and PNG/SVG export
- [ ] **Phase 16: Analytics E2E** - Real tracked click surfaces in per-link view, tracking-off true zero-rows, cross-link rollup
- [ ] **Phase 17: Team Management & Domain-Scoped Authorization E2E** - Invite/roles/domain assignment/removal, plus representative server-side domain-denial and account-admin bypass through the UI

## Phase Details

### Phase 11: Playwright E2E Infrastructure & Fixtures

**Goal**: A reliable Playwright harness runs against the production-shape built Docker image, with email capture, database isolation, per-role authenticated fixtures, and CI wiring — so every downstream suite builds on a foundation whose shared infrastructure bugs are already solved.
**Depends on**: Nothing (first phase of v1.1; the v1.0 app is the system under test)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06
**Success Criteria** (what must be TRUE):

  1. `pnpm --filter @kurzly/e2e test` boots the 3-file compose stack (prod + dev + new e2e overlay), waits on the app's healthcheck, and runs Playwright against the built image at `http://localhost:3000` — never split dev servers. [INFRA-01]
  2. A throwaway smoke spec reads a magic-link email from Mailpit's REST API scoped by unique recipient and logs in, proving Mailpit wiring with zero cross-worker email theft when run at `workers=N`. [INFRA-02, INFRA-04]
  3. The suite passes identically at `workers=1` and `workers=N` with no `P2002` unique-constraint failures, proving the chosen DB-isolation + truncate/reseed-per-file strategy against the published `5433` Postgres, separate from the Vitest testcontainers harness. [INFRA-03]
  4. A fresh browser context loaded from saved `storageState` reaches an authenticated dashboard route without re-login, for both the Admin and the Member role fixtures. [INFRA-04]
  5. CI runs the Playwright suite as its own job after the existing test/build jobs, uploads report/trace artifacts on failure, and one dedicated spec still trips a real 429 while the rest of the suite runs unthrottled via a narrow test-only bypass (not a blanket disable). [INFRA-05, INFRA-06]

**Plans**: 6/6 plans complete

- [x] 11-01-PLAN.md — E2E workspace scaffold + Prisma-client subpath export & spike (INFRA-01) [Wave 1]
- [x] 11-02-PLAN.md — Rate-limit test-only bypass mechanism + unit tests (INFRA-06) [Wave 1]
- [x] 11-03-PLAN.md — E2E compose overlay, boot script & built-image boot smoke (INFRA-01) [Wave 2]
- [x] 11-04-PLAN.md — DB reset/seed + Mailpit client + global setup + isolation/wiring smokes (INFRA-02, INFRA-03) [Wave 3]
- [x] 11-05-PLAN.md — Per-role storageState auth fixture + reuse smoke (INFRA-04) [Wave 4]
- [x] 11-06-PLAN.md — Rate-limit bypass E2E proof + CI e2e job (INFRA-05, INFRA-06) [Wave 5]

### Phase 12: Redirect Handler E2E (Core Value)

**Goal**: Prove the redirect handler — Kurzly's stated single most important guarantee — behaves correctly end-to-end across every state, against the built image, with no dependency on authentication (public endpoint).
**Depends on**: Phase 11
**Requirements**: REDIRECT-E2E-01, REDIRECT-E2E-02, REDIRECT-E2E-03, REDIRECT-E2E-04, REDIRECT-E2E-05
**Success Criteria** (what must be TRUE):

  1. An `APIRequestContext` request with `maxRedirects: 0` asserts a slug resolves to its target with the correct 3xx status and `Location` header (status contract, not just final landing URL). [REDIRECT-E2E-01]
  2. The password gate rejects a wrong password and frees on the correct one, and the real target string appears in no response body or network payload before unlock. [REDIRECT-E2E-02]
  3. An expired link returns HTTP 410 (distinct from a 404 slug-not-found) and does not leak its target. [REDIRECT-E2E-03]
  4. A request with a pinned bot User-Agent receives the link's configured custom OG values — never the real target — and still respects the password/expiry gates; a request with a pinned browser UA is redirected. [REDIRECT-E2E-04]
  5. Owner-configured UTM parameters and request-time query params appear correctly merged on the final redirect URL. [REDIRECT-E2E-05]

**Plans**: TBD

### Phase 13: Authentication & Session E2E

**Goal**: Prove both login paths (magic-link primary, OIDC/SSO optional) and the full session lifecycle work end-to-end, unlocking every dashboard-authenticated suite that follows.
**Depends on**: Phase 11
**Requirements**: AUTH-E2E-01, AUTH-E2E-02, AUTH-E2E-03, AUTH-E2E-04, AUTH-E2E-05, AUTH-E2E-06, AUTH-E2E-07
**Success Criteria** (what must be TRUE):

  1. The magic-link round-trip passes end-to-end (request → read in Mailpit → open link → active session), and a consumed/expired/invalid token is rejected with no session created. [AUTH-E2E-01, AUTH-E2E-02]
  2. A non-invited email address never receives a session, proving invite-only enforcement through the real flow. [AUTH-E2E-03]
  3. The OIDC/SSO round-trip against an in-process mock IdP logs a first-time user in and provisions them least-privilege ("Mitglied") with zero domain memberships, even against admin-shaped IdP claims. [AUTH-E2E-04]
  4. An invited-but-not-yet-activated magic-link account that first signs in via SSO is correctly merged into a single account. [AUTH-E2E-05]
  5. Logout ends the session and unauthenticated access to dashboard routes redirects to login; a magic-link resend that trips the rate limit surfaces a clear UI message rather than failing silently. [AUTH-E2E-06, AUTH-E2E-07]

**Plans**: TBD

### Phase 14: Links & CSV Import E2E

**Goal**: Prove the core dashboard link lifecycle and the two-step CSV bulk-import flow work end-to-end through the real UI and database, establishing the link fixture pattern the QR and Analytics suites reuse.
**Depends on**: Phase 13
**Requirements**: LINKS-E2E-01, LINKS-E2E-02, LINKS-E2E-03
**Success Criteria** (what must be TRUE):

  1. The canonical link journey passes: create a link, see it in the list, edit it, find it via search/filter, then delete it. [LINKS-E2E-01]
  2. A valid CSV import shows a preview with the correct row count/diff, and commit writes exactly the previewed rows — no silent extras — asserted directly against the database. [LINKS-E2E-02]
  3. A CSV containing a slug conflict surfaces the conflict in the preview, and commit behaves exactly as specified (skip/overwrite). [LINKS-E2E-03]

**Plans**: TBD

### Phase 15: QR Studio E2E

**Goal**: Prove static QR generation with customization, dynamic-QR remapping, and dual-format export all work end-to-end, reusing the Phase 14 links fixture.
**Depends on**: Phase 14
**Requirements**: QR-E2E-01, QR-E2E-02, QR-E2E-03
**Success Criteria** (what must be TRUE):

  1. A static QR generated with customization (color/rounding/logo) decodes back to its target URL — a content round-trip, not just "an image rendered". [QR-E2E-01]
  2. A dynamic `/q/:code` resolves to target A, then to target B after a Studio remap, and an ordered remap-history row is recorded. [QR-E2E-02]
  3. PNG and SVG exports each produce a valid, downloadable file. [QR-E2E-03]

**Plans**: TBD

### Phase 16: Analytics E2E

**Goal**: Prove the privacy-friendly tracking pipeline end-to-end — a real click surfaces in analytics, tracking-off produces true zero rows, and cross-link rollups aggregate correctly.
**Depends on**: Phase 12, Phase 14
**Requirements**: ANALYTICS-E2E-01, ANALYTICS-E2E-02, ANALYTICS-E2E-03
**Success Criteria** (what must be TRUE):

  1. A real redirect-handler click — generated by hitting the public endpoint, not by seeding a DB row — appears in the per-link analytics view. [ANALYTICS-E2E-01]
  2. With tracking toggled off, a redirect provably creates no new tracking row (true zero-rows, asserted at the database). [ANALYTICS-E2E-02]
  3. The global cross-link analytics overview correctly rolls up numbers from multiple links. [ANALYTICS-E2E-03]

**Plans**: TBD

### Phase 17: Team Management & Domain-Scoped Authorization E2E

**Goal**: Prove the invite-only team lifecycle and — using its multi-role fixtures — that domain-scoped authorization is enforced server-side through the real UI for each resource type, closing the milestone's safety-critical coverage.
**Depends on**: Phase 13, Phase 14, Phase 15, Phase 16
**Requirements**: TEAM-E2E-01, TEAM-E2E-02, TEAM-E2E-03, AUTHZ-E2E-01, AUTHZ-E2E-02
**Success Criteria** (what must be TRUE):

  1. An invite is delivered (via Mailpit), accepted, and the new member appears in the team list. [TEAM-E2E-01]
  2. An admin's role/domain reassignment takes real effect in the affected member's own re-navigated session (only the newly scoped domains are visible). [TEAM-E2E-02]
  3. Removing a member immediately revokes their active session — not only at the next login attempt. [TEAM-E2E-03]
  4. For each resource type (Link, QR, Analytics), a real member session with no domain assignment is denied server-side through the UI, complementing (not duplicating) the existing v1.0 integration Denial-Suite. [AUTHZ-E2E-01]
  5. An account-admin reaches a domain never explicitly assigned to them through the UI, proving the bypass. [AUTHZ-E2E-02]

**Plans**: TBD

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1. Test Infrastructure & Scaffolding | v1.0 | 9/9 | Complete | 2026-07-11 |
| 2. Magic-Link Auth & Domain Authz Core | v1.0 | 6/6 | Complete | 2026-07-11 |
| 3. Domains & Multi-Domain TLS Routing | v1.0 | 4/4 | Complete | 2026-07-11 |
| 4. Links Management & Bulk Import | v1.0 | 5/5 | Complete | 2026-07-11 |
| 5. Core Redirect Engine | v1.0 | 6/6 | Complete | 2026-07-12 |
| 6. Internal Tracking & Analytics | v1.0 | 8/8 | Complete | 2026-07-20 |
| 7. QR Codes (Static + Dynamic, Studio) | v1.0 | 9/9 | Complete | 2026-07-23 |
| 8. UTM Builder + Custom OG Metadata | v1.0 | 6/6 | Complete | 2026-07-23 |
| 9. Team Mgmt & Domain-Scoped Authz | v1.0 | 7/7 | Complete | 2026-07-23 |
| 10. OIDC/SSO Integration | v1.0 | 5/5 | Complete | 2026-07-23 |
| 11. Playwright E2E Infrastructure & Fixtures | v1.1 | 6/6 | Complete   | 2026-07-24 |
| 12. Redirect Handler E2E (Core Value) | v1.1 | 0/TBD | Not started | - |
| 13. Authentication & Session E2E | v1.1 | 0/TBD | Not started | - |
| 14. Links & CSV Import E2E | v1.1 | 0/TBD | Not started | - |
| 15. QR Studio E2E | v1.1 | 0/TBD | Not started | - |
| 16. Analytics E2E | v1.1 | 0/TBD | Not started | - |
| 17. Team Mgmt & Domain-Scoped Authz E2E | v1.1 | 0/TBD | Not started | - |
