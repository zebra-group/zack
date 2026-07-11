---
phase: 03-domains-multi-domain-tls-routing
plan: 03
subsystem: api
tags: [fastify, prisma, tls, security, tdd, caddy, on-demand-tls]

# Dependency graph
requires:
  - phase: 03-domains-multi-domain-tls-routing (plan 01)
    provides: Extended Domain schema (hostname/type/status/verificationTarget), domainsRoute(prisma, auth) with POST/GET /api/domains
  - phase: 03-domains-multi-domain-tls-routing (plan 02)
    provides: DNS verification flow that flips Domain.status pending -> active/failed, TLS_CHECK_RATE_LIMIT const (added 03-01)
provides:
  - resolveActiveDomainByHost(prisma, rawHost) — exact-match, lowercased, port-stripped, status==='active'-only host guard, deny-by-default on any miss (unregistered/pending/failed/malformed/partial)
  - GET /api/tls-check?domain=<host> — session-free, rate-limited (TLS_CHECK_RATE_LIMIT) ask endpoint: 200 empty body for active domains, 404 empty body otherwise
  - docs/deployment/reverse-proxy.md On-Demand TLS Integration section (Caddy ask + Traefik/certbot polling notes)
affects: [03-04, 05-redirect-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveActiveDomainByHost mirrors authorization.ts's deny-by-default contract — absence of an exact-match active row is denial, never a wildcard/substring/first-domain fallback; this is the FROZEN shared host guard both the tls-check ask endpoint and the Phase 5 redirect engine depend on"
    - "tlsCheckRoute(prisma) mirrors canaryRoute(prisma)'s no-session factory shape — the caller is the operator's own reverse proxy, not a browser, so no auth.api.getSession() call exists in this route at all"
    - "Ask-endpoint response contract: empty body on both 200 and 404, no distinguishing detail beyond the status code (Caddy's documented ask contract + T-03-04 information-disclosure mitigation)"

key-files:
  created:
    - apps/api/src/lib/domainResolution.ts
    - apps/api/src/routes/tlsCheck.ts
    - apps/api/test/domainResolution.test.ts
    - apps/api/test/tlsCheck.integration.test.ts
  modified:
    - apps/api/src/app.ts
    - docs/deployment/reverse-proxy.md

key-decisions:
  - "resolveActiveDomainByHost normalizes via rawHost.toLowerCase().split(':')[0]?.trim() and returns null on any falsy/empty result before ever touching Prisma — matches RESEARCH Pattern 4 and 03-PATTERNS.md exactly"
  - "tlsCheckRoute reads the hostname exclusively from request.query.domain (Caddy sets this from the TLS SNI) — never from request.hostname or X-Forwarded-Host, per Pitfall 1 / T-03-02"
  - "reverse-proxy.md's Caddy example intentionally omits the deprecated on_demand_tls interval/burst options in favor of the ask-only form, since Kurzly's own Domain.status check is already the authoritative gate"

requirements-completed: [DOMAIN-03]

coverage:
  - id: D1
    description: "resolveActiveDomainByHost resolves only an exact-match, active-status hostname; returns null for unregistered/pending/failed/malformed/partial hosts, case-insensitively and with :port stripped"
    requirement: "DOMAIN-03"
    verification:
      - kind: unit
        ref: "test/domainResolution.test.ts — active match, unregistered/pending/failed/undefined/empty/whitespace/partial all null, case-insensitive + port-strip match"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/tls-check returns 200/empty-body for an active domain and 404/empty-body for pending/failed/unregistered/spoofed hosts, requires no session, and is rate-limited"
    requirement: "DOMAIN-03"
    verification:
      - kind: integration
        ref: "test/tlsCheck.integration.test.ts — 200 active, 404 pending/failed/unregistered/substring-spoof, 200 with no cookie header, 429 under rapid-fire load"
        status: pass
    human_judgment: false
  - id: D3
    description: "docs/deployment/reverse-proxy.md documents the Caddy on_demand_tls.ask -> /api/tls-check integration, states TLS is the operator's responsibility (D-01), and adds Traefik/certbot dynamic-domain polling notes"
    requirement: "DOMAIN-03"
    verification:
      - kind: other
        ref: "grep -c 'tls-check' docs/deployment/reverse-proxy.md returns 5 (greater than 0)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 3: TLS gating via operator-delegated ask endpoint Summary

**Exact-match, deny-by-default `resolveActiveDomainByHost` host guard plus a session-free, rate-limited `GET /api/tls-check` ask endpoint that lets an operator's reverse proxy (Caddy `on_demand_tls.ask`) request Let's Encrypt certificates only for domains Kurzly has verified as active — with `reverse-proxy.md` documenting the full integration.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-11T15:54:30Z
- **Completed:** 2026-07-11T16:03:54Z
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `resolveActiveDomainByHost(prisma, rawHost)` — normalizes (lowercase, strip `:port`), exact `findUnique` against `Domain.hostname`, returns the row only when `status === "active"`; null for unregistered, pending, failed, malformed, and partial/substring hosts (no wildcard, no fallback)
- `GET /api/tls-check?domain=<host>` — reads the hostname exclusively from the `?domain=` query param (Caddy's SNI-derived value), delegates the decision to `resolveActiveDomainByHost`, returns an empty-body `200` (issue cert) or `404` (refuse) with zero distinguishing detail, no session required, rate-limited via `TLS_CHECK_RATE_LIMIT` (60/min)
- Wired `tlsCheckRoute(prisma)` into `app.ts` directly after `domainsRoute` and before `registerStatic()`, updated the file's registration-order docblock to match
- `docs/deployment/reverse-proxy.md` — new "On-Demand TLS Integration" section under the Caddy option (ask-only Caddyfile example, explicit D-01 "TLS is the operator's responsibility, not Kurzly's" statement) plus a Traefik/certbot dynamic-domain polling note (no native `ask` webhook equivalent)

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1: resolveActiveDomainByHost host guard + unit suite**
   - `2a752db` (test, RED) — failing unit suite: missing-module error confirmed before implementation existed
   - `01bec1f` (feat, GREEN) — `domainResolution.ts` implementation, all 8 unit tests pass
2. **Task 2: GET /api/tls-check ask endpoint + app.ts wiring + integration suite**
   - `7068163` (test, RED) — failing integration suite: 6 of 7 cases failed (404 fallback / no route / no rate limit) before implementation existed
   - `b439d9b` (feat, GREEN) — `tlsCheck.ts` + `app.ts` wiring, all 7 integration tests pass
3. **Task 3: Document On-Demand TLS ask integration**
   - `094691f` (docs) — extended `reverse-proxy.md`'s Caddy section + added Traefik/certbot notes

**Plan metadata:** (this commit, docs: complete plan)

_Both TDD tasks followed strict RED -> GREEN: Task 1's RED failed with a "Cannot find module" error (implementation didn't exist yet); Task 2's RED failed 6/7 assertions (missing route falls through to the JSON 404 not-found handler, with a body, and the true active-domain case returned 404 instead of 200) before the corresponding GREEN commit made all cases pass._

## Files Created/Modified
- `apps/api/src/lib/domainResolution.ts` - `resolveActiveDomainByHost(prisma, rawHost)`, the shared exact-match/deny-by-default host guard
- `apps/api/test/domainResolution.test.ts` - Unit suite (8 tests: active/unregistered/pending/failed/case-insensitive/port-strip/undefined-empty-whitespace/partial-substring)
- `apps/api/src/routes/tlsCheck.ts` - `tlsCheckRoute(prisma)` factory registering `GET /api/tls-check`
- `apps/api/test/tlsCheck.integration.test.ts` - Integration suite (7 tests: 200 active, 404 pending/failed/unregistered/spoofed, no-session 200, rate-limit 429)
- `apps/api/src/app.ts` - Imports and registers `tlsCheckRoute(prisma)` after `domainsRoute`, before `registerStatic()`; registration-order docblock updated
- `docs/deployment/reverse-proxy.md` - New "On-Demand TLS Integration" section (Caddy `ask` example, D-01 statement) + Traefik/certbot dynamic-domain polling note

## Decisions Made
- `resolveActiveDomainByHost`'s signature (`prisma: PrismaClient, rawHost: string | undefined`) is treated as FROZEN per the plan's explicit instruction — kept exactly as researched/patterned so the Phase 5 redirect engine can reuse it without churn.
- The ask endpoint intentionally has zero authentication/session logic — it mirrors `canaryRoute`'s no-session factory shape rather than `domainsRoute`'s `resolveUserId`/`requireDomainAccess` pattern, since the caller is the operator's own infrastructure, not a dashboard user.
- The Caddy documentation explicitly steers operators away from the deprecated `interval`/`burst` options (per RESEARCH's State of the Art note) in favor of the `ask`-only form, since Kurzly's `Domain.status` check already serves as the authoritative rate/permission gate.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. This plan only extends documentation and adds an internal API endpoint; no new ENV vars or credentials.

## Next Phase Readiness
- `resolveActiveDomainByHost` is a stable, frozen export ready for direct reuse by Phase 5's redirect engine (`routes/redirect.ts`'s current stub will call it to resolve incoming Host headers to a Domain row).
- `GET /api/tls-check` is live and testable end-to-end against a real Caddy `on_demand_tls.ask` config per the new documentation.
- 03-04 can proceed independently; no blockers identified for this plan's deliverables.
- No blockers.

---
*Phase: 03-domains-multi-domain-tls-routing*
*Completed: 2026-07-11*
