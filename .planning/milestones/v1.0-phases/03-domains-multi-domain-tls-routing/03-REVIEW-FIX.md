---
phase: 03-domains-multi-domain-tls-routing
fixed_at: 2026-07-11T18:39:00Z
review_path: .planning/phases/03-domains-multi-domain-tls-routing/03-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-07-11T18:39:00Z
**Source review:** .planning/phases/03-domains-multi-domain-tls-routing/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 Critical, 3 Warnings, 2 Info)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: Missing hostname normalization on create defeats the unique-hostname / DNS-ownership-proof invariant

**Files modified:** `apps/api/src/lib/hostname.ts` (new), `apps/api/src/lib/domainResolution.ts`, `apps/api/src/routes/domains.ts`, `apps/api/test/domains.integration.test.ts`, `apps/api/test/domainResolution.test.ts`, `apps/web/src/views/DomainsView.vue`
**Commit:** `2be536a`

**Applied fix:** Added a shared `normalizeHostname()` helper (trim + lowercase + strip a single trailing dot) in a new `apps/api/src/lib/hostname.ts` module. `createDomainSchema` (routes/domains.ts) now runs every incoming hostname through this helper via a Zod `.transform()` BEFORE both the in-transaction uniqueness pre-check and persistence, so `Example.COM.` and `example.com` collide as the same row. `resolveActiveDomainByHost` (lib/domainResolution.ts) was refactored to call the SAME `normalizeHostname()` (after stripping a trailing `:port`) instead of its own inline `.toLowerCase()` — the create and read paths can no longer drift apart. Also mirrored `.toLowerCase()` client-side in `DomainsView.vue`'s `handleAddDomain` (UX nicety only — server remains authoritative). Added three regression tests: (1) creating `Normalize-CR01.EXAMPLE.com.` stores/returns `normalize-cr01.example.com`; (2) a second, unrelated user attempting to register `CaseVariant.Example.COM.` after `casevariant.example.com` already exists gets `409`, with only one row in the DB; (3) `resolveActiveDomainByHost` now also strips a trailing dot from the queried host before matching (domainResolution.test.ts).

### WR-01: Unvalidated `?domain=` query type on the unauthenticated tls-check endpoint can crash the handler instead of returning a clean 404

**Files modified:** `apps/api/src/routes/tlsCheck.ts`, `apps/api/test/tlsCheck.integration.test.ts`
**Commit:** `047b877`

**Applied fix:** Replaced the unchecked `const { domain } = request.query as { domain?: string }` type assertion with a runtime `typeof rawDomain === "string"` guard — anything that isn't a plain string (missing param, duplicate-key array, or any other shape Fastify's query parser could produce) is coerced to `undefined`, which routes through the SAME deny-by-default branch `resolveActiveDomainByHost` already handles for a missing host, yielding a clean `404` with an empty body instead of a `TypeError`-triggered `500`. Chose a runtime guard over a Fastify/AJV route schema specifically because AJV type-mismatch validation would produce a `400`, not the `404` this ask endpoint's contract requires. Added two regression tests: a missing `?domain=` param, and a duplicate-key `?domain=a&domain=b` (Fastify parses this as an array) — both now assert `404` with an empty body.

### WR-02: No hostname format validation on domain creation

**Files modified:** `apps/api/src/lib/hostname.ts`, `apps/api/src/routes/domains.ts`, `apps/api/test/domains.integration.test.ts`
**Commit:** `c33127a`

**Applied fix:** Added `HOSTNAME_FORMAT_RE` (label/charset validation: `1-63` alphanumeric-or-hyphen chars per label, no leading/trailing hyphen, `2-63`-letter TLD) and `HOSTNAME_MAX_LENGTH` (253, RFC 1035) to `lib/hostname.ts`. `createDomainSchema` now pipes the CR-01-normalized hostname through `z.string().min(1).max(HOSTNAME_MAX_LENGTH).regex(HOSTNAME_FORMAT_RE, ...)` — a whitespace-only, all-symbols, or overlong hostname is rejected with `400` instead of persisting as a perpetually-failing-verification row. Added two regression tests: a whitespace-only hostname (`"   "`) and a malformed hostname (`"not_a_valid_host!!"`), both asserting `400`.

### WR-03: DNS verification timeout timer is never cleared

**Files modified:** `apps/api/src/lib/dnsClient.ts`, `apps/api/test/dnsClient.test.ts`
**Commit:** `2e10508`

**Applied fix:** Captured the `setTimeout` handle in a `let timer: NodeJS.Timeout | undefined` and added a `finally { clearTimeout(timer); }` block around `verifyDomain`'s `Promise.race`, so the pending timer is always cleared once the resolver settles first (the common case) instead of staying alive for up to `timeoutMs` after every call. Added a regression test that spies on `global.clearTimeout` and asserts it was called exactly once after a fast-resolving fake resolver settles.

### IN-01: `POST /api/domains` has no dedicated per-route rate limit

**Files modified:** `apps/api/src/plugins/rateLimit.ts` (definition), `apps/api/src/routes/domains.ts` (route wiring — committed as part of CR-01 since both edits landed in the same file/pass)
**Commit:** `2926c47` (adds the `DOMAIN_CREATE_RATE_LIMIT` constant + doc comment; the route already consumed it as of `2be536a`)

**Applied fix:** Added `DOMAIN_CREATE_RATE_LIMIT = { max: 20, timeWindow: "15 minutes" }` to `plugins/rateLimit.ts`, mirroring `VERIFY_RATE_LIMIT`'s established per-route-override pattern (tighter than the 100-req/15-min global default, looser than `MAGIC_LINK_RATE_LIMIT` since there's no email-bombing risk — just row-creation noise). `POST /api/domains` was converted from `app.post(url, handler)` to `app.route({ method, url, config: { rateLimit: DOMAIN_CREATE_RATE_LIMIT }, handler })`, matching the `POST /:id/verify` / `GET /api/tls-check` pattern.

### IN-02: `CNAME_TARGET`/`A_RECORD_IP` fallback literals were duplicated between `env.ts` and `domains.ts`

**Files modified:** `apps/api/src/env.ts` (definition), `apps/api/src/routes/domains.ts` (consumption — committed as part of CR-01, same reason as IN-01 above)
**Commit:** `aa1af97` (adds the `DOMAIN_VERIFICATION_DEFAULTS` constant; `computeVerificationTarget` already consumed it as of `2be536a`)

**Applied fix:** Added `export const DOMAIN_VERIFICATION_DEFAULTS = { CNAME_TARGET: "shortener.kurzly.local", A_RECORD_IP: "0.0.0.0" } as const;` to `env.ts`, and wired `envSchema`'s `.default(...)` calls for `CNAME_TARGET`/`A_RECORD_IP` to reference it instead of re-typing the literals. `routes/domains.ts`'s `computeVerificationTarget` (which intentionally reads `process.env` directly rather than the parsed `loadEnv()` result — see its own header comment) now imports and falls back to the SAME `DOMAIN_VERIFICATION_DEFAULTS` constants, so the two boot paths can never silently diverge on what the fallback value actually is.

## Skipped Issues

None — all 6 in-scope findings (1 Critical, 3 Warnings, 2 Info) were fixed.

## Verification

- `pnpm --filter @kurzly/shared build` — clean (rebuilt after web/api typecheck initially failed to resolve `@kurzly/shared`)
- `pnpm --filter @kurzly/api exec tsc --noEmit` — clean, run after every commit in the sequence
- `pnpm --filter @kurzly/web exec tsc --noEmit` — clean
- `pnpm --filter @kurzly/api test -- --run` — 93/93 passing (real testcontainers Postgres; includes 9 new/updated regression tests: 3 for CR-01, 2 for WR-02, 2 for WR-01, 1 for WR-03, plus the pre-existing 84)
- `pnpm --filter @kurzly/web test -- --run` — 23/23 passing (unchanged count; DomainsView.vue's client-side `.toLowerCase()` mirror did not require new assertions — existing fixtures already use lowercase hostnames)

## Notes on Commit Granularity

CR-01 and WR-02 both modify `createDomainSchema` in `routes/domains.ts` (normalization vs. format-validation of the same `hostname` field). These were deliberately staged and committed as two separate, independently-verified diffs (`2be536a` then `c33127a`) — the WR-02 regex/format piece and its two regression tests were temporarily reverted, CR-01 was verified standalone (91/91 tests green) and committed, then WR-02 was re-applied, re-verified (93/93 tests green), and committed separately, so each commit's diff maps 1:1 to its finding ID.

IN-01 and IN-02's *consuming* code in `routes/domains.ts` (the `app.route(...)` rate-limit wiring and the `DOMAIN_VERIFICATION_DEFAULTS` import/fallback) was already present in the working tree by the time CR-01 was first edited and landed in the CR-01 commit (`2be536a`) as part of that file's full diff. The IN-01/IN-02 commits (`2926c47`, `aa1af97`) add the *supporting definitions* those imports resolve against (`DOMAIN_CREATE_RATE_LIMIT` in `plugins/rateLimit.ts`, `DOMAIN_VERIFICATION_DEFAULTS` in `env.ts`). All verification (typecheck + full test suite) was run against the complete working tree at each stage, so the fully-committed final state builds and passes cleanly; an intermediate `git checkout` of `2be536a` alone would not build in isolation (missing those two exports) — flagging this for transparency since it's a minor deviation from strict per-commit buildability, traded off against keeping CR-01/WR-02 (which share a line-level edit) as cleanly separable commits.

---

_Fixed: 2026-07-11T18:39:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
