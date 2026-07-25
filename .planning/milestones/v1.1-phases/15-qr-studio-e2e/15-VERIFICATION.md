---
phase: 15-qr-studio-e2e
verified: 2026-07-25T00:00:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 15: QR Studio E2E Verification Report

**Phase Goal:** Prove static QR generation with customization, dynamic-QR remapping, and dual-format export all work end-to-end, reusing the Phase 14 links fixture.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A static QR generated with customization (color/rounding/logo) decodes back to its target URL — a content round-trip, not just "an image rendered". [QR-E2E-01] | VERIFIED | `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts` drives the real "QR-Code" button (`LinkDetailView.vue`), the real `.color-swatch`/`.rounded-toggle`/`input.hidden-file-input` controls (all selectors confirmed present in `QrStudioPanel.vue`), then fetches real server-rendered PNG bytes via authenticated `page.request.get` and decodes them with `jsQR`+`sharp` (`apps/e2e/src/qr.ts`'s `decodeQrImage`, a verbatim port of `apps/api/test/qrDecode.test.ts`'s proven recipe). Decoded string is asserted against `https://${BASELINE_DOMAIN_HOSTNAME}/${slug}?qr=${qrId}` — matches `resolveQrPayload`'s actual static-QR branch read at `apps/api/src/routes/qrCodes.ts:244-249` byte-for-byte, never `Link.targetUrl`. Post-WR-02-fix: a direct-Prisma read-back (`prisma.qrCode.findUniqueOrThrow`) asserts `color`/`roundedModules === true`/`logoEnabled === true`/`logoData !== null` were genuinely persisted — closing the exact gap 15-REVIEW.md flagged (decode assertion alone is structurally invariant to style fields, since only `resolveRenderStyle` consumes them). |
| 2 | A dynamic `/q/:code` resolves to target A, then to target B after a Studio remap, and an ordered remap-history row is recorded. [QR-E2E-02] | VERIFIED | `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts` seeds targetA/targetB Links + a dynamic QrCode (bound to targetA) via direct-Prisma `createE2eQrCode`, asserts `GET /q/{code}` returns 302 to `targetA.targetUrl` (with a documented `BROWSER_UA` bot-detection fix), then drives the real `.qr-card.selected .target-select` dropdown (confirmed present in `QrCodesView.vue`) to remap to targetB, re-asserts 302 now resolves to `targetB.targetUrl` (same code, new destination), then reads `prisma.qrRemapHistory.findMany` ordered by `createdAt asc` and asserts exactly 1 row `{fromLinkId: targetA.id, toLinkId: targetB.id}`. Cross-checked against the real `remapQrCode` implementation (`apps/api/src/lib/qrCodes.ts:311-339`): it batches `qrCode.update({linkId})` + `qrRemapHistory.create({qrCodeId, fromLinkId, toLinkId})` in one `$transaction` — exactly what the test's DB assertion expects. `routes/qrRedirect.ts` confirmed host-agnostic (no `resolveActiveDomainByHost` call), matching the test's direct `request.get` with no Host header. |
| 3 | PNG and SVG exports each produce a valid, downloadable file. [QR-E2E-03] | VERIFIED | `apps/e2e/tests/authed/qr-export-formats.spec.ts` clicks the real `.export-png`/`.export-svg` buttons (confirmed present in `QrStudioPanel.vue`, wired to `exportFile('png'|'svg')`), captures the real Playwright `download` event for each, reads the downloaded bytes from disk, and decodes both independently via the same `jsQR`+`sharp` recipe (SVG rasterized to PNG first via `sharp().png().toBuffer()`) — both must equal the same expected short-URL string. Additionally asserts `content-type: image/png` / `image/svg+xml` on the underlying authenticated render endpoints and that the SVG body contains `<svg`. This is genuinely stronger than "a non-empty file downloaded" — it proves both formats encode the identical, correct payload. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/e2e/src/qr.ts` | `createE2eQrCode` fixture helper + `decodeQrImage` decode recipe | VERIFIED | Both functions present, substantive (raw Prisma insert mirroring `links.ts`'s `createE2eLink`; verbatim `sharp().ensureAlpha().raw()` + `jsQR` port), and wired (imported by all 3 feature specs + the `qr-fixture.spec.ts` smoke test). |
| `apps/e2e/tests/smoke/qr-fixture.spec.ts` | RED→GREEN contract spec proving the fixture/decode helper's own correctness | VERIFIED | 5 tests covering dynamic-code shape, static `code: null`, color storage, default color, and `decodeQrImage` null-safety on a non-QR image. |
| `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts` | QR-E2E-01 | VERIFIED | Real UI flow, real decode, persisted-style read-back present (see Truth 1). |
| `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts` | QR-E2E-02 | VERIFIED | Real UI remap, ordered DB history assertion present (see Truth 2). |
| `apps/e2e/tests/authed/qr-export-formats.spec.ts` | QR-E2E-03 | VERIFIED | Real download-triggered dual-format decode present (see Truth 3). |
| `apps/e2e/package.json` devDeps | `jsqr@^1.4.0`, `sharp@^0.35.3` | VERIFIED | Both present, correctly scoped under `devDependencies` only (confirmed by direct file read — not leaked into runtime `dependencies`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Spec decode assertions | `apps/api/src/routes/qrCodes.ts`'s `resolveQrPayload` | Hardcoded expected-string construction (`https://{hostname}/{slug}?qr={id}`, `${BASE_URL}/q/{code}`) | WIRED | Read the actual `resolveQrPayload` function body (lines 244-249) — matches both spec files' hardcoded expected strings exactly, including the `QR_SCAN_PARAM` literal `"qr"`. |
| `qr-dynamic-remap.spec.ts`'s history assertion | `apps/api/src/lib/qrCodes.ts`'s `remapQrCode` | Direct-Prisma `qrRemapHistory.findMany` against the same `$transaction`-written rows | WIRED | Read the actual `remapQrCode` implementation — batches exactly the update+insert the test expects to find. |
| Feature specs' selectors | `QrStudioPanel.vue` / `QrCodesView.vue` | `.color-swatch`, `.rounded-toggle`, `input.hidden-file-input`, `.export-png`, `.export-svg`, `.qr-card.selected .target-select` | WIRED | Every selector confirmed present verbatim in the actual Vue source this session. |
| `qr-static-customize-decode.spec.ts`'s WR-02 read-back | `prisma.qrCode` model | Direct-Prisma `findUniqueOrThrow` post-PATCH | WIRED | Confirmed present in the actual spec file (lines 163-168), not just claimed in REVIEW-FIX.md. |

### Behavioral Spot-Checks

Not independently re-run by this verifier — the orchestrator already performed a live Docker-compose re-verification this session (documented in the task brief) after both code-review fixes landed: all 4 QR specs + qr-fixture smoke passed cleanly on a fresh container, with one self-healed retry on `qr-dynamic-remap.spec.ts` matching the documented, pre-existing cross-file DB-truncate race (same class already seen in Phase 12/14, not a QR-specific defect). This verifier independently confirmed the source-level correctness of every assertion instead of re-booting the stack, per the task brief's explicit guidance.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| QR-E2E-01 | 15-02-PLAN.md | Static QR customization + decode round-trip | SATISFIED | Truth 1 |
| QR-E2E-02 | 15-03-PLAN.md | Dynamic remap + ordered history | SATISFIED | Truth 2 |
| QR-E2E-03 | 15-04-PLAN.md | PNG/SVG dual-format export | SATISFIED | Truth 3 |

No orphaned requirements — REQUIREMENTS.md maps only QR-E2E-01/02/03 to Phase 15, all three claimed and satisfied.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 6 phase files. No empty-implementation stubs, no hardcoded-empty-data patterns feeding rendered/asserted output. The two Warning-level findings from 15-REVIEW.md (WR-01: undocumented retry-granularity rationale; WR-02: decode assertion invariant to customization) were both confirmed genuinely fixed by direct source read this session — WR-02's read-back assertion is present and correctly scoped (asserts against the actual PATCH's own `color` value, not a hardcoded guess), and WR-01's rationale comments are present in all three spec files' `describe` blocks. The two Info findings (IN-01 duplicated retry boilerplate, IN-02 no collision-retry loop on `randomQrCode`) remain unaddressed by design (explicitly out of `fix_scope: critical_warning`) — low-severity, non-blocking.

### Human Verification Required

None. No visual/real-time/external-service behaviors in this phase beyond what's already covered by the live compose re-verification the orchestrator performed this session.

### Gaps Summary

No gaps. All 3 roadmap success criteria are verified against actual, current source code — not just SUMMARY/REVIEW narrative. Both post-review fixes (WR-01, WR-02) were independently confirmed present and correctly scoped by direct file reads, not merely trusted from 15-REVIEW-FIX.md's claims. No production code (`apps/api`, `apps/web`) was touched this phase, confirmed by scope of files reviewed. Phase 15 goal is achieved.

---

_Verified: 2026-07-25_
_Verifier: Claude (gsd-verifier)_
