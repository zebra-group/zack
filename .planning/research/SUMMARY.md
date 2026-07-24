# Project Research Summary

**Project:** Kurzly v1.1 "E2E Test Coverage"
**Domain:** Playwright E2E test infrastructure addition to an existing self-hosted URL-shortener (Fastify + Vue + Postgres + better-auth)
**Researched:** 2026-07-24
**Confidence:** MEDIUM (infrastructure patterns validated against project history; E2E best practices synthesized from community sources; stack choices verified against npm registry and official docs)

## Executive Summary

Kurzly v1.1 is **not a new product feature milestone, but an infrastructure/testing milestone**: adding Playwright E2E test coverage to an already-shipped, production-ready system (v1.0 with 53 requirements, ~37k LOC). The goal is to prove that critical user-facing flows (authentication, redirects, dashboard CRUD, QR codes, analytics, team management) work end-to-end through a real browser against a real database, complementing v1.0's existing unit/integration test suite.

The recommended approach is **infrastructure-first, phased in order of dependency**: (1) establish a rock-solid Playwright fixture layer with Mailpit email handling and per-worker database isolation, resolving all potential race conditions upfront; (2) prove the Core Value (redirect handler correctness per PROJECT.md) with minimal dependencies; (3) add authentication flows that unlock the rest; (4) layer on dashboard/team/analytics breadth. This sequencing directly mitigates the biggest risk identified across research: a naive "cover everything at once" attempt would accumulate shared infrastructure bugs (flaky email polling, DB constraint collisions, rate-limiting false positives) that would mask the actual product issues you're trying to prove, making the suite unreliable before it ever becomes useful.

Key technical decisions are already made: Playwright ^1.61.1, Mailpit v1.30.5 (MailHog unmaintained), oidc-provider for OIDC testing, Postgres 18 on a separate port (5433) for E2E rather than sharing the Vitest testcontainers harness. The architecture reuses this project's existing patterns (pnpm workspaces, Docker Compose overlays, Prisma client export) with minimal new infrastructure code. The biggest implementation risks are isolated and addressable: unique-per-worker email/slug generation for Mailpit inbox pollution, explicit `APIRequestContext` usage for redirect status-code assertions (to avoid hidden by auto-follows), and per-file truncate/reseed for DB isolation (different from Vitest's per-test `BEGIN/ROLLBACK` due to cross-process boundaries).

## Key Findings

### Recommended Stack

**Playwright E2E is the specified tool for this milestone.** Core technologies for v1.1 E2E infrastructure:

- **@playwright/test ^1.61.1**: Spec-named E2E runner with first-class TypeScript, multi-context/multi-origin support (critical for custom-domain redirect testing), `storageState` fixtures (reusable authenticated sessions), native sharding, and official Docker image for CI/local parity.
- **Mailpit v1.30.5**: SMTP test-catcher with REST API (`GET /api/v1/messages`), replacing the unmaintained MailHog. Used for magic-link email capture in E2E (and in dev via `docker-compose.dev.yml`).
- **oidc-provider ^9.10.0**: In-process mock OIDC IdP for SSO/OIDC E2E testing, avoiding external IdP dependencies. Boots in-process, tears down with test runner, implements full OIDC discovery.
- **@testcontainers/postgresql ^12.0.4** (reused): Already used by v1.0 Vitest harness; E2E's global setup uses the same library for local dev runs. CI uses GitHub Actions native `services:` instead (Postgres + Mailpit as GH service containers).
- **mcr.microsoft.com/playwright:v1.61.1-noble** (Docker image for CI): Pre-installed browsers, version-locked to `@playwright/test`, eliminates browser cache/download flakiness.

### Expected Features

From FEATURES.md: **18 table-stakes E2E scenarios** (mandatory for "complete coverage" claim) + **9 differentiators** (edge cases to add once table stakes are green).

**Must have (table stakes) — grouped by flow area:**
1. **Auth infrastructure & flows:** Magic-link login round-trip, OIDC/SSO round-trip, session/logout, route guarding
2. **Redirect handler (Core Value):** Slug → target redirect, password gate, expiry (410), bot OG rendering, query-param/UTM forwarding
3. **Dashboard CRUD:** Links create/edit/delete/search, CSV bulk import, QR Studio (static, dynamic remap, PNG/SVG export)
4. **Analytics:** Click populates per-link view, tracking-off produces zero rows
5. **Team management:** Invite → accept → appears in list, role/domain assignment takes effect
6. **Security:** Domain-scoped authorization deny-path per resource type, account-admin bypass

**Differentiators (nice-to-have edge cases):**
- Magic-link resend/rate-limit UX, OIDC account-linking, redirect handler 404/normalization, CSV conflict handling, Analytics aggregation, Team member removal revokes session

### Architecture Approach

E2E architecture is a new `apps/e2e` workspace package (mirroring `apps/api` and `apps/web`) with three-file Docker Compose setup (`docker-compose.yml` + `docker-compose.dev.yml` + new `docker-compose.e2e.yml` overlay). The app under test is always the **built Docker image in production-shape** (single Fastify origin serving both `/api/*` and the Vue SPA via `@fastify/static`), never split dev servers — this ensures the E2E run exercises the exact topology users will deploy. Global setup seeds baseline test data once per run. Individual spec files truncate mutable tables and reseed fixtures (differs from Vitest's per-test `BEGIN/ROLLBACK` because E2E and app are separate processes). Auth fixture runs once per role via Playwright's "setup project" pattern, writes `storageState`, and all other specs declare it as a dependency.

**Major components:**
1. **apps/e2e** — New workspace package; owns Playwright config, spec files, and test helpers
2. **docker-compose.e2e.yml** — Additive overlay; publishes Postgres port 5433 (separate from app's internal 5432)
3. **scripts/e2e-compose.sh** — New helper; boots 3-file stack, waits for healthcheck, runs suite, tears down
4. **Mailpit** (existing in dev.yml, reused) — SMTP catcher for magic-link emails; accessible via REST API
5. **CI job** (new in workflow) — Builds app image, boots compose stack with E2E overlay, runs Playwright

### Critical Pitfalls

Research identified 8 pitfalls; top 5 by implementation risk:

1. **Shared Mailpit inbox causes flaky magic-link E2E tests** — Multiple workers "steal" each other's emails. Prevent: unique recipient per test, filter by `to:`, delete after reading. **Must solve in infra phase.**

2. **`storageState` silently omits sessionStorage** — If app code stores session data in `sessionStorage` (not cookies), saved state won't capture it. Prevent: explicitly verify where better-auth's session lives before building the shared auth fixture. **Validate with smoke test.**

3. **Playwright auto-follows redirects, hiding status codes** — `page.goto()` transparently follows redirects; tests never verify actual status code (301/302/410). Prevent: use `request.fetch(url, { maxRedirects: 0 })` via `APIRequestContext`. **Must address in redirect phase.**

4. **Parallel workers collide on Postgres unique constraints** — Two workers try to create links with same slug, triggering `P2002` errors. Prevent: choose strategy explicitly—either (a) per-worker throwaway databases or (b) globally-unique identifiers per test. **Decide in infra phase.**

5. **@fastify/rate-limit triggers false 429s during E2E** — Rate-limiter keys by IP; in CI all workers trip limits. Prevent: gate narrow bypass (env flag) and write one dedicated 429-test spec. **Set up in infra phase.**

## Implications for Roadmap

Research suggests a **4-phase structure** prioritizing infrastructure stability, then Core Value, then authentication, then breadth:

### Phase 1: Playwright Infrastructure & Fixtures
**Rationale:** Foundation for all other phases. All shared infrastructure bugs must be resolved once here.

**Delivers:**
- Playwright config with projects: setup/chromium-admin/chromium-member
- Global setup/teardown (seed baseline data, clear Mailpit inbox)
- Mailpit wiring in `docker-compose.e2e.yml` + CI
- DB isolation strategy decision + per-file truncate/reseed helper
- Rate-limit bypass mechanism + one 429-test spec
- Healthchecks in compose + CI shm-size config
- `storageState` auth fixture validated with smoke tests

**Addresses:** Pitfalls 1, 2, 5, 6, 7

**Research flags:** DB isolation strategy choice (per-worker DB vs. unique-ID generation) requires a 1–2 day spike to prototype both and measure overhead.

### Phase 2: Redirect Handler E2E (Core Value)
**Rationale:** Core Value and independent of authentication (public endpoint). Can run in parallel with Phase 1, but must complete before expanding scope.

**Delivers:**
- Slug → target happy-path redirect (via `APIRequestContext` to assert 301/302 status)
- Password-gate flow with target absence assertion pre-unlock
- Expiry handling (410 status distinct from 404)
- Bot OG rendering (two specs with pinned `userAgent`: bot vs. browser)
- Query-param/UTM forwarding

**Addresses:** Core Value redirect handler + Pitfalls 3, 4

**Research flags:** Bot detection implementation in app must be reviewed before writing specs (UA allowlist/regex specifics).

### Phase 3: Authentication & Session E2E
**Rationale:** Enables all subsequent dashboard/team/analytics specs. Includes magic-link (primary) and OIDC/SSO (secondary).

**Delivers:**
- Magic-link login round-trip (happy + invalid/expired + non-invited)
- OIDC/SSO login round-trip (happy + least-privilege provisioning)
- Session persistence and logout
- Route guard enforcement

**Addresses:** All auth scenarios + Pitfalls 1, 2

### Phase 4: Dashboard Flows & Team Management E2E
**Rationale:** Broadens coverage to all remaining table-stakes. Depends on authenticated sessions from Phase 3.

**Delivers:**
- Links CRUD + CSV bulk import
- QR Studio (static, dynamic remap, PNG/SVG export)
- Analytics views (click populates, tracking-off zero rows)
- Team management (invite/accept, role/domain assignment)
- Domain-scoped authorization deny-path (one per resource type)

**Addresses:** All remaining table-stakes coverage

**Research flags:** CSV parsing/conflicts already unit-tested? Domain-scoped authorization: prove UI-layer representation is correct (integration suite already covers full matrix).

### Phase Ordering Rationale

1. **Infrastructure first:** Eight pitfalls cluster around shared foundation (email, DB, rate limiting, CI). Solving them once prevents months of "is this my test or framework?" debugging.

2. **Core Value second:** Redirect handler is project's stated single most important guarantee, independent of auth. Validates foundational infrastructure without auth complexity.

3. **Auth enables breadth:** Almost all dashboard features require authenticated session. Stable auth fixtures unlock final breadth phase.

4. **Breadth last:** Links/QR/Analytics/Team all use same session/DB/API patterns; once framework and auth are solid, adding specs is lower-risk.

### Research Flags

**Phases needing deeper research:**
- **Phase 1 (DB isolation):** Choose and prototype per-worker databases vs. unique-ID generation; recommend former for consistency with Vitest harness.
- **Phase 2 (custom-domain testing):** Verify if custom-domain redirect logic supports `/etc/hosts` override or localhost-with-header approach.
- **Phase 4 (CSV coverage):** Review unit-test coverage; if already comprehensive, E2E can be lighter.

**Standard patterns (skip research-phase):**
- **Phase 2:** `APIRequestContext` and `userAgent` pinning are well-documented Playwright patterns.
- **Phase 3:** storageState fixtures and mock OIDC are established patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | MEDIUM-HIGH | Versions verified against npm registry (HIGH). Docker/Compose patterns grounded in project's prior art (HIGH). Playwright + Compose race conditions sourced from web search (MEDIUM) — re-verify during Phase 1. |
| **Features** | MEDIUM | E2E scenario grouping synthesized from testing-pyramid practice + project constraints (MEDIUM). Feature dependencies grounded in data model (HIGH). |
| **Architecture** | MEDIUM-HIGH | Recommend architecture grounded entirely in project's existing patterns (HIGH). Cross-process DB isolation necessity validated by project history (HIGH). |
| **Pitfalls** | MEDIUM | Infrastructure/DevOps pitfalls from web search (MEDIUM). Pitfall 8 (phased approach) grounded in project history + consensus (MEDIUM-HIGH). |

**Overall confidence:** MEDIUM

### Gaps to Address

1. **DB isolation mechanism not yet chosen:** Recommend 1–2 day spike to prototype per-worker databases vs. unique-ID generation before Phase 1 planning.

2. **OIDC IdP mock specifics:** better-auth `genericOAuth` configuration and oidc-provider provisioning details need Phase 3 planning validation.

3. **Bot-detection implementation:** Code review of actual UA parsing/allowlist needed before Phase 2 spec writing.

4. **Custom-domain testing environment:** Verify `/etc/hosts` or localhost-with-header support before Phase 2 spike.

5. **CSV import unit-test coverage:** Confirm comprehensive coverage; if gaps exist, prioritize unit-test closure before E2E expansion.

6. **Rate-limit bypass mechanism finalization:** Decide exact implementation (header, IP allowlist, feature flag) during Phase 1 planning.

## Sources

### Primary (HIGH confidence)
- This repository's own prior art: `docker-compose.yml`, `docker-compose.dev.yml`, `scripts/smoke-compose.sh`, `apps/api/test/globalSetup.ts`, `apps/api/vitest.config.ts`, `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `.claude/CLAUDE.md`, `.planning/PROJECT.md`
- npm registry direct fetch for `@playwright/test`, `mailpit`, `oidc-provider` versions (verified 2026-07-24)
- GitHub Releases API for Mailpit v1.30.5, MailHog maintenance status, Dex alternatives

### Secondary (MEDIUM confidence)
- Playwright official docs (web-search synthesis): `/docs/test-webserver`, `/docs/ci`, `/docs/auth`
- Mailpit official docs: REST API contract
- Kurzly project conventions: testing constraints, Core Value statement
- Testing-pyramid consensus (Checkly, CyberArk, Autonoma)

### Tertiary (LOW confidence — needs validation at implementation)
- Playwright + Docker Compose race conditions (webServer vs. healthcheck) — web search, re-verify during Phase 1
- Postgres per-worker schema isolation patterns — community sources, validate with spike
- Bot-detection UA patterns — ScrapingAnt, community sources, needs code review
- CI resource limits (shm, caching) — Docker/Playwright blogs, standard advice

---
*Research completed: 2026-07-24*
*Summarized by: gsd-synthesizer agent*
*Ready for roadmap: yes*
