---
phase: 05-core-redirect-engine
plan: 06
status: complete
completed: 2026-07-12
requirements: [REDIR-01, REDIR-02, REDIR-03, REDIR-04, REDIR-05, UI-04, UI-05]
---

# 05-06 Summary — Redirect Precedence Engine Route

**Status:** Complete
**Tasks:** 2/2

## Commits

- `9c5668c` — test(05-06): add failing redirect-engine integration + no-leak canary tests (RED)
- `ca8dec0` — feat(05-06): implement redirect precedence engine route with no-leak canary (GREEN)

## What Was Built

Replaced the stub `apps/api/src/routes/redirect.ts` with the real redirect engine — the product's Core Value. The route composes the pure helpers from 05-04 and the renderers from 05-03 into one coherent precedence engine:

- **Host resolution** via the frozen `resolveActiveDomainByHost(prisma, request.hostname)` (deny-by-default; never re-derives host from raw headers). Unknown/inactive host or unknown slug → generic branded 404 (`renderNotFoundPage`, D-11), with the raw slug echo run through `escapeHtml` (reflected-XSS guard).
- **`Cache-Control: no-store`** set as the first action on every response branch (302/410/password/404/bot-OG) — D-18.
- **Bot short-circuit** (`isBotRequest`): a crawler always receives a 200 OG-HTML page (`renderBotOgPage`), never a 302 and never the human 410/password page — D-06/REDIR-05; generic OG only, real target absent.
- **Precedence** (D-14) via `resolveLinkState(link, hasValidUnlockCookie(request, link))`: expiration (410 + `renderExpiredPage`) → password-gate (`renderPasswordPage`) → 302 redirect. Expired-and-protected resolves to 410, never the password page.
- **Password gate** (D-07/D-08): GET a protected link → password page with the destination absent from HTML/JSON/headers; `POST` verify endpoint (bcrypt compare, rate-limited per (IP, host, slug) via `VERIFY_RATE_LIMIT_PER_LINK`) → on match sets the self-invalidating unlock cookie (`issueUnlockCookie`) and 302s; wrong password → same page with inline error, no leak.
- **forwardQuery** (D-12/D-13): when enabled, incoming query is merged onto the stored target via `mergeQuery` (stored target wins on key conflict).
- **Click-tracking seam** (D-17): `recordClickHook({ linkId })` is a no-op placed at the successful-redirect point — writes no tracking data; Phase 6 hooks here.
- **`@fastify/cookie`** registered in `apps/api/src/app.ts` (used for signing the unlock cookie); the tight verify rate-limit is registered on the specific verify route ahead of the wildcard (magic-link pattern). No `@fastify/session`.

## Files

- `apps/api/src/routes/redirect.ts` — real precedence engine route (replaces stub)
- `apps/api/src/app.ts` — `@fastify/cookie` wiring + verify-route rate-limit registration
- `apps/api/test/redirect.integration.test.ts` — 17 integration tests

## Verification

- `apps/api` redirect integration suite: **17/17 passing** (no-leak canary asserts a distinctive target string is absent from body AND all headers across 404 / expired / protected-GET / wrong-password / bot branches; host-based scoping — same slug on two domains resolves to each own target, unknown host → 404; full precedence matrix incl. expired+protected → 410; reflected-XSS escaping; unlock cookie set on correct password and invalidated after password change; per-(IP,host,slug) rate-limit keying; `no-store` on every branch).
- `pnpm -r typecheck` clean across `packages/shared`, `apps/api`, `apps/web`.

## Deviations / Notes

- **Completed inline by the orchestrator after a session-limit interruption.** The gsd-executor subagent committed the RED test suite (`9c5668c`) and wrote the full GREEN implementation into the working tree, but was terminated by a provider session limit before committing GREEN or writing this SUMMARY. The orchestrator verified the uncommitted implementation (17/17 redirect integration tests green, typecheck clean), committed it as `ca8dec0`, and authored this summary — no code was regenerated, only verified and committed.
- The `.planning/config.json` working-tree change (`_auto_chain_active`) is an orchestration flag, intentionally excluded from the GREEN commit.
