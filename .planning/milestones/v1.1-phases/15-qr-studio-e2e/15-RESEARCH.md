# Phase 15: QR Studio E2E - Research

**Researched:** 2026-07-25
**Domain:** Playwright E2E for static/dynamic QR generation, customization, remapping, and PNG/SVG export against a Fastify + Prisma + `qrcode`/`sharp` backend and a Vue 3 Studio UI
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **QR generation stack** per project CLAUDE.md: `qrcode` (node-qrcode) for QR matrix/PNG/SVG generation with `errorCorrectionLevel: 'H'` when a logo overlay is requested, `sharp` for raster logo compositing, manual SVG string `<image>` injection for the SVG logo path. Confirm the ACTUAL implementation in apps/api during phase research — do not assume the CLAUDE.md's stack recommendation was followed exactly; verify against real source.
- **Decode round-trip** for QR-E2E-01 needs a real QR-decoding library in the E2E harness (not part of the app itself) — research must identify and, if needed, add a QR-decode npm package (e.g. `jsqr` or similar) as an `apps/e2e` devDependency, or determine whether Playwright/a headless approach can decode the rendered image content some other way.
- **Static vs. dynamic QR distinction**: static QR encodes the target URL directly; dynamic QR encodes a stable `/q/:code` redirect URL that can be remapped without regenerating the QR image itself — confirm the actual DB schema/route naming for this (QrCode model, remap history table) during research, do not assume field names.
- **Reuses Phase 14's link fixture pattern**: a Link (or equivalent target) must exist for a QR code to be generated against — direct-Prisma link fixture creation via `apps/e2e/src/links.ts`'s `createE2eLink` is the established pattern to reuse here for setup, with real-UI QR generation being this phase's own subject (mirroring Phase 14's "the feature under test IS the UI flow" principle).

### Claude's Discretion

- Exact npm package for QR decode verification in the E2E harness — planner/researcher's call once the real QR image format (PNG buffer vs. SVG string vs. data URL) is confirmed.
- Whether QR customization (color/rounding/logo) is asserted via decode-round-trip alone, or whether the customization itself needs a secondary visual/structural assertion (e.g. confirming a logo was actually composited) — read the actual Studio UI/backend during research to judge what's practically assertable in an E2E context vs. what belongs to existing v1.0 unit/integration tests.
- Spec file layout under `apps/e2e/tests/authed/` (same testMatch constraint discovered in Phase 14 research — confirm this still applies, and whether QR specs need chromium-admin only or also chromium-member).

### Deferred Ideas (OUT OF SCOPE)

- Analytics/click-tracking on QR-code-driven redirects — Phase 16's job.
- Team/domain-scoped authorization on QR CRUD — Phase 17's job.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QR-E2E-01 | Static QR generation incl. customization (color/rounding/logo) with decode-roundtrip to the target URL | Confirmed exact rendering pipeline (`lib/qr.ts`), the exact encoded payload (`resolveQrPayload` — the QR's OWN short URL, `https://{hostname}/{slug}?qr={id}`, NEVER the raw destination), and the exact decode recipe already proven in this codebase's own `apps/api/test/qrDecode.test.ts` (`sharp().ensureAlpha().raw()` + `jsQR`). See Summary point 1 and Code Examples. |
| QR-E2E-02 | Dynamic `/q/:code` remapping — resolves to target A, then to target B after a Studio remap, remap history recorded | Confirmed `remapQrCode` (lib/qrCodes.ts) batches the `QrCode.linkId` update + `QrRemapHistory` insert in one `$transaction`; confirmed `/q/:code` is host-agnostic (no `resolveActiveDomainByHost` call) so no host-header spike is needed unlike Phase 12's `/:slug`; confirmed the exact UI remap control (`.target-select` dropdown, `QrCodesView.vue`). See Architecture Patterns and Code Examples. |
| QR-E2E-03 | PNG and SVG export each produce a valid, downloadable file | Confirmed exact export mechanism (`QrStudioPanel.vue`'s `exportFile`, fetching `render.png`/`render.svg` as a Blob and triggering a `<a download>` click) and confirmed both formats independently decode via the same jsQR recipe — the strongest available "valid file" proof. See Common Pitfalls and Code Examples. |
</phase_requirements>

## Summary

This phase adds real-browser E2E coverage for Kurzly's QR Studio (`apps/web/src/views/QrCodesView.vue` + `apps/web/src/components/QrStudioPanel.vue`, entry point also from `apps/web/src/views/LinkDetailView.vue`) against the actual Fastify routes (`apps/api/src/routes/qrCodes.ts`, `apps/api/src/routes/qrRedirect.ts`) and their Prisma-backed cores (`apps/api/src/lib/qrCodes.ts`, `apps/api/src/lib/qr.ts`). Every claim below was verified by reading the real source this session — nothing here is inherited unverified from CONTEXT.md's open questions.

**Two of CONTEXT.md's framings resolve differently than their phrasing implied, and both are important for the planner:**

1. **A QR never encodes the raw destination URL — it always encodes Kurzly's OWN short URL.** `resolveQrPayload` (`routes/qrCodes.ts`) makes a `static` QR encode `https://{domain.hostname}/{slug}?qr={id}` (the bound Link's own short URL, with a `?qr=` scan-attribution marker) and a `dynamic` QR encode `${BASE_URL}/q/{code}`. Neither ever encodes `Link.targetUrl` directly — this is a deliberate architectural guarantee (QR-01/QR-03's whole point: printed codes must survive a later edit of the destination, and every scan must be a real, trackable Kurzly request). **QR-E2E-01's "decodes back to its target URL" must therefore be read as: decode the QR → get back the exact short-URL string Kurzly constructed → optionally follow that short URL with a real HTTP request and confirm IT resolves (302) to the Link's real `targetUrl`.** A test that expects the decoded payload to literally equal `Link.targetUrl` will fail — that is not a bug, it is the documented design (`routes/qrCodes.ts`'s `resolveQrPayload` doc comment is explicit about why). This is the single most important correction this research makes to CONTEXT.md's phrasing.
2. **The decode round-trip is not merely feasible — it is already a proven, working pattern in this exact codebase.** `apps/api/test/qrDecode.test.ts` (a Vitest unit suite, already passing in CI) does the EXACT decode CONTEXT.md asked this research to investigate: `sharp(imageBuffer).ensureAlpha().raw().toBuffer({resolveWithObject: true})` → `jsQR(new Uint8ClampedArray(data), info.width, info.height)` → `result.data` is the decoded string. Both `jsqr@^1.4.0` and `sharp@^0.35.3` are ALREADY approved, already-in-the-lockfile dependencies of `@kurzly/api` (devDependency and dependency respectively) — this phase only needs to add both as `apps/e2e` devDependencies (they are not currently there) and reuse the identical recipe against real HTTP-fetched bytes instead of in-process buffers. There is no genuine feasibility risk here.

**Primary recommendation:** Reuse `apps/api/test/qrDecode.test.ts`'s exact `sharp` + `jsQR` decode recipe inside `apps/e2e`, fetching the QR's PNG/SVG bytes via `page.request.get()` (which carries the `chromium-admin` project's `storageState` session cookie, per Phase 11's confirmed pattern) against the real `render.png`/`render.svg` endpoints — never a client-side redraw. Drive static-QR creation through the real UI (`LinkDetailView.vue`'s "QR-Code" button, per QR-E2E-01's "own subject is the Studio flow" framing) and drive customization through the real `QrStudioPanel.vue` controls (color swatch buttons, rounded toggle, logo file input). For QR-E2E-02, seed the dynamic QR's INITIAL binding via a new direct-Prisma fixture helper (`apps/e2e/src/qr.ts`, mirroring Phase 14's `createE2eLink`/CSV-conflict precedent: creation itself is not this test's subject, only the remap is) so the test controls exactly which two Links are "target A" and "target B", then drive the remap itself through the real `.target-select` dropdown.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| QR module-matrix rendering (color/rounding/logo compositing) | API / Backend | — | `lib/qr.ts`'s `renderQrPng`/`renderQrSvg` are the SOLE renderers; the Vue Studio panel never redraws QR modules itself, only requests a fresh server render (`refreshPreview`) — a deliberate single-code-path lock documented in `QrStudioPanel.vue`'s own header comment. |
| QR style/remap persistence | API / Backend | Database / Storage | `lib/qrCodes.ts`'s `createQrCode`/`updateQrCode`/`remapQrCode` are the ONLY `prisma.qrCode.create`/`update` call sites in the codebase (D-01-equivalent single-write-path enforcement) — the Vue layer only ever calls `api.ts`'s thin fetch wrappers. |
| Remap-history recording | Database / Storage | API / Backend | `remapQrCode` batches the `QrCode.linkId` update + a `QrRemapHistory` insert in one `prisma.$transaction` — the history can structurally never drift from the current target. |
| Dynamic QR redirect resolution (`GET /q/:code`) | API / Backend | — | `routes/qrRedirect.ts` reads the CURRENT target Link fresh on every request (`prisma.link.findUnique`, never cached) — a remap takes effect on the very next scan while the printed `/q/:code` URL itself never changes. Host-agnostic (no domain-scoping check), unlike `/:slug`. |
| QR customization UI (color/rounding/logo/name) | Browser / Client | API / Backend | `QrStudioPanel.vue` collects input and PATCHes immediately per control change (300ms-debounced re-render only, not debounced persistence) — every validation rule (hex color format, logo magic-byte sniffing) is enforced server-side; the client never re-implements it. |
| PNG/SVG export | Browser / Client | API / Backend | `QrStudioPanel.vue`'s `exportFile` fetches the server-rendered bytes as a `Blob` and triggers a `<a download>` click client-side — the actual PNG/SVG bytes are 100% server-rendered, the client only handles the browser download mechanics. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `@playwright/test` | `1.61.1` (already pinned, `apps/e2e/package.json`) [VERIFIED: apps/e2e/package.json, direct read] | E2E test runner | Already the project's sole E2E framework (Phases 11-14); no new library needed for the test-runner layer of this phase. |
| `jsqr` | `^1.4.0` [VERIFIED: apps/api/package.json devDependencies, already in `pnpm-lock.yaml`; npm registry `dist-tags.latest = "1.4.0"`, published 2021-04-24, ~1.8M weekly downloads, repo `github.com/cozmo/jsQR`] | QR image → payload string decoder (pure JS, works on raw RGBA pixel arrays) | ALREADY an approved, in-use dependency of this exact monorepo (`apps/api/test/qrDecode.test.ts`) — proven to correctly decode this project's own PNG/SVG QR renders, including with a composited logo. Not a new, unvetted choice. |
| `sharp` | `^0.35.3` [VERIFIED: apps/api/package.json dependencies, already in `pnpm-lock.yaml`] | Rasterizes fetched PNG bytes to raw RGBA pixels for `jsQR` (PNG needs no rasterization step itself, but `.raw()` extraction is still required to get the pixel array `jsQR` expects); rasterizes SVG bytes to PNG first for the SVG export path | ALREADY an approved, in-use dependency of `@kurzly/api` (Phase 7) — the exact same library the SERVER uses to composite logos. Reusing it in `apps/e2e` for decode-only purposes (never writing files, never compositing) is a read-only, low-risk reuse of an already-audited binary-shipping package. |

**Both packages need to be added as new `apps/e2e` devDependencies** — they are currently only present in `apps/api`'s dependency tree, and `apps/e2e`'s `package.json` has no `exports`-based path to reach into `apps/api`'s `node_modules` for them (the workspace dependency only exposes `.`/`./prisma-client`, per `apps/api/package.json`'s `exports` map). This is a normal, low-risk devDependency addition, not a new-to-the-ecosystem risk.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@kurzly/api/prisma-client` (workspace subpath export, already an `apps/e2e` dependency) | n/a (workspace) | Direct-Prisma QR-code/remap-history assertions (QR-E2E-02's "remap history recorded" requirement) and the new `apps/e2e/src/qr.ts` fixture helper | Reuse `apps/e2e/src/db.ts`'s existing `createE2ePrisma()` — do not add a second DB client. `db.ts`'s `withResetDbLock` truncate list ALREADY includes `QrRemapHistory` and `QrCode` (verified this session — no `db.ts` changes needed). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `jsqr` (pure-JS decoder, needs raw pixels) | A native/WASM decoder (e.g. `@zxing/library`, `quirc`-based bindings) | `jsqr` is already the exact library this codebase's own unit tests use and trust against this exact renderer's output (including logo-composited symbols) — introducing a second, different decoder into `apps/e2e` would mean two potentially-divergent decode implementations proving the "same" guarantee, with no upside. Zero reason to deviate. |
| Fetching render bytes via `page.request.get()` | A raw `fetch()` inside `page.evaluate()`, or Node's own `fetch` with manually-forwarded cookies | `page.request` shares the SAME `BrowserContext` cookie jar as `page` (confirmed pattern already used/documented in Phase 12's STATE.md notes on `page.request`), so it automatically carries the `chromium-admin` project's `storageState` session cookie with zero manual cookie plumbing — the render endpoints require an authenticated session (`resolveUserId`/401 gate), so this is the only low-friction option. |
| Direct-Prisma `apps/e2e/src/qr.ts` fixture for QR-E2E-02's initial dynamic-QR binding | Driving "+ Dynamischer QR" through the real UI to create it, then remapping | The real UI's create button always binds to `links.value[0]` (whatever `GET /api/links` returns first) — not deterministic enough to reliably set up "starts bound to Link A" without also controlling link list ordering. A direct-Prisma fixture (mirroring Phase 14's Pattern 2: "the CSV-conflict spec MAY use `createE2eLink` since CSV-conflict's own subject is the import flow, not link creation") keeps QR-E2E-02 focused on proving the REMAP, which is genuinely this test's subject — while QR-E2E-01 still proves fresh, real-UI-driven QR *creation* on its own. |

**Installation:**
```bash
pnpm --filter @kurzly/e2e add -D jsqr@^1.4.0 sharp@^0.35.3
```

**Version verification:** `jsqr@1.4.0` and `sharp@0.35.3` (or whatever patch `apps/api`'s own `^0.35.3` range currently resolves to in the shared lockfile) are already resolved in this monorepo's single `pnpm-lock.yaml` — installing them into `apps/e2e` adds a new consumer of an existing lockfile entry, not a new version resolution. No registry lookup needed beyond the confirmation already run this session (`npm view jsqr dist-tags`, `gsd-tools package-legitimacy check`).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `jsqr` | npm | published 2021-04-24 (latest `1.4.0`), package created 2015 | ~1.8M/week | `github.com/cozmo/jsQR` | **OK** [VERIFIED: `gsd-tools query package-legitimacy check`, this session] | Approved — already an in-use `apps/api` devDependency, reused verbatim. |
| `sharp` | npm | latest version published 2026-07-01 | ~76.1M/week | `github.com/lovell/sharp` | **SUS** ("too-new" heuristic flag) [VERIFIED: `gsd-tools query package-legitimacy check`, this session] | **Flagged by the automated heuristic only** — `sharp` is a 10+-year-old, ~76M-weekly-download package already an APPROVED, in-production dependency of `@kurzly/api` since Phase 7 (07-RESEARCH.md's own legitimacy audit). The "too-new" signal fires because `sharp` ships frequent patch releases (normal for a package wrapping native `libvips` bindings, not a legitimacy risk) — this is a false-positive from the freshness heuristic, not a genuine new-package risk. Per protocol this is still recorded as `[SUS]`; the planner should add a lightweight `checkpoint:human-verify` before the `apps/e2e` devDependency install step, but no alternate package should be substituted — `sharp` is the correct, established choice and is already trusted elsewhere in this exact codebase. |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `sharp` (see disposition above — recommend a `checkpoint:human-verify` acknowledging the false-positive before the `pnpm add -D sharp` step, not a substitution).

## Architecture Patterns

### System Architecture Diagram

```
Playwright test (chromium-admin project, storageState-authenticated)
        │
        │ 1. QR-E2E-01: page.goto(/links/{id}) — Link created via createE2eLink fixture
        v
LinkDetailView.vue — click "QR-Code" button (handleQrCode)
        │
        │ 2. createQrCode({variant:"static", linkId, name}) ── POST /api/qr-codes ──► routes/qrCodes.ts
        │                                                                                   │
        │                                                                                   v
        │                                                                       lib/qrCodes.ts createQrCode()
        │                                                                         -> resolveLinkDomainAccess()
        │                                                                         -> prisma.qrCode.create()  (SOLE insert site)
        │
        │ 3. router.push({name:"qr-codes", query:{selected: created.id}})
        v
QrCodesView.vue ── GET /api/qr-codes, GET /api/links ──► loads list, resolves selection
        │
        │ 4. QrStudioPanel.vue renders (selected static QR)
        │    - click color swatch -> PATCH /api/qr-codes/:id {color}
        │    - toggle "Runde Module" -> PATCH {roundedModules:true}
        │    - upload logo file -> PATCH {logoData, logoEnabled:true}
        v
lib/qrCodes.ts updateQrCode() -> resolveLinkDomainAccess() -> prisma.qrCode.update()  (style fields only)
        │
        │ 5. Test fetches real bytes: page.request.get('/api/qr-codes/:id/render.png')
        v
routes/qrCodes.ts GET .../render.png -> resolveOwnedQrCode() -> lib/qr.ts renderQrPng(resolveQrPayload(qr), resolveRenderStyle(qr))
        │                                                          │
        │                                                          v
        │                                            payload = "https://{domain.hostname}/{slug}?qr={id}"
        │                                                   (NEVER Link.targetUrl — QR-01/03 guarantee)
        v
Test decodes PNG bytes: sharp(bytes).ensureAlpha().raw() -> jsQR(pixels, w, h) -> decoded string
        │
        │ 6. Assert decoded string === expected short-URL string
        │    (optionally: follow it with a real HTTP request, assert 302 -> Link.targetUrl)
        v
DONE (QR-E2E-01)


Dynamic QR remap flow (QR-E2E-02):

Test setup: createE2eLink(targetA), createE2eLink(targetB), createE2eQrCode(dynamic, linkId=targetA.id)  -- direct Prisma, apps/e2e/src/qr.ts (NEW)
        │
        │ 1. Real HTTP: GET {BASE_URL}/q/{code}, maxRedirects:0
        v
routes/qrRedirect.ts -> prisma.qrCode.findUnique({code}) -> prisma.link.findUnique(qrCode.linkId)
        │                                                          │
        │                                              resolveLinkState() -> "ok" -> 302 redirect(targetA.targetUrl)
        │
        │ 2. Assert 302 Location === targetA.targetUrl   [state BEFORE remap]
        v
Test drives the real UI: page.goto(/qr-codes?selected={qrId}) -> QrCodesView.vue's `.target-select` dropdown
        │
        │ 3. select targetB -> handleRemapChange() -> remapQrCode(qr.id, targetB.id)
        │                                    PATCH /api/qr-codes/:id {targetLinkId: targetB.id}
        v
lib/qrCodes.ts remapQrCode() -> checks BOTH old+new Link domain access -> prisma.$transaction([
    qrCode.update({linkId: targetB.id}),
    qrRemapHistory.create({qrCodeId, fromLinkId: targetA.id, toLinkId: targetB.id}),
  ])
        │
        │ 4. Real HTTP AGAIN: GET {BASE_URL}/q/{code}, maxRedirects:0
        v
Assert 302 Location === targetB.targetUrl   [state AFTER remap — SAME printed URL, NEW destination]
        │
        │ 5. Direct-Prisma assertion: prisma.qrRemapHistory.findMany({where:{qrCodeId}, orderBy:{createdAt:"asc"}})
        v
Assert exactly 1 row: {fromLinkId: targetA.id, toLinkId: targetB.id}
```

**Reading this diagram for the primary use case (QR-E2E-01):** a Link fixture is seeded directly via Prisma (setup only, not the subject under test), then every subsequent step — QR creation, customization, and the final decode assertion — exercises the REAL UI and REAL server rendering pipeline, exactly mirroring Phase 14's "fixture for setup, real UI for the feature under test" principle. The crux fact this diagram makes explicit: the decoded string is the QR's OWN short URL, never the raw destination — any assertion comparing the decoded payload to `Link.targetUrl` directly is structurally wrong.

### Recommended Project Structure

```
apps/e2e/
├── src/
│   └── qr.ts                      # NEW — createE2eQrCode(prisma, opts) direct-Prisma fixture,
│                                   #   mirrors links.ts's createE2eLink shape; generates a random
│                                   #   Base62 `code` for dynamic variant (no collision-retry needed
│                                   #   at E2E's tiny scale — a fixed-length crypto-random string is
│                                   #   sufficient, unlike the app's own resolveDynamicCode retry loop)
└── tests/authed/
    ├── qr-static-customize-decode.spec.ts   # QR-E2E-01
    ├── qr-dynamic-remap.spec.ts             # QR-E2E-02
    └── qr-export-formats.spec.ts            # QR-E2E-03
```
Flat layout under `tests/authed/`, matching the established convention confirmed again this session (`links-crud.spec.ts`, `csv-import-happy.spec.ts`, `csv-import-conflict.spec.ts`, `storage-state.spec.ts` — no subdirectories). No static fixture files needed for logos: Phase 14 already established the "build fixtures programmatically in a `src/` helper or inline in the spec, not static binary/text files" convention (`csv.ts`'s `buildImportCsv` — no `fixtures/*.csv` files were actually created despite 14-RESEARCH.md initially suggesting them). This phase's logo fixture should follow the same convention: generate a small solid-color PNG in-memory via `sharp({create:{...}}).png().toBuffer()` at test time, fed directly into `setInputFiles({buffer: ...})` — no binary asset committed to the repo.

### Structure Rationale — confirming CONTEXT.md's discretion note

`playwright.config.ts`'s `testMatch: /authed\/.*\.spec\.ts$/` on both `chromium-admin` and `chromium-member` is unchanged since Phase 14's research — QR specs MUST live under `tests/authed/`, confirmed again by direct read this session. **chromium-admin only is sufficient for this phase**: nothing in QR-E2E-01/02/03 exercises role-differentiated behavior (that is explicitly Phase 17's job, per REQUIREMENTS.md's Out-of-Scope table and CONTEXT.md's Deferred Ideas) — running these specs under `chromium-member` too would be pure duplication with no additional proof value, since the seeded Member has full "member" role access to the one baseline Domain these fixtures use.

### Pattern 1: The decode recipe is a direct port of `apps/api/test/qrDecode.test.ts` — do not invent a new one

**What:** `apps/api/test/qrDecode.test.ts`'s `decode()` helper (in-process buffers) ports directly to E2E with only the byte-source changed (real HTTP fetch instead of an in-process function call).

**Verified against actual source, this session** (`apps/api/test/qrDecode.test.ts` lines 86-90):
```typescript
async function decode(imageBuffer: Buffer): Promise<string | null> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}
```

**E2E adaptation** (new, `apps/e2e/src/qr.ts` or inline in the spec):
```typescript
// Source: apps/api/test/qrDecode.test.ts's decode() helper, ported verbatim —
// only the byte SOURCE changes (real HTTP fetch vs. an in-process render call).
import sharp from "sharp";
import jsQR from "jsqr";

export async function decodeQrImage(bytes: Buffer): Promise<string | null> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}
```

**When to use:** Every decode assertion in QR-E2E-01 and QR-E2E-03 (both PNG bytes directly, and SVG bytes rasterized via `sharp(svgBytes).png().toBuffer()` first, exactly mirroring the unit test's own SVG-decode case).

### Pattern 2: Fetching authenticated render bytes via `page.request`

**What:** `page.request` (NOT the standalone `request` fixture) shares the SAME `BrowserContext` cookie jar as `page` — since `chromium-admin`'s project config loads `storageState` into that context, `page.request.get(...)` automatically carries the session cookie the render endpoints require (`resolveUserId`/401 gate in `routes/qrCodes.ts`).

**Example:**
```typescript
// Source: apps/api/src/routes/qrCodes.ts (render.png/render.svg handlers, 401-gated), read this session
const response = await page.request.get(`/api/qr-codes/${qrId}/render.png`);
expect(response.status()).toBe(200);
expect(response.headers()["content-type"]).toBe("image/png");
const bytes = Buffer.from(await response.body());
const decoded = await decodeQrImage(bytes);
expect(decoded).toBe(`https://${BASELINE_DOMAIN_HOSTNAME}/${slug}?qr=${qrId}`);
```

### Pattern 3: Dynamic QR fixture creation — direct Prisma, mirrors `createE2eLink`'s shape

**What:** For QR-E2E-02, a new `apps/e2e/src/qr.ts` exports `createE2eQrCode`, a raw-insert helper for a `dynamic` QrCode bound to a given `linkId`, generating a collision-free-enough random `code` (E2E's scale never needs the app's own retry-loop robustness).

**Example:**
```typescript
// Source: apps/api/prisma/schema.prisma's QrCode model + apps/e2e/src/links.ts's
// createE2eLink shape (mirrored, this session)
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@kurzly/api/prisma-client";

type E2ePrismaLike = PrismaClient | Prisma.TransactionClient;

/** Matches routes/qrRedirect.ts's QR_CODE_PARAM shape gate (/^[0-9A-Za-z]{1,32}$/). */
function randomQrCode(): string {
  return randomBytes(8).toString("hex"); // 16 hex chars — well within the 1-32 char gate
}

export type CreateE2eQrCodeOptions = {
  variant: "static" | "dynamic";
  linkId: string;
  name: string;
  color?: string;
  roundedModules?: boolean;
};

export async function createE2eQrCode(prisma: E2ePrismaLike, opts: CreateE2eQrCodeOptions) {
  return prisma.qrCode.create({
    data: {
      variant: opts.variant,
      linkId: opts.linkId,
      code: opts.variant === "dynamic" ? randomQrCode() : null,
      name: opts.name,
      color: opts.color ?? "#000000",
      roundedModules: opts.roundedModules ?? false,
    },
  });
}
```

**When to use:** QR-E2E-02 only — sets up the "starts bound to target A" precondition without depending on `GET /api/links`' non-deterministic-for-testing ordering. QR-E2E-01 and QR-E2E-03 should create their QR through the real UI (their own subject).

### Anti-Patterns to Avoid

- **Asserting the decoded QR payload equals `Link.targetUrl`:** confirmed false by design (see Summary point 1) — always assert against the constructed short-URL string (`https://{hostname}/{slug}?qr={id}` for static, `${BASE_URL}/q/{code}` for dynamic).
- **Redrawing/parsing QR modules client-side to "verify" customization:** the Vue layer deliberately never redraws QR modules itself (single-code-path lock, `QrStudioPanel.vue`'s own header comment) — a test that tries to inspect rendered pixels in the DOM instead of fetching the real server-rendered bytes would be testing a code path the app doesn't have.
- **Using the host-header spike pattern for `/q/:code`:** confirmed unnecessary — `qrRedirectRoute` deliberately never calls `resolveActiveDomainByHost` (it's host-agnostic by design, `code` is a flat globally-unique namespace), so a plain request against `PLAYWRIGHT_BASE_URL` resolves correctly with no `Host` header gymnastics, unlike Phase 12's `/:slug` handler.
- **Testing an "overwrite" or "combined remap+style" PATCH:** confirmed not to exist — `routes/qrCodes.ts`'s PATCH handler routes the ENTIRE request through EITHER `remapQrCode` (if `targetLinkId` present) OR `updateQrCode` (otherwise), never both; `api.ts`'s `remapQrCode()` client function only ever sends `{targetLinkId}` alone.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| QR payload decoding | A custom QR-matrix reader, or scraping the SVG's `<rect>` elements to reconstruct the encoded string | `jsqr` + `sharp` (see Pattern 1) | This exact recipe is already proven correct against this exact renderer's output in `apps/api/test/qrDecode.test.ts`, including the logo-composited case — reinventing it in `apps/e2e` risks a subtly different (and unproven) decode path. |
| Dynamic-QR fixture `code` generation | Reusing `lib/links.ts`'s exported `generateSlug`/`AUTO_SLUG_RETRY_LIMIT` (as `apps/api`'s own `resolveDynamicCode` does) | A simple `randomBytes(8).toString("hex")` in the new `apps/e2e/src/qr.ts` | `generateSlug` is NOT exported from `@kurzly/api`'s `exports` map (only `.`/`./prisma-client` are, confirmed this session) and is therefore structurally unreachable from `apps/e2e`, exactly like `createLink`/`updateLink` were found unreachable in Phase 12's research (12-RESEARCH.md Q2). A plain random hex string easily satisfies the `QR_CODE_PARAM` shape gate and E2E's tiny scale needs no collision-retry loop. |
| Waiting for the Studio's 300ms debounced preview re-render | `page.waitForTimeout(300)` | `page.waitForResponse()` scoped to the specific `GET /api/qr-codes/:id/render.png` request the control change triggers — OR skip waiting on the debounced preview entirely and fetch `render.png` directly via `page.request` for the actual assertion (the debounced `<img>` preview is a UX nicety, not the thing under test) | Matches Phase 14's Pitfall 1 precedent (never sleep-and-hope for a debounce); additionally, since the actual assertion in this phase is a direct `page.request` fetch of the render endpoint (not a DOM screenshot), the debounced preview `<img>` doesn't even need to be waited on for QR-E2E-01/03 — only the PATCH's own response (which persists the style synchronously) needs awaiting before fetching render bytes. |

**Key insight:** This phase needs almost no new mechanism beyond what the codebase already proves works — the one genuinely new asset is a thin `apps/e2e/src/qr.ts` fixture helper plus two new devDependencies (`jsqr`, `sharp`) that are both already trusted, already-lockfile-resolved packages in this exact monorepo.

## Runtime State Inventory

Not applicable — this is a greenfield test-authoring phase (new Playwright spec files + one new fixture helper), not a rename/refactor/migration. No existing runtime state, stored data, or registered OS/service state is being renamed or moved.

## Common Pitfalls

### Pitfall 1: Asserting decoded payload equality against the wrong string
**What goes wrong:** A test decodes the QR and compares it to `link.targetUrl` — the assertion always fails (or, worse, is written loosely enough to pass for the wrong reason).
**Why it happens:** CONTEXT.md's requirement wording ("decodes back to its target URL") reads naturally as "the destination," but the actual encoded payload is Kurzly's own short URL (see Summary point 1).
**How to avoid:** Build the expected string explicitly from the fixture's known `domain.hostname`/`link.slug`/`qrCode.id` (static) or `BASE_URL`/`qrCode.code` (dynamic) — never the fixture's `targetUrl` field — and assert equality against that.
**Warning signs:** A test written before reading `resolveQrPayload` that hardcodes `expect(decoded).toBe(targetUrl)`.

### Pitfall 2: Fetching render bytes without an authenticated `page.request`
**What goes wrong:** Using Node's global `fetch()` or a fresh, cookie-less `APIRequestContext` to hit `render.png`/`render.svg` returns a 401, not image bytes.
**Why it happens:** `routes/qrCodes.ts`'s render handlers call `resolveUserId`/`resolveOwnedQrCode` — every render is IDOR-guarded and session-gated, unlike the redirect-handler endpoints Phase 12 tested (which are deliberately public).
**How to avoid:** Always use `page.request.get(...)` (shares the `chromium-admin` project's `storageState` cookie jar) — never a bare `fetch`/a fresh unauthenticated request context.
**Warning signs:** `response.status()` is 401; `decodeQrImage` throws because the "PNG" bytes are actually a JSON error body.

### Pitfall 3: Logo upload validated client-side but rejected server-side due to size
**What goes wrong:** A test-generated logo PNG that is technically valid but exceeds `MAX_LOGO_BYTES` (1,400,000 bytes, `QrStudioPanel.vue`'s own client-side pre-check) or the server's `LOGO_DATA_MAX_LENGTH` (1,900,000 base64 chars, `routes/qrCodes.ts`) silently fails with a generic save-failure toast, not a clear test error.
**Why it happens:** A naively-generated "solid color, but large canvas" test PNG (e.g. an 800×800 noise fixture, as `qrDecode.test.ts` deliberately uses for a DIFFERENT reason — proving the upload isn't merely re-declared) can balloon past these limits if copied verbatim.
**How to avoid:** Generate a genuinely tiny fixture for the E2E logo test — a small (e.g. 32×32 or 64×64), solid-color PNG via `sharp({create:{width:64,height:64,channels:4,background:{r:20,g:58,b:95,alpha:1}}}).png().toBuffer()` compresses to well under 1 KB, comfortably inside every limit.
**Warning signs:** The Studio's `logoError` ref shows "Datei zu groß (max. 1,4 MB)." instead of the upload succeeding.

### Pitfall 4: Racing the Studio's monotonic mutation sequence guard across rapid style changes
**What goes wrong:** A test that fires multiple style PATCHes back-to-back without awaiting each one's completion can have an EARLIER request's response arrive AFTER a later one — `QrStudioPanel.vue`'s `persistStyle`'s `mutationSeq` guard deliberately drops the stale response (no `styled` emit, no revert), which is correct app behavior but means a test asserting on the FIRST PATCH's outcome without waiting for its own `waitForResponse` can read an inconsistent DOM state.
**Why it happens:** Every control (color swatch, rounded toggle, logo upload, name blur) fires its own independent PATCH with no ordering guarantee — documented explicitly in the component's own header comment.
**How to avoid:** Always `await page.waitForResponse(r => r.url().includes('/api/qr-codes/') && r.request().method() === 'PATCH')` (or click-and-wait sequentially) between successive style changes in one test, rather than firing several clicks in immediate succession.
**Warning signs:** Flaky, order-dependent failures only when a test's controls-and-assert sequence is compressed (e.g., clicking color THEN toggling rounded THEN asserting both applied, without awaiting each PATCH).

### Pitfall 5: Static QR's HTTPS-hardcoded payload vs. the E2E stack's actual HTTP serving
**What goes wrong:** `resolveQrPayload` hardcodes `https://` for a static QR's encoded URL regardless of the actual serving scheme. If a test tries to literally `fetch()` the decoded URL (rather than just string-comparing it, or deliberately reconstructing an equivalent request against `PLAYWRIGHT_BASE_URL` with a `Host` header), it will fail to connect (no TLS listener at `e2e.kurzly.local:443` in the E2E stack).
**Why it happens:** The encoded string is a product-level constant ("public QR codes should always claim to be `https://`"), independent of how the E2E test harness actually serves the app (`http://localhost:3000`, per `docker-compose.e2e.yml`'s `BASE_URL`).
**How to avoid:** For the static-QR case, treat the decode assertion as string-equality-only (proving CONTENT correctness) unless a stronger live-follow-through is explicitly wanted — if a live follow-through IS wanted, reuse Phase 12's already-proven host-header-delivery pattern (`request.get(url, {headers: {Host: BASELINE_DOMAIN_HOSTNAME}})` against `http://localhost:3000/{slug}?qr={id}`), never a literal `fetch(decodedUrl)`.
**Warning signs:** `ECONNREFUSED`/TLS handshake errors if a test literally re-fetches the decoded HTTPS URL as-is.

## Code Examples

### Static QR customization + decode round-trip (QR-E2E-01)
```typescript
// Source: apps/web/src/views/LinkDetailView.vue (handleQrCode), apps/web/src/components/QrStudioPanel.vue,
// apps/api/src/routes/qrCodes.ts (resolveQrPayload), apps/api/test/qrDecode.test.ts (decode recipe)
import { test, expect } from "@playwright/test";
import { createE2eLink } from "../../src/links.js";
import { createE2ePrisma } from "../../src/db.js";
import { decodeQrImage } from "../../src/qr.js";

test("static QR customization decodes back to its short URL", async ({ page }) => {
  const prisma = createE2ePrisma();
  const slug = `e2e-qr-${crypto.randomUUID().slice(0, 8)}`;
  const link = await createE2eLink(prisma, { slug, targetUrl: "https://example.com/qr-target" });

  await page.goto(`/links/${link.id}`);
  await page.getByRole("button", { name: "QR-Code" }).click();
  await expect(page).toHaveURL(/\/qr-codes\?selected=/);

  // Customize: pick a non-default color swatch, enable rounded modules.
  await page.locator(".color-swatch").nth(1).click();
  await page.waitForResponse((r) => r.url().includes("/api/qr-codes/") && r.request().method() === "PATCH");
  await page.locator(".rounded-toggle").click();
  await page.waitForResponse((r) => r.url().includes("/api/qr-codes/") && r.request().method() === "PATCH");

  const qrId = new URL(page.url()).searchParams.get("selected")!;
  const response = await page.request.get(`/api/qr-codes/${qrId}/render.png`);
  expect(response.headers()["content-type"]).toBe("image/png");
  const decoded = await decodeQrImage(Buffer.from(await response.body()));

  expect(decoded).toBe(`https://e2e.kurzly.local/${slug}?qr=${qrId}`);
});
```

### Dynamic QR remap resolves target A -> target B, history recorded (QR-E2E-02)
```typescript
// Source: apps/api/src/routes/qrRedirect.ts, apps/api/src/lib/qrCodes.ts (remapQrCode),
// apps/web/src/views/QrCodesView.vue (handleRemapChange, .target-select)
import { test, expect } from "@playwright/test";
import { createE2eLink } from "../../src/links.js";
import { createE2eQrCode } from "../../src/qr.js";
import { createE2ePrisma } from "../../src/db.js";

test("dynamic QR remap changes resolution, records ordered history", async ({ page, request }) => {
  const prisma = createE2ePrisma();
  const targetA = await createE2eLink(prisma, { slug: `e2e-qr-a-${crypto.randomUUID().slice(0, 8)}`, targetUrl: "https://example.com/target-a" });
  const targetB = await createE2eLink(prisma, { slug: `e2e-qr-b-${crypto.randomUUID().slice(0, 8)}`, targetUrl: "https://example.com/target-b" });
  const qr = await createE2eQrCode(prisma, { variant: "dynamic", linkId: targetA.id, name: "Remap Test QR" });

  const beforeResp = await request.get(`/q/${qr.code}`, { maxRedirects: 0 });
  expect(beforeResp.status()).toBe(302);
  expect(beforeResp.headers()["location"]).toBe(targetA.targetUrl);

  await page.goto(`/qr-codes?selected=${qr.id}`);
  await page.locator(".qr-card.selected .target-select").selectOption(targetB.id);
  await page.waitForResponse((r) => r.url().includes(`/api/qr-codes/${qr.id}`) && r.request().method() === "PATCH");

  const afterResp = await request.get(`/q/${qr.code}`, { maxRedirects: 0 });
  expect(afterResp.status()).toBe(302);
  expect(afterResp.headers()["location"]).toBe(targetB.targetUrl);

  const history = await prisma.qrRemapHistory.findMany({ where: { qrCodeId: qr.id }, orderBy: { createdAt: "asc" } });
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ fromLinkId: targetA.id, toLinkId: targetB.id });
});
```

### PNG and SVG export both produce a genuinely decodable file (QR-E2E-03)
```typescript
// Source: apps/web/src/components/QrStudioPanel.vue (exportFile), apps/api/src/routes/qrCodes.ts
// (render.png/render.svg handlers), apps/api/test/qrDecode.test.ts (SVG-via-sharp decode case)
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { decodeQrImage } from "../../src/qr.js";

test("PNG and SVG exports are both valid, independently decodable files", async ({ page }) => {
  // ... QR created/selected as in QR-E2E-01 ...
  const pngResp = await page.request.get(`/api/qr-codes/${qrId}/render.png`);
  expect(pngResp.headers()["content-type"]).toBe("image/png");
  const pngBytes = Buffer.from(await pngResp.body());
  expect(await decodeQrImage(pngBytes)).toBe(expectedShortUrl);

  const svgResp = await page.request.get(`/api/qr-codes/${qrId}/render.svg`);
  expect(svgResp.headers()["content-type"]).toBe("image/svg+xml");
  const svgText = await svgResp.text();
  expect(svgText).toContain("<svg");
  const rasterized = await sharp(Buffer.from(svgText)).png().toBuffer();
  expect(await decodeQrImage(rasterized)).toBe(expectedShortUrl);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|----------------|--------|
| CONTEXT.md's framing: "decodes back to its target URL" | Decodes back to Kurzly's own constructed short URL (`https://{hostname}/{slug}?qr={id}` or `${BASE_URL}/q/{code}`) — the raw destination is never encoded | Confirmed this research pass by reading `routes/qrCodes.ts`'s `resolveQrPayload` | Every decode assertion in this phase must be built against the short-URL string, never `Link.targetUrl` directly (see Pitfall 1). |
| CONTEXT.md's open question: "identify and, if needed, add a QR-decode npm package" | `jsqr` + `sharp` are ALREADY approved, in-lockfile dependencies of `@kurzly/api`, with an ALREADY-PROVEN decode recipe in `apps/api/test/qrDecode.test.ts` | Confirmed this research pass | Zero feasibility risk for QR-E2E-01's decode-round-trip crux — only a devDependency addition to `apps/e2e`, not new-package research. |
| CONTEXT.md's speculation that a host-header spike (Phase 12 precedent) might be needed for `/q/:code` | Confirmed unnecessary — `qrRedirectRoute` is deliberately host-agnostic (no `resolveActiveDomainByHost` call) | Confirmed this research pass by reading `routes/qrRedirect.ts`'s header comment + implementation | QR-E2E-02's redirect assertions can hit `PLAYWRIGHT_BASE_URL` directly with zero `Host` header handling, simpler than Phase 12's `/:slug` tests. |

**Deprecated/outdated:** none.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `page.request` (used within a test that also uses `page`) shares the SAME `BrowserContext` cookie jar/storageState as `page`, so it will carry the `chromium-admin`/`chromium-member` project's saved session cookie automatically | Pattern 2, Code Examples | Low — this is documented Playwright behavior and already an established pattern per Phase 12's STATE.md notes ("`page.request` shares the same BrowserContext cookie jar as `page`"); if it somehow doesn't carry the cookie in practice, the render fetch returns 401 immediately and loudly (not a silent wrong-content failure), making the issue trivial to diagnose at implementation time. |
| A2 | A `randomBytes(8).toString("hex")` (16 hex chars) is collision-free enough for `apps/e2e/src/qr.ts`'s fixture `code` generation without a retry loop, at E2E's test-run scale | Pattern 3 | Low — 16 hex chars is 2^64 possible values; even hundreds of parallel test runs make an actual collision astronomically unlikely, and a collision would surface as a loud Prisma P2002 unique-constraint error during fixture setup, not a silent wrong-test-behavior. |

**If this table is empty:** N/A — two low-risk implementation-detail assumptions above; every other claim in this document (routes, request/response shapes, encoded-payload construction, decode feasibility, remap transaction shape, UI selectors) was verified by direct source reads this session, not assumed.

## Open Questions

1. **Should QR-E2E-01's decode assertion ALSO perform a live follow-through request to the decoded short URL (proving it actually resolves to the real destination), or is string-equality against the constructed short-URL sufficient?**
   - What we know: the decoded payload is provably the correct short-URL construction (string-equality is a genuine content proof, not merely "an image rendered" — it directly satisfies QR-E2E-01's stated bar). A live follow-through would additionally prove the short URL is LIVE and correctly wired end-to-end, at the cost of needing Phase 12's host-header delivery pattern for the static case (Pitfall 5).
   - What's unclear: whether the milestone's bar ("a content round-trip, not just an image rendered") is satisfied by string-equality alone, or requires the extra live-follow-through hop.
   - Recommendation: implement string-equality as the mandatory baseline assertion (this alone already exceeds "just an image rendered" — it proves the exact expected string was encoded and successfully decoded pixel-for-pixel through a real rasterized render). Add the live follow-through as a stretch enhancement only if the planner judges it valuable; it is not required to satisfy the requirement's literal wording once the encoding architecture (Summary point 1) is understood.

2. **Does QR-E2E-03 need its own fresh QR fixture, or can it reuse QR-E2E-01's spec-local QR (if run in the same file)?**
   - What we know: nothing in the PNG/SVG export requirement depends on customization state — a freshly-created static (or dynamic) QR with default style already produces valid, decodable PNG/SVG bytes.
   - What's unclear: whether the planner wants QR-E2E-03 as a fully independent spec file (this research's Recommended Project Structure assumes so, for parallel-test-file isolation and clarity) or folded into QR-E2E-01's file as additional assertions on the same QR.
   - Recommendation: keep them as separate spec files (as structured above) — `fullyParallel: true` means independent files isolate failures cleanly and each maps 1:1 to a requirement ID, matching every prior phase's established one-file-per-requirement-behavior convention.

## Environment Availability

Not applicable — this phase adds no new external service/tool dependency (no new Docker container, no new CLI). It reuses the entire Phase 11-14 E2E harness (compose stack, Postgres on `:5433`, no Mailpit needed since no email flow is involved) as-is, plus two new devDependencies (`jsqr`, `sharp`) that are ordinary npm packages already resolved in this monorepo's lockfile.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `@playwright/test` 1.61.1 |
| Config file | `apps/e2e/playwright.config.ts` |
| Quick run command | `pnpm --filter @kurzly/e2e exec playwright test tests/authed/qr-static-customize-decode.spec.ts --project=chromium-admin` (adjust filename once the planner finalizes spec names) |
| Full suite command | `scripts/e2e-compose.sh` (boots the compose stack, runs `pnpm --filter @kurzly/e2e test`, always tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| QR-E2E-01 | Static QR created via real UI, customized (color/rounded/logo) via real Studio controls, PNG bytes decode back to the exact expected short-URL string | e2e (browser + real HTTP fetch + jsQR decode) | `playwright test tests/authed/qr-static-customize-decode.spec.ts` | ❌ Wave 0 |
| QR-E2E-02 | Dynamic `/q/:code` resolves to target A, then target B after a real-UI remap; exactly one ordered `QrRemapHistory` row recorded | e2e (real HTTP redirect assertions + real-UI remap + direct-Prisma history assertion) | `playwright test tests/authed/qr-dynamic-remap.spec.ts` | ❌ Wave 0 |
| QR-E2E-03 | PNG and SVG exports both return correct content-type AND both independently decode via jsQR to the same expected short-URL string | e2e (real HTTP fetch, two content-types, jsQR decode on both) | `playwright test tests/authed/qr-export-formats.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted spec file only, e.g. `playwright test tests/authed/qr-static-customize-decode.spec.ts --project=chromium-admin`, against a running local compose stack.
- **Per wave merge:** full `tests/authed/` directory at both `--workers=1` and the CI's configured parallelism, to catch any new DB-truncate race this phase's specs introduce (the truncate list already covers `QrCode`/`QrRemapHistory`, so this is a re-confirmation, not new risk).
- **Phase gate:** full E2E suite (`scripts/e2e-compose.sh`, all directories) green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/e2e/src/qr.ts` — does not exist yet (new fixture helper: `createE2eQrCode`, `decodeQrImage`).
- [ ] `apps/e2e/tests/authed/qr-static-customize-decode.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/qr-dynamic-remap.spec.ts` — does not exist yet.
- [ ] `apps/e2e/tests/authed/qr-export-formats.spec.ts` — does not exist yet.
- [ ] `apps/e2e/package.json` — needs `jsqr` and `sharp` added as devDependencies (both already resolved in the shared `pnpm-lock.yaml`).
- [ ] No `apps/api`/`apps/web` code changes are anticipated — this phase is test-authoring only, confirmed by full reads of every relevant backend/frontend file this session.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes (indirect) | Specs run under the existing `chromium-admin` `storageState` fixture (Phase 11) — no new auth mechanism. |
| V3 Session Management | no (unchanged) | This phase adds no session-management code. |
| V4 Access Control | yes (existing, exercised incidentally) | Every QR create/update/remap/render call this phase's specs make passes through `resolveLinkDomainAccess`/`resolveOwnedQrCode`'s existing IDOR guards — full domain-denial-matrix testing is explicitly Phase 17's job (CONTEXT.md's Deferred Ideas). |
| V5 Input Validation | yes (existing, exercised incidentally) | The hex-color regex gate, logo magic-byte sniffing (`normalizeLogo`), and `QR_CODE_PARAM` shape gate are all exercised naturally by this phase's happy-path specs; exhaustive validation-error-message testing is explicitly out of scope for this milestone (REQUIREMENTS.md's Out-of-Scope table). |
| V6 Cryptography | n/a | No new crypto surface — this phase's QR fixtures don't need password-protected Links (that's Phase 12's scope). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| SVG attribute-injection via an unvalidated color value (`fill="${color}"`) | Tampering | Already enforced server-side (`lib/qr.ts`'s `assertValidColor`/`InvalidColorError`, plus `routes/qrCodes.ts`'s Zod `HEX_COLOR_SCHEMA` defense-in-depth) — this phase's specs use the LOCKED product color swatches only (`PRODUCT_COLORS` in `QrStudioPanel.vue`), so they don't need to re-prove this guard (already unit-tested in `apps/api/test/qrDecode.test.ts`'s injection-string suite). |
| Uploaded logo bytes disguised as PNG/SVG (magic-byte spoofing) | Tampering / Denial of Service | Already enforced server-side (`normalizeLogo`'s magic-byte sniffing + `LOGO_MAX_PIXELS` rasterization ceiling) — this phase's happy-path logo upload uses a genuinely valid, tiny PNG (Pitfall 3), and does not need to re-prove the rejection path (already unit-tested). |
| QR remap IDOR (re-pointing a QR to a Link outside the caller's domain scope) | Elevation of Privilege | Already covered by `remapQrCode`'s dual-sided `resolveLinkDomainAccess` check (both the CURRENT and the NEW target Link) — not this phase's job to re-prove; Phase 17's representative denial case covers this pattern at the E2E layer. |

## Sources

### Primary (HIGH confidence — direct source reads, this session)
- `apps/api/src/lib/qr.ts` — full read
- `apps/api/src/lib/qrCodes.ts` — full read
- `apps/api/src/routes/qrCodes.ts` — full read
- `apps/api/src/routes/qrRedirect.ts` — full read
- `apps/api/test/qrDecode.test.ts` — full read (the proven decode recipe this research reuses verbatim)
- `apps/api/prisma/schema.prisma` — targeted read (QrCode/QrRemapHistory models)
- `apps/web/src/components/QrStudioPanel.vue` — full read
- `apps/web/src/views/QrCodesView.vue` — full read
- `apps/web/src/views/LinkDetailView.vue` — targeted read (handleQrCode entry point, router names)
- `apps/web/src/api.ts` — targeted read (QR client section)
- `packages/shared/src/index.ts` — targeted read (QrCodeDTO/CreateQrCodeInput/UpdateQrCodeInput/QrRemapHistoryEntryDTO)
- `apps/api/src/plugins/rateLimit.ts` — targeted read (QR_CREATE_RATE_LIMIT/QR_RENDER_RATE_LIMIT values)
- `apps/api/package.json`, `apps/e2e/package.json` — full reads (confirms jsqr/sharp already present in apps/api, absent in apps/e2e)
- `pnpm-lock.yaml` — targeted grep (confirms jsqr@1.4.0 already resolved)
- `apps/e2e/src/db.ts`, `apps/e2e/src/links.ts` — full reads (reused patterns, confirmed truncate list already covers QrCode/QrRemapHistory)
- `apps/e2e/playwright.config.ts`, `apps/e2e/tests/authed/storage-state.spec.ts` — full reads (testMatch/project structure precedent)
- `.env.example`, `docker-compose.e2e.yml`, `apps/api/src/env.ts` — targeted greps (BASE_URL=http://localhost:3000 in the E2E stack)
- `.planning/phases/14-links-csv-import-e2e/14-RESEARCH.md`, `.planning/phases/11-playwright-e2e-infrastructure-fixtures/11-RESEARCH.md` — read for RESEARCH.md structural/style precedent and reusable patterns

### Secondary (MEDIUM confidence)
- `npm view jsqr` (registry metadata: dist-tags, publish dates, repo) — this session

### Tertiary (LOW confidence)
- None this pass — every claim traces to a direct source read or registry check above.

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no genuinely new package (`jsqr`/`sharp` both already approved, in-lockfile dependencies elsewhere in this monorepo), versions confirmed directly.
- Architecture: HIGH — every route/component/schema read in full this session; the encoded-payload architecture (the single biggest risk to a naive test) is now closed with certainty, not assumption.
- Pitfalls: HIGH — every pitfall traces to specific code read this session (resolveQrPayload's URL construction, mutationSeq guard, magic-byte/size limits, host-agnostic /q/:code routing), not generic Playwright folklore.

**Research date:** 2026-07-25
**Valid until:** 30 days (stable, code-verified; revisit only if `lib/qr.ts`/`lib/qrCodes.ts`/`routes/qrCodes.ts`/`routes/qrRedirect.ts`/the two Vue views change before planning completes)
