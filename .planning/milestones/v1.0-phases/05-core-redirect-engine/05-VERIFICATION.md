---
phase: 05-core-redirect-engine
verified: 2026-07-12T19:14:21Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 5: Core Redirect Engine Verification Report

**Phase Goal:** Every visit to a short link resolves correctly, safely, and fast — the product's stated Core Value — with the exact status-code precedence (expiration → password-gate → bot/OG branch → 302 redirect) enforced and zero premature leakage of protected destinations.
**Verified:** 2026-07-12T19:14:21Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A valid link on a domain resolves 302 to its exact stored target (REDIR-01) | ✓ VERIFIED | `apps/api/src/routes/redirect.ts:134-137`; `redirect.integration.test.ts` "REDIR-01" (302 + exact `Location` + `no-store`) |
| 2 | Redirect resolution is strictly host-scoped per domain (REDIR-02) | ✓ VERIFIED | `redirectRoute` resolves via `resolveActiveDomainByHost(prisma, request.hostname)` before any slug lookup (`redirect.ts:96,101-103`); `redirect.integration.test.ts:129-181` "REDIR-02: host-scoped resolution" — same slug `promo` on two domains resolves independently to `target-a`/`target-b`, and an unregistered host never cross-domain-matches (404) |
| 3 | An expired link returns 410 with the expiry page, no Location header (REDIR-03) | ✓ VERIFIED | `redirect.ts:117-122`; `redirect.integration.test.ts:183-207` — 410, no `location`, body contains "Dieser Link ist abgelaufen"/"HTTP 410 · Gone", no-leak canary asserted absent |
| 4 | A protected link shows the password page (target absent) and only unlocks after a server-side bcrypt-verified password (REDIR-04) | ✓ VERIFIED | `redirect.ts:123-128` (GET) + `145-196` (POST verify, `bcrypt.compare`); `redirect.integration.test.ts:210-309` covers GET-no-leak, wrong-password no-leak, correct-password unlock+cookie, and cookie self-invalidation after password rotation |
| 5 | Bots get generic OG tags without redirect; protected/expired targets are never disclosed to bots (REDIR-05) | ✓ VERIFIED | `redirect.ts:108-115` (bot short-circuit ahead of state branches, per D-06); `redirect.integration.test.ts:336-393` — bot on normal link gets 200 OG never 302; bot on protected AND expired link both get generic OG with canary absent |
| 6 | Precedence expiration→password→bot/OG→302 is enforced coherently; expired+protected → 410, never the password page (D-14) | ✓ VERIFIED | `resolveLinkState` (`redirectEngine.ts:44-51`) checks `expiresAt` first and unconditionally before `passwordHash`, with unit tests (`redirectEngine.test.ts:42-63`) proving expired-wins-over-protected even with a valid unlock cookie; integration test `redirect.integration.test.ts:311-333` confirms 410 + absence of the password-page string end-to-end |
| 7 | Password/expiry/forwardQuery are set only through the single write path (`createLink`/`updateLink`); passwordHash never appears in any DTO/response (D-01) | ✓ VERIFIED | `grep` confirms `prisma.link.create`/`prisma.link.update` occur only inside `apps/api/src/lib/links.ts` (application code, excluding generated Prisma client boilerplate); `toLinkDto` (`links.ts:407-421`) derives only `passwordProtected: boolean`, never reads `passwordHash` onto the DTO; `routes/links.ts`'s Zod allowlist schemas never accept a client-supplied `passwordHash` field |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### No-Leak Canary (Success Criterion 3 — special attention item)

`apps/api/test/redirect.integration.test.ts` defines `CANARY_TARGET = "https://canary-leak-marker.example.net/super-secret-target-xyz123"` (line 33) and a shared `assertNoLeak()` helper (lines 93-102) that asserts the canary is absent from **both** the response body **and every header value** (iterates `Object.values(response.headers)`). This assertion is exercised across all pre-unlock branches:
- expired (410) — line 206
- protected GET (200, password page) — line 231
- protected POST wrong-password (200, re-shown page) — line 254
- expired+protected precedence (410) — line 332
- bot on protected link — line 391
- bot on expired link — line 391 (same loop)

This is a real, running assertion — not a claim. Confirmed executed and green (see Test Execution below). `apps/api/src/lib/publicHtml.ts`'s render-context types (`PasswordPageCtx`, `ExpiredPageCtx`, `NotFoundPageCtx`, `BotOgPageCtx`) structurally carry no `target`/`targetUrl` field, so the leak is prevented by construction, not just by the assertion.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/routes/redirect.ts` | `GET /:slug` + `POST /:slug/verify` precedence engine | ✓ VERIFIED | Real implementation, 199 lines, reads-only (no `prisma.link.write` calls) |
| `apps/api/src/lib/redirectEngine.ts` | `resolveLinkState` + `mergeQuery` pure functions | ✓ VERIFIED | Pure, no DB/Fastify imports; 24/24 unit tests |
| `apps/api/src/lib/publicHtml.ts` | Shared render layer (password/expiry/404/bot-OG) | ✓ VERIFIED | `escapeHtml` applied to every user-controlled interpolation; 24/24 unit tests |
| `apps/api/src/lib/unlockCookie.ts` | Self-invalidating link-bound unlock cookie | ✓ VERIFIED | Payload = digest of current `passwordHash`; signed, httpOnly, sameSite=strict, session-lifetime |
| `apps/api/src/lib/botDetection.ts` | `isBotRequest` wrapping `isbot` | ✓ VERIFIED | Thin, pure wrapper |
| `apps/api/src/lib/links.ts` | Single write path + `toLinkDto` | ✓ VERIFIED | `createLink`/`updateLink` are the only `prisma.link.create`/`update` call sites in application code |
| `apps/api/src/plugins/rateLimit.ts` | `REDIRECT_RATE_LIMIT` + `VERIFY_RATE_LIMIT_PER_LINK` | ✓ VERIFIED | 300/min generous redirect limit; 5/min tight per-(IP,host,slug) verify limit |
| `apps/web/src/components/LinkFormModal.vue` | Security accordion (password/expiry/forwardQuery) | ✓ VERIFIED | Password field never pre-filled; "Passwortschutz entfernen" clear action; 16/16 component tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `routes/redirect.ts` | `lib/domainResolution.ts` | `resolveActiveDomainByHost(prisma, request.hostname)` | ✓ WIRED | Called on both GET and POST/verify handlers before any slug lookup |
| `routes/redirect.ts` | `lib/redirectEngine.ts` | `resolveLinkState`/`mergeQuery` | ✓ WIRED | Composed directly in the handler |
| `routes/redirect.ts` | `lib/unlockCookie.ts` | `hasValidUnlockCookie`/`issueUnlockCookie` | ✓ WIRED | Checked on GET, issued on successful POST verify |
| `routes/redirect.ts` | `lib/publicHtml.ts` | `renderPasswordPage`/`renderExpiredPage`/`renderNotFoundPage`/`renderBotOgPage` | ✓ WIRED | All four renderers called from the correct branches |
| `app.ts` | `routes/redirect.ts` | `redirectRoute(prisma)` registered after `linksRoute`, before `registerStatic` | ✓ WIRED | Confirmed at `app.ts:155` — correct Pitfall-5 slot, `/api/links` and SPA fallback never shadowed |
| `app.ts` | `@fastify/cookie` | `app.register(fastifyCookie, { secret: BETTER_AUTH_SECRET })` | ✓ WIRED | Registered before route registration (`app.ts:133`) |
| `LinkFormModal.vue` | `lib/links.ts` (via API) | submit payload carries `password`/`expiresAt`/`forwardQuery` into `createLink`/`updateLink` | ✓ WIRED | `routes/links.ts`'s Zod allowlist accepts these three fields; no second write path |

### Test Execution (run directly by the verifier, not taken from SUMMARY claims)

| Suite | Command | Result |
|-------|---------|--------|
| `redirect.integration.test.ts` | `npx vitest run` (apps/api) | **17/17 passed** |
| `publicHtml.test.ts` | `npx vitest run` (apps/api) | **24/24 passed** |
| `redirectEngine.test.ts` | `npx vitest run` (apps/api) | **24/24 passed** |
| `LinkFormModal.test.ts` | `npx vitest run` (apps/web) | **16/16 passed** |
| `pnpm -r typecheck` | repo root | **Clean, 0 errors, all workspaces** |

Combined: 3 API suites = 65/65 passed; +16 web = 81/81 total passed across the phase's test files. All executed live in this verification session (real testcontainers Postgres, real migrations applied), not sourced from SUMMARY.md narrative.

Note: `apps/web/src/components/LinkFormModal.test.ts` must be run from the `apps/web` workspace (its own Vite/Vue config) — running it from the repo root fails on `.vue` parsing, which is a workspace-invocation artifact, not a code defect; re-running from the correct cwd produced a clean pass.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REDIR-01 | 05-02, 05-04, 05-05, 05-06 | 302 auf Ziel-URL | ✓ SATISFIED | `redirect.ts:134-137`; integration test |
| REDIR-02 | 05-06 | Host-basiert pro Domain gescoped | ✓ SATISFIED | `redirect.ts:96` `resolveActiveDomainByHost`; dedicated integration describe block (2 tests) proving same-slug-different-domain independence and no cross-domain match. **Note:** `.planning/REQUIREMENTS.md` line 57/149 still shows this requirement as `[ ] Pending`/"Pending" — this is a stale documentation bookkeeping gap, not a functional gap (see Anti-Patterns/Notes below) |
| REDIR-03 | 05-02, 05-03, 05-04, 05-06 | Abgelaufen → 410 Gone, kein Redirect | ✓ SATISFIED | `redirect.ts:117-122`; integration + unit tests |
| REDIR-04 | 05-01, 05-02, 05-04, 05-05, 05-06 | Passwort-Seite; Ziel erst nach geprüftem, gehashtem Passwort | ✓ SATISFIED | `redirect.ts:123-128,145-196`; bcrypt compare; integration tests |
| REDIR-05 | 05-01, 05-03, 05-04, 05-06 | Bots injizierte OG-Tags ohne Redirect; kein Preview vor Prüfung | ✓ SATISFIED | `redirect.ts:108-115`; `renderBotOgPage`; integration tests |
| UI-04 | 05-01, 05-03, 05-06 | Öffentliche Passwort-Seite | ✓ SATISFIED | `publicHtml.ts:165-198` `renderPasswordPage`; LOCKED German copy; dark-mode support |
| UI-05 | 05-01, 05-03, 05-06 | Öffentliche Ablauf-Seite | ✓ SATISFIED | `publicHtml.ts:206-231` `renderExpiredPage`; LOCKED German copy; formatted expiry date |

All 7 phase requirement IDs accounted for and satisfied by working, tested code. One documentation-bookkeeping discrepancy noted (REDIR-02's REQUIREMENTS.md status/checkbox not flipped to Complete) — flagged as a WARNING-level note, not a functional gap, since the underlying capability is verified working and tested.

### Anti-Patterns Found

None. Scanned all phase-modified files (`redirect.ts`, `redirectEngine.ts`, `publicHtml.ts`, `unlockCookie.ts`, `botDetection.ts`, `links.ts`, `plugins/rateLimit.ts`, `LinkFormModal.vue`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero matches.

**Note (non-blocking, documentation-only):** `.planning/REQUIREMENTS.md` line 57 (`- [ ] REDIR-02`) and line 149 (`| REDIR-02 | Phase 5 | Pending |`) were not updated to reflect completion, unlike REDIR-01/03/04/05 and UI-04/05 which are correctly marked `[x]`/"Complete". The actual implementation and a dedicated, passing integration test suite prove REDIR-02 is fully satisfied (see Requirements Coverage above). Recommend a trivial follow-up edit to flip these two lines to `[x]`/"Complete" for documentation accuracy — this does not block phase completion since it is purely a bookkeeping omission, not a code or test gap.

### D-01 Single-Write-Path Audit

`grep -rn "prisma\.link\.\(create\|update\|upsert\|createMany\|updateMany\)" apps/api/src --include="*.ts"` was run across the entire application source tree. The only matches in non-generated application code are `apps/api/src/lib/links.ts:340` (`createLink`'s `prisma.link.create`) and `apps/api/src/lib/links.ts:381` (`updateLink`'s `prisma.link.update`). All other matches are inside `apps/api/src/generated/prisma/**` (Prisma-generated client boilerplate/doc comments, not application write sites) or are comments referencing the rule. `apps/api/src/routes/redirect.ts` performs zero `prisma.link.*` write calls — confirmed by direct read of the file (only two `prisma.link.findUnique` calls, both reads).

### Password Hash Leakage Audit

`grep -rn "passwordHash"` across `apps/api/src`, `apps/web/src`, `packages/shared/src` (excluding tests and generated Prisma boilerplate) shows `passwordHash` is only ever: (1) derived/stored inside `lib/links.ts`, (2) read (never re-exposed) inside `redirectEngine.ts`'s type-only `Pick`, `unlockCookie.ts`'s digest derivation, and `routes/redirect.ts`'s `bcrypt.compare`/`issueUnlockCookie` calls. `toLinkDto` never assigns `passwordHash` onto its return object. No DTO, API response shape, or Vue component ever holds a raw or hashed password value — `LinkFormModal.vue`'s password field is documented and tested to never be pre-filled.

### Cache-Control: no-store Audit

`redirect.ts` sets `reply.header("Cache-Control", "no-store")` as the literal first statement in both the GET and POST handlers (lines 89, 146), before any branching — so no early-return path can skip it. Confirmed by a dedicated integration test (`redirect.integration.test.ts:560-615`) asserting `no-store` on the 302, 410, password-200, and 404 branches.

## Human Verification Required

None. This phase's user-facing surface is fully server-rendered HTML with deterministic string output, entirely covered by automated string-assertion tests (copy contract, token values, dark-mode media query, escaping). No visual/interactive behavior requires human judgment beyond what the existing UI-SPEC-derived unit tests already assert.

## Gaps Summary

No functional gaps found. All 7 observable truths derived from the ROADMAP success criteria and phase requirements (REDIR-01..05, UI-04, UI-05) are verified against real, running code and passing tests (81/81 across 4 test files, executed live in this session) plus a clean repo-wide typecheck. The security-critical no-leak canary, host-based scoping, D-14 precedence ordering, D-01 single-write-path, and Cache-Control: no-store guarantees were independently confirmed by direct source reading, not merely by trusting SUMMARY.md.

One non-blocking documentation gap was found: `.planning/REQUIREMENTS.md`'s REDIR-02 row/checkbox was not updated to "Complete" despite the requirement being fully implemented and tested. Recommend fixing this in a trivial follow-up commit.

---

_Verified: 2026-07-12T19:14:21Z_
_Verifier: Claude (gsd-verifier)_
