---
phase: 07-qr-codes-static-dynamic-qr-studio
reviewed: 2026-07-21T08:56:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/api/package.json
  - apps/api/prisma/migrations/20260720125110_add_qr_codes/migration.sql
  - apps/api/prisma/schema.prisma
  - apps/api/src/app.ts
  - apps/api/src/lib/qrCodes.ts
  - apps/api/src/lib/qr.ts
  - apps/api/src/lib/unlockCookie.ts
  - apps/api/src/plugins/rateLimit.ts
  - apps/api/src/routes/qrCodes.ts
  - apps/api/src/routes/qrRedirect.ts
  - apps/api/src/routes/redirect.ts
  - apps/api/test/qrCodes.integration.test.ts
  - apps/api/test/qrDecode.test.ts
  - apps/api/test/qrRedirect.integration.test.ts
  - apps/api/test/qrRenderSmoke.test.ts
  - apps/api/test/qr-schema-push.test.ts
  - apps/web/src/api.qr.test.ts
  - apps/web/src/api.ts
  - apps/web/src/components/QrStudioPanel.test.ts
  - apps/web/src/components/QrStudioPanel.vue
  - apps/web/src/router/index.ts
  - apps/web/src/views/LinkDetailView.test.ts
  - apps/web/src/views/LinkDetailView.vue
  - apps/web/src/views/QrCodesView.test.ts
  - apps/web/src/views/QrCodesView.vue
  - packages/shared/src/index.ts
findings:
  critical: 2
  warning: 9
  info: 9
  total: 20
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-07-21T08:56:00Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Phase 7 adds QR codes (static + dynamic), a shared server-side render core, a `/q/:code` public redirect twin, and the QR Studio UI. The authorization substrate is genuinely solid: `resolveOwnedQrCode` joins through the bound Link's `domainId`, `remapQrCode` checks membership on **both** sides of a re-point, `UNAUTHORIZED_DOMAIN` and `NOT_FOUND` collapse to an identical 404 with no existence oracle, `logoData` never crosses the JSON boundary, and the SVG `fill=` injection vector is closed at the interpolation site itself with a strict hex gate plus a second Zod gate at the route boundary. The `/q/:code` handler correctly reuses `resolveLinkState` and the single `recordClickHook` seam rather than duplicating either. Mass-assignment on `code`/`variant`/`lifetimeScans` is blocked both by Zod allowlists and by the Prisma `data` objects.

The defects are concentrated in three places: (1) **what a static QR actually encodes** — it encodes the raw destination, not the short link, which structurally defeats the link's password gate, expiry gate, and every scan count; (2) **the logo pipeline**, which has an unhandled error path that turns a trivially-crafted upload into a 500, and which composites the logo differently in the PNG and SVG exports despite the module's own "single-geometry guarantee" claim; and (3) **the Studio component**, which mutates its props directly, drops a promise rejection, and enforces a client-side size cap that is materially looser than the server's.

## Critical Issues

### CR-01: Static QR encodes the destination URL, bypassing the link's password/expiry gates and making scan counts permanently zero

**File:** `apps/api/src/routes/qrCodes.ts:213-218`
**Issue:**
`resolveQrPayload` returns `qrCode.link.targetUrl` for a `static` QR. The exported PNG/SVG therefore encodes the *destination*, not the Kurzly short link. Consequences, all of them permanent once the code is printed:

- **Gate bypass.** A static QR created for a password-protected Link (`Link.passwordHash != null`) leads a scanner straight to the target. `resolveLinkState` is never consulted, because the request never reaches Kurzly at all. The same holds for `expiresAt` — an expired link's static QR keeps working forever. This directly contradicts `07-RESEARCH.md`'s own threat row "`/q/:code` scan bypassing the target Link's password/expiry gate → reuse `resolveLinkState`, never a direct unconditional 302", which was honoured for the dynamic path (`routes/qrRedirect.ts:133-151`) but not for the static one.
- **QR-07 is unsatisfiable for static codes.** No ClickEvent and no `lifetimeScans` increment can ever occur, so `QrCodesView.vue:336`'s "Scans" figure is hard-wired to `0` for every static QR for all time. Phase 7 success criterion 4 ("sees the code's scan count") is not met for the static variant.
- **Requirement mismatch.** ROADMAP success criterion 1 is "User generates a static QR code **for a short link**"; `07-CONTEXT.md` describes the static variant as one that "references a Link directly". Encoding `targetUrl` makes the QR reference the destination instead, so editing the Link's target later silently invalidates every already-printed static QR.

This is currently *asserted* as correct behaviour by `apps/api/test/qrCodes.integration.test.ts:1223` (`expect(decoded).toBe(link.targetUrl)`), so the test suite locks the defect in rather than catching it.

**Fix:** Encode the short-link URL, exactly as the dynamic branch encodes `/q/:code`. `resolveOwnedQrCode` already `include`s the `link` relation; extend it to include the domain so no extra query is needed:

```ts
// routes/qrCodes.ts
type QrCodeWithLink = QrCode & { link: Link & { domain: Domain } };

async function resolveOwnedQrCode(prisma, userId, id) {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.qrCode.findFirst({
    where: { id, link: { domainId: { in: domainIds } } },
    include: { link: { include: { domain: true } } },
  });
}

function resolveQrPayload(qrCode: QrCodeWithLink): string {
  if (qrCode.variant === "dynamic") {
    return `${requireEnv("BASE_URL")}/q/${qrCode.code}`;
  }
  // Static QR = a QR *for the short link* — every scan goes through
  // GET /:slug, so the password gate, expiry gate and click tracking
  // all apply exactly as they do for a pasted short URL.
  return `https://${qrCode.link.domain.hostname}/${qrCode.link.slug}`;
}
```

Then flip the integration assertion at `qrCodes.integration.test.ts:1223` to the short URL and add a regression test proving a static QR for a password-protected Link does **not** encode `targetUrl`.

---

### CR-02: A corrupt or oversized logo upload produces an unhandled 500 instead of the designed typed 400

**File:** `apps/api/src/lib/qr.ts:253-272`, `apps/api/src/lib/qrCodes.ts:236-249`, `apps/api/src/routes/qrCodes.ts:334-347`
**Issue:**
`normalizeLogo` only ever throws `InvalidLogoError` for input it *recognises* as neither PNG nor SVG. Both accepted branches then hand the bytes to `sharp`, which throws a plain `Error` on malformed input — and that error escapes every layer:

- `qr.ts:256-258`: a file whose first 8 bytes are the PNG signature but whose body is garbage passes the magic-byte check, then `sharp(bytes).metadata()` throws. Verified empirically against the installed sharp `0.35.x`:
  `THROWS: Error  "Input buffer has corrupt header: ..."`
- `qr.ts:261-268`: the SVG sniff is `/<svg[\s>]/i` over the first 512 bytes — an ~200-byte SVG declaring `width="60000" height="60000"` is accepted and `sharp(bytes).png()` throws. Verified:
  `THROWS: Error  "Input image exceeds pixel limit"`

`updateQrCode` (`qrCodes.ts:246-249`) catches **only** `InvalidLogoError` and rethrows everything else. The `PATCH /api/qr-codes/:id` handler (`routes/qrCodes.ts:334-347`) has no try/catch at all — unlike the render handlers, which do. Result: any authenticated member can produce a Fastify 500 (with a stack trace in the logs) from a hand-crafted ~200-byte upload, on a code path whose entire stated design is "`InvalidLogoError`/`InvalidColorError` ... always map to 400, never an unhandled 500" (`routes/qrCodes.ts:41-42`). `mapQrFormError` in the client has no 500 branch either, so the user sees nothing useful.

**Fix:** Make `normalizeLogo` the single funnel it claims to be — wrap every `sharp` call and convert failures into `InvalidLogoError`, and bound the rasterization explicitly:

```ts
// lib/qr.ts
const LOGO_MAX_PIXELS = 16_000_000; // ~4000x4000, generous for a 46px tile

export async function normalizeLogo(input: LogoInput): Promise<NormalizedLogo> {
  const { bytes } = input;
  try {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      const metadata = await sharp(bytes, { limitInputPixels: LOGO_MAX_PIXELS }).metadata();
      return { buffer: bytes, width: metadata.width ?? 0, height: metadata.height ?? 0 };
    }
    const head = bytes.subarray(0, 512).toString("utf8").trimStart();
    if (/^<\?xml/i.test(head) || /<svg[\s>]/i.test(head)) {
      const rasterBuffer = await sharp(bytes, { limitInputPixels: LOGO_MAX_PIXELS }).png().toBuffer();
      const metadata = await sharp(rasterBuffer).metadata();
      return { buffer: rasterBuffer, width: metadata.width ?? 0, height: metadata.height ?? 0 };
    }
  } catch (err) {
    throw new InvalidLogoError(`Unreadable logo image: ${(err as Error).message}`);
  }
  throw new InvalidLogoError("Unsupported logo format: expected a PNG (magic bytes) or an SVG (XML/<svg> root)");
}
```

Additionally wrap the `PATCH` handler's `updateQrCode` call in the same `InvalidColorError | InvalidLogoError → 400` catch the render handlers already use, as defence-in-depth. Add two regression tests: a PNG-signature-prefixed garbage buffer and a huge-dimension SVG, both asserting `400 { error: "INVALID_LOGO" }`.

## Warnings

### WR-01: PNG and SVG exports composite the logo with different fit modes — the "single-geometry guarantee" does not hold for the logo path

**File:** `apps/api/src/lib/qr.ts:212` vs `apps/api/src/lib/qr.ts:235-237`
**Issue:** The SVG path injects `<image ... preserveAspectRatio="xMidYMid slice"/>` (= cover: the logo is scaled up and **cropped** to fill the tile), while the PNG path resizes with `fit: "contain"` and a transparent background (= letterboxed, never cropped). For any non-square logo the two exports show visibly different artwork from the same stored bytes. The file header claims "sized via the SAME `LOGO_TILE_FRACTION` the SVG path uses. Never a second, independently-computed pixel-grid path" (`qr.ts:216-221`), and `qrDecode.test.ts:148-155` only proves byte-identity for the **no-logo** case, so nothing catches this.
**Fix:** Use the same semantics in both. Simplest: change the SVG to `preserveAspectRatio="xMidYMid meet"` (the SVG equivalent of `contain`), or change the PNG resize to `fit: "cover"`. Then add a decode/geometry test that renders a deliberately non-square logo through both paths and asserts the composited logo occupies the same box.

### WR-02: `render.svg` embeds the full-resolution logo, un-resized, in every response

**File:** `apps/api/src/lib/qr.ts:207-213`
**Issue:** `renderQrSvg` base64-embeds `normalizedLogo.buffer` — the *original* uploaded PNG bytes — while displaying it in a ~46px tile. `renderQrPng` resizes first (`qr.ts:235-238`). With `LOGO_DATA_MAX_LENGTH = 1_900_000` base64 chars, a stored logo can be ~1.36 MiB, so every `GET .../render.svg` response carries ~1.8 MiB of base64 for a 46px thumbnail. `QR_RENDER_RATE_LIMIT` permits 120 requests/minute per IP against that. This is also inconsistent with the PNG path for no stated reason.
**Fix:** Resize once, before embedding, exactly as the PNG path does:
```ts
const logoTilePx = Math.round(dim * LOGO_TILE_FRACTION);
const resized = await sharp(normalizedLogo.buffer)
  .resize(logoTilePx, logoTilePx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer();
const dataUri = `data:image/png;base64,${resized.toString("base64")}`;
```

### WR-03: Client logo size cap (2 MiB raw) is looser than the server's effective cap (~1.36 MiB), so a file the UI accepts is rejected with a generic error

**File:** `apps/web/src/components/QrStudioPanel.vue:66,164-171` vs `apps/api/src/routes/qrCodes.ts:131`
**Issue:** The client validates `file.size > 2 * 1024 * 1024` and shows "Datei zu groß (max. 2 MB)". The server caps the **base64 string** at 1,900,000 chars, which is ~1,425,000 raw bytes ≈ 1.36 MiB. Every file in the ~1.36–2.00 MiB band passes the client check, then fails server-side with a bare 400 (`"Invalid QR data"`, no `INVALID_LOGO` code), which `mapQrFormError` funnels into `generalError` — so `handleLogoFile`'s `mapQrFormError(err).logoError ?? SAVE_FAILED_MESSAGE` shows "Speichern fehlgeschlagen" for a file the UI just told the user was within limits.
**Fix:** Derive the client cap from the server cap and keep the copy honest:
```ts
// 1_900_000 base64 chars ≈ 1_425_000 raw bytes (server: LOGO_DATA_MAX_LENGTH)
const MAX_LOGO_BYTES = 1_400_000;
const LOGO_SIZE_ERROR = "Datei zu groß (max. 1,4 MB).";
```
Better still, export the limit from `@kurzly/shared` so the two can never drift again.

### WR-04: `readAsDataUrl` rejection is unhandled — a FileReader failure becomes a silent no-op plus an unhandled promise rejection

**File:** `apps/web/src/components/QrStudioPanel.vue:190-202`
**Issue:** `const dataUrl = await readAsDataUrl(file);` sits **outside** the `try` block. `readAsDataUrl` rejects on `reader.onerror` (`:177`). The rejection propagates out of `handleLogoFile`, which is invoked as `void handleLogoFile(file)` (`:207`) — so the user sees no error at all, `logoError` stays `null`, and the browser logs an unhandled rejection.
**Fix:** Move the read inside the existing try, or wrap it:
```ts
let dataUrl: string;
try {
  dataUrl = await readAsDataUrl(file);
} catch {
  logoError.value = LOGO_FORMAT_ERROR;
  return;
}
```

### WR-05: `QrStudioPanel` mutates its `qr` prop directly

**File:** `apps/web/src/components/QrStudioPanel.vue:121-122, 134-135, 147-148, 154, 194`
**Issue:** `setColor`, `toggleRounded`, `toggleLogo` and `handleLogoFile` all assign to `props.qr.*` (`props.qr.color = color`, `props.qr.roundedModules = !prev`, …). Because `selectedQr` in `QrCodesView.vue:77-79` returns a live element of the `qrCodes` array, the child is writing into the parent's state behind the parent's back — while the parent *also* replaces that element via `handleStyled` (`QrCodesView.vue:100-104`). Two write paths for the same state. This is the exact pattern `vue/no-mutating-props` exists to catch; the repo currently has no ESLint config, so nothing flags it.
**Fix:** Keep the optimistic value in local component state and let the parent own the DTO:
```ts
const local = reactive({ color: props.qr.color, roundedModules: props.qr.roundedModules, logoEnabled: props.qr.logoEnabled });
watch(() => props.qr, (qr) => Object.assign(local, { color: qr.color, roundedModules: qr.roundedModules, logoEnabled: qr.logoEnabled }));
```
Bind the template to `local`, revert `local` on failure, and rely on the existing `styled` emit for the authoritative value.

### WR-06: Rapid Studio edits race — an older PATCH response can overwrite a newer one

**File:** `apps/web/src/components/QrStudioPanel.vue:119-157`
**Issue:** Every control change fires an independent `updateQrCode` with no sequencing, no abort, and no request-id check. Clicking two colour swatches in quick succession issues two PATCHes; if the first response arrives second, `emit("styled", updated)` pushes the *stale* DTO into `qrCodes.value[idx]` (`QrCodesView.vue:102`), so the list and swatch selection show a colour that is no longer persisted. The debounced preview re-fetch masks it (it reads fresh server state), which makes the divergence harder to notice, not less real.
**Fix:** Guard emits with a monotonically increasing request token, discarding responses older than the newest issued request:
```ts
let mutationSeq = 0;
async function persist(patch: UpdateQrCodeInput) {
  const seq = ++mutationSeq;
  const updated = await updateQrCode(props.qr.id, patch);
  if (seq !== mutationSeq) return; // superseded
  emit("styled", updated);
}
```

### WR-07: No delete path for QR codes — accidental creations are permanent and carry unbounded BYTEA

**File:** `apps/api/src/routes/qrCodes.ts` (whole file), `apps/web/src/api.ts:350-406`
**Issue:** The route surface is `POST` / `GET` / `GET :id` / `GET :id/remap-history` / `PATCH :id` / two render endpoints. There is no `DELETE /api/qr-codes/:id`, no `deleteQrCode` in `lib/qrCodes.ts`, and no client function. Meanwhile both UI entry points create rows on a single click with no confirmation dialog: `QrCodesView.createDynamicQr` (`:185-204`) and `LinkDetailView.handleQrCode` (`:212-234`). A QR can only be removed by deleting its Link (cascade). Each row can hold ~1.36 MiB of `logoData` BYTEA. Every comparable resource in this codebase (`Link`, `Domain`) ships a delete endpoint.
**Fix:** Add `DELETE /api/qr-codes/:id` gated by `resolveOwnedQrCode` (204 on success, identical 404 for missing/forbidden), a `deleteQrCode` in `lib/qrCodes.ts` as the sole delete site, a `deleteQrCode` client function, and a confirmation dialog in `QrCodesView` mirroring `LinkDetailView`'s delete dialog.

### WR-08: `removeLogo` leaves `logoEnabled: true`, so the Studio shows a placeholder logo that the exported bytes do not contain

**File:** `apps/web/src/components/QrStudioPanel.vue:211-221`, `:80`
**Issue:** `removeLogo` sends only `{ logoData: null }`. Server-side, `logoEnabled` stays `true` while `logoData` becomes `null`, so `resolveRenderStyle` (`routes/qrCodes.ts:225`) yields `logo: undefined` and the error-correction level silently drops from `H` back to `M`. Client-side, `hasCustomLogo` is reset to `false` while `props.qr.logoEnabled` remains `true`, so `showLogoOverlay` (`:80`) flips back to `true` and the decorative "K" tile reappears — over a preview and an export that contain no logo at all. A user can download and print a QR believing it carries the logo shown on screen. Note this is the mirror image of the upload path, which *does* set both (`:193`).
**Fix:** Clear both fields atomically, matching the upload's symmetry:
```ts
const updated = await updateQrCode(props.qr.id, { logoData: null, logoEnabled: false });
```

### WR-09: The "one static QR per link" invariant is asserted in code comments but enforced nowhere

**File:** `apps/web/src/views/LinkDetailView.vue:200-234`, `apps/api/src/routes/qrCodes.ts:260-271`, `apps/api/prisma/schema.prisma:285-311`
**Issue:** `LinkDetailView.handleQrCode`'s doc comment states "a static QR is 1:1 bound to this Link" and implements the invariant by fetching **the caller's entire QR list** and filtering client-side (`listQrCodes()` + `find`). Nothing enforces it: there is no unique constraint on `(linkId, variant)` where `variant = 'static'`, `createQrCode` performs no duplicate check, and `GET /api/qr-codes` has no `linkId` filter, no `limit`, and no pagination. Two quick clicks (or two tabs) create two static QRs for the same link; the moment the list endpoint is ever paginated the check silently starts creating duplicates on every click.
**Fix:** Enforce server-side. Either add a partial unique index and map the `P2002` to a typed error:
```sql
CREATE UNIQUE INDEX "QrCode_static_link_key" ON "QrCode"("linkId") WHERE "variant" = 'static';
```
…or add a `?linkId=&variant=` filter to `GET /api/qr-codes` and have `createQrCode` return the existing row for a duplicate static create. Either way, stop relying on an unbounded client-side list scan for a correctness invariant.

## Info

### IN-01: `validateQrCodeInput` is exported but has no external caller

**File:** `apps/api/src/lib/qrCodes.ts:106`
**Issue:** The only call site is `createQrCode` (`:155`) in the same module. The header comment describes it as "the SOLE authorization + validation gate for every QrCode content/target write", but `updateQrCode` and `remapQrCode` call `resolveLinkDomainAccess` directly instead, so the exported surface implies a contract that does not exist.
**Fix:** Make it module-private (drop `export`) and correct the header to name `resolveLinkDomainAccess` as the shared gate.

### IN-02: `getQrCode` in the web client has no production caller

**File:** `apps/web/src/api.ts:367-370`
**Issue:** Referenced only by `apps/web/src/api.qr.test.ts`. No view or component imports it — `QrCodesView` uses `listQrCodes`, `QrStudioPanel` receives the DTO as a prop.
**Fix:** Remove it, or wire it into `QrStudioPanel`'s selection refresh so the panel re-reads authoritative state on mount instead of trusting the list DTO.

### IN-03: `qrDimensionPx` re-encodes the entire QR just to measure it

**File:** `apps/api/src/lib/qr.ts:127-130`, called from `:208` and `:233`
**Issue:** Both logo render paths call `buildModuleSvg` (which runs `QRCode.create`) and then `qrDimensionPx` (which runs `QRCode.create` again on the same payload/EC level). Two full Reed–Solomon encodes per logo render, on the endpoint with the highest rate limit in the app.
**Fix:** Have `buildModuleSvg` return `{ svg, dim }`, or extract a `createMatrix(payload, ecLevel)` helper both call once.

### IN-04: The 300 ms render debounce timer is never cleared on QR switch or unmount

**File:** `apps/web/src/components/QrStudioPanel.vue:99-117`
**Issue:** `scheduleRender` stores `renderDebounceTimer`, but the `watch` on `props.qr.id` (`:108-117`) does not clear it, and there is no `onUnmounted` hook. A pending timer fires after the panel is unmounted or after the user selected a different QR, writing to refs of a dead/stale component.
**Fix:** `clearTimeout(renderDebounceTimer)` inside the watch callback, and add `onUnmounted(() => { if (renderDebounceTimer) clearTimeout(renderDebounceTimer); })`.

### IN-05: `DATA_URI_PREFIX` misses multi-parameter data URIs

**File:** `apps/api/src/routes/qrCodes.ts:153-157`
**Issue:** `/^data:[^;]+;base64,/` does not match `data:image/svg+xml;charset=utf-8;base64,...` — a form Blob/FileReader can legitimately produce. The prefix survives into `Buffer.from(..., "base64")`, corrupting the leading bytes and turning a valid upload into an `INVALID_LOGO` 400.
**Fix:** `const DATA_URI_PREFIX = /^data:[^,]*;base64,/;`

### IN-06: `schema.prisma`'s `logoData` comment contradicts the write path

**File:** `apps/api/prisma/schema.prisma:295`
**Issue:** "Logo image bytes (PNG), present only when `logoEnabled` is true." `updateQrCode` (`lib/qrCodes.ts:252-262`) writes `logoData` and `logoEnabled` as fully independent optional fields, and the DTO doc in `packages/shared/src/index.ts:300-310` explicitly documents `logoEnabled: true` with no stored bytes as a supported state.
**Fix:** Reword to "Logo image bytes (always PNG after `normalizeLogo`); independent of `logoEnabled`, which only gates whether they are composited at render time."

### IN-07: The `:code` route param is interpolated unvalidated into the unlock cookie's `Path` attribute

**File:** `apps/api/src/routes/qrRedirect.ts:215`
**Issue:** `issueUnlockCookie(reply, link.id, \`/q/${code}\`, ...)` passes a raw URL param into `cookie.serialize`'s `path` option, which rejects characters outside ` -:=-~` with a `TypeError` (→ 500). Not exploitable today, because the handler only reaches this line after an exact `findUnique({ where: { code } })` match against a server-generated Base62 code — but the safety depends entirely on that ordering, which is not documented at the call site.
**Fix:** Add a shape guard on the param (`/^[0-9A-Za-z]{1,32}$/` → 404 on mismatch) at the top of both `/q/:code` handlers, mirroring `customSlugSchema`'s discipline in `lib/links.ts`.

### IN-08: Synthetic remap-history entry ids can collide

**File:** `apps/web/src/views/QrCodesView.vue:231`
**Issue:** `id: \`local-${Date.now()}\`` — two remaps completing within the same millisecond produce duplicate ids, which is the `:key` for `v-for="entry in historyFor(qr)"` (`:353`). Duplicate keys cause Vue to warn and can mis-patch the list.
**Fix:** Use `crypto.randomUUID()`, or drop the synthetic entry entirely and re-fetch via `getQrRemapHistory` after a successful remap.

### IN-09: `assertValidColor` runs twice on every render

**File:** `apps/api/src/lib/qr.ts:120` and `:166`
**Issue:** `resolveModuleStyle` validates, then `buildModuleSvg` validates the identical value again. Both call sites carry long comments justifying their own necessity. The duplication is deliberate defence-in-depth, but the redundancy is undocumented as such at the second site.
**Fix:** Keep the `buildModuleSvg` check (it is the one that actually closes the vector for direct callers) and add a one-line note to `resolveModuleStyle`'s call that it exists only to fail earlier with a better stack, not because `buildModuleSvg` cannot be trusted.

---

_Reviewed: 2026-07-21T08:56:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
