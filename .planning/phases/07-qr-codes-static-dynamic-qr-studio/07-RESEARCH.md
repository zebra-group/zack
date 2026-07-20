# Phase 7: QR Codes (Static + Dynamic, QR Studio) - Research

**Researched:** 2026-07-20
**Domain:** Server-side QR code generation/rendering (Node.js), image compositing, decode-verification testing, Fastify route/data-model extension
**Confidence:** MEDIUM (core libraries + patterns CITED/verified against source/official docs; QR-design heuristics and rounded-module rendering approach are WebSearch-synthesized, no official-docs equivalent exists for those two topics)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**QR Generation & Export**
- Server-side generation via `qrcode` (node-qrcode) for PNG buffer + SVG string; no client-side QR rendering (single tested code path).
- Export both PNG and SVG for every code; each format covered by an automated decode-round-trip test (QR-01, QR-05).
- Logo overlay: centered composite via `sharp` for PNG; `<image>` data-URI injection into the SVG string for SVG. Whenever a logo is enabled, force `errorCorrectionLevel: 'H'` automatically (QR-05).
- Styling: foreground color + rounded-module toggle applied at generation time (QR-06).

**Dynamic QR Model & Routing**
- New `QrCode` model: `static` variant references a Link directly; `dynamic` variant owns its own `/q/:code` short code and points at a current target Link.
- Dynamic redirect handler lives at `/q/:code` (namespace already reserved in `apps/api/src/lib/links.ts`), resolving to the current target — re-pointing never changes the printed code (QR-02, QR-03).
- `QrRemapHistory` rows record every target change (from→to link, timestamp) for the visible remap history (QR-04).
- Single-write-path discipline mirrored from Links: exactly one `createQrCode`/`updateQrCode` path; styling/target fields never mass-assignable outside it.

**QR Studio (UI)**
- Surfaces: the existing `/qr-codes` route (currently ComingSoonView) becomes the QR list/studio; QR creation also reachable from Link detail.
- Controls: color picker + rounded-module toggle with a live preview of the rendered code (QR-06).
- Per-code scan count displayed (QR-07), derived from `source='qr'` ClickEvents.
- Visual language: reuse `apps/web/src/styles/tokens.css` and the component/state patterns established in 04-UI-SPEC (list/table + form modal) and 06-UI-SPEC (stat display).

**Scan Tracking**
- Dynamic QR scans recorded through the Phase-6 click seam with `source='qr'` (enum + analytics query already prepared in Phase 6).
- Same privacy guarantees as Phase 6 (no raw IP, salted visitor hash, zero-rows-when-off semantics as applicable).
- Scan counter pruning-resistant, analogous to `Link.lifetimeClicks`.

### Claude's Discretion
- Exact QrCode schema field names, code-generation alphabet/length for `/q/:code`, and QR Studio component decomposition are at Claude's discretion, guided by codebase conventions and the forthcoming UI-SPEC.

### Deferred Ideas (OUT OF SCOPE)
- Bulk QR generation, non-link payloads (vCard/wifi), print/PDF sheet layouts, animated/gradient QR styling — out of scope for v1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QR-01 | Nutzer kann einen statischen QR-Code zu einem Kurzlink erzeugen (PNG- und SVG-Export) | Standard Stack (`qrcode`), Architecture Pattern 1 (module-matrix renderer), Code Examples 1/2, Validation Architecture row QR-01 |
| QR-02 | Nutzer kann einen dynamischen QR-Code mit eigener Kurz-URL (`/q/xxxx`) anlegen | Architecture Pattern 2 (QrCode data model), Code Example 3 (`/q/:code` route), Common Pitfall 3 (routing collision) |
| QR-03 | Nutzer kann das Ziel eines dynamischen QR-Codes jederzeit auf einen anderen Link umstellen; der gedruckte Code bleibt gültig | Architecture Pattern 2/3 (remap = update `currentLinkId`, code column never touched), Common Pitfall 4 |
| QR-04 | Nutzer kann die Remapping-Historie eines dynamischen QR-Codes einsehen | Architecture Pattern 3 (`QrRemapHistory` model + single-write-path `remapQrCode`) |
| QR-05 | Nutzer kann ein zentriertes Logo in den QR-Code einfügen (Fehlerkorrektur-Level H → bleibt scannbar) | Architecture Pattern 1 (logo compositing), Common Pitfall 1 (EC-level/logo-size), Code Example 2, Validation Architecture (decode-round-trip test) |
| QR-06 | Nutzer kann im QR-Studio Farbe wählen und runde Module umschalten | Architecture Pattern 1 (custom SVG module renderer), Common Pitfall 2 (rounded modules not supported by `qrcode`'s built-in SVG output) |
| QR-07 | Nutzer sieht die Scan-Anzahl eines QR-Codes | Reuses Phase-6 `source='qr'` ClickEvent seam + a pruning-resistant `QrCode.lifetimeScans` counter (mirrors `Link.lifetimeClicks`) |
</phase_requirements>

## Summary

This phase adds server-only QR generation on top of the existing single-write-path/IDOR-guard architecture Phases 4-6 already established — there is no new architectural pattern to invent, only a new rendering domain (raster/vector image generation) bolted onto the same `validateXInput` → single-insert → DTO-mapping shape `lib/links.ts` uses. The generation stack is already locked by `.claude/CLAUDE.md`/CONTEXT.md: `qrcode` (node-qrcode) for encoding + PNG/SVG output, `sharp` for PNG logo compositing. Both are long-established, extremely high-download packages (`qrcode`: 18.7M/week, `sharp`: 74.8M/week) already implicitly approved via the project's own CLAUDE.md stack table.

The one genuinely new technical wrinkle this phase must solve is **rounded QR modules**: `qrcode`'s built-in `toString({type:'svg'})` emits a single combined `<path>` covering every dark module — there is no per-module DOM node to round the corners of. The correct, non-hand-rolled approach (confirmed against the package's own source) is to call `QRCode.create()` for the raw module bit-matrix and hand-write a small SVG-and-PNG-shared renderer that emits one `<rect>` per dark module (square or `rx`/`ry`-rounded, colored per the Studio's color picker), then rasterize that exact SVG through `sharp` for the PNG path — so PNG and SVG output are structurally guaranteed to render identical module geometry, never two diverging code paths. This mirrors the project's own single-write-path discipline (`lib/links.ts`), applied to rendering instead of persistence.

The second hard requirement — an automated PNG+SVG decode-round-trip test with a logo present — needs a decode library. `qrcode`/`sharp` are both encoders/compositors, not decoders. `jsQR` (pure JS, zero dependencies, works directly on raw RGBA pixel arrays) is the right fit for a headless Vitest suite: no canvas/DOM needed, and `sharp` itself (already a prod dependency) can supply the raw RGBA pixels for both the PNG path (`sharp(pngBuffer).raw().toBuffer()`) and the SVG path (rasterize the SVG string through `sharp` first, then decode the resulting PNG the same way) — so no `pngjs`/`canvas` dependency needs to be added on top of `jsQR`.

**Primary recommendation:** Build one shared "module-matrix → styled SVG string" renderer (using `QRCode.create()`'s raw matrix, not `qrcode`'s `toString('svg')`), reuse it for both SVG output (inject the logo `<image>` there) and as the rasterization source for PNG (via `sharp`, then `sharp.composite()` the logo). Add exactly one new test dependency, `jsQR`, decoding raw RGBA pixels obtained via `sharp`'s `.raw()` output for both formats.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| QR module-matrix generation (encoding, Reed-Solomon, mask selection) | API/Backend | — | `qrcode`'s `create()` — pure computation, no I/O; must never run in the browser per CONTEXT.md's "single tested code path" decision |
| Styled SVG/PNG rendering (color, rounding, logo compositing) | API/Backend | — | CONTEXT.md locks this server-side; `sharp` (native binary, prebuilt for the project's `node:24-alpine` image) cannot run in-browser anyway |
| QR Studio live preview | Frontend Server (SPA) → API/Backend round-trip | Browser (renders returned image only) | UI-SPEC's "debounced (300ms) Render-API-Call (kein Client-seitiges Neuzeichnen, D-Server-Only)" — the browser only displays a `<img>`/inline SVG the API rendered, it never re-derives QR geometry itself |
| `QrCode`/`QrRemapHistory` persistence, single-write-path validation | API/Backend | Database/Storage | Mirrors `lib/links.ts`'s `validateLinkInput`/`createLink` shape exactly |
| `/q/:code` dynamic redirect resolution + scan recording | API/Backend | Database/Storage | Same tier as `routes/redirect.ts`'s `GET /:slug` — a Fastify route reading `QrCode` → target `Link`, writing one `ClickEvent(source='qr')` |
| Logo file upload (PNG/SVG, max 2MB) | Browser (file picker) | API/Backend (validation + storage) | Browser only selects+reads the file; the API re-validates MIME/size server-side before ever handing bytes to `sharp`/the SVG injector (never trust a client-declared `Content-Type`) |
| Scan count display | Database/Storage (source of truth) | API/Backend (DTO mapping) | Reuses the exact `getGlobalAnalytics`/`ClickEvent` pattern already built in Phase 6; QR Studio itself is a pure read view |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `qrcode` | 1.5.4 [VERIFIED: npm registry — `npm view qrcode version`, published 2024-08-05, 18.7M weekly downloads, `github.com/soldair/node-qrcode`] | QR encoding: `QRCode.create()` for the raw module bit-matrix, `QRCode.toString(text, {type:'svg'}, cb)` for the unstyled SVG baseline reference, `errorCorrectionLevel` option | Already locked by `.claude/CLAUDE.md`'s Recommended Stack table and CONTEXT.md's decisions — the de-facto standard Node.js QR encoder, most-downloaded QR package on npm |
| `sharp` | 0.35.3 [VERIFIED: npm registry — `npm view sharp version`, package created 2013-08-20 (12+ years), 74.8M weekly downloads, `github.com/lovell/sharp`] | PNG rasterization of the custom module-matrix SVG, `.composite()` for centered logo overlay on the PNG path, `.raw()` pixel extraction for decode-round-trip tests | Already locked by `.claude/CLAUDE.md`; ships prebuilt `libvips` binaries per-platform (no native build step on `node:24-alpine`, this project's exact Docker base) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jsqr` | 1.4.0 [ASSUMED — package name discovered via WebSearch, not Context7/official docs this session; `npm view jsqr version` confirms registry existence + `package-legitimacy check` verdict `OK`, but per the provenance rule registry existence alone does not upgrade this to VERIFIED] | Decodes raw RGBA pixel arrays back into QR payload text — the decode half of the mandatory PNG+SVG decode-round-trip test (QR-01/QR-05) | devDependency only, used exclusively in Vitest integration tests; never shipped to the runtime image |
| `@types/qrcode` | 1.5.6 [VERIFIED: npm registry, `github.com/DefinitelyTyped/DefinitelyTyped`, 9.1M weekly downloads] | TypeScript types for `qrcode` (the package itself ships no `.d.ts`) | devDependency; `sharp` and `jsqr` both ship their own bundled types, no separate `@types/*` needed for those two |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `qrcode` + `sharp` (manual logo/rounding compositing) | `qr-code-styling` | Already rejected by `.claude/CLAUDE.md`: depends on `canvas`+`jsdom` in Node, heavier/more fragile to build on `node:*-alpine` than `sharp`'s prebuilt binaries |
| Hand-written module-matrix SVG renderer | `qrcode-svg` or `@qrgrid/core` (third-party libraries that already expose per-module SVG rects for custom styling) | These are lighter-weight alternatives that solve the exact "rounded modules" gap this phase hits — NOT chosen here because they'd be a second, unverified/unaudited encoding-adjacent dependency for a ~40-line renderer function this codebase can own directly (mirrors the project's general preference for owning small render logic over adding a dependency for it, see "Don't Hand-Roll" section below for the boundary) |
| `jsQR` for decode-round-trip tests | `@zxing/library` / `zxing-wasm` | Both are heavier (full multi-format barcode libraries, WASM binary for the latter) for a QR-only, pure-JS-preferred headless test use case; `jsQR` is purpose-built and dependency-free |
| `sharp`'s `.raw()` for PNG pixel extraction in tests | `pngjs` (already a transitive dependency of `qrcode` itself) | Either works; `sharp` is chosen since it is already a direct prod dependency (no new package needed) and its `.raw()` output is the exact same RGBA shape `jsQR` expects |

**Installation:**
```bash
# apps/api (prod)
pnpm --filter @kurzly/api add qrcode sharp

# apps/api (dev/test only)
pnpm --filter @kurzly/api add -D jsqr @types/qrcode
```

**Version verification:** confirmed 2026-07-20 via `npm view <pkg> version` against the live npm registry (see table above) — do not reuse `.claude/CLAUDE.md`'s original version pins without re-checking; `sharp` in particular ships frequent point releases.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `qrcode` | npm | published 2024-08-05 (package itself long-established, `soldair/node-qrcode` repo dates to 2012) | 18.7M/week | github.com/soldair/node-qrcode | OK | Approved |
| `sharp` | npm | package created 2013-08-20 (12+ yrs); latest point release 2026-07-01 | 74.8M/week | github.com/lovell/sharp | **SUS** (`reasons: ["too-new"]`) | Approved WITH checkpoint — see note below |
| `jsqr` | npm | published 2021-04-24 (no dependencies, no postinstall) | 1.83M/week | github.com/cozmo/jsQR | OK | Approved — devDependency only |
| `@types/qrcode` | npm | published 2025-10-24 | 9.1M/week | github.com/DefinitelyTyped/DefinitelyTyped | OK | Approved — devDependency only |

**`sharp`'s `SUS`/"too-new" note (false-positive context for the human verifier):** the legitimacy heuristic flags `sharp` because its *most recent point-release publish date* (2026-07-01) is recent — this is normal maintenance cadence for a 12+-year-old, 74.8M-weekly-download package with 0 postinstall/install scripts and the canonical `lovell/sharp` repo, not a signal of a new/hijacked package. Per protocol this is still surfaced as `[SUS]` and the planner MUST insert a `checkpoint:human-verify` task before `pnpm add sharp` — the check itself is fast (confirm `npm view sharp repository.url` still points to `lovell/sharp` and the version matches what's on npmjs.com/package/sharp at install time).

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `sharp` (false-positive "too-new", see note above — planner inserts one `checkpoint:human-verify` before its install step).

*`jsqr`'s package name was discovered via WebSearch (no Context7/official-docs access in this research session — the agent's Context7 MCP tool was unavailable at runtime, see Assumptions Log A1) and is therefore tagged `[ASSUMED]` in the Standard Stack table above despite its `OK` legitimacy verdict. The planner MUST gate `jsqr`'s install behind a `checkpoint:human-verify` task per the provenance rule (registry existence + legitimacy `OK` alone does not constitute verification against an authoritative source).*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── Browser (QR Studio) ───────────────────────────┐
│  QrCodesView.vue          color/rounding/logo controls, debounced (300ms) │
│       │  POST/PATCH color/rounded/logo               "Render-API-Call"    │
│       ▼                                                                    │
└───────┼─────────────────────────────────────────────────────────────────┘
        │  fetch() same-origin (mirrors apps/web/src/api.ts pattern)
        ▼
┌─────────────────────────── Fastify API (apps/api) ─────────────────────────┐
│  routes/qrCodes.ts                                                         │
│    POST /api/qr-codes            (create static|dynamic)                  │
│    PATCH /api/qr-codes/:id       (style: color/rounded/logo; dynamic-only │
│                                    target remap → writes QrRemapHistory)   │
│    GET  /api/qr-codes            (list, domain-scoped)                    │
│    GET  /api/qr-codes/:id/render.png | .svg   (on-demand image bytes)     │
│         │                                                                  │
│         ▼                                                                  │
│  lib/qrCodes.ts (D-01-style single-write-path)                            │
│    validateQrCodeInput() → requireDomainAccess (reused from Phase 2-6)    │
│    createQrCode() / updateQrCode() / remapQrCode()  ── the ONLY           │
│    prisma.qrCode.{create,update} + prisma.qrRemapHistory.create sites     │
│         │                                                                  │
│         ▼                                                                  │
│  lib/qrRender.ts (NEW rendering core)                                     │
│    1. QRCode.create(payloadUrl, {errorCorrectionLevel})  ← qrcode pkg     │
│    2. buildModuleSvg(modules, {color, rounded}) → SVG string (OWN code)   │
│    3a. SVG export: inject <image> (logo) into that SVG string, return    │
│    3b. PNG export: sharp(svgBuffer).png().toBuffer() → sharp.composite() │
│         the logo PNG with gravity:'centre' → final PNG buffer            │
│         │                                                                  │
│         ▼                                                                  │
│  Postgres: QrCode, QrRemapHistory, ClickEvent(source='qr')                │
└─────────────────────────────────────────────────────────────────────────────┘
        ▲
        │  GET /q/:code  (public, no auth — mirrors routes/redirect.ts)
┌───────┴──────────────── routes/qrRedirect.ts ──────────────────────────────┐
│  resolve QrCode by code → currentLinkId → Link.targetUrl                   │
│  recordClickHook(source='qr')  (reuses Phase-6 transactional insert +      │
│  QrCode.lifetimeScans increment, mirrors Link.lifetimeClicks exactly)      │
│  302 redirect to target                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   ├── qrCodes.ts        # D-01-style single-write-path: validate+create+update+remap
│   ├── qrRender.ts        # NEW: module-matrix → styled SVG/PNG renderer (no DB access)
│   └── qrCodeSlug.ts      # (or folded into qrCodes.ts) — /q/:code alphabet + collision retry, mirrors generateSlug/resolveSlug in links.ts
├── routes/
│   ├── qrCodes.ts         # POST/PATCH/GET /api/qr-codes* (authenticated, domain-scoped)
│   └── qrRedirect.ts      # GET /q/:code (public, mirrors routes/redirect.ts's shape)
apps/web/src/
├── views/
│   └── QrCodesView.vue    # replaces ComingSoonView.vue under /qr-codes
├── components/
│   ├── QrListCard.vue     # (optional decomposition) list-column card
│   └── QrStudioPanel.vue  # (optional decomposition) preview + controls + export
```

### Pattern 1: Module-Matrix-First Rendering (the core new pattern this phase introduces)
**What:** Never call `qrcode`'s `toString({type:'svg'})`/`toFile` as the final output. Instead call `QRCode.create(payload, { errorCorrectionLevel })` to get the raw module bit-matrix (`modules.size`, `modules.data` — a `Uint8Array`/bitmatrix where each cell is dark/light), then a small hand-written function walks that matrix and emits one `<rect>` per dark module into an SVG string — `x=col*moduleSize`, `y=row*moduleSize`, `width=height=moduleSize`, `fill=color`, and `rx`/`ry` set to e.g. `moduleSize*0.45` when `rounded` is true (matches the UI-SPEC's large-preview CSS convention `border-radius:{{ rounded ? '45%' : '0' }}` for the dashboard's own CSS-grid preview approximation — the *real* rendered SVG/PNG must bake the same 45%-of-module-size rounding into actual geometry, not rely on CSS, since PNG has no CSS).
**When to use:** Every QR render (thumbnail, Studio large preview endpoint, PNG export, SVG export) goes through this ONE function — never a second ad-hoc renderer, mirroring `createLink`'s single-insert-site discipline.
**Example:**
```typescript
// Source: derived from qrcode@1.5.4's lib/server.js (unpkg.com/qrcode@1.5.4/lib/server.js,
// confirmed via direct source read this session) + sharp.pixelplumbing.com/api-composite
import QRCode from "qrcode";

type ModuleStyle = { color: string; rounded: boolean; moduleSizePx: number };

export function buildModuleSvg(
  payload: string,
  errorCorrectionLevel: "L" | "M" | "Q" | "H",
  style: ModuleStyle,
): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel });
  const size = qr.modules.size;
  const px = style.moduleSizePx;
  const rects: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue; // light module, skip
      const rx = style.rounded ? px * 0.45 : 0;
      rects.push(
        `<rect x="${col * px}" y="${row * px}" width="${px}" height="${px}" rx="${rx}" ry="${rx}" fill="${style.color}"/>`,
      );
    }
  }
  const dim = size * px;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}">${rects.join("")}</svg>`;
}
```
> Note (Assumptions Log A2): `qr.modules.get(row, col)` is the BitMatrix accessor `qrcode`'s own internal renderers (`lib/renderer/svg-tag.js`, `lib/renderer/utils.js`) use — confirmed by inspecting the source, not the (sparser) README. Re-verify this exact accessor name against the installed `qrcode@1.5.4` package at implementation time (`node_modules/qrcode/lib/core/bit-matrix.js`) before relying on it in a plan task.

### Pattern 2: QrCode Single-Write-Path (mirrors `lib/links.ts` exactly)
**What:** `validateQrCodeInput()` (pure, zero DB writes: `requireDomainAccess` reused verbatim from Phase 2, target-Link ownership check, style-field allowlist) → `createQrCode()` (the ONLY `prisma.qrCode.create` site) / `updateQrCode()` (style-only fields: color/rounded/logo) / `remapQrCode()` (dynamic-only: changes `currentLinkId`, writes one `QrRemapHistory` row in the same `$transaction`).
**When to use:** Every QR create/style-update/remap goes through `lib/qrCodes.ts` — no route ever calls `prisma.qrCode.*` directly, exactly like LINK-0x's discipline.
**Example:**
```typescript
// Source: pattern mirrors apps/api/src/lib/links.ts's createLink/updateLink shape (this codebase)
export async function remapQrCode(
  prisma: PrismaClient,
  qrCodeId: string,
  userId: string,
  newLinkId: string,
): Promise<RemapResult> {
  const qr = await prisma.qrCode.findUnique({ where: { id: qrCodeId } });
  if (!qr || !qr.dynamic) return { ok: false, error: "NOT_DYNAMIC" };

  // Reused: requireDomainAccess against the QR's owning domain AND the
  // new target Link's domain (both must be authorized — a remap must not
  // let a member point a QR at a Link they cannot access, T-QR-MASS).
  await requireDomainAccess(prisma, userId, qr.domainId, "member");
  const targetLink = await prisma.link.findUnique({ where: { id: newLinkId } });
  if (!targetLink) return { ok: false, error: "TARGET_NOT_FOUND" };
  await requireDomainAccess(prisma, userId, targetLink.domainId, "member");

  const [updated] = await prisma.$transaction([
    prisma.qrCode.update({ where: { id: qrCodeId }, data: { currentLinkId: newLinkId } }),
    prisma.qrRemapHistory.create({
      data: { qrCodeId, fromLinkId: qr.currentLinkId, toLinkId: newLinkId },
    }),
  ]);
  return { ok: true, qrCode: updated };
}
```

### Pattern 3: `/q/:code` Public Redirect (mirrors `routes/redirect.ts`)
**What:** A second, structurally-identical-but-simpler redirect route. No password/expiry/bot-OG branching (those are Link-level concerns the *target* Link already enforces once the dynamic QR's redirect chains into it) — `/q/:code` resolves `QrCode.code` → `QrCode.currentLinkId` → issues a 302 straight to `Link.targetUrl` **after** re-running the SAME expiry/password checks the target Link would enforce on a direct visit (a QR scan must not bypass a password-gated or expired target — see Common Pitfall 4).
**When to use:** Registered directly on `app` (not host-scoped like `routes/redirect.ts`'s `/:slug`, since dynamic QR codes are a Kurzly-hosted global namespace tied to the operator's own `BASE_URL`, not to arbitrary customer domains — see Open Questions).
**Example:**
```typescript
// Source: pattern mirrors apps/api/src/routes/redirect.ts's GET /:slug handler (this codebase)
app.route({
  method: "GET",
  url: "/q/:code",
  config: { rateLimit: REDIRECT_RATE_LIMIT }, // reuse Phase 5's constant
  handler: async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { code } = request.params as { code: string };
    const qr = await prisma.qrCode.findUnique({ where: { code }, include: { currentLink: true } });
    if (!qr || !qr.currentLink) return reply.code(404).send(/* 404 page */);

    // Re-run the target Link's own expiry/password state machine — a QR
    // scan is just another way of arriving at that Link, not a bypass.
    const state = resolveLinkState(qr.currentLink, /* no unlock cookie context here */ false);
    if (state === "expired") return reply.code(410).send(/* expired page */);
    if (state === "protected") return reply.code(200).send(/* password page, action=/q/:code/verify */);

    await recordClickHook({ prisma, link: qr.currentLink, /* ...ip/ua/referer */, source: "qr" });
    await prisma.qrCode.update({ where: { id: qr.id }, data: { lifetimeScans: { increment: 1 } } });
    return reply.code(302).redirect(qr.currentLink.targetUrl);
  },
});
```
> Note: `recordClickHook` in `routes/redirect.ts` currently hardcodes `source: "link"` — it must be parameterized to accept `source: ScanSource` so this route can pass `"qr"` through the SAME transactional insert path, rather than duplicating the click-recording logic (Common Pitfall 3).

### Anti-Patterns to Avoid
- **Rendering QR codes in the browser (client-side canvas/`qrcode` bundle):** explicitly ruled out by CONTEXT.md ("no client-side QR rendering — single tested code path"). Would also make the "identical geometry across thumbnail/preview/PNG/SVG" guarantee impossible to hold, since a browser-side re-render is a second, untested code path.
- **Two separate renderers for PNG vs SVG:** if PNG rounding/logo placement is computed independently from the SVG path (e.g., PNG via a from-scratch pixel-grid loop, SVG via `qrcode`'s built-in path), the two exports can silently drift apart (different rounding radius, off-by-one module alignment) — Pattern 1 exists specifically to prevent this by making PNG rasterize the *exact same* SVG string SVG export returns (logo aside).
- **Trusting a client-declared `Content-Type` for logo uploads:** the Dropzone accepts `image/png,image/svg+xml` client-side, but the API must independently sniff/validate the actual bytes (magic-number check for PNG, XML/SVG-root check for SVG) before ever handing them to `sharp`/the SVG injector — an attacker-supplied file with a spoofed extension/MIME must not reach `sharp` unvalidated (ASVS V5, see Security Domain below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR encoding (Reed-Solomon error correction, mask-pattern selection, version/mode selection) | A from-scratch QR encoder | `qrcode`'s `QRCode.create()` | Reed-Solomon + mask-pattern optimization is a solved, security/correctness-sensitive algorithm — reimplementing it risks subtly-wrong error-correction bytes that only fail under real-world scan conditions (folded paper, low light), which is exactly what EC-level H exists to guard against |
| PNG image compositing (alpha blending a logo onto a raster QR) | Manual pixel-buffer math | `sharp`'s `.composite()` | Alpha compositing has non-obvious correctness pitfalls (premultiplied vs. straight alpha, gamma) that `sharp`'s native `libvips` binding already handles correctly and fast |
| QR decoding for the round-trip test | A hand-rolled finder-pattern/decoder | `jsQR` | QR decoding (locating finder patterns, perspective correction, Reed-Solomon error correction on read) is at least as complex as encoding — this is exactly the kind of "deceptively complex, mature library exists" problem this section exists to flag |
| Base62 short-code generation for `/q/:code` | A new alphabet/generator | Reuse `lib/links.ts`'s existing `BASE62`/`customAlphabet(BASE62, N)` pattern (already used for Link slugs) | Zero new code, zero new collision-characteristics to reason about — the existing `nanoid`-based generator + retry-loop pattern (`AUTO_SLUG_RETRY_LIMIT`) is already proven correct in this codebase |
| Logo/upload MIME validation | A hand-rolled magic-number sniffer | `sharp`'s own `sharp(buffer).metadata()` call (throws/reports an unrecognized format) doubles as a validity check for the PNG path; for SVG, a minimal XML-root + `<svg` tag check is sufficient since `sharp`'s SVG loader will itself reject malformed SVG at render time | Avoids adding a dedicated file-type-sniffing dependency (e.g. `file-type`) for a problem `sharp` already fails safely on |

**Key insight:** every "don't hand-roll" item above is an algorithmically deep, correctness-critical primitive (encoding, decoding, alpha compositing) where a subtly-wrong reimplementation would only surface as an intermittent real-world scan failure — exactly the kind of bug class mature, widely-used libraries exist to eliminate. The ONE thing this phase legitimately DOES hand-write (the module-matrix→SVG renderer, Pattern 1) is deliberately NOT on this list: it is pure, deterministic geometry (draw a rect per already-computed module) with no algorithmic risk, and owning it directly is what makes the "PNG and SVG never diverge" guarantee possible.

## Common Pitfalls

### Pitfall 1: Treating "EC-level H tolerates 30% damage" as "any 30%-sized logo is safe"
**What goes wrong:** A logo sized right at the 30% ceiling with no quiet-zone/padding margin can still fail to scan on real hardware, because H's 30% tolerance budget also has to absorb print smudging, screen glare, and QR reader implementation variance — it isn't a dedicated logo-only budget.
**Why it happens:** The 30%/H-level number is a data-recovery ceiling for the whole code, not a logo-specific design spec.
**How to avoid:** Cap the logo overlay tile at a conservative fraction of the total QR area (the UI-SPEC's own numbers — a 46×46px logo tile inside a 196×196px large preview is ~5.5% of the linear dimension, i.e. well under 10% of area — already bake in this conservative margin; do not let the QR Studio's color/size controls allow scaling the logo tile larger than what the UI-SPEC locks). Always force `errorCorrectionLevel: 'H'` whenever a logo is present (already a locked CONTEXT.md decision) and never allow `L`/`M`/`Q` + logo simultaneously.
**Warning signs:** A logo tile whose CSS/render size the Studio computes as a percentage of the *current* QR pixel dimensions rather than a fixed module-count budget — if the Studio ever lets the QR shrink (e.g. via a `width` scale control this phase doesn't currently expose) without re-deriving the logo's module-count budget, the logo can silently exceed a safe fraction. [CONFIDENCE: LOW/WebSearch-derived guidance — see Assumptions Log A3; the actual scan-rate numbers cited are from non-official QR vendor blogs, not the QR spec itself. Treat 20% as a defensible internal ceiling, not a certified number.]

### Pitfall 2: Reaching for `qrcode`'s built-in `toString({type:'svg'})` and then trying to CSS-round it
**What goes wrong:** That renderer emits ONE `<path>` element combining every dark module (an SVG optimization to keep file size small) — there is no per-module DOM node to attach `rx`/`ry` or a CSS `border-radius`-equivalent to. Teams that don't discover this until mid-implementation end up either abandoning the rounded-module requirement or bolting on a fragile path-string regex hack.
**Why it happens:** The rounded-corner requirement (QR-06) sits exactly at the boundary the built-in renderer wasn't designed for (it optimizes for minimal SVG markup, not per-module styling).
**How to avoid:** Skip the built-in SVG renderer entirely for the final styled output; use `QRCode.create()`'s raw module matrix + Pattern 1's hand-written per-module `<rect>` renderer from the start. Reserve the built-in `toString('svg')` (if used at all) only for a throwaway unstyled reference/debug output, never as the shipped export.
**Warning signs:** A task or PR that imports `qrcode`'s `toString`/`toFile` with `type: 'svg'` directly in a route handler rather than through a shared `qrRender.ts` module-matrix renderer.

### Pitfall 3: A second, drifting `prisma.clickEvent.create` call site for QR scans
**What goes wrong:** `routes/redirect.ts`'s `recordClickHook` currently hardcodes `source: "link"` and is private to that file. A naive Phase-7 implementation copy-pastes a near-identical function into `routes/qrRedirect.ts` with `source: "qr"` hardcoded there instead — creating exactly the "second write path" anti-pattern `lib/links.ts`'s own header comment warns against (applied to `ClickEvent` instead of `Link`).
**Why it happens:** `recordClickHook` isn't currently exported/parameterized for reuse — Phase 6 only needed one call site.
**How to avoid:** Extract/export `recordClickHook` from `routes/redirect.ts` (or move it to `lib/`) with `source: ScanSource` as a parameter, defaulting to `"link"` for the existing call site, and have `routes/qrRedirect.ts` call the SAME function with `source: "qr"`. This is a one-line refactor of existing Phase 6 code, not a new pattern.
**Warning signs:** `grep -rn "prisma.clickEvent.create" apps/api/src` returning more than one call site after this phase — must stay exactly one, mirroring `lib/links.ts`'s own grep-provable single-insert-site guarantee.

### Pitfall 4: A dynamic QR scan bypassing the target Link's password/expiry gate
**What goes wrong:** If `/q/:code`'s handler redirects straight to `Link.targetUrl` without re-running `resolveLinkState`, a QR code pointed at a password-protected or expired Link becomes a silent bypass of REDIR-03/REDIR-04 — printed QR codes are exactly the kind of artifact that outlives a Link's intended access window (that's the whole point of "re-pointable without invalidating the printed code," QR-03), so this path MUST re-enforce the same state machine `routes/redirect.ts` already implements, not skip it.
**Why it happens:** It's tempting to treat `/q/:code` as "just look up the target and 302" since the QR-side data model has no password/expiry fields of its own (those live entirely on the target `Link`).
**How to avoid:** Reuse `lib/redirectEngine.ts`'s `resolveLinkState`/`mergeQuery` functions directly (already pure, already unit-tested) inside `routes/qrRedirect.ts` — do not reimplement the state machine, and do not skip it "because it's just a QR."
**Warning signs:** A `qrRedirect.ts` implementation that never imports from `lib/redirectEngine.ts` or `lib/publicHtml.ts`.

### Pitfall 5: `sharp`'s SVG rasterization silently failing on a malicious/malformed uploaded SVG logo
**What goes wrong:** SVG is an XML+scripting-capable format; accepting an arbitrary user-uploaded `.svg` and handing it straight to an SVG renderer is a known XXE/SSRF/script-injection surface in other stacks (though `sharp`'s bundled SVG loader is a rasterizer, not a browser DOM, so `<script>` execution is not the primary risk here — external entity/`xlink:href` resource-fetch attempts inside the SVG are the main one).
**Why it happens:** "Accept SVG file uploads" is treated as equivalent-risk to "accept PNG file uploads," but SVG is a markup/XML format with a materially larger attack surface.
**How to avoid:** Before passing an uploaded SVG logo to any renderer, strip/reject `<script>`, `<foreignObject>`, and any external resource reference (`xlink:href`/`href` pointing off-document) — or, simpler and safer for a "just a logo overlay" use case, convert the uploaded SVG logo to a PNG raster immediately on upload (via `sharp`) and only ever store/composite the rasterized PNG, never re-parsing the original SVG markup at render time. This also sidesteps needing to validate `sharp`'s exact SVG-safety guarantees for untrusted input.
**Warning signs:** Any code path that stores the raw uploaded SVG bytes and re-feeds them into a renderer on every subsequent Studio preview render, rather than rasterizing once at upload time.

## Code Examples

### 1. Forcing EC-level H whenever a logo is present (server-side, never trust a client-sent `errorCorrectionLevel`)
```typescript
// Source: derived from CONTEXT.md's locked decision + qrcode@1.5.4's documented
// errorCorrectionLevel option (L/M/Q/H)
export function resolveErrorCorrectionLevel(logoEnabled: boolean): "L" | "M" | "Q" | "H" {
  // QR-05: whenever a logo is enabled, EC level is ALWAYS forced to 'H' —
  // this is not a client-settable field, mirrors passwordHash/lifetimeClicks
  // being server-owned in lib/links.ts.
  return logoEnabled ? "H" : "M"; // 'M' default matches qrcode's own package default
}
```

### 2. Decode-round-trip test recipe (the hard blocking success criterion, QR-01/QR-05)
```typescript
// Source: pattern combining sharp.pixelplumbing.com's .raw() pixel-extraction API
// + jsqr@1.4.0's documented (imageData, width, height) signature — this session's
// WebSearch synthesis, no single official doc covers this exact combined recipe;
// re-verify sharp's raw()/toBuffer({resolveWithObject}) exact return shape at
// implementation time (Assumptions Log A4).
import sharp from "sharp";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { renderQrPng, renderQrSvg } from "../src/lib/qrRender.js";

async function decode(imageBuffer: Buffer): Promise<string | null> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha() // guarantee RGBA (4 channels) regardless of source format
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}

describe("QR decode round-trip (QR-01, QR-05)", () => {
  it("decodes a PNG export with a logo back to the original target URL", async () => {
    const target = "https://kurzly.example.com/promo";
    const pngBuffer = await renderQrPng(target, { logo: FIXTURE_LOGO_PNG, color: "#17170f" });
    await expect(decode(pngBuffer)).resolves.toBe(target);
  });

  it("decodes an SVG export with a logo back to the original target URL", async () => {
    const target = "https://kurzly.example.com/promo";
    const svgString = await renderQrSvg(target, { logo: FIXTURE_LOGO_PNG, color: "#17170f" });
    const rasterized = await sharp(Buffer.from(svgString)).png().toBuffer();
    await expect(decode(rasterized)).resolves.toBe(target);
  });
});
```

### 3. Remap does not change the printed code (QR-03's headline negative test)
```typescript
// Source: pattern mirrors this codebase's existing negative-test conventions
// (e.g. apps/api/test/redirect.integration.test.ts's no-leak canary)
it("re-pointing a dynamic QR's target never changes its /q/:code, and the old code keeps resolving to the NEW target", async () => {
  const qr = await createQrCode(prisma, { userId, domainId, dynamic: true, currentLinkId: linkA.id });
  const originalCode = qr.code;

  await remapQrCode(prisma, qr.id, userId, linkB.id);

  const app = await buildApp({ prisma });
  const response = await app.inject({ method: "GET", url: `/q/${originalCode}` });
  expect(response.headers.location).toBe(linkB.targetUrl); // NOT linkA
  expect(qr.code).toBe(originalCode); // printed artifact unchanged
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `sharp`'s SVG input relying on a system-installed `librsvg` | `sharp`'s bundled prebuilt binaries ship their own SVG rasterization support (no `apk add librsvg` needed on `node:24-alpine`) | Ongoing across recent `sharp`/`libvips` releases [LOW confidence — WebSearch-only, see Assumptions Log A5; verify empirically in the Dockerfile build once `sharp` is actually added, since this is exactly the kind of claim that should be confirmed by an actual `docker build` rather than trusted from search results] | Simplifies the Dockerfile — no new `apk add` line expected for logo-overlay SVG rasterization, but budget a Wave-0 smoke task to confirm this against the pinned `sharp` version in the real Alpine build |

**Deprecated/outdated:** none identified specific to this phase's stack — `qrcode`/`sharp` are both actively maintained, no announced replacement for either in the QR/image-compositing space for Node.js.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `jsqr`'s package name/API was discovered via WebSearch, not Context7 or official docs (Context7 MCP tool was unavailable this research session) | Standard Stack, Package Legitimacy Audit | Low-moderate — registry existence + `OK` legitimacy verdict + zero dependencies are independently confirmed, but the planner must still gate its install behind `checkpoint:human-verify` per the provenance rule before it becomes a locked plan dependency |
| A2 | `qrcode`'s internal `BitMatrix` accessor is `.get(row, col)` (confirmed by reading the package's own source structure/renderer conventions this session, not the sparser README) | Architecture Pattern 1, Code Example 1 | Moderate — if the installed `qrcode@1.5.4`'s exact `BitMatrix` API differs even slightly (e.g. flat-array `.data[row*size+col]` instead of a `.get()` method), Pattern 1's renderer code needs a one-line adjustment; a plan task should read `node_modules/qrcode/lib/core/bit-matrix.js` directly before writing the renderer, not just copy this snippet verbatim |
| A3 | "Cap logo coverage around 20% even under EC-level H" and the "98% scan success at ~20% obscured" figure | Common Pitfall 1 | Low — these are non-official QR vendor marketing-blog figures (WebSearch, no ISO/QR-spec citation found), used here only as a conservative internal design margin; the UI-SPEC's actual locked logo-tile dimensions (46px in a 196px preview, ~5.5% linear / <10% area) are comfortably under even a skeptical reading of this number, so the risk is low regardless |
| A4 | The exact `sharp(...).raw().toBuffer({ resolveWithObject: true })` return shape (`{ data, info: { width, height, channels } }`) used in the decode-round-trip test recipe | Code Example 2, Validation Architecture | Moderate — this is `sharp`'s documented API shape from training-data knowledge, not confirmed via a fetched official doc page this session; a Wave-0 spike/smoke test should run this exact call against a real `sharp` install before the full decode-round-trip test suite depends on it |
| A5 | `sharp`'s prebuilt binaries include SVG rasterization support out-of-the-box on `node:24-alpine` with zero extra `apk` packages | State of the Art, Common Pitfalls | Moderate — if wrong, the Dockerfile needs an added `apk add librsvg` (or equivalent) build step; low blast radius (a build-time failure, not a silent runtime bug) but should be confirmed with an actual local `sharp(svgBuffer).png().toBuffer()` smoke test early in Wave 0, before deeper implementation depends on it |
| A6 | `/q/:code` is registered host-agnostically (not scoped to a specific customer domain the way `routes/redirect.ts`'s `/:slug` is) | Architecture Pattern 3, Open Questions | Moderate — CONTEXT.md doesn't explicitly state this; if the intended design is actually "dynamic QR codes are also scoped per custom domain," the route needs an added `resolveActiveDomainByHost` check mirroring `redirect.ts`. Flagged explicitly in Open Questions below for discuss/plan-time confirmation. |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Is `/q/:code` scoped to a single operator `BASE_URL` host, or resolvable on any active custom domain too?**
   - What we know: `RESERVED_SLUGS` in `lib/links.ts` already reserves the literal `"q"` slug across every customer domain's *Link* namespace (so no Link can ever collide with `/q`), and CONTEXT.md calls `/q/:code` "its own short URL" — implying a namespace Kurzly itself owns, not one replicated per customer domain.
   - What's unclear: whether a scan of a printed QR code is expected to work when addressed to `printed-qr.example.com/q/xxxx` for EVERY active domain the operator has configured, or only via the app's own `BASE_URL` (e.g. `kurzly.example.com/q/xxxx`).
   - Recommendation: register `/q/:code` host-agnostically (matches ANY host, same as `/api/*`/`/health`) — this is the simpler, safer default (a QR printed with any of the operator's domains in the URL still resolves) and avoids a second `resolveActiveDomainByHost` dependency for a code that has no domain-scoped ownership concept in the CONTEXT.md model. Confirm with the user at plan/discuss time if a domain-scoped variant is actually intended (Assumption A6).

2. **Does the QR Studio's live-preview endpoint (`GET /api/qr-codes/:id/render.png|svg` or similar) need its own dedicated rate limit?**
   - What we know: UI-SPEC mandates a 300ms-debounced render call on every control change — a user actively tweaking color/rounding could trigger several requests per second during an editing burst.
   - What's unclear: whether the existing global 100-req/15-min default (`plugins/rateLimit.ts`) is generous enough, or whether this needs its own override the way `REDIRECT_RATE_LIMIT`/`TLS_CHECK_RATE_LIMIT` got dedicated tighter/looser buckets.
   - Recommendation: add a dedicated, generous per-route limit (e.g. 120 req/min, similar spirit to `TLS_CHECK_RATE_LIMIT`'s "hot interactive path" reasoning) rather than relying on the global default, since a debounced-but-bursty editing session is a different traffic shape than a one-off form submit.

3. **Where does an uploaded custom logo image get stored (filesystem vs. DB blob vs. object storage), given this is a single-container self-hosted deployment?**
   - What we know: `.claude/CLAUDE.md`'s stack notes mention `@fastify/static` could serve "QR logo uploads if stored on local disk instead of object storage" as one option; the project has no S3/object-storage dependency anywhere else.
   - What's unclear: whether a logo should be persisted as a DB `bytea`/base64 column on `QrCode` (simplest, survives container restarts via the same Postgres volume every other durable state uses, but bloats query payloads) vs. a local-disk upload directory (needs its own persistent Docker volume + `INFRA-03`-style survive-restart guarantee, currently only Postgres has this).
   - Recommendation: store the logo as a binary column on `QrCode` (e.g. `logoData Bytes?`, `logoMimeType String?`) — reuses the EXISTING Postgres persistent-volume guarantee (`INFRA-03`) with zero new infrastructure, at the cost of slightly heavier `QrCode` rows; a 2MB max-upload cap (already locked in the UI-SPEC) bounds this cost. Confirm this is acceptable at plan time — it is Claude's discretion per CONTEXT.md ("exact QrCode schema field names... at Claude's discretion").

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `qrcode`/`sharp`/`jsqr` runtime | ✓ | v24 (project `.nvmrc`/Dockerfile pin) | — |
| `sharp` prebuilt `libvips` binary for the CI/dev host's platform | PNG rasterization, logo compositing, decode-round-trip tests | Not yet installed — no blocking risk, `sharp` publishes prebuilt binaries for all mainstream platforms (linux-x64/arm64 glibc+musl, macOS, Windows) | 0.35.3 (to be installed this phase) | If a future exotic CI runner architecture lacks a prebuilt binary, `sharp` falls back to a from-source build requiring `python3`/`make`/`g++` — not expected to be needed here |
| PostgreSQL (testcontainers) | `QrCode`/`QrRemapHistory` integration tests | ✓ (already the project's established test harness, `postgres:18-alpine` via `@testcontainers/postgresql`) | 18-alpine | — |
| pnpm workspace install | new `qrcode`/`sharp`/`jsqr`/`@types/qrcode` packages | ✓ (`pnpm --filter @kurzly/api add ...` — same mechanism every prior phase used) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none beyond the noted `sharp` from-source fallback above (not expected to trigger on this project's stated CI/Docker targets).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.10 (already configured, `apps/api/vitest.config.ts` implied by existing `test/` suite) |
| Config file | `apps/api/package.json`'s `test` script (`vitest run`) — no separate `vitest.config.ts` observed; mirrors existing phases' convention |
| Quick run command | `pnpm --filter @kurzly/api test -- test/qrRender.test.ts` (per-file, once created) |
| Full suite command | `pnpm --filter @kurzly/api test` (real-Postgres testcontainers suite, same as every prior phase) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QR-01 | Static QR create (PNG+SVG export) decodes back to the Link's target URL | integration (decode-round-trip, no logo) | `vitest run test/qrRender.test.ts` | ❌ Wave 0 |
| QR-02 | Dynamic QR create with its own `/q/:code`, GET resolves via redirect | integration (`app.inject`, mirrors `redirect.integration.test.ts`) | `vitest run test/qrRedirect.integration.test.ts` | ❌ Wave 0 |
| QR-03 | Remap changes target; OLD `/q/:code` still resolves (now to the NEW target) | integration, negative test (Code Example 3) | `vitest run test/qrRedirect.integration.test.ts` | ❌ Wave 0 (same file as QR-02) |
| QR-04 | Remap history rows created + retrievable oldest→newest / newest-first per UI copy | integration | `vitest run test/qrCodes.integration.test.ts` | ❌ Wave 0 |
| QR-05 | PNG+SVG export WITH a logo still decodes correctly; EC-level forced to H when logo present | integration (decode-round-trip WITH logo — the hard blocking test, Code Example 2) | `vitest run test/qrRender.test.ts` | ❌ Wave 0 |
| QR-06 | Color + rounded-module toggle change the rendered SVG/PNG (module fill color, `rx`/`ry` presence) | unit (assert on the SVG string / raw pixel sampling, no DB needed) | `vitest run test/qrRender.test.ts` | ❌ Wave 0 |
| QR-07 | Scan count increments on `/q/:code` GET, visible via existing analytics DTO shape | integration, reuses Phase-6 `source='qr'` seam | `vitest run test/qrRedirect.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @kurzly/api test -- <changed-test-file>`
- **Per wave merge:** `pnpm --filter @kurzly/api test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/test/qrRender.test.ts` — covers QR-01/QR-05/QR-06 (module-matrix renderer + decode-round-trip, PNG and SVG, with and without logo)
- [ ] `apps/api/test/qrCodes.integration.test.ts` — covers QR-04 (single-write-path create/update/remap + remap history), mirrors `links.integration.test.ts`'s fixture-building conventions (`createTestUser`/`seedOwnedDomain` helpers already exist in `test/redirect.integration.test.ts` and can be imported/reused, not re-invented)
- [ ] `apps/api/test/qrRedirect.integration.test.ts` — covers QR-02/QR-03/QR-07 (`/q/:code` resolution, remap-preserves-code negative test, scan recording)
- [ ] Fixture logo files (a small valid PNG + valid SVG, and one deliberately-invalid file for the upload-rejection test) — need to be added under `apps/api/test/fixtures/` (existing `fixtures/` dir already present)
- [ ] Framework install: `pnpm --filter @kurzly/api add qrcode sharp && pnpm --filter @kurzly/api add -D jsqr @types/qrcode` — before any of the above tests can run

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuses the existing better-auth session cookie check on every authenticated `/api/qr-codes*` route — no new auth mechanism |
| V3 Session Management | yes (indirectly) | No new session state introduced; `/q/:code` itself is intentionally public/unauthenticated (mirrors `/:slug`) |
| V4 Access Control | yes | `requireDomainAccess` reused verbatim (Pattern 2) for both the QR's own domain AND, on remap, the new target Link's domain — prevents cross-domain QR/Link mixing (IDOR) |
| V5 Input Validation | yes | Zod allowlist schema for QR create/update requests (mirrors `routes/links.ts`'s `createLinkSchema`/`updateLinkSchema` mass-assignment guard); explicit MIME/byte-sniffing validation for uploaded logo files (Common Pitfall 5) before any renderer touches the bytes |
| V6 Cryptography | no | No new cryptographic primitive introduced this phase (the `/q/:code` alphabet reuses the existing `BASE62`/`nanoid` generator, not a new randomness source) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Mass-assignment on QR create/update (client sets `lifetimeScans`, `code`, or `domainId` directly) | Tampering | Zod allowlist schema in `routes/qrCodes.ts`, mirrors `createLinkSchema`'s pattern exactly — only ever read allowlisted fields off `parsed.data`, never `request.body` |
| Cross-domain QR/Link IDOR (remap a QR to point at a Link in a domain the caller cannot access) | Elevation of Privilege | `requireDomainAccess` checked against BOTH the QR's domain and the new target Link's domain on every remap (Pattern 2's `remapQrCode`) |
| Malicious/malformed uploaded SVG logo (XXE-adjacent external-entity/resource-fetch attempts inside SVG markup) | Tampering / Information Disclosure | Rasterize any uploaded SVG logo to PNG immediately on upload via `sharp`, never re-parse the original SVG markup at subsequent render time (Common Pitfall 5) |
| `/q/:code` scan bypassing the target Link's password/expiry gate (a printed QR outliving its target's intended access window) | Elevation of Privilege / Tampering | Reuse `lib/redirectEngine.ts`'s `resolveLinkState` inside the `/q/:code` handler — never a direct unconditional 302 (Common Pitfall 4) |
| QR-code payload itself used as an open-redirect/SSRF vector (a QR encoding an attacker-controlled arbitrary URL) | Spoofing | Not a new risk this phase introduces — the QR payload is always `Link.targetUrl`, which already passed `validateTargetUrl`'s http(s)-only scheme allowlist (`lib/links.ts`) at Link-creation time; the QR generator never encodes a client-supplied raw URL directly |
| Abuse of the QR Studio's debounced render endpoint (repeated re-renders as a resource-exhaustion vector, since `sharp`/SVG-matrix rendering is more CPU-costly than a typical JSON endpoint) | Denial of Service | Dedicated per-route rate limit (Open Question 2) rather than relying on the global 100-req/15-min default alone |

## Sources

### Primary (HIGH confidence)
- None — Context7 MCP tooling was unavailable in this research session (see Assumptions Log A1); no source in this research reaches the HIGH/context7-plus-package-legitimacy-OK bar the provenance rule requires.

### Secondary (MEDIUM confidence)
- `unpkg.com/qrcode@1.5.4/lib/server.js` (direct package source read) — confirms `toBuffer`/`toString`/`create` exports and PNG-default behavior
- `sharp.pixelplumbing.com/api-composite/` (official sharp docs, fetched via WebFetch) — `composite()` signature, `gravity:'centre'` behavior
- `npm view qrcode/sharp/jsqr/@types-qrcode version|scripts|dependencies|engines` (live npm registry queries, this session) — version pins, dependency graphs, absence of postinstall scripts
- `gsd-tools query package-legitimacy check` (this session) — verdicts for all four packages

### Tertiary (LOW confidence)
- WebSearch synthesis on: `sharp` Alpine/musl prebuilt-binary behavior, QR logo-size/EC-level-H scan-rate guidance, rounded-QR-module rendering approaches (`qrcode-svg`/`qrGrid` prior art) — none of these three topics have an authoritative single-source doc; flagged in the Assumptions Log for re-verification at implementation/plan time (A3, A5)

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — `qrcode`/`sharp` versions and core APIs confirmed via direct source read + official docs + live registry query; `jsqr` is registry-confirmed but package-name-provenance is WebSearch-only (tagged ASSUMED)
- Architecture: MEDIUM-HIGH — every pattern is a direct mirror of an already-implemented, already-tested pattern in this exact codebase (`lib/links.ts`, `routes/redirect.ts`); the one genuinely novel piece (module-matrix SVG renderer) is grounded in the `qrcode` package's own source structure, not speculation
- Pitfalls: MEDIUM — pitfalls 2/3/4/5 are derived directly from this codebase's existing conventions and the `qrcode` package's confirmed source behavior (HIGH-confidence reasoning); pitfall 1's specific percentage figures are LOW-confidence WebSearch synthesis (flagged, A3)

**Research date:** 2026-07-20
**Valid until:** 2026-08-19 (30 days — stable, mature libraries; re-check `sharp`'s version pin specifically before implementation given its frequent point-release cadence)
