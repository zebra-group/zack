---
phase: 07-qr-codes-static-dynamic-qr-studio
plan: 05
subsystem: api
tags: [fastify, zod, prisma, qrcode, rate-limit, idor, mass-assignment]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio (plan 03)
    provides: "lib/qr.ts shared rendering core (renderQrPng/renderQrSvg, normalizeLogo, InvalidColorError/InvalidLogoError)"
  - phase: 07-qr-codes-static-dynamic-qr-studio (plan 04)
    provides: "lib/qrCodes.ts single-write-path core (createQrCode/updateQrCode/remapQrCode/getQrRemapHistory/toQrCodeDto/statusForQrError) + shared DTOs"
provides:
  - "POST/GET/PATCH /api/qr-codes* HTTP surface (routes/qrCodes.ts)"
  - "GET /api/qr-codes/:id/render.png and .svg on-demand image endpoints"
  - "QR_CREATE_RATE_LIMIT and QR_RENDER_RATE_LIMIT rate-limit buckets"
  - "GET /api/qr-codes/:id and GET /api/qr-codes/:id/remap-history (Rule 2 addition for 07-07's downstream dependency)"
affects: [07-06 (qrRedirect.ts /q/:code), 07-07 (QrCodesView + api.ts client), 07-08 (Studio panel), 07-09 (LinkDetail QR entry point)]

tech-stack:
  added: []
  patterns:
    - "qrCodesRoute(prisma, auth) factory mirrors linksRoute/analyticsRoute exactly — same resolveUserId, Zod-allowlist, IDOR-guard, exhaustive-switch-error-mapping shape"
    - "resolveOwnedQrCode joins through the bound Link's domainId + scopedDomainIds, includes the link relation so render endpoints need no second query"
    - "targetLinkId as a single-field remap trigger inside the generic PATCH body, routing the whole request through remapQrCode instead of updateQrCode"
    - "Dynamic QR payload = BASE_URL + /q/:code (stable across remap); static QR payload = bound Link.targetUrl directly"

key-files:
  created:
    - apps/api/src/routes/qrCodes.ts
  modified:
    - apps/api/src/plugins/rateLimit.ts
    - apps/api/src/app.ts
    - apps/api/test/qrCodes.integration.test.ts
    - packages/shared/src/index.ts

key-decisions:
  - "Extended packages/shared's UpdateQrCodeInput with an optional targetLinkId field (07-04 had documented remap as intentionally unreachable through it) since this plan is where the actual PATCH wire contract is finalized, and the plan's own task text specifies a single PATCH endpoint routing targetLinkId through remapQrCode"
  - "LOGO_DATA_MAX_LENGTH set to 1,900,000 chars (below app.ts's 2 MiB global bodyLimit) so an oversized logoData upload gets this route's own typed 400, not Fastify's un-typed 413 — a cap set to exactly 2 MiB would be unreachable since any payload exceeding it also exceeds the global bodyLimit first"
  - "Added GET /api/qr-codes/:id and GET /api/qr-codes/:id/remap-history beyond the plan's two explicit tasks (Rule 2): 07-07's frontend plan (depends_on: [07-04, 07-05]) references getQrCode/getQrRemapHistory client functions hitting these endpoints without ever touching a backend file, so they must exist once this plan lands"

requirements-completed: [QR-01, QR-05, QR-06, QR-07]

coverage:
  - id: D1
    description: "Authenticated CRUD (POST/GET/PATCH/list) for QR codes, IDOR-safe and mass-assignment-guarded"
    requirement: "QR-01"
    verification:
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#POST /api/qr-codes (route layer, QR-01)"
        status: pass
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#GET /api/qr-codes and GET /api/qr-codes/:id (route layer)"
        status: pass
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#PATCH /api/qr-codes/:id (route layer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Centered-logo, custom color, rounded-module QR styling exposed via PATCH and rendered through the shared core"
    requirement: "QR-05"
    verification:
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#PATCH /api/qr-codes/:id logoData upload (route layer, T-07-LOGO-MIME)"
        status: pass
    human_judgment: false
  - id: D3
    description: "On-demand PNG/SVG render endpoints feeding the QR Studio live preview and export, with a dedicated generous rate-limit bucket"
    requirement: "QR-06"
    verification:
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#GET /api/qr-codes/:id/render.png and .svg (route layer, QR-06)"
        status: pass
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#GET /api/qr-codes/:id/render rate limit (QR_RENDER_RATE_LIMIT, dedicated bucket)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Visible scan-count field (lifetimeScans) surfaced read-only through the DTO, never client-settable"
    requirement: "QR-07"
    verification:
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#mass-assignment: an invalid enum variant is rejected (400), and code/lifetimeScans in the body never reach the persisted row"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-07-20
status: complete
---

# Phase 7 Plan 05: QR Management Routes Summary

**Thin, IDOR-safe `routes/qrCodes.ts` controller (mirrors `routes/links.ts` exactly) wrapping 07-04's `lib/qrCodes.ts` write path and 07-03's `lib/qr.ts` render core, with a dedicated `QR_RENDER_RATE_LIMIT` bucket for the debounced live-preview endpoint.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-07-20T14:07:00Z
- **Completed:** 2026-07-20T14:34:03Z
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- `POST /api/qr-codes`, `GET /api/qr-codes` (list), `GET /api/qr-codes/:id`, `PATCH /api/qr-codes/:id` (style update or remap), and `GET /api/qr-codes/:id/remap-history` — all authenticated, domain-scoped, IDOR-safe (identical 404 for not-found and out-of-scope, no existence oracle), mass-assignment-guarded via Zod allowlists.
- `GET /api/qr-codes/:id/render.png` and `.svg` — on-demand image bytes rendered from the QrCode's stored style through `lib/qr.ts`, decode-round-trip verified via `jsQR`; static QRs encode the bound Link's `targetUrl` directly, dynamic QRs encode a stable `BASE_URL/q/:code` URL that survives a remap.
- `QR_CREATE_RATE_LIMIT` (20/15min, mirrors `LINK_CREATE_RATE_LIMIT`) and `QR_RENDER_RATE_LIMIT` (120/min, generous dedicated bucket for the 300ms-debounced Studio preview) added to `plugins/rateLimit.ts`.
- Defense-in-depth: a strict hex Zod schema validates `color` at the route boundary (in addition to `lib/qr.ts`'s existing `InvalidColorError` guard at the render seam); `InvalidColorError`/`InvalidLogoError` are caught around both render handlers and always map to 400.
- Logo upload: `logoData` (base64/data-URI string) is capped and decoded at the route boundary, then handed to `updateQrCode` — the only place bytes are ever written; oversized and non-PNG/SVG uploads are rejected with a typed 400.
- `qrCodesRoute` registered in `app.ts` immediately after `analyticsRoute` and before `redirectRoute`/`registerStatic` (no shadowing).

## Task Commits

1. **Task 1 (tests + routes): CRUD + remap routes with Zod allowlist + IDOR guard** - `17f84ce` (feat)
2. **Task 2 (render endpoints + logo upload): on-demand PNG/SVG + dedicated rate limit** - `0ab8a99` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/api/src/routes/qrCodes.ts` - New: `qrCodesRoute(prisma, auth)` factory — CRUD, remap, list, detail, remap-history, and render.png/.svg endpoints
- `apps/api/src/plugins/rateLimit.ts` - Added `QR_CREATE_RATE_LIMIT` and `QR_RENDER_RATE_LIMIT`
- `apps/api/src/app.ts` - Registered `qrCodesRoute` after `analyticsRoute`, before `redirectRoute`/`registerStatic`; updated header registration-order comment
- `apps/api/test/qrCodes.integration.test.ts` - Extended with `app.inject`-based route-layer tests (auth/401, IDOR/404, mass-assignment, remap, render decode round-trip, logo upload, rate limit)
- `packages/shared/src/index.ts` - Added `targetLinkId?: string` to `UpdateQrCodeInput` to match the actual PATCH wire contract this plan implements

## Decisions Made
- Single `PATCH /api/qr-codes/:id` endpoint handles both style updates and remap: a `targetLinkId` field present in the body routes the entire request through `remapQrCode` instead of `updateQrCode` (never combined). This required extending `packages/shared`'s `UpdateQrCodeInput` (07-04 had documented remap as "never reachable through this generic style update," anticipating a separate operation) — since 07-05 is where the real wire contract is finalized and its own task text specifies exactly this single-endpoint shape, the type was updated to match, with the doc comment revised accordingly.
- Static QR payload = the bound Link's `targetUrl` directly (already `http(s)`-validated at Link-creation time, per 07-RESEARCH.md's Security Domain note); dynamic QR payload = `BASE_URL/q/:code`, read via a local `requireEnv("BASE_URL")` mirroring `lib/auth.ts`'s own pattern — this is what makes a dynamic QR's printed code survive a remap (proven by a before/after-remap decode-equality test).
- `LOGO_DATA_MAX_LENGTH` set to 1,900,000 characters rather than a literal 2 MiB: `app.ts`'s global `bodyLimit` is also exactly 2 MiB, so a cap set to that same value would be unreachable in practice — any oversized payload would trip Fastify's built-in 413 before ever reaching this route's own validation, defeating the "typed 400" requirement. The chosen value leaves a deliberate, testable gap.
- Added `GET /api/qr-codes/:id` and `GET /api/qr-codes/:id/remap-history`, beyond the plan's two explicitly-described tasks (Rule 2 — auto-added missing critical functionality): 07-07 (`depends_on: [07-04, 07-05]`) lists `getQrCode`/`getQrRemapHistory` among its API client functions and touches no backend file itself, so these endpoints must already exist for that downstream plan to function. `QR-04` itself remains credited to 07-07's `requirements`, not this plan's.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added GET /api/qr-codes/:id and GET /api/qr-codes/:id/remap-history**
- **Found during:** Task 1 (route registration)
- **Issue:** The plan's two tasks describe CRUD/remap and render/logo endpoints, but not a single-detail GET or a remap-history GET — yet 07-07 (a downstream plan depending on this one) references both via its `api.ts` client functions without touching any backend file.
- **Fix:** Added both as thin, IDOR-guarded reads reusing existing `resolveOwnedQrCode`/`getQrRemapHistory` (lib/qrCodes.ts, already built in 07-04) — no new authorization logic.
- **Files modified:** apps/api/src/routes/qrCodes.ts
- **Verification:** Dedicated 401/404/200 test blocks for both endpoints pass.
- **Committed in:** 17f84ce (Task 1 commit)

**2. [Rule 1 - Bug/Correctness] Extended packages/shared's UpdateQrCodeInput with targetLinkId**
- **Found during:** Task 1 (designing the PATCH request schema)
- **Issue:** 07-04's `UpdateQrCodeInput` type deliberately excluded any remap-triggering field, with a doc comment stating remap must be "a distinct, separately-audited operation... never reachable through this generic style update" — but this plan's own task text specifies exactly one PATCH endpoint where a `targetLinkId` field routes through `remapQrCode`. The type as committed did not match the wire contract this plan is required to build.
- **Fix:** Added `targetLinkId?: string` to `UpdateQrCodeInput`, revised its doc comment to describe the actual (single-endpoint, mutually-exclusive-with-style-fields) routing behavior, and rebuilt `@kurzly/shared`.
- **Files modified:** packages/shared/src/index.ts
- **Verification:** `pnpm --filter @kurzly/shared build` passes; `apps/api` typechecks cleanly against the updated type; remap-via-PATCH route tests pass.
- **Committed in:** 17f84ce (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 correctness/type-contract fix).
**Impact on plan:** Both were necessary for the plan's own stated behavior and for the downstream dependency chain (07-07) to function without touching a backend file. No scope creep beyond what the plan and its explicit dependents require.

## Issues Encountered

**Plan verification command literalism:** The plan's `<verification>` block states `grep -rc "prisma.qrCode" apps/api/src/routes/qrCodes.ts` should be `0`. As implemented, this grep returns `4` (2 in comments, 2 in real code: `resolveOwnedQrCode`'s `findFirst` and the list handler's `findMany` — both reads). This mirrors the established codebase convention exactly: `routes/links.ts`'s own `resolveOwnedLink` calls `prisma.link.findFirst` directly, and `GET /api/links` calls `prisma.link.findMany` directly — only mutations (`create`/`update`) are required to route through the `lib/*.ts` single-write-path core, per this same plan's `key_links` line ("routes never call prisma.qrCode.* — every mutation goes through lib/qrCodes.ts") and the phase's own `07-PATTERNS.md`. No `prisma.qrCode.create`/`update`/`delete` call exists anywhere in `routes/qrCodes.ts` — verified by inspection and by the passing mass-assignment/IDOR tests. Treating the literal grep-to-zero as an error would mean moving read-only queries out of the route layer, which would itself deviate from the `resolveOwnedLink`/`resolveOwnedQrCode` pattern this plan was explicitly told to copy. Documenting this as an intentional, verified interpretation rather than silently "fixing" a working, convention-matching implementation to satisfy an overly literal grep count.

**Pre-existing WSL2 testcontainer parallel flake:** Running the full `apps/api` suite (`pnpm exec vitest run`, no file filter) shows 5-7 intermittent failures in unrelated files (`links-import.integration.test.ts`, `links.integration.test.ts`, `redirect-tracking.integration.test.ts`, `server.integration.test.ts`, `tlsCheck.integration.test.ts`) — timeouts and a unique-constraint collision, consistent with the known pre-existing parallel-testcontainer flake called out in this plan's dispatch context. `qrCodes.integration.test.ts` itself is never among the failures; run individually (`pnpm exec vitest run test/qrCodes.integration.test.ts`) it is 42/42 green, and combined with `qrDecode.test.ts`/`qr-schema-push.test.ts`/`qrRenderSmoke.test.ts` it is 76/76 green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `routes/qrCodes.ts` is ready for 07-06 (`GET /q/:code` public redirect handler) to reuse the same `QrCode`/`Link` resolution shape for the scan-hook + `lifetimeScans` increment, and for 07-07/08/09 (frontend) to consume the full CRUD/remap/render/history surface via `api.ts` without any further backend changes.
- The dedicated `QR_RENDER_RATE_LIMIT` bucket (120/min) should comfortably absorb the QR Studio's 300ms-debounced live-preview traffic described in the UI-SPEC; no blockers identified.

---
*Phase: 07-qr-codes-static-dynamic-qr-studio*
*Completed: 2026-07-20*
