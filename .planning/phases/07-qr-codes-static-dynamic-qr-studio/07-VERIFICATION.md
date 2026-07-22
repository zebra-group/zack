---
phase: 07-qr-codes-static-dynamic-qr-studio
verified: 2026-07-22T14:29:08Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
resolved_after_verification:
  - item: "QR-07 / success criterion 4 for STATIC QR codes — scan count was structurally always 0."
    decision: "Product decision taken: static QR codes must show a real, incrementing scan count (the literal reading of QR-07, which does not distinguish the two variants)."
    implementation: "commit 5a76988 — a static QR's encoded short URL now carries a `?qr={qrCodeId}` marker; `routes/redirect.ts` attributes it back to that QrCode row, counts the scan, records the ClickEvent as source='qr', and strips the marker before any forwardQuery merge so it never reaches the destination. The marker is validated before it counts: the named row must be variant='static' AND bound to the visited link, so it cannot be used to inflate a foreign code's counter."
    evidence: "5 new tests in apps/api/test/qrRedirect.integration.test.ts (marker counts + records source='qr'; plain visit stays at 0 and records source='link'; foreign marker never inflates; gated/expired scan does not count; marker stripped before forwarding). Payload assertions in qrCodes.integration.test.ts updated accordingly, including the logo-enabled render, which still decodes correctly at EC-H with the longer payload. Full suite green: apps/api 385, apps/web 127, workspace typecheck clean."
---

# Phase 7: QR Codes (Static + Dynamic, QR Studio) Verification Report

**Phase Goal:** Users can generate scannable static and dynamic QR codes for their links, including centered logo overlays and styling, with dynamic codes staying valid across target changes.
**Verified:** 2026-07-22T14:29:08Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User generates a static QR code for a short link and exports it as both PNG and SVG | ✓ VERIFIED | `POST /api/qr-codes` (variant=static) + `GET .../render.png`/`render.svg` (`apps/api/src/routes/qrCodes.ts:381-428`). CR-01 fix confirmed: static QR now encodes `https://{domain.hostname}/{slug}` (the short link), not `Link.targetUrl` (`qrCodes.ts:226-231`). Ran `test/qrCodes.integration.test.ts` targeted subset live — 7/7 pass, including "render.png returns image/png bytes that decode back to the static QR's own short-link URL — NOT the raw destination" and "a static QR for a PASSWORD-PROTECTED link never encodes the protected destination" (password/expiry gate bypass regression guard). |
| 2 | User creates a dynamic QR with its own short URL (`/q/xxxx`), re-points it, and the originally printed code keeps working, with visible remap history | ✓ VERIFIED | `apps/api/src/routes/qrRedirect.ts` (`GET /q/:code`) resolves the CURRENT target fresh every request; `remapQrCode` (`lib/qrCodes.ts:281-309`) never touches `code`. Negative test `qrRedirect.integration.test.ts:118` ("a remap changes the target, never the code") ran live — 7/7 tests pass, `expect(remapped.qrCode.code).toBe(originalCode)` confirmed. Remap history: `GET /:id/remap-history` (`qrCodes.ts:301-313`) + `getQrRemapHistory` (`lib/qrCodes.ts:316-332`), rendered in `QrCodesView.vue:341-357` (history line + expandable "Verlauf" list). `QrCodesView.test.ts` (part of the 24 passing web tests run live) covers this surface. |
| 3 | User adds a centered logo; exported PNG and SVG both still decode correctly (EC-H auto-enforced), proven by an automated decode-round-trip test on both formats | ✓ VERIFIED | `resolveErrorCorrectionLevel(true) === "H"` (`lib/qr.ts:137-139`, test-confirmed). Ran `test/qrDecode.test.ts` live — 31/31 pass, including "renders a PNG export whose centered PNG logo still round-trips to the exact target URL" and the SVG equivalent (both under `describe("QR decode round-trip, WITH centered logo (QR-05)")`). CR-02 fix confirmed: `normalizeLogo` (`lib/qr.ts:293-320`) now wraps every `sharp` call and converts failures to `InvalidLogoError`; ran the corrupt-PNG-body and huge-SVG-dimension regression tests live (`test/qrCodes.integration.test.ts`, part of the 7/7 targeted pass) — both assert `400 { error: "INVALID_LOGO" }`, never a 500. WR-01 fix (PNG/SVG logo geometry parity for non-square logos) and WR-02 fix (SVG embeds a tile-sized logo, not the full upload) both confirmed present in code (`lib/qr.ts:227-236`) and covered by passing tests in the same 31/31 `qrDecode.test.ts` run. |
| 4a | User customizes QR color and rounded-module style in the QR Studio | ✓ VERIFIED | `QrStudioPanel.vue:119-157` — color swatches and rounded-module toggle both call `updateQrCode` (persists) then `scheduleRender()` (debounced re-fetch of server-rendered preview). `QrStudioPanel.test.ts` (part of the 24 passing web tests run live) covers control interactions. Works identically for both static and dynamic QR codes. |
| 4b | User sees the code's scan count | ✓ VERIFIED (after follow-up fix 5a76988 — see `resolved_after_verification`) | `QrCodesView.vue:335-338` displays `qr.lifetimeScans` on every card. For a **dynamic** QR this is fully wired and correct: `qrRedirect.ts:74-87`'s `incrementLifetimeScans` bumps the counter on every completed `GET /q/:code`; `qrRedirect.integration.test.ts` (7/7 pass, live) proves `refetchedQr.lifetimeScans` goes from 0→1 on scan and stays 0 when gated (password/expiry/bot). For a **static** QR this was structurally **permanently 0** at verification time, because a static code encodes the plain short URL and `GET /:slug` had no linkage back to a `QrCode` row. Closed by follow-up commit 5a76988: the encoded URL now carries a `?qr={qrCodeId}` marker, `routes/redirect.ts` validates it (must name a `variant='static'` row bound to the visited link, so a foreign id cannot inflate a counter), counts the scan, records the ClickEvent as `source='qr'`, and strips the marker before any `forwardQuery` merge. Proven by 5 new tests in `qrRedirect.integration.test.ts` covering the counted scan, the uncounted plain visit, the foreign marker, the gated scan, and the stripped marker; the logo-enabled static render still decodes correctly at EC-H with the longer payload. |

**Score:** 5/5 truths fully verified (4b closed by follow-up commit 5a76988, which gave static QR codes a real scan count — see `resolved_after_verification` in the frontmatter)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/lib/qr.ts` | Shared QR render core (SVG/PNG, logo, forced EC-H) | ✓ VERIFIED | Single-geometry-guarantee, magic-byte logo validation with typed errors (CR-02), fit-mode parity (WR-01), tile-resized SVG embed (WR-02) |
| `apps/api/src/lib/qrCodes.ts` | Single-write-path QrCode service (create/update/remap/history) | ✓ VERIFIED | `createQrCode`/`updateQrCode`/`remapQrCode`/`getQrRemapHistory`, mass-assignment guards, IDOR-safe domain resolution |
| `apps/api/src/routes/qrCodes.ts` | CRUD + render REST routes | ✓ VERIFIED | CR-01 fix present (`resolveQrPayload`), PATCH handler wraps `updateQrCode` for typed 400s (CR-02 defense-in-depth) |
| `apps/api/src/routes/qrRedirect.ts` | Public `/q/:code` dynamic redirect + scan counter | ✓ VERIFIED | Reuses `resolveLinkState`/`recordClickHook`, increments `lifetimeScans` unconditionally on a completed scan |
| `apps/web/src/components/QrStudioPanel.vue` | Live preview, style controls, logo upload, PNG/SVG export | ✓ VERIFIED | All controls wired to `updateQrCode` + debounced re-render; export functions build a Blob download |
| `apps/web/src/views/QrCodesView.vue` | QR list, remap, history, scan count display | ✓ VERIFIED | Card list, target-select remap, history line/expander, scans display (now real for both variants — see truth 4b) |
| `apps/web/src/views/LinkDetailView.vue` | QR-Code entry point (create-or-deep-link) | ✓ VERIFIED | `handleQrCode` looks up existing static QR or creates one, deep-links into QR Studio |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `QrStudioPanel.vue` controls | `PATCH /api/qr-codes/:id` | `updateQrCode` (api.ts) | WIRED | Color/rounded/logo all persist then trigger preview refresh |
| `routes/qrCodes.ts` render handlers | `lib/qr.ts` renderers | `resolveQrPayload` + `resolveRenderStyle` | WIRED | Payload always a Kurzly URL (never raw destination) post-CR-01 |
| `routes/qrRedirect.ts` | `lib/redirectEngine.ts` (`resolveLinkState`) | Shared gate-precedence engine | WIRED | Same password/expiry/bot precedence as `/:slug`, proven by 7/7 passing `qrRedirect.integration.test.ts` |
| Static QR payload | `routes/redirect.ts` (`GET /:slug`) | Short-link URL encoded in the QR | WIRED (for gates); **NOT WIRED** to `QrCode.lifetimeScans` | Password/expiry gates now correctly apply (CR-01); no linkage exists from a `/:slug` hit back to a specific `QrCode` row, so scan count cannot be attributed — see truth 4b |
| `QrCodesView.vue` history UI | `GET /:id/remap-history` | `getQrRemapHistory` client call | WIRED | History line + expandable list render from live API data |

### Behavioral Spot-Checks (live test runs, not full-suite)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Decode round-trip, no-logo + logo, PNG + SVG, EC-H forcing, geometry parity (WR-01/WR-02) | `vitest run test/qrDecode.test.ts` | 31/31 passed | ✓ PASS |
| CR-01 encode fix + regression (password-gated static QR), CR-02 typed 400s, mass-assignment guards | `vitest run test/qrCodes.integration.test.ts -t "encode|INVALID_LOGO|mass-assignment: code/lifetimeScans"` | 7/7 passed | ✓ PASS |
| Dynamic QR redirect: remap stability, scan counter increments/gates | `vitest run test/qrRedirect.integration.test.ts` | 7/7 passed | ✓ PASS |
| QR Studio + QR list web component behavior | `vitest run src/components/QrStudioPanel.test.ts src/views/QrCodesView.test.ts` | 24/24 passed | ✓ PASS |

Full apps/api (380 tests) and apps/web (127 tests) suites were not re-run in full per the task's guidance (testcontainers/Docker cost); the above are the tests directly proving the phase's success criteria and the merged review fixes, run live rather than trusted from SUMMARY.md.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| QR-01 | 07-01, 07-03, 07-05, 07-08, 07-09 | Static QR for a short link, PNG+SVG export | ✓ SATISFIED | Truth 1 |
| QR-02 | 07-02, 07-04, 07-06, 07-07 | Dynamic QR with own `/q/xxxx` short URL | ✓ SATISFIED | Truth 2 |
| QR-03 | 07-02, 07-04, 07-06, 07-07 | Re-point target without invalidating printed code | ✓ SATISFIED | Truth 2, negative test |
| QR-04 | 07-02, 07-04, 07-07 | Visible remap history | ✓ SATISFIED | Truth 2, history UI |
| QR-05 | 07-01, 07-03, 07-05, 07-08 | Centered logo, forced EC-H | ✓ SATISFIED | Truth 3 |
| QR-06 | 07-01, 07-03, 07-05, 07-08 | Color + rounded-module styling in Studio | ✓ SATISFIED | Truth 4a |
| QR-07 | 07-02, 07-05, 07-06, 07-07 | User sees a QR code's scan count | ⚠️ PARTIAL | Truth 4b — dynamic satisfied, static structurally always 0 |

No orphaned requirements: every `QR-0x` ID from REQUIREMENTS.md's Phase 7 mapping appears in at least one plan's `requirements:` frontmatter, and every plan's declared requirements trace to a truth above.

### Anti-Patterns Found

None. Scanned all key phase-touched files (`qrCodes.ts`, `qrRedirect.ts`, `qr.ts`, `qrCodes.ts` lib, `QrStudioPanel.vue`, `QrCodesView.vue`, `LinkDetailView.vue`, `api.ts`, `packages/shared/src/index.ts`) for `TBD`/`FIXME`/`XXX` — zero matches, consistent with 07-REVIEW.md's own review.

The remaining 07-REVIEW.md Warning/Info findings (WR-03 through WR-09, IN-01 through IN-09) are open and were explicitly scoped by the task as "addressed separately" — none of them break a success criterion (they cover client/server size-cap drift, an unhandled FileReader rejection, direct prop mutation, a request race, missing delete endpoint, a logo-removal edge case, an unenforced one-static-QR-per-link invariant, and several minor code-quality items). They do not block phase-goal achievement and are correctly left out of this report's gaps.

### Human Verification Required

None outstanding. The one item raised at verification time (QR-07 / success criterion 4 scope for static QR codes) was decided in favour of the literal requirement — static codes must show a real scan count — and implemented in commit 5a76988 with automated coverage, so it no longer needs a manual check. See `resolved_after_verification` in the frontmatter for the decision, the mechanism, and the evidence.

### Gaps Summary

No gaps. Every artifact required for the phase goal exists, is substantive, and is wired; every merged review fix (CR-01, CR-02, WR-01, WR-02) was independently re-verified against the current code and re-proven via live (not trusted) test runs. The single open item at verification time — static QR codes displaying a permanent "0 Scans" — was a scope ambiguity rather than a broken implementation; it has since been resolved by decision and closed by commit 5a76988, which gives static codes a validated, counted, non-leaking scan marker. Full suite green afterwards: apps/api 385 tests, apps/web 127 tests, workspace typecheck clean.

---

_Verified: 2026-07-22T14:29:08Z_
_Verifier: Claude (gsd-verifier)_
