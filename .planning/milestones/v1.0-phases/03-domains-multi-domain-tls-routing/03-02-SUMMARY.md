---
phase: 03-domains-multi-domain-tls-routing
plan: 02
subsystem: api
tags: [dns, fastify, prisma, authorization, tdd, ssrf]

# Dependency graph
requires:
  - phase: 03-domains-multi-domain-tls-routing (plan 01)
    provides: Extended Domain schema (hostname/type/status/verificationTarget/verifiedAt/lastCheckedAt/lastCheckError), domainsRoute(prisma, auth) factory with POST/GET /api/domains, VERIFY_RATE_LIMIT const, requireDomainAccess/scopedDomainIds authorization core (Phase 2)
provides:
  - dnsClient.ts — injectable DnsResolver + verifyDomain(hostname, type, expectedTarget, resolver, timeoutMs): SSRF-safe (DNS-only, zero fetch calls), timeout-bounded (Promise.race), never-throwing, normalizes trailing-dot/case
  - POST /api/domains/:id/verify (rate-limited via VERIFY_RATE_LIMIT), DELETE /api/domains/:id, GET /api/domains/:id/instructions — all requireDomainAccess(prisma, userId, id, "admin")-gated
  - BuildAppOptions.dnsResolver — injectable DNS resolver threaded through buildApp into domainsRoute, so integration tests never touch live DNS
affects: [03-03, 03-04, 05-redirect-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dnsClient.ts's DnsResolver/nodeDnsResolver mirrors canaryRoute(prisma)/authRoute(auth)'s factory-injection precedent — no vi.mock of a Node builtin, an injected fake resolver instead"
    - "domainsRoute(prisma, auth, dnsResolver = nodeDnsResolver) — third optional collaborator param, defaulted for production callers, overridden by buildApp({ dnsResolver }) in tests"
    - "DNS lookups wrapped in Promise.race against a setTimeout-rejecting promise — the standard, low-risk timeout pattern for Node's dns/promises (which has no native timeout/cancellation)"

key-files:
  created:
    - apps/api/src/lib/dnsClient.ts
    - apps/api/test/dnsClient.test.ts
  modified:
    - apps/api/src/routes/domains.ts
    - apps/api/src/app.ts
    - apps/api/test/domains.integration.test.ts

key-decisions:
  - "verifyDomain never throws past its own boundary — ENOTFOUND/ENODATA/DNS_TIMEOUT/anything else all surface as { verified: false, error: '<code>' }, matching D-03's 'status stays pending or flips failed, never an unhandled route error' contract"
  - "GET /:id/instructions is admin-gated (not just any member) — it reveals the operator's exact DNS target for a specific domain, treated as the same trust boundary as verify/delete per the plan's must_haves"
  - "A failed verify leaves verifiedAt untouched (only a successful check ever stamps it) — preserves 'has this domain EVER passed a check' information distinct from 'still pending, never checked'"

requirements-completed: [DOMAIN-02, DOMAIN-04]

coverage:
  - id: D1
    description: "verifyDomain resolves a subdomain via CNAME / apex via A-record using an injected resolver, normalizes trailing-dot/case, and returns { verified: true/false } without throwing — including a bounded-timeout path"
    requirement: "DOMAIN-02"
    verification:
      - kind: unit
        ref: "test/dnsClient.test.ts — match/mismatch/apex/normalize/timeout/ENOTFOUND/ENODATA cases"
        status: pass
      - kind: unit
        ref: "test/dnsClient.test.ts#SSRF canary: verifyDomain never issues an HTTP fetch — global fetch spy recorded 0 calls"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/domains/:id/verify flips Domain.status to active/failed based on the injected resolver's outcome, stamping verifiedAt/lastCheckedAt/lastCheckError accordingly"
    requirement: "DOMAIN-02"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#owner/admin + matching fake resolver → 200, status flips to active, verifiedAt + lastCheckedAt set"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#owner/admin + non-matching fake resolver → 200, status flips to failed, lastCheckError set"
        status: pass
    human_judgment: false
  - id: D3
    description: "verify / delete / instructions are all admin+-gated via requireDomainAccess; a member-role caller or unknown domain id is denied 403 (deny-by-default)"
    requirement: "DOMAIN-02, DOMAIN-04"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#member-role caller → 403 (deny-by-default, requireDomainAccess admin+)"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#unknown domain id → 403 (deny-by-default, no membership row)"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#DELETE .../member-role caller → 403"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#GET .../instructions/member-role caller → 403"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /:id/instructions returns a CNAME record line for a subdomain, and an A record plus an ALIAS alternative for an apex domain (03-UI-SPEC.md format)"
    requirement: "DOMAIN-04"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#subdomain → returns a CNAME record line"
        status: pass
      - kind: integration
        ref: "test/domains.integration.test.ts#apex → returns an A record line plus a non-null ALIAS alternative"
        status: pass
    human_judgment: false
  - id: D5
    description: "DELETE /api/domains/:id removes the row for an admin caller"
    requirement: "DOMAIN-02"
    verification:
      - kind: integration
        ref: "test/domains.integration.test.ts#owner/admin → 204 and the row is gone"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 2: On-demand DNS verification + admin-gated domain actions Summary

**Injectable, SSRF-safe, timeout-bounded `dnsClient.verifyDomain` (Promise.race, never-throwing) plus admin-gated `POST /:id/verify`, `DELETE /:id`, and `GET /:id/instructions` routes wired into `buildApp` via a resolver-injection param — DOMAIN-02 + DOMAIN-04 proven against real Postgres with 12 new tests.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-07-11T17:37:58Z
- **Completed:** 2026-07-11T17:47:42Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `dnsClient.ts` — `DnsResolver` type + `nodeDnsResolver` (backed by `node:dns/promises`) + `verifyDomain(hostname, type, expectedTarget, resolver, timeoutMs)`: DNS-only (SSRF-safe by construction, proven by a fetch-spy canary asserting zero `fetch` calls), `Promise.race`-timeout-bounded (default 5s, never hangs), normalizes trailing-dot/case before comparing, never throws past its own boundary (ENOTFOUND/ENODATA/DNS_TIMEOUT all surface as structured `{ verified: false, error }`)
- `POST /api/domains/:id/verify` (rate-limited via `VERIFY_RATE_LIMIT`), `DELETE /api/domains/:id`, `GET /api/domains/:id/instructions` — all `requireDomainAccess(prisma, userId, id, "admin")`-gated (member-role and unknown-domain callers get 403, deny-by-default)
- Verify route calls `verifyDomain` with the injected resolver and persists `status: active/failed`, `verifiedAt` (only on success), `lastCheckedAt` (always), `lastCheckError` (null on success, code/message on failure)
- Instructions route returns a CNAME line for subdomains, an A line + ALIAS alternative for apex domains, matching 03-UI-SPEC.md's exact code-block format
- `BuildAppOptions.dnsResolver` threaded into `domainsRoute(prisma, auth, dnsResolver)` — CI never touches live DNS

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: dnsClient.ts injectable resolver + verifyDomain**
   - `d425010` (test, RED) — failing unit suite: match/mismatch/apex/normalize/timeout/ENOTFOUND/ENODATA/SSRF-canary
   - `5cda540` (feat, GREEN) — `dnsClient.ts` implementation, all 8 unit tests pass
2. **Task 2: verify / delete / instructions routes + dnsResolver injection**
   - `7c80111` (test, RED) — failing integration suite: 9 new cases across verify/delete/instructions
   - `618bf13` (feat, GREEN) — routes + `app.ts` wiring, all 70 tests pass (61 prior + 9 new)

**Plan metadata:** (this commit, docs: complete plan)

_Both tasks followed strict RED→GREEN: each RED commit was confirmed failing (missing-module error for Task 1, 404s for Task 2's not-yet-existing routes) before the corresponding GREEN commit._

## Files Created/Modified
- `apps/api/src/lib/dnsClient.ts` - `DnsResolver` type, `nodeDnsResolver`, `verifyDomain()`
- `apps/api/test/dnsClient.test.ts` - Unit suite (8 tests: match/mismatch/apex/normalize/timeout/ENOTFOUND/ENODATA/SSRF-canary)
- `apps/api/src/routes/domains.ts` - Added `POST /:id/verify`, `DELETE /:id`, `GET /:id/instructions`; `domainsRoute` now accepts a third `dnsResolver` param; added `toInstructions()` helper
- `apps/api/src/app.ts` - `BuildAppOptions.dnsResolver?` added and threaded into `domainsRoute(prisma, auth, options.dnsResolver)`
- `apps/api/test/domains.integration.test.ts` - 9 new integration tests (verify status transitions, member-role 403s across all three actions, unknown-domain 403, instructions per-type format) plus a `fakeDnsResolver` test helper

## Decisions Made
- `verifyDomain` treats a CNAME/A mismatch as an expected, non-error outcome (`{ verified: false }`, no `error` field) — only actual DNS lookup failures (ENOTFOUND, ENODATA, DNS_TIMEOUT) populate `error`, matching the plan's `<behavior>` spec exactly.
- `GET /:id/instructions` is gated at `admin`+ (same as verify/delete), not merely any membership — it discloses the operator's exact CNAME target / A-record IP for a specific domain, which the plan's `must_haves.truths` explicitly scopes to admin-gated actions alongside verify/delete.
- A failed verify attempt leaves `verifiedAt` untouched (only a successful check ever sets it) — this preserves "has this domain ever passed a DNS check" as separate information from "still pending, never checked" for the UI's "Zuletzt geprüft" line, per RESEARCH Open Question 2's recommendation.
- The `domainsRoute` factory's third parameter is a plain positional `dnsResolver: DnsResolver = nodeDnsResolver` (not an options object) — matches the plan's explicit action text and keeps parity with the two-positional-arg `(prisma, auth)` shape already established in 03-01.

## Deviations from Plan

None - plan executed exactly as written. The one formatting adjustment (wrapping the `domainsRoute` function signature across multiple lines instead of one long line) is a pure style choice, not a behavioral deviation, and required no separate commit — it was folded into the Task 2 GREEN commit before that commit was made.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. `VERIFY_RATE_LIMIT` (10/5min) was already added in 03-01; this plan only consumes it.

## Next Phase Readiness
- `dnsClient.ts`'s `DnsResolver`/`nodeDnsResolver`/`verifyDomain` are stable exports available for reuse.
- `requireDomainAccess`/`scopedDomainIds` remain untouched (frozen signature, per Phase 2).
- `domainsRoute`'s three-positional-param shape `(prisma, auth, dnsResolver?)` is now the established pattern for any further domain-route additions.
- 03-03 (the `ask`/`tls-check` endpoint + `resolveActiveDomainByHost`) and 03-04 can build directly on the now-complete Domain lifecycle (pending → active/failed) and the admin-gated action set.
- No blockers.

---
*Phase: 03-domains-multi-domain-tls-routing*
*Completed: 2026-07-11*

## Self-Check: PASSED

All created/modified files verified present on disk (dnsClient.ts, dnsClient.test.ts, routes/domains.ts, app.ts, domains.integration.test.ts, this SUMMARY). All 4 task commit hashes (d425010, 5cda540, 7c80111, 618bf13) verified present in `git log --oneline --all`.
