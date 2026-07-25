---
phase: 15
slug: qr-studio-e2e
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 15 — Validation Strategy

> Derived from 15-RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` ^1.61.1 (existing) |
| **Config file** | `apps/e2e/playwright.config.ts` (existing `chromium-admin`/`chromium-member` authenticated projects, `tests/authed/`) |
| **Quick run command** | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/<spec>.spec.ts --project=chromium-admin` (stack already up) |
| **Full suite command** | `./scripts/e2e-compose.sh` |

---

## Sampling Rate

- **Per task commit:** targeted spec file against a running local stack, `--project=chromium-admin`.
- **Per wave merge:** full `tests/authed/` at `--workers=1` then again at higher parallelism.
- **Phase gate:** full E2E suite green before phase completion.

---

## Per-Task Verification Map

| Plan | Wave | Requirement(s) | Secure Behavior | Test Type | Status |
|------|------|-----------------|-----------------|-----------|--------|
| 15-01 (Wave 0) | 0 | (infra) | `apps/e2e/src/qr.ts` (createE2eQrCode, decodeQrImage via jsQR+sharp); `jsqr`/`sharp` added as apps/e2e devDependencies | e2e/infra | ⬜ pending |
| 15-02 | 1 | QR-E2E-01 | Static QR created + customized (color/rounding/logo) via real Studio UI, PNG bytes decode via jsQR to the exact expected short-URL string | e2e | ⬜ pending |
| 15-03 | 1 | QR-E2E-02 | Dynamic `/q/:code` resolves to target A, then target B after real-UI remap; exactly one ordered QrRemapHistory row recorded (DB-asserted) | e2e | ⬜ pending |
| 15-04 | 1 | QR-E2E-03 | PNG and SVG exports both return correct content-type AND both independently decode via jsQR to the same expected short-URL string | e2e | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/e2e/src/qr.ts` — does not exist yet (createE2eQrCode, decodeQrImage)
- [ ] `apps/e2e/package.json` — add `jsqr` + `sharp` devDependencies (both already resolved in the shared pnpm-lock.yaml via `@kurzly/api`)
- [ ] `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts` — does not exist yet
- [ ] `apps/e2e/tests/authed/qr-export-formats.spec.ts` — does not exist yet

---

## Manual-Only Verifications

*None — all behaviors have automated verification per the map above.*

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity maintained
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-25 (autonomous mode, per 15-RESEARCH.md Validation Architecture)
