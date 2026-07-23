---
phase: 05-core-redirect-engine
plan: 04
subsystem: api
tags: [fastify, fastify-cookie, isbot, url, urlsearchparams, rate-limit, redirect]

# Dependency graph
requires:
  - phase: 05-core-redirect-engine (plan 01/02)
    provides: resolveActiveDomainByHost host guard, Link.passwordHash/expiresAt/forwardQuery columns
provides:
  - "resolveLinkState + mergeQuery pure precedence/query-forward engine (lib/redirectEngine.ts)"
  - "isBotRequest bot detection wrapper (lib/botDetection.ts)"
  - "cookieName/unlockPayload/issueUnlockCookie/hasValidUnlockCookie self-invalidating unlock cookie (lib/unlockCookie.ts)"
  - "REDIRECT_RATE_LIMIT + VERIFY_RATE_LIMIT_PER_LINK rate-limit configs with a per-(IP,host,slug) keyGenerator (plugins/rateLimit.ts)"
affects: [05-05, 05-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, Fastify-free, DB-free classifier/transform functions (resolveLinkState, mergeQuery, isBotRequest) unit-tested with plain object-literal fixtures — no fastify.inject, no testcontainers Postgres round-trip needed for this logic."
    - "Self-invalidating cookie payload = digest of the resource's own mutable secret field (passwordHash), not a bare boolean — automatic revocation on secret rotation with zero bookkeeping."
    - "Fastify-free rate-limit keyGenerator typed against a minimal structural request shape (RateLimitKeyRequest), not FastifyRequest, so it stays directly unit-testable with a stub."

key-files:
  created:
    - apps/api/src/lib/redirectEngine.ts
    - apps/api/src/lib/botDetection.ts
    - apps/api/src/lib/unlockCookie.ts
    - apps/api/test/redirectEngine.test.ts
  modified:
    - apps/api/src/plugins/rateLimit.ts

key-decisions:
  - "resolveLinkState/mergeQuery take a minimal Pick<Link, ...> shape rather than the full generated Prisma Link type, keeping the module import-graph free of any Prisma runtime/DB coupling while still deriving the field types from the single source of truth."
  - "unlockCookie.ts imports '@fastify/cookie' only for its side-effect type augmentation (declare module 'fastify') — the plugin itself is registered by the route layer in 05-06, not here."
  - "VERIFY_RATE_LIMIT_PER_LINK's keyGenerator is typed against a local RateLimitKeyRequest structural type (ip/hostname/params.slug), not FastifyRequest, so it stays Fastify-free and directly unit-testable with a stub object per the plan's critical notes."

patterns-established:
  - "Pattern: security-critical precedence/merge/detection logic lives in pure functions unit-tested via fixtures; the HTTP route layer (05-06) composes them and owns all Fastify/Prisma access."

requirements-completed: [REDIR-01, REDIR-03, REDIR-04, REDIR-05]

coverage:
  - id: D1
    description: "resolveLinkState classifies expired > protected > ok with expiry checked first and unconditionally (D-14), including the expired+protected+valid-cookie edge case and the <= boundary"
    requirement: "REDIR-03"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts#resolveLinkState (D-14, precedence: expired > protected > ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "mergeQuery appends only incoming keys the target doesn't already define, target wins on conflict, scheme/host/path never altered (D-12/D-13, no open-redirect surface)"
    requirement: "REDIR-05"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts#mergeQuery (D-12/D-13, target wins on conflict, no open-redirect surface)"
        status: pass
    human_judgment: false
  - id: D3
    description: "isBotRequest correctly classifies a known crawler UA as bot, a real browser UA and a missing UA as not-bot (D-04)"
    requirement: "REDIR-05"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts#isBotRequest (D-04, thin isbot wrapper)"
        status: pass
    human_judgment: false
  - id: D4
    description: "unlockPayload/cookieName primitives are deterministic and self-invalidating on password-hash change (D-07/D-08); issueUnlockCookie/hasValidUnlockCookie implemented per Pattern 4 but their signed round-trip needs a real Fastify request/reply — deferred to 05-06's route integration test"
    requirement: "REDIR-04"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts#unlockPayload / cookieName (D-07/D-08, self-invalidating unlock cookie)"
        status: pass
    human_judgment: true
    rationale: "issueUnlockCookie/hasValidUnlockCookie's signed cookie issue/verify round-trip requires a real FastifyReply/FastifyRequest with @fastify/cookie registered — that end-to-end proof is explicitly deferred to 05-06's route integration test per this plan's own task text, not covered by this plan's unit suite."
  - id: D5
    description: "REDIRECT_RATE_LIMIT (generous, D-16) and VERIFY_RATE_LIMIT_PER_LINK (tight, per-(IP,host,slug) keyGenerator, D-15) rate-limit configs exist and the keyGenerator does not collapse cross-domain same-slug buckets"
    requirement: "REDIR-01"
    verification:
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts#VERIFY_RATE_LIMIT_PER_LINK.keyGenerator (D-15, RESEARCH Pitfall 4)"
        status: pass
      - kind: unit
        ref: "apps/api/test/redirectEngine.test.ts#Rate-limit consts exist with the expected shape (D-15/D-16)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-07-12
status: complete
---

# Phase 5 Plan 04: Redirect Engine Core Logic Summary

**Pure precedence/query-merge classifier (resolveLinkState/mergeQuery), isbot wrapper, self-invalidating passwordHash-digest unlock cookie, and per-(IP,host,slug) rate-limit configs — all Fastify/DB-free and unit-tested with fixtures.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-12T15:21:00Z
- **Completed:** 2026-07-12T15:35:40Z
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `resolveLinkState` (D-14): expired > protected > ok precedence, expiry checked first and unconditionally — proven for the expired+protected, expired+protected+valid-cookie, and exact `<=` boundary cases.
- `mergeQuery` (D-12/D-13): WHATWG `URL`/`URLSearchParams`-based query forwarding where the stored target always wins on key conflict; structurally cannot alter scheme/host/path.
- `isBotRequest` (D-04): thin `isbot` wrapper, verified against a real crawler UA, a real browser UA, and a missing UA.
- `unlockCookie.ts` (D-07/D-08): `cookieName`/`unlockPayload` primitives proven deterministic and self-invalidating on hash rotation; `issueUnlockCookie`/`hasValidUnlockCookie` implemented per RESEARCH Pattern 4 (signed, httpOnly, sameSite=strict, path-scoped, session-lifetime, `Secure` gated on `NODE_ENV`).
- `REDIRECT_RATE_LIMIT` + `VERIFY_RATE_LIMIT_PER_LINK` (D-15/D-16): the verify limit's `keyGenerator` proven to key on `ip:hostname:slug`, avoiding the cross-domain same-slug bucket collision RESEARCH's Pitfall 4 warns about.

## Task Commits

Each task followed RED → GREEN (TDD):

1. **Task 1: resolveLinkState + mergeQuery**
   - `d0b2431` - test(05-04): add failing unit tests for resolveLinkState + mergeQuery (RED)
   - `6d61398` - feat(05-04): implement resolveLinkState + mergeQuery redirect engine (GREEN)
2. **Task 2: botDetection + unlockCookie + rate-limit configs**
   - `59a0133` - test(05-04): add failing unit tests for botDetection, unlockCookie, rate limits (RED)
   - `07a96bd` - feat(05-04): implement botDetection, unlockCookie, and new rate-limit configs (GREEN)

**Plan metadata:** (this commit)

_No REFACTOR commits were needed — the GREEN implementation for each task matched RESEARCH's patterns directly._

## Files Created/Modified
- `apps/api/src/lib/redirectEngine.ts` - `LinkState`, `resolveLinkState`, `mergeQuery` — pure precedence classifier + query-forward merge
- `apps/api/src/lib/botDetection.ts` - `isBotRequest` — thin `isbot` wrapper
- `apps/api/src/lib/unlockCookie.ts` - `cookieName`, `unlockPayload`, `issueUnlockCookie`, `hasValidUnlockCookie` — link-bound, self-invalidating unlock cookie
- `apps/api/src/plugins/rateLimit.ts` - added `REDIRECT_RATE_LIMIT`, `VERIFY_RATE_LIMIT_PER_LINK`, `RateLimitKeyRequest`
- `apps/api/test/redirectEngine.test.ts` - 24 unit tests covering all five artifacts above

## Decisions Made
- `resolveLinkState`/`mergeQuery`'s input types use `Pick<Link, ...>` (a type-only import) rather than the full Prisma `Link` model, keeping the module's declared "zero DB access" contract unambiguous while still deriving field types from the single schema source of truth.
- `unlockCookie.ts` imports `"@fastify/cookie"` purely for its `declare module "fastify"` type-augmentation side effect (so `FastifyReply.setCookie`/`FastifyRequest.cookies`/`unsignCookie` type-check) — the plugin itself is registered by the route layer in 05-06, not here.
- `VERIFY_RATE_LIMIT_PER_LINK.keyGenerator` is typed against a local `RateLimitKeyRequest` structural type (`{ ip, hostname, params: { slug } }`) instead of `FastifyRequest`, matching this plan's "PURE, Fastify-free building blocks" directive and keeping it directly unit-testable with a stub object.

## Deviations from Plan

None — plan executed exactly as written. All five `must_haves.artifacts` exist with their required exports/contents; all `must_haves.truths` are covered by passing unit tests; all `must_haves.prohibitions` hold (verified `resolveLinkState`/`mergeQuery` have no Fastify/HTTP/PrismaClient imports and no DB calls — only a type-only `Link` import for field-shape derivation).

## Issues Encountered

None specific to this plan's files. Two full-suite (`vitest run`, all `apps/api` test files) sanity runs each showed 2 unrelated flaky failures in different pre-existing integration test files (`auth.integration.test.ts` on one run, `canary.integration.test.ts` on another) — neither file is in this plan's scope, and `test/redirectEngine.test.ts` passed 24/24 in every isolated run. Logged to `.planning/phases/05-core-redirect-engine/deferred-items.md` per the executor's scope-boundary rule; not fixed here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `resolveLinkState`, `mergeQuery`, `isBotRequest`, `hasValidUnlockCookie`/`issueUnlockCookie`, `REDIRECT_RATE_LIMIT`, and `VERIFY_RATE_LIMIT_PER_LINK` are all implemented, typed, and unit-tested — ready for 05-06 (redirect route wiring, per RESEARCH's "Redirect Handler Skeleton") to compose them with `resolveActiveDomainByHost` (05-01) and `lib/publicHtml.ts`'s renderers (05-03).
- The signed unlock-cookie issue/verify round-trip (requires `@fastify/cookie` registered on a real Fastify app) and the rate-limit configs' actual route wiring remain to be proven end-to-end in 05-06's route integration test, as this plan's task text specifies.

---
*Phase: 05-core-redirect-engine*
*Completed: 2026-07-12*

## Self-Check: PASSED

All created files found on disk (redirectEngine.ts, botDetection.ts, unlockCookie.ts, redirectEngine.test.ts, this SUMMARY.md, deferred-items.md); all four task commits (d0b2431, 6d61398, 59a0133, 07a96bd) found in git log.
