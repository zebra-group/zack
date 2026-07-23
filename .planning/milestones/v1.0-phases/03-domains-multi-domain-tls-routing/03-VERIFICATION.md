---
phase: 03-domains-multi-domain-tls-routing
verified: 2026-07-11T18:48:14Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Pixel-fidelity comparison of the Domains screen (list, add row, status badges, instructions accordion, delete dialog, empty state) at 1440px in both Light and Dark theme against design_handoff_url_shortener/Kurzly Prototyp.dc.html"
    expected: "Colors, typography, spacing, and interaction states match the prototype exactly (UI-03, 03-UI-SPEC.md 860px container contract)"
    why_human: "Visual/pixel fidelity cannot be verified by static analysis or grep — requires rendering the app and doing a side-by-side visual comparison"
    result: "PASSED (operator-accepted 2026-07-11). Deterministic token-fidelity audit of DomainsView.vue: 50+ var(--*) token references, accent #d7ff01 applied only via var(--accent) (never hard-coded), Geist Mono for DNS records, 860px container per UI-SPEC, and the direct hex values present (#1b1b18/#f1f1ec/#e5484d) are exact matches to the locked --text tokens + the documented static destructive color — no drift. The Domains screen reuses Phase 2's already-accepted locked design system verbatim (0 new tokens/sizes/weights per 03-UI-SPEC.md). Same acceptance basis the operator applied to Phase 2's UI-03; a live headless-browser pixel-diff is not runnable in this WSL environment (no working browser)."
  - test: "Point a real Caddy instance's on_demand_tls.ask at a running Kurzly instance's /api/tls-check for an actually-active domain and confirm a Let's Encrypt certificate is issued, and that a request for an unregistered/pending host is refused"
    expected: "Caddy issues a cert only for the active domain; the ask call for any other domain is refused (404) and no cert is requested"
    why_human: "Requires a live reverse proxy, real DNS, and a real ACME round-trip against Let's Encrypt (or its staging environment) — not reproducible in this verification pass; documented instead in docs/deployment/reverse-proxy.md per D-01"
    result: "DEFERRED to deployment (operator-acknowledged 2026-07-11). This is an ops/deployment integration test requiring a live public deployment + DNS + Let's Encrypt round-trip — inherently out of scope for the automated test harness and not a code gap. The Kurzly side of the contract (the /api/tls-check ask endpoint: 200 for active, 404 otherwise, empty body, deny-by-default via resolveActiveDomainByHost) IS automated-tested (tlsCheck.integration.test.ts) and the Caddy on_demand_tls.ask wiring is documented in docs/deployment/reverse-proxy.md per D-01. Does not block subsequent phases."
---

# Phase 3: Domains & Multi-Domain TLS Routing Verification Report

**Phase Goal:** Admins can register their own domains/subdomains, verify DNS, and have TLS certificates issued on-demand once verified via OPERATOR-DELEGATED TLS (D-01: Kurzly gates the operator proxy's on-demand TLS via a verified-status `ask` endpoint — GET /api/tls-check; NO in-app ACME, Kurzly terminates no TLS) — establishing the domain layer the redirect engine will resolve every request against.
**Verified:** 2026-07-11T18:48:14Z
**Status:** passed (UI-03 token-fidelity sign-off recorded 2026-07-11; operator-proxy TLS integration deferred to deployment per D-01)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin registers a domain/subdomain, created with status "DNS pending" | ✓ VERIFIED | `apps/api/src/routes/domains.ts` `POST /api/domains` creates `Domain` with `status: "pending"` + owner `DomainMembership` in one `prisma.$transaction`; integration test `domains.integration.test.ts:108` "creates a pending Domain + owner DomainMembership in one transaction" passes. `apps/web/src/views/DomainsView.vue` `handleAddDomain()` calls `createDomain()` and shows `"${hostname} hinzugefügt — DNS ausstehend"` toast; `DomainsView.test.ts:99` asserts this. |
| 2 | Admin triggers a DNS check; correct CNAME/A flips domain to "Active", incorrect leaves it pending/failed | ✓ VERIFIED | `apps/api/src/lib/dnsClient.ts` `verifyDomain()` resolves CNAME (subdomain) / A (apex) via an injectable `DnsResolver`, normalizes both sides, returns `{verified}`; `POST /api/domains/:id/verify` in `domains.ts` sets `status: "active"`/`"failed"` + `verifiedAt`/`lastCheckedAt`/`lastCheckError` accordingly. Both branches asserted in `domains.integration.test.ts:381` (flips to active) and `:413` (flips to failed, `lastCheckError` set) using a fake injected resolver — real state-transition behavior is exercised by a passing test, not just presence. `DomainsView.vue handleVerify()` calls the endpoint and updates the badge; `DomainsView.test.ts:119` asserts this. |
| 3 | Admin sees per-domain CNAME/A instructions; Kurzly exposes `GET /api/tls-check?domain=<host>` → 200/404 that an operator's reverse proxy queries to issue TLS on-demand only for Active domains; Kurzly terminates no TLS itself | ✓ VERIFIED | `GET /:id/instructions` (`domains.ts toInstructions()`) returns a CNAME line for subdomain, A + ALIAS-alternative line for apex — tested (`domains.integration.test.ts:560`, `:587`). `apps/api/src/routes/tlsCheck.ts` `tlsCheckRoute` returns `200` empty body for active, `404` empty body otherwise, no session required, rate-limited (`TLS_CHECK_RATE_LIMIT`) — all asserted in `tlsCheck.integration.test.ts` (10 cases: active/unregistered/pending/failed/substring-spoof/missing-param/duplicate-param/no-session/rate-limit). `docs/deployment/reverse-proxy.md` §"On-Demand TLS Integration" documents the Caddy `on_demand_tls.ask` pattern pointed at `/api/tls-check`, explicit "Kurzly does not issue or terminate TLS certificates itself (D-01)" wording, plus a Traefik/certbot polling fallback. `DomainsView.vue`'s TLS hint text states the operator's own reverse proxy issues/terminates TLS, never Kurzly. |
| 4 | A spoofed/unregistered Host/X-Forwarded-Host is rejected, never silently matched to any domain | ✓ VERIFIED | `apps/api/src/lib/domainResolution.ts` `resolveActiveDomainByHost()` does an exact-match `findUnique` on the normalized hostname and requires `status === "active"`; returns `null` for anything else — no substring/wildcard/first-domain fallback exists in the implementation. `tlsCheckRoute` reads `?domain=` only, never `request.hostname`/`X-Forwarded-Host`. Regression tests: `domainResolution.test.ts:114` "never falls back to a wildcard/first-domain match for a partial/substring host"; `tlsCheck.integration.test.ts:93` "returns 404 for a spoofed host that only contains a registered hostname as a substring". |
| 5 (plan-level) | A shared `normalizeHostname()` is used by BOTH create and read paths — no case/dot-variant cross-owner registration or verified-but-unreachable domain (CR-01) | ✓ VERIFIED | `apps/api/src/lib/hostname.ts normalizeHostname()` is imported by both `createDomainSchema` (`routes/domains.ts:76`, applied via `.transform()` before the uniqueness pre-check and persistence) and `resolveActiveDomainByHost` (`domainResolution.ts:29`, applied after `:port` stripping). Regression tests: `domains.integration.test.ts:246` (normalizes casing+trailing dot before persist), `:269` (case/dot variant of an existing hostname → 409, not a second row), `domainResolution.test.ts:80` (strips trailing dot before matching). |
| 6 (plan-level) | Only owner/admin can register/verify/delete domains (D-04); members are read-only | ✓ VERIFIED | `POST /:id/verify`, `DELETE /:id`, `GET /:id/instructions` all call `requireDomainAccess(prisma, userId, id, "admin")`, catching `ForbiddenError` → 403. Denial tested for all three routes: `domains.integration.test.ts:444` (verify, member→403), `:521` (delete, member→403), `:615` (instructions, member→403); also `:478` unknown-domain-id → 403 (deny-by-default). `POST /api/domains` deliberately bypasses `requireDomainAccess` (no Domain/Membership exists yet) but is still 401-gated on an authenticated session; tested `:171`. |
| 7 (plan-level) | DNS verification is SSRF-safe (DNS resolution only, no HTTP fetch) and timeout-bounded | ✓ VERIFIED | `dnsClient.ts` imports only `node:dns/promises`; header comment states it must never import an HTTP client. `verifyDomain()` wraps the lookup in `Promise.race` against a `setTimeout`-based timer, with a `finally { clearTimeout(timer) }` (WR-03 fix) so the timer never leaks. `dnsClient.test.ts` includes an SSRF-canary test (per plan's must_haves) and a `clearTimeout` spy assertion for the WR-03 fix. |
| 8 (plan-level) | The `/api/tls-check` response never leaks a target/account and returns 404 (not 500) for malformed `?domain=` (WR-01) | ✓ VERIFIED | `tlsCheck.ts` handler coerces any non-string `request.query.domain` (missing, duplicate-key array) to `undefined`, routing through the same deny-by-default branch → clean 404, never a `TypeError`-triggered 500. Both response bodies (`200`/`404`) are empty (`reply.code(...).send()`) — no target URL, account, or distinguishing detail. Tested: `tlsCheck.integration.test.ts:113` (missing param), `:125` (duplicate-key array param). |

**Score:** 8/8 truths verified (11/11 counting all must_have artifacts/links independently checked below); 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/prisma/schema.prisma` | Extended `Domain` model + `DomainType`/`DomainStatus` enums | ✓ VERIFIED | Fields `hostname @unique`, `type`, `status @default(pending)`, `verificationTarget`, `verifiedAt?`, `lastCheckedAt?`, `lastCheckError?`, `updatedAt`, `@@index([status])` all present (lines 100-114, 119-132). |
| `apps/api/prisma/migrations/20260711151644_extend_domain_lifecycle/migration.sql` | Migration applying the schema change | ✓ VERIFIED | Creates `DomainType`/`DomainStatus` enums, adds all new columns, unique index on `hostname`, index on `status` — matches schema exactly. |
| `packages/shared/src/index.ts` — `DomainDTO` | Shared type consumed by both frontend and backend | ✓ VERIFIED | `DomainDTO` (lines 46-55) matches `toDomainDto()` in `routes/domains.ts` field-for-field. |
| `apps/api/src/env.ts` — `CNAME_TARGET`/`A_RECORD_IP` | Fail-safe-defaulted env vars | ✓ VERIFIED | `DOMAIN_VERIFICATION_DEFAULTS` const + Zod `.default(...)` wiring present; single source of truth shared with `routes/domains.ts` (IN-02 fix). |
| `apps/api/src/plugins/rateLimit.ts` | `VERIFY_RATE_LIMIT`, `TLS_CHECK_RATE_LIMIT`, `DOMAIN_CREATE_RATE_LIMIT` | ✓ VERIFIED | All three consts present and applied via `config.rateLimit` on their respective routes (IN-01 fix confirmed for `DOMAIN_CREATE_RATE_LIMIT`). |
| `apps/api/src/routes/domains.ts` | `domainsRoute(prisma, auth, dnsResolver)`: POST/GET/verify/delete/instructions | ✓ VERIFIED | All 5 routes present, wired, and independently authorization-gated as documented above. |
| `apps/api/src/lib/dnsClient.ts` | `verifyDomain`, `DnsResolver`, `nodeDnsResolver` | ✓ VERIFIED | Present, injectable, SSRF-safe, timeout-bounded with leak fix. |
| `apps/api/src/lib/domainResolution.ts` | `resolveActiveDomainByHost(prisma, rawHost)` | ✓ VERIFIED | Exact-match, deny-by-default, shares `normalizeHostname()` with the create path. |
| `apps/api/src/routes/tlsCheck.ts` | `tlsCheckRoute(prisma)`: GET /api/tls-check | ✓ VERIFIED | Present, rate-limited, session-free, WR-01 hardened. |
| `docs/deployment/reverse-proxy.md` | On-Demand TLS `ask` section | ✓ VERIFIED | §"On-Demand TLS Integration (Caddy `ask` → `/api/tls-check`)" present with Caddyfile example, Traefik/certbot polling fallback, explicit D-01 wording. |
| `apps/web/src/api.ts` | `createDomain`/`listDomains`/`verifyDomain`/`deleteDomain`/`getDomainInstructions` | ✓ VERIFIED | All 5 typed client fns present, hitting the correct endpoints. |
| `apps/web/src/views/DomainsView.vue` | Domains screen (860px container) | ✓ VERIFIED | `.screen-container { max-width: 860px; }` confirmed (line 328); list/add/verify/instructions/delete-confirm/empty-state all implemented. |
| `apps/web/src/router/index.ts` | `/domains` → `DomainsView` | ✓ VERIFIED | Route swapped from `ComingSoonView` to `DomainsView` (line 60). |
| `apps/web/test/DomainsView.test.ts` | Component suite | ✓ VERIFIED | 9 test cases covering empty state, list render, add, verify, instructions, delete-confirm (open/cancel), 409-duplicate mapping. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `app.ts` | `domainsRoute(prisma, auth, dnsResolver)` | `app.register(...)` before `registerStatic()` | ✓ WIRED | Registered at line 117, after `authRoute`, before `healthRoute`/`redirectRoute`/`registerStatic` — never shadowed by SPA fallback. |
| `app.ts` | `tlsCheckRoute(prisma)` | `app.register(...)` | ✓ WIRED | Registered at line 118. |
| `routes/domains.ts createDomainSchema` | `lib/hostname.ts normalizeHostname` | `.transform()` | ✓ WIRED | Applied before uniqueness pre-check and persistence. |
| `lib/domainResolution.ts resolveActiveDomainByHost` | `lib/hostname.ts normalizeHostname` | direct call | ✓ WIRED | Same function as the create path — confirmed CR-01 fix holds. |
| `routes/tlsCheck.ts` | `lib/domainResolution.ts resolveActiveDomainByHost` | direct call, reads only `?domain=` | ✓ WIRED | No use of `request.hostname`/`X-Forwarded-Host` anywhere in the file. |
| `DomainsView.vue` | `apps/web/src/api.ts` domain client fns | direct import + call | ✓ WIRED | All 5 CRUD/verify/instructions actions call the corresponding typed client fn. |
| `router/index.ts` | `DomainsView.vue` | route component | ✓ WIRED | `/domains` maps to `DomainsView`, was `ComingSoonView`. |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| API test suite (testcontainers Postgres, real DB) | `pnpm --filter @kurzly/api test -- --run` | 15 files, **93/93 passed** | ✓ PASS |
| Web component test suite | `pnpm --filter @kurzly/web test -- --run` | 5 files, **23/23 passed** | ✓ PASS |
| API typecheck | `pnpm --filter @kurzly/api exec tsc --noEmit` | clean, no output | ✓ PASS |
| Web typecheck | `pnpm --filter @kurzly/web exec tsc --noEmit` | clean, no output | ✓ PASS |
| Shared package build | `pnpm --filter @kurzly/shared build` | clean | ✓ PASS |
| HEAD matches claimed fix commit | `git log` | `383f415` (docs(03): add code review fix report) is HEAD, matches 03-REVIEW-FIX.md | ✓ PASS |

Individually-confirmed named DOMAIN-02 state-transition tests (not just enumerated — read and traced): `domains.integration.test.ts` "owner/admin + matching fake resolver → 200, status flips to active, verifiedAt + lastCheckedAt set" and "owner/admin + non-matching fake resolver → 200, status flips to failed, lastCheckError set" both ran as part of the 93/93 full-suite pass above; these are the tests that upgrade truth #2 from presence to behaviorally-verified.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| DOMAIN-01 | 03-01, 03-04 | Register domain/subdomain → "DNS pending" | ✓ SATISFIED | `POST /api/domains` + `DomainsView.vue` add flow, tested end-to-end (API + component). |
| DOMAIN-02 | 03-02, 03-04 | Check DNS (CNAME) → flips to "Active" | ✓ SATISFIED | `verifyDomain()` + `POST /:id/verify` + `DomainsView.vue` verify button, both status-transition branches tested. |
| DOMAIN-03 (reformulated per D-01) | 03-03 | `ask`/status endpoint gates operator on-demand TLS; Kurzly terminates no TLS | ✓ SATISFIED | `GET /api/tls-check`, `resolveActiveDomainByHost`, `docs/deployment/reverse-proxy.md`. REQUIREMENTS.md already carries the D-01-reformulated wording (line 40) — no drift between plan and requirements doc. |
| DOMAIN-04 | 03-02, 03-04 | Per-domain DNS instructions (CNAME target) | ✓ SATISFIED | `GET /:id/instructions` + `DomainsView.vue` instructions accordion + copy-to-clipboard. |

No orphaned requirements found — REQUIREMENTS.md's `DOMAIN-01..04` all trace to plans in this phase, and all four plans' frontmatter `requirements:` fields collectively cover exactly this set.

### Anti-Patterns Found

None. Scanned all phase-modified files (`hostname.ts`, `domainResolution.ts`, `dnsClient.ts`, `domains.ts`, `tlsCheck.ts`, `env.ts`, `app.ts`, `rateLimit.ts`, `DomainsView.vue`, `api.ts`, `router/index.ts`, `packages/shared/src/index.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches. The single "placeholder" string hit is the HTML `placeholder="z.B. s.meinefirma.de"` input attribute (not a stub marker).

### Human Verification Required

### 1. UI-03 Pixel-Fidelity Check

**Test:** Render the Domains screen at 1440px viewport width in both Light and Dark theme; visually compare against `design_handoff_url_shortener/Kurzly Prototyp.dc.html`'s Domains screen (colors, typography, spacing, badge states, accordion, delete dialog, toast).
**Expected:** Pixel-level match per 03-UI-SPEC.md's Layout Contract (860px container, Geist fonts, lime accent tokens).
**Why human:** Automated structure/behavior tests (23/23 web component tests) confirm the DOM structure, class bindings, and interaction logic are correct, but cannot assess actual rendered pixel fidelity against a static HTML prototype — this requires a human visual comparison.

### 2. Real Operator Reverse-Proxy On-Demand TLS Integration

**Test:** Deploy Kurzly behind a real Caddy instance configured per `docs/deployment/reverse-proxy.md`'s `on_demand_tls.ask` example, register + verify a real domain end-to-end, and confirm Caddy successfully requests and receives a Let's Encrypt certificate for it (and refuses for an unverified domain).
**Expected:** Certificate issuance succeeds only for the "Active" domain; the ask call is refused (404) for any unregistered/pending/failed domain, and Caddy does not attempt issuance.
**Why human:** Requires live infrastructure (real reverse proxy, real DNS records, a real or staging ACME/Let's Encrypt round-trip) that cannot be exercised inside this verification pass — the endpoint's contract (200/404 empty body) is fully covered by the automated integration suite, but the actual operator-proxy interaction is an ops-level integration documented for manual execution.

### Gaps Summary

No gaps found. All 4 phase-level Success Criteria (DOMAIN-01 through DOMAIN-04, reformulated per D-01) and all plan-level must_haves (schema/migration, owner-bootstrap creation, hostname normalization shared between create and read paths per the CR-01 fix, admin-gated verify/delete/instructions, SSRF-safe timeout-bounded DNS verification, deny-by-default exact-match host resolution, non-leaking tls-check response, and the frontend Domains screen) are implemented, wired, and covered by passing tests (93/93 API + 23/23 web, both real-Postgres/testcontainers-backed for the API suite). The two items requiring human verification (visual pixel-fidelity and live reverse-proxy TLS issuance) are explicitly out of automated-verification scope by nature (visual comparison / live external infrastructure), not implementation gaps.

---

_Verified: 2026-07-11T18:48:14Z_
_Verifier: Claude (gsd-verifier)_
