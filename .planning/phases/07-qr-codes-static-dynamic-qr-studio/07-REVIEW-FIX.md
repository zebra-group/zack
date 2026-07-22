---
phase: 07-qr-codes-static-dynamic-qr-studio
fixed_at: 2026-07-22T19:45:00Z
review_path: .planning/phases/07-qr-codes-static-dynamic-qr-studio/07-REVIEW.md
iteration: 1
findings_in_scope: 20
fixed: 14
already_resolved: 4
skipped: 2
status: partial
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-07-22T19:45:00Z
**Source review:** `.planning/phases/07-qr-codes-static-dynamic-qr-studio/07-REVIEW.md`
**Iteration:** 1
**Fix scope:** all (Critical + Warning + Info)

**Summary:**

- Findings in scope: 20
- Fixed this run: 14
- Already resolved before this run: 4
- Skipped: 2

**Verification (whole repo, after every fix):**

- `apps/api`: 33 test files, 390 tests passed
- `apps/web`: 14 test files, 136 tests passed
- `tsc --noEmit` clean for `apps/api`, `apps/web` and `packages/shared`

Every fix followed the mandatory TDD cycle: a failing test first (RED output
captured for each), then the implementation, then a green run before the
commit. No commit was made with a failing test.

## Already Resolved (verified against current code, no new work)

These four were confirmed fixed in `master` before this run. Each was
re-verified by reading the cited source, not by trusting the commit message.

### CR-01: Static QR encoded the destination URL

**Resolved by:** `fc82dc0`
**Verified:** `apps/api/src/routes/qrCodes.ts` — `resolveQrPayload` now returns
`https://{link.domain.hostname}/{link.slug}?qr={qrCode.id}` for the static
variant, and `resolveOwnedQrCode` eagerly includes `link.domain` so no extra
query is needed. The `?qr=` marker is attributed back to the QrCode row by
`routes/redirect.ts` (`5a76988`), so the review's corollary claim that static
scan counts are structurally impossible is now obsolete.

### CR-02: Corrupt/oversized logo upload produced an unhandled 500

**Resolved by:** `1ae2635`
**Verified:** `apps/api/src/lib/qr.ts` — both `normalizeLogo` branches wrap
their `sharp` calls and re-type failures as `InvalidLogoError`, with an
explicit `LOGO_MAX_PIXELS` rasterization ceiling. The `PATCH` handler in
`routes/qrCodes.ts` also carries the `InvalidLogoError | InvalidColorError ->
400` catch the review asked for as defence-in-depth.

### WR-01: PNG/SVG logo fit-mode mismatch

**Resolved by:** `2d88675`
**Verified:** `apps/api/src/lib/qr.ts` — the SVG path emits
`preserveAspectRatio="xMidYMid meet"` and both paths share the single
`resizeLogoToTile` helper (`fit: "contain"`). A non-square-logo parity test
exists in `test/qrDecode.test.ts`.

### WR-02: `render.svg` embedded the full-resolution logo

**Resolved by:** `415013a`
**Verified:** `apps/api/src/lib/qr.ts` — `renderQrSvg` resizes through
`resizeLogoToTile` before base64-embedding.

## Fixed Issues

### WR-03: Client logo size cap was looser than the server's

**Files modified:** `apps/web/src/components/QrStudioPanel.vue`, `apps/web/src/components/QrStudioPanel.test.ts`
**Commit:** `32138d9`
**Applied fix:** Lowered `MAX_LOGO_BYTES` from `2 * 1024 * 1024` to
`1_400_000` (below the server's ~1,425,000-raw-byte effective ceiling derived
from `LOGO_DATA_MAX_LENGTH = 1_900_000` base64 chars) and corrected the copy to
"Datei zu groß (max. 1,4 MB)." A regression test drives a 1.5 MiB file — squarely
inside the old client/server gap — and asserts it is rejected inline with no
request issued.

I deliberately did **not** take the review's "better still, export the limit
from `@kurzly/shared`" suggestion: the constant is a client-side UX guard
derived from a server constant with a base64 inflation factor, and hoisting it
into the shared package would have required a shared-package rebuild in the
dependency chain for no behavioural gain. The comment now names
`LOGO_DATA_MAX_LENGTH` and its file explicitly instead.

### WR-04: `readAsDataUrl` rejection was unhandled

**Files modified:** `apps/web/src/components/QrStudioPanel.vue`, `apps/web/src/components/QrStudioPanel.test.ts`
**Commit:** `e2bc660` (test typing corrected in `3d8e2db`)
**Applied fix:** Moved the `await readAsDataUrl(file)` into its own try/catch
that sets `logoError` to the format message and returns. Test stubs a
`FileReader` that fires `onerror` and asserts the inline error appears — which
can only happen if the rejection was caught.

### WR-05: `QrStudioPanel` mutated its `qr` prop

**Files modified:** `apps/web/src/components/QrStudioPanel.vue`, `apps/web/src/components/QrStudioPanel.test.ts`
**Commit:** `3d8e2db`
**Status:** fixed: requires human verification
**Applied fix:** Introduced a `reactive` `local` mirror of the three styleable
fields (`color`, `roundedModules`, `logoEnabled`), synced from a
`watch(() => props.qr, ...)`. All five former `props.qr.*` assignment sites and
all five template bindings now read/write `local`; the parent stays the sole
owner of the DTO via the existing `styled` emit. Three tests cover it: the prop
object is never mutated, the optimistic value still shows before the server
responds, and a new parent-supplied DTO re-syncs local state.

**Why human verification:** this changes which object is the source of truth
for the Studio's optimistic UI. Tests cover the intended semantics, but the
interaction with `QrCodesView`'s `handleStyled` array-splice is worth one
manual pass in the running app.

### WR-06: Rapid Studio edits raced

**Files modified:** `apps/web/src/components/QrStudioPanel.vue`, `apps/web/src/components/QrStudioPanel.test.ts`
**Commit:** `b6cd850`
**Status:** fixed: requires human verification
**Applied fix:** Added a monotonic `mutationSeq` token and routed all five
mutations through a single `persistStyle(patch)` helper. A response whose
sequence number is no longer the newest is discarded: it neither emits
`styled` nor reverts local state (reverting a superseded failure would undo a
later edit). Two tests: a stale success must not be emitted, and a stale
failure must not drag the swatch selection backwards.

**Why human verification:** concurrency ordering semantics. The tests pin the
two orderings that matter, but real-world interleavings are worth a manual
smoke test.

### WR-08: `removeLogo` left `logoEnabled: true`

**Files modified:** `apps/web/src/components/QrStudioPanel.vue`, `apps/web/src/components/QrStudioPanel.test.ts`
**Commit:** `edd9279`
**Applied fix:** `removeLogo` now sends `{ logoData: null, logoEnabled: false }`
and clears the local `logoEnabled`, so the server stops forcing EC level H for a
logo it no longer has and the decorative placeholder tile cannot reappear over a
logo-free export. Test asserts both the payload and that `.logo-overlay` is gone.

### IN-01: `validateQrCodeInput` exported with no external caller

**Files modified:** `apps/api/src/lib/qrCodes.ts`, `packages/shared/src/index.ts`
**Commit:** `e7bc695`
**Applied fix:** Dropped `export` from `validateQrCodeInput` and from the two
types used only by it (`ValidatedQrCode`, `ValidationResult`);
`ValidateQrCodeInputParams` stays exported because it is `createQrCode`'s
public input type. Rewrote the module header to name `resolveLinkDomainAccess`
as the real shared authorization gate and to list the four operations that use
it. Corrected the stale cross-reference in the shared `CreateQrCodeInput` doc.

### IN-02: `getQrCode` had no production caller

**Files modified:** `apps/web/src/api.ts`, `apps/web/src/api.qr.test.ts`
**Commit:** `d40d2d4`
**Applied fix:** Removed the dead function and its dedicated test; repointed
the ApiError-propagation test (which happened to use it as a vehicle) at
`listQrCodes`. Chose removal over the review's alternative of wiring it into
`QrStudioPanel`'s selection refresh — that alternative adds a network round-trip
per card selection, which is a performance/UX decision rather than a defect fix.

### IN-03: `qrDimensionPx` re-encoded the whole QR just to measure it

**Files modified:** `apps/api/src/lib/qr.ts`, `apps/api/test/qrDecode.test.ts`
**Commit:** `229a324`
**Applied fix:** Deleted `qrDimensionPx`. Added an internal
`buildModuleSvgWithDim` that returns `{ svg, dim }` from the matrix it already
walks; the exported `buildModuleSvg` is now a one-line wrapper returning `.svg`,
so its signature — relied on by the security and geometry tests — is unchanged.
Both render paths take the dimension from that single call. Tests spy on
`QRCode.create` and assert exactly one encode per logo render (RED showed 2 for
PNG and 4 for SVG).

### IN-04: Render debounce timer never cleared

**Files modified:** `apps/web/src/components/QrStudioPanel.vue`, `apps/web/src/components/QrStudioPanel.test.ts`
**Commit:** `6f1cb0c`
**Applied fix:** Extracted `cancelScheduledRender()`, called from
`scheduleRender`, from the `props.qr.id` watch, and from a new
`onUnmounted` hook. Two tests: switching QR mid-debounce must leave the new
QR's snap-to URL untouched (no cache-buster), and no `new Image()` may be
constructed after unmount.

### IN-05: `DATA_URI_PREFIX` missed multi-parameter data URIs

**Files modified:** `apps/api/src/routes/qrCodes.ts`, `apps/api/test/qrCodes.integration.test.ts`
**Commit:** `4bb401f`
**Applied fix:** Changed `/^data:[^;]+;base64,/` to `/^data:[^,]*;base64,/`.
Integration test PATCHes a `data:image/png;charset=utf-8;base64,...` payload;
RED returned 400, GREEN returns 200.

### IN-06: `schema.prisma`'s `logoData` comment contradicted the write path

**Files modified:** `apps/api/prisma/schema.prisma`
**Commit:** `d0900c7`
**Applied fix:** Reworded to state that the bytes are always PNG after
`normalizeLogo`, and that the field is independent of `logoEnabled` — which
only gates compositing at render time — matching `updateQrCode`'s independent
optional writes and the `QrCodeDTO` doc. Schema re-parse verified via
`test/qr-schema-push.test.ts` (5 tests green).

### IN-07: `:code` param interpolated unvalidated into the unlock cookie `Path`

**Files modified:** `apps/api/src/routes/qrRedirect.ts`, `apps/api/test/qrRedirect.integration.test.ts`
**Commit:** `daddb66`
**Applied fix:** Added `QR_CODE_PARAM = /^[0-9A-Za-z]{1,32}$/` and a guard at
the top of both `/q/:code` handlers returning the same generic 404 on mismatch.
The tests assert the guard runs **before** any DB access by spying on
`prisma.qrCode.findUnique` — RED showed 1 and 2 calls respectively — which is
what makes the cookie-`Path` interpolation structurally safe rather than
incidentally safe.

### IN-08: Synthetic remap-history entry ids could collide

**Files modified:** `apps/web/src/views/QrCodesView.vue`, `apps/web/src/views/QrCodesView.test.ts`
**Commit:** `8e041ff`
**Applied fix:** Replaced `local-${Date.now()}` with
`local-${crypto.randomUUID()}`. To make the collision observable (Vue's
duplicate-key warning does not fire for this render shape), added
`:data-entry-id="entry.id"` to `.verlauf-row`; the test freezes `Date.now` and
asserts two remaps yield two distinct ids — RED collapsed them to 1.

### IN-09: `assertValidColor` runs twice per render

**Files modified:** `apps/api/src/lib/qr.ts`
**Commit:** `1d65c04`
**Applied fix:** Documentation only, exactly as the review specified: kept the
`buildModuleSvg` check as authoritative (it is the one at the interpolation
site that closes the vector for direct callers) and added a note at
`resolveModuleStyle`'s call explaining it exists only to fail earlier with a
better stack, not because `buildModuleSvg` cannot be trusted.

## Skipped Issues

### WR-07: No delete path for QR codes

**File:** `apps/api/src/routes/qrCodes.ts` (whole file), `apps/web/src/api.ts`
**Reason:** skipped — this is a missing feature, not a defect. The fix as
specified spans a new `DELETE /api/qr-codes/:id` endpoint, a `deleteQrCode`
service function, a client function, and a confirmation dialog in
`QrCodesView` — a full vertical slice with its own UX copy (the locked
Copywriting Contract in `07-UI-SPEC.md` has no delete strings) and its own
cascade semantics for `QrRemapHistory`. That belongs in a planned phase, not
in a review-fix pass.

**Original issue:** QR codes can only be removed by deleting their Link
(cascade); each row can hold ~1.36 MiB of `logoData` BYTEA, and both UI entry
points create rows on a single unconfirmed click.

### WR-09: The "one static QR per link" invariant is enforced nowhere

**File:** `apps/web/src/views/LinkDetailView.vue:200-234`, `apps/api/src/routes/qrCodes.ts`, `apps/api/prisma/schema.prisma`
**Reason:** skipped — requires a product decision the review explicitly leaves
open ("Either ... or ..."), and both branches carry consequences beyond a
review-fix pass:

- **Partial unique index + `P2002` mapping** needs a migration that will *fail
  to apply* against any database that already contains duplicate static QRs
  (which the current code permits), so it needs a backfill/dedup step and a
  decision on which duplicate survives. It also needs a new typed
  `QrCodeErrorCode` and an HTTP status choice (409 vs. the existing
  identical-404 posture).
- **Idempotent create** (return the existing row for a duplicate static
  create) changes `POST /api/qr-codes` semantics: it would return 201 for a
  row it did not create, and would have to silently ignore a differing `name`
  or `color` in the request body. Whether that is the desired contract is a
  product call.

**Original issue:** `LinkDetailView.handleQrCode` enforces the invariant by
fetching the caller's entire QR list and filtering client-side. There is no
unique constraint on `(linkId, variant='static')`, no duplicate check in
`createQrCode`, and no `linkId` filter or pagination on `GET /api/qr-codes` —
so two quick clicks or two tabs create two static QRs, and the check breaks
silently the moment the list endpoint is paginated.

**Recommended follow-up:** the partial unique index is the more robust option;
plan it together with a dedup migration and an explicit duplicate-create
contract.

---

_Fixed: 2026-07-22T19:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
