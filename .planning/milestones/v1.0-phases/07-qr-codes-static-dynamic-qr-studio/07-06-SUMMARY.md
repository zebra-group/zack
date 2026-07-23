---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 06
subsystem: api
tags: [fastify, prisma, redirect, click-tracking, qrcode, unlock-cookie]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (plan 04)
    provides: "lib/qrCodes.ts single-write-path core (createQrCode/remapQrCode), QrCode.lifetimeScans field"
  - phase: 07-qr-codes-static-dynamic-qr-studio (plan 05)
    provides: "POST/GET/PATCH /api/qr-codes* HTTP surface (createQrCode/remapQrCode already reachable via HTTP)"
provides:
  - "GET /q/:code public dynamic-QR redirect handler (routes/qrRedirect.ts)"
  - "POST /q/:code/verify password unlock flow for password-protected dynamic-QR targets"
  - "recordClickHook (routes/redirect.ts) parameterized by source: ScanSource, exported for reuse"
  - "QrCode.lifetimeScans counter incremented on every completed scan"
  - "issueUnlockCookie(reply, linkId, cookiePath, passwordHash) — path now caller-supplied"
affects: [07-07 (QrCodesView needs /q/:code payload URLs to already resolve), 07-08 (Studio panel), 07-09 (LinkDetail QR entry point)]

tech-stack:
  added: []
  patterns:
    - "qrRedirectRoute(prisma) factory mirrors redirectRoute(prisma) structurally but is host-agnostic (no resolveActiveDomainByHost call) since QrCode.code is a flat global namespace"
    - "Shared write seams: routes/redirect.ts exports recordClickHook (source-parameterized) and brandCtx; qrRedirect.ts imports and reuses both instead of duplicating logic"
    - "Target Link is re-fetched fresh via prisma.link.findUnique on every /q/:code request (never cached), so remapQrCode's linkId change is honored on the very next scan while the printed code string never changes"
    - "lib/unlockCookie.ts's issueUnlockCookie now takes an explicit cookiePath instead of deriving /${slug} internally, so two independent route namespaces (/:slug and /q/:code) can each issue a correctly path-scoped, self-invalidating unlock cookie for the same Link"

key-files:
  created:
    - apps/api/src/routes/qrRedirect.ts
    - apps/api/test/qrRedirect.integration.test.ts
  modified:
    - apps/api/src/routes/redirect.ts
    - apps/api/src/lib/unlockCookie.ts
    - apps/api/src/app.ts

key-decisions:
  - "lifetimeScans increments unconditionally on every completed GET /q/:code scan, independent of the target Link's trackingEnabled preference — unlike the ClickEvent write (which recordClickHook still gates on trackingEnabled). This is a QR-code-level scan counter (QR-07), not a privacy-sensitive per-visit event, so it stays accurate even when a link owner has disabled detailed click logging."
  - "POST /q/:code/verify does NOT call recordClickHook on success (mirrors routes/redirect.ts's POST /:slug/verify exactly) — it only issues the unlock cookie and 302s straight to the target. The scan is recorded by the immediately-following GET /q/:code, which now carries the valid cookie and resolves to state 'ok'."
  - "brandCtx and recordClickHook exported from routes/redirect.ts (not moved to a new shared module) — smallest-diff reuse path that keeps the single ClickEvent insert site inside the file that already owns it, per the plan's 'export it, or move it' either-or."

requirements-completed: [QR-02, QR-03, QR-07]

coverage:
  - id: D1
    description: "GET /q/:code resolves a dynamic QrCode's CURRENT target Link and 302-redirects there, re-running the target's expiry/password gate on every scan"
    requirement: "QR-02"
    verification:
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#GET /q/:code 302s to the target and records exactly one source='qr' ClickEvent + lifetimeScans+1"
        status: pass
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#returns 410 with the branded expiry copy when the target Link is expired"
        status: pass
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#GET shows the password page with the target absent and records no scan"
        status: pass
    human_judgment: false
  - id: D2
    description: "A remap changes the target Link a dynamic QR resolves to, while the printed /q/:code URL/code itself never changes (headline QR-03 negative test)"
    requirement: "QR-03"
    verification:
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#after remapping the QR to a new Link, GET /q/:code (SAME code) 302s to the NEW target"
        status: pass
    human_judgment: false
  - id: D3
    description: "A successful scan records exactly one ClickEvent with source='qr' through the shared recordClickHook, and increments QrCode.lifetimeScans; still exactly one ClickEvent insert call site in the codebase"
    requirement: "QR-07"
    verification:
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#GET /q/:code 302s to the target and records exactly one source='qr' ClickEvent + lifetimeScans+1"
        status: pass
      - kind: other
        ref: "grep -rn 'clickEvent.create' apps/api/src — one match (routes/redirect.ts's recordClickHook)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Password-protected dynamic-QR targets require unlock via POST /q/:code/verify before redirecting; wrong password blocks with no scan, correct password unlocks and a subsequent GET records the scan"
    requirement: "QR-02"
    verification:
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#POST /q/:code/verify with the wrong password re-renders the page with the error state, records nothing"
        status: pass
      - kind: integration
        ref: "apps/api/test/qrRedirect.integration.test.ts#POST /q/:code/verify with the correct password unlocks; a subsequent GET /q/:code then records the scan + 302s"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-20
status: complete
---

# Phase 7 Plan 6: Dynamic-QR Redirect Handler Summary

**`GET /q/:code` + `POST /q/:code/verify` — host-agnostic dynamic-QR redirect that re-fetches its target Link fresh every scan, reuses the redirect engine's gate/click-hook seams verbatim, and increments `QrCode.lifetimeScans`.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-20T19:35:00Z
- **Completed:** 2026-07-20T20:30:00Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `routes/redirect.ts`'s `recordClickHook` is now a `source: ScanSource`-parameterized, exported function — the codebase's single `prisma.clickEvent.create` call site, reused verbatim by the new QR route instead of duplicated.
- `routes/qrRedirect.ts`: `GET /q/:code` resolves a `dynamic` QrCode's CURRENT target Link fresh on every request (never a baked-in value), reuses `lib/redirectEngine.ts`'s `resolveLinkState`/`mergeQuery` so expiry/password gates are enforced identically to `/:slug`, and is registered host-agnostically (no `resolveActiveDomainByHost` call) since `QrCode.code` is a flat global namespace.
- On a successful scan: `recordClickHook({..., source: 'qr'})` writes the ClickEvent, and a new, narrowly-scoped `prisma.qrCode.update` increments `lifetimeScans` — the one documented exception `lib/qrCodes.ts`'s header comment already reserved for this file.
- `POST /q/:code/verify` mirrors `routes/redirect.ts`'s `POST /:slug/verify`: expiry precedence, bcrypt compare, unlock-cookie issue, 302 straight to target — wrong password re-renders with the inline error and records nothing; a subsequent `GET /q/:code` with the cookie records the scan.
- Headline QR-03 negative test proven: remapping a dynamic QR's target Link, then hitting the SAME original `/q/:code` code, 302s to the NEW target — the printed code never changes.
- `qrRedirectRoute(prisma)` registered in `app.ts` immediately after `redirectRoute(prisma)` and before `registerStatic`, so `/q/:code` is never shadowed by the SPA fallback.

## Task Commits

Each task was committed atomically:

1. **Task 1: Parameterize recordClickHook with source: ScanSource** - `1eec429` (refactor)
2. **Task 2: GET /q/:code resolution, gate reuse, scan recording, 302** - `9de75d5` (test, RED) + `e25fc90` (feat, GREEN)
3. **Task 3: /q/:code password unlock flow** - `9a5e4fc` (feat)

_TDD tasks: Task 1 was a refactor of already-tested code (existing redirect suite proves no regression), verified directly. Task 2 used the RED→GREEN split (test commit before implementation commit). Task 3's tests were folded into the same integration test file and verified GREEN before its single commit._

## Files Created/Modified
- `apps/api/src/routes/qrRedirect.ts` - `GET /q/:code` + `POST /q/:code/verify`, the dynamic-QR redirect/unlock handler
- `apps/api/test/qrRedirect.integration.test.ts` - resolution, remap-preserves-code, expired/protected gates, scan recording, password unlock flow
- `apps/api/src/routes/redirect.ts` - `recordClickHook` now `source`-parameterized and exported; `brandCtx` exported; `issueUnlockCookie` call now passes `/${slug}` explicitly
- `apps/api/src/lib/unlockCookie.ts` - `issueUnlockCookie` takes an explicit `cookiePath` instead of deriving `/${slug}` internally
- `apps/api/src/app.ts` - registers `qrRedirectRoute(prisma)` after `redirectRoute`, before `registerStatic`

## Decisions Made
- `lifetimeScans` increments unconditionally on every completed scan, independent of the target Link's `trackingEnabled` flag — see key-decisions above.
- `POST /q/:code/verify` does not itself record a scan (mirrors `/:slug/verify`'s existing, pre-Phase-7 behavior) — the scan lands on the follow-up `GET` once the unlock cookie is present.
- Reused (exported) `recordClickHook`/`brandCtx` from `routes/redirect.ts` rather than extracting a new shared module — smaller diff, keeps the single write site co-located with its existing ownership comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `issueUnlockCookie` needed a caller-supplied cookie path, not an internally-derived `/${slug}`**
- **Found during:** Task 3 (POST /q/:code/verify implementation)
- **Issue:** `lib/unlockCookie.ts`'s `issueUnlockCookie(reply, linkId, slug, passwordHash)` hardcoded the cookie's `path` as `/${slug}`. Reusing it verbatim for `/q/:code/verify` (passing `code` as the `slug` argument) would have scoped the cookie to path `/${code}` — a real browser would never send that cookie back on a subsequent `/q/:code` request (different top-level path), silently breaking the unlock flow for password-protected dynamic-QR targets. `fastify.inject`-based tests would not have caught this (inject doesn't enforce cookie-path semantics), so this was a latent correctness bug the test suite alone couldn't surface — it required tracing the actual `Set-Cookie` `Path` attribute against the request path the unlock is meant to protect.
- **Fix:** Changed `issueUnlockCookie`'s third parameter from `slug: string` to `cookiePath: string` (the caller now builds the full path). `routes/redirect.ts` now passes `/${slug}` explicitly; `routes/qrRedirect.ts` passes `/q/${code}`. `cookieName(linkId)` still keys purely on the Link, so the two path-scoped cookies for the same Link coexist independently without cross-invalidating each other.
- **Files modified:** `apps/api/src/lib/unlockCookie.ts`, `apps/api/src/routes/redirect.ts`, `apps/api/src/routes/qrRedirect.ts`
- **Verification:** Full `redirect.integration.test.ts` (17/17) and `qrRedirect.integration.test.ts` (7/7) suites pass; `qrCodes.integration.test.ts` (42/42) unaffected.
- **Committed in:** `9a5e4fc` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality)
**Impact on plan:** Necessary for the password-unlock flow to actually work in a real browser; no scope creep — confined to the exact cookie-path parameterization the plan's Task 3 required to make the two route namespaces independent.

## Issues Encountered
- Pre-existing WSL2 testcontainer parallel-flake (already logged as tech debt, commit `35a9128`) surfaced once during the full-suite run as an unrelated `links-import.integration.test.ts` row-count assertion failure (`expected 21 to be 1`) — a cross-test-file isolation leak under `--no-file-parallelism`'s heavier worker pressure, not caused by this plan's changes. Re-running the full suite immediately after showed only that single, unrelated failure and then, on a third run, zero failures. All target files for this plan (`redirect.integration.test.ts`, `redirect-tracking.integration.test.ts`, `qrRedirect.integration.test.ts`, `qrCodes.integration.test.ts`) pass 100% consistently across every individual and combined run performed during this plan's execution.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `/q/:code`'s payload URL (already generated by 07-05's `createQrCode`/`toQrCodeDto` as `BASE_URL + /q/:code`) now actually resolves end-to-end — 07-07/07-08/07-09's frontend QR Studio work can rely on printed/rendered dynamic QR codes being live.
- `lib/qrCodes.ts`'s header-comment-documented "future `/q/:code` scan hook" exception is now fulfilled exactly as scoped (only `lifetimeScans`, never `code`/`variant`/`linkId`).
- No blockers for downstream frontend phases.

---
*Phase: 07-qr-codes-static-dynamic-qr-studio*
*Completed: 2026-07-20*

## Self-Check: PASSED

- All key files present on disk (`apps/api/src/routes/qrRedirect.ts`, `apps/api/test/qrRedirect.integration.test.ts`, `apps/api/src/routes/redirect.ts`, `apps/api/src/lib/unlockCookie.ts`, `apps/api/src/app.ts`, this SUMMARY.md).
- All 4 task commits found in `git log` (`1eec429`, `9de75d5`, `e25fc90`, `9a5e4fc`).
- `pnpm exec tsc --noEmit` clean.
- `apps/api/test/qrRedirect.integration.test.ts` — 7/7 pass (isolated run).
- `apps/api/test/redirect.integration.test.ts` — 17/17 pass (isolated run, no regression from Task 1/3 changes).
- `apps/api/test/redirect-tracking.integration.test.ts` — 8/8 pass (no regression).
- `apps/api/test/qrCodes.integration.test.ts` — 42/42 pass (no regression from `issueUnlockCookie` signature change).
- `grep -rn "clickEvent.create" apps/api/src` — exactly 1 call site (`routes/redirect.ts`'s `recordClickHook`).
- `grep -n "qrCodesRoute\|redirectRoute\|qrRedirectRoute\|registerStatic" apps/api/src/app.ts` — confirmed registration order: `qrCodesRoute` → `redirectRoute` → `qrRedirectRoute` → `registerStatic`.
