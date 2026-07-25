---
phase: 15-qr-studio-e2e
reviewed: 2026-07-25T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - apps/e2e/src/qr.ts
  - apps/e2e/tests/smoke/qr-fixture.spec.ts
  - apps/e2e/tests/authed/qr-static-customize-decode.spec.ts
  - apps/e2e/tests/authed/qr-dynamic-remap.spec.ts
  - apps/e2e/tests/authed/qr-export-formats.spec.ts
  - apps/e2e/package.json
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-07-25
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the new QR fixture/decode helper (`apps/e2e/src/qr.ts`), its RED→GREEN
contract spec (`qr-fixture.spec.ts`), the three new authenticated feature
specs covering QR-E2E-01/02/03, and the `apps/e2e/package.json` devDependency
addition. All six files are test-authoring-only, confirmed by `git log`/plan
summaries to touch nothing under `apps/api`/`apps/web`. Every selector,
route path, and payload-construction claim these specs make was
cross-checked directly against the real source they exercise
(`QrStudioPanel.vue`, `QrCodesView.vue`, `LinkDetailView.vue`,
`routes/qrCodes.ts`'s `resolveQrPayload`, `prisma/schema.prisma`'s `QrCode`
model, `playwright.config.ts`'s project/testMatch wiring) and every one came
back correct: `.color-swatch`/`.rounded-toggle`/`.hidden-file-input`/
`.export-png`/`.export-svg`/`.qr-card.selected .target-select` all exist
exactly as asserted, `PRODUCT_COLORS` genuinely never includes the default
`#000000` (so the "first non-selected swatch is always a real change"
comment is accurate), the `QR_SCAN_PARAM` value (`"qr"`) and
`resolveQrPayload`'s two branches match every hardcoded expected-URL string
byte-for-byte, and the decode-assertion strings are built exclusively from
fixture-known values (`BASELINE_DOMAIN_HOSTNAME`, slug, `qrCode.id`/`code`) —
**no spec anywhere asserts the decoded payload against `Link.targetUrl`**,
correctly honoring the phase's single most important research finding
(Pitfall 1). The `jsqr`/`sharp` devDependency additions are scoped correctly
to `devDependencies` only. No Critical issues found: no injection, no
hardcoded secrets, no unsafe eval, no logic bug that would let a broken
redirect/render path pass as green.

Two recurring concerns carry over unaddressed from Phase 14's review
(14-REVIEW.md WR-01/IN-01) and one new coverage gap is specific to this
phase's own subject matter (QR customization). See below.

## Warnings

### WR-01: Whole-test retries remain the only cross-file DB-truncate-race protection — the exact gap 14-REVIEW.md WR-01 already flagged, still unaddressed

**File:** `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts:38`
**File:** `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts:44`
**File:** `apps/e2e/tests/authed/qr-export-formats.spec.ts:50`
**Issue:** All three new specs seed their fixtures (`createE2eLink`,
`createE2eQrCode`) via a plain top-level `createE2ePrisma()` call — outside
`withResetDbLock`'s advisory-locked critical section — and then rely
exclusively on `test.describe.configure({ retries: 2 })` plus a
`testInfo.retry` `console.warn` to survive `db-isolation.spec.ts`'s
concurrent `TRUNCATE "QrRemapHistory", "QrCode", ..., "Link", ...` race
during full-suite runs. This is the identical pattern 14-REVIEW.md's WR-01
already flagged for `links-crud.spec.ts`/`csv-import-*.spec.ts` as strictly
weaker than the established `fetchWithFixtureRaceRetry` helper
(`apps/e2e/src/links.ts`): a whole-test retry cannot distinguish "the
documented truncate race fired" from "a genuine regression that happens to
reproduce intermittently" — the entire journey (every click, PATCH, decode,
and Prisma read) reruns on ANY failure, silently masking a real bug that
only fails 1-of-3 attempts. The `console.warn` added here is an improvement
over the earlier links/CSV specs (which had none), but it still fires at the
whole-test-retry granularity, not the single-request granularity
`fetchWithFixtureRaceRetry` provides with its `onDiscardedAttempt` hook.
**Fix:** Either adopt `fetchWithFixtureRaceRetry`-style helpers for the
specific HTTP reads/redirect checks that actually race (the `/q/:code`
GETs in `qr-dynamic-remap.spec.ts`, the `render.png`/`render.svg` fetches
elsewhere), keeping the outer `retries: 2` only as a last-resort safety net,
or explicitly document in each spec's header comment why the coarser
whole-test retry is an accepted tradeoff for this phase (as was never done
for Phase 14's specs either) so a future reviewer doesn't need to
re-discover the same gap a third time.

### WR-02: QR-E2E-01's decode assertion is invariant to the customization it claims to prove — a silently-dropped color/rounded/logo PATCH would still pass

**File:** `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts:95-134,141-159`
**Issue:** QR-E2E-01 is titled "Static QR generation **incl. customization**
(color/rounding/logo) with decode-roundtrip." The test drives the color
swatch, the rounded toggle, and a logo upload, and asserts only that each
resulting `PATCH /api/qr-codes/:id` response is `ok()` (2xx) — it never
reads back the persisted `color`/`roundedModules`/`logoEnabled`/`logoData`
fields (via a direct-Prisma read, mirroring the pattern
`qr-fixture.spec.ts` already establishes) nor inspects the rendered PNG for
any visual evidence the styling was actually applied (e.g. non-black pixels
near the modules, or a structural check that the logo region differs from
a no-logo render). `resolveQrPayload`'s encoded string
(`https://{hostname}/{slug}?qr={id}`) is **completely independent** of
`color`/`roundedModules`/`logoEnabled`/`logoData` — only `resolveRenderStyle`
consumes those fields, and nothing in this test reads a value derived from
`resolveRenderStyle`. Concretely: if a future regression in `updateQrCode`
silently ignored `color`/`roundedModules`/`logoData` on write (while still
returning 200), or if `resolveRenderStyle` stopped reading the stored style
fields entirely, this test would still pass, because the decoded payload
string never changes. The only thing genuinely proven here is "the QR
short-URL payload is correct and three PATCH calls didn't error" — not that
customization took effect, despite that being the requirement's stated
scope.
**Fix:** Add at least one direct-Prisma read-back assertion after the three
customization steps (`prisma.qrCode.findUniqueOrThrow({where:{id:qrId}})` →
assert `color`/`roundedModules`/`logoEnabled === true`/`logoData !== null`),
mirroring the pattern `qr-fixture.spec.ts` already uses for the same model.
This closes the gap cheaply without needing pixel-level image analysis.

## Info

### IN-01: `test.beforeEach` skip + retry-warning boilerplate duplicated verbatim across all three new spec files — the exact debt 14-REVIEW.md IN-01 already flagged

**File:** `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts:40-57`
**File:** `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts:46-62`
**File:** `apps/e2e/tests/authed/qr-export-formats.spec.ts:52-68`
**Issue:** The `test.describe.configure({ retries: 2 })` line, the
`testInfo.project.name !== "chromium-admin"` skip block, and the
`testInfo.retry > 0` `console.warn` are copy-pasted near-verbatim (only the
spec filename in the log string and the exact table list in the comment
differ) across all three files, rather than factored into a shared
`apps/e2e/src` helper — the same maintainability concern 14-REVIEW.md's
IN-01 raised for the prior phase's specs, still not addressed as a shared
utility two phases later.
**Fix:** Extract a small shared helper (e.g. `adminOnlyRetryingTest(name,
fn, { label })` in `apps/e2e/src/testHelpers.ts`) that both this phase's and
future admin-only specs can reuse, so the retry count / skip reason / log
format only needs to change in one place.

### IN-02: `randomQrCode()`'s collision handling relies entirely on astronomically-low probability, with no retry loop or clear-error wrapping

**File:** `apps/e2e/src/qr.ts:34-44`
**Issue:** `randomQrCode()` generates 16 lowercase-hex characters via
`randomBytes(8).toString("hex")` with no uniqueness check, and
`createE2eQrCode` performs a single, unwrapped `prisma.qrCode.create` against
a column with a real DB-level `@unique` constraint (`QrCode.code`). Unlike
the application's own `resolveDynamicCode` (which has a genuine retry loop),
a collision here surfaces as a raw Prisma `P2002` unique-constraint
exception rather than a clear, test-specific error message. This is an
explicitly documented, accepted low-risk tradeoff (15-RESEARCH.md Assumption
A2 — 2^64 possible values), so no action is required; noted here only for
completeness per the review's char to check every helper this phase
introduces.
**Fix:** No action needed given the documented risk acceptance; if this
codebase's E2E run volume ever grows by many orders of magnitude, wrap the
`create` call with a small retry-on-`P2002` loop mirroring
`resolveDynamicCode`'s shape.

---

_Reviewed: 2026-07-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
