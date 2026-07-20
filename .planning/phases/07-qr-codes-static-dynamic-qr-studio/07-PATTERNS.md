# Phase 7: QR Codes (Static + Dynamic, QR Studio) - Pattern Map

**Mapped:** 2026-07-20
**Files analyzed:** 12 new/modified files
**Analogs found:** 12 / 12 (2 with "no analog" — new-pattern territory, see below)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/prisma/schema.prisma` (QrCode + QrRemapHistory models) | model | CRUD | `Link` + `ClickEvent` models | exact |
| `apps/api/src/lib/qr.ts` (generation: qrcode+sharp, PNG/SVG, logo overlay) | service/utility | transform | no direct analog (new binary-transform domain) | no-analog |
| `apps/api/src/lib/qrCodes.ts` (single-write-path core: validate/create/update/remap) | service | CRUD | `apps/api/src/lib/links.ts` | exact |
| `apps/api/src/routes/qrCodes.ts` (CRUD routes `/api/qr-codes*`) | route/controller | request-response | `apps/api/src/routes/links.ts` | exact |
| `apps/api/src/routes/qrRedirect.ts` (`/q/:code` dynamic redirect handler) | route/controller | request-response | `apps/api/src/routes/redirect.ts` | exact |
| `packages/shared/src/index.ts` (add `QrCodeDTO`, `CreateQrCodeInput`, `UpdateQrCodeInput`, `QrRemapHistoryEntryDTO`) | model/DTO | transform | existing `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` block in same file | exact |
| `apps/web/src/views/QrCodesView.vue` (replaces ComingSoonView at `/qr-codes`, QR Studio list) | component (view) | request-response | `apps/web/src/views/LinksView.vue` | exact |
| `apps/web/src/components/QrFormModal.vue` (create/edit + styling controls + logo upload + live preview) | component | request-response | `apps/web/src/components/LinkFormModal.vue` | role-match |
| `apps/web/src/views/LinkDetailView.vue` (add QR entry point / QR panel) | component (view, modified) | request-response | itself (existing file, extend in place) | exact |
| `apps/web/src/api.ts` (add QR CRUD + remap-history client functions) | utility (API client) | request-response | existing Link/Domain functions in same file | exact |
| `apps/api/test/qrCodes.integration.test.ts` | test | CRUD | `apps/api/test/links.integration.test.ts` | exact |
| `apps/api/test/qrDecode.test.ts` (PNG/SVG decode-round-trip, logo-enabled) | test | transform | no direct analog (new decode-round-trip domain); structure borrows from `apps/api/test/links.integration.test.ts`'s describe/it shape | partial |
| `apps/web/src/views/QrCodesView.test.ts` | test | request-response | `apps/web/src/views/LinksView.test.ts` | exact |
| `apps/web/src/components/QrFormModal.test.ts` | test | request-response | `apps/web/src/components/LinkFormModal.test.ts` | exact |

## Pattern Assignments

### `apps/api/prisma/schema.prisma` — `QrCode` + `QrRemapHistory` models (model, CRUD)

**Analog:** `Link` model (lines 177-220) + `ClickEvent` model (lines 232-246), same file

**Core pattern to copy** (`Link` model, lines 177-220):
```prisma
model Link {
  id        String   @id @default(cuid())
  domainId  String
  slug      String
  targetUrl String
  ...
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ...
}
```
Copy this shape for `QrCode`: `id @id @default(cuid())`, explicit `@@index([...])` on every FK (never rely on the implicit FK index alone — this file's own comment on `ClickEvent` states the convention explicitly: "`@@index` is always explicit (never rely on the FK alone), mirroring `Link`'s own `@@index([domainId])` convention", line 231). `QrCode` needs at minimum:
- `variant` (`static` | `dynamic`) — model as an enum the same way `ScanSource` is modeled (lines 221-224: a plain top-level `enum` block, lowercase values, `@default(...)` on the enum where the analog needs a default).
- `linkId` (static variant's bound Link) and `targetLinkId`/similar (dynamic variant's current target) — both `Link` relations, both indexed.
- `code` (the `/q/:code` short code) — unique per the same discipline as `Link.slug`'s `@@unique([domainId, slug])`-style composite (see `domainId_slug` unique constraint referenced in `apps/api/src/lib/links.ts` line 210 — `prisma.link.findUnique({ where: { domainId_slug: ... } })`); `code` is likely globally unique (no domain scoping) since `/q/:code` is a single flat namespace — use a plain `@unique`.
- Styling fields (`color`, `roundedModules` boolean, `logoUrl`/`logoData`) plain nullable columns, same style as `Link.title String?`.
- `scanCount`-equivalent: do NOT add a separate counter column that duplicates `ClickEvent`/`source='qr'` counting — CONTEXT.md explicitly says derive scan count from `source='qr'` ClickEvents (mirrors `Link.lifetimeClicks`'s "pruning-resistant all-time counter" pattern, lines 204-207) — if a counter is added for pruning-resistance, follow that exact doc-comment convention (increment only from the click hook, never queried live via COUNT).

**Remap history model** — mirrors `ClickEvent`'s per-event-row shape (lines 232-246):
```prisma
model ClickEvent {
  id           String     @id @default(cuid())
  linkId       String
  createdAt    DateTime   @default(now())
  ...
  link Link @relation(fields: [linkId], references: [id], onDelete: Cascade)
  @@index([linkId])
  @@index([createdAt])
}
```
`QrRemapHistory` should copy this exactly: `id @id @default(cuid())`, `qrCodeId` FK + `@@index([qrCodeId])`, `createdAt @default(now())` + `@@index([createdAt])`, `fromLinkId`/`toLinkId` (or `fromTargetUrl`/`toTargetUrl` if snapshotting is preferred), relation with `onDelete: Cascade` back to `QrCode`.

---

### `apps/api/src/lib/qrCodes.ts` (service, CRUD) — single-write-path core

**Analog:** `apps/api/src/lib/links.ts`

**Header-comment convention to copy** (lines 1-31): document this file as the SOLE authorization+validation gate and the ONLY `prisma.qrCode.create`/`prisma.qrCode.update` call site, explicitly naming the anti-pattern it prevents (a future bulk-write bypass). This project enforces D-01-style single-write-path discipline structurally and via grep-provable comments — CONTEXT.md explicitly calls for "Single-write-path discipline mirrored from Links: exactly one `createQrCode`/`updateQrCode` path."

**Validation core pattern** (`validateLinkInput`, lines 292-337):
```typescript
export async function validateLinkInput(
  prisma: PrismaClient,
  input: ValidateLinkInputParams,
): Promise<ValidationResult> {
  try {
    await requireDomainAccess(prisma, input.userId, input.domainId, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "UNAUTHORIZED_DOMAIN" };
    throw err;
  }
  // ...pure checks, ZERO writes...
  return { ok: true, data: { ... } };
}
```
`validateQrCodeInput` should reuse `requireDomainAccess` verbatim (via the bound Link's `domainId`, since a QrCode belongs to a Link's domain, not its own) — zero new authorization code, per CONTEXT.md's "reused verbatim from `apps/api/src/lib/authorization.ts`" convention already established for Links.

**Create/Update pattern** (lines 347-415, `createLink`/`updateLink`): validate-then-single-insert/single-update, catching `isUniqueConstraintViolation` (P2002) for the `code` unique constraint the same way `SLUG_TAKEN` is caught (lines 360-363, 410-413).

**Code generation pattern** — reuse `generateSlug`/`BASE62`/`AUTO_SLUG_RETRY_LIMIT` (lines 88-96, 219-235) verbatim or near-verbatim for `/q/:code` generation: `customAlphabet(BASE62, 7)` + a bounded retry loop checking DB collision, returning a `*_GENERATION_EXHAUSTED` error code after `AUTO_SLUG_RETRY_LIMIT` attempts.

**Reserved-slug note:** `RESERVED_SLUGS` (lines 132-148) already contains `"q"` — the `/q` namespace is pre-reserved against Link slugs. No new reserved-word logic needed for QR codes themselves, but if `/q/:code` codes must ALSO avoid colliding with Link slugs (or vice versa) at a shared-namespace level, that discretely differs from Link's per-domain uniqueness (QR `code` is likely global) — flag this as a discretion point for the planner.

**Remap function** (new — no direct analog in `links.ts`, but shape mirrors `updateLink`, lines 384-415): `remapQrCode(prisma, qrCodeId, newTargetLinkId, userId)` should (1) call the same domain-access/validation gate, (2) in a `prisma.$transaction` update the `QrCode.targetLinkId`/similar AND insert one `QrRemapHistory` row — mirrors `apps/api/src/routes/redirect.ts`'s `recordClickHook` transaction-batching pattern (lines 99-107: `await prisma.$transaction([create, update])` so the counter/history never drifts from the event rows).

**DTO mapping pattern** (`toLinkDto`, lines 423-439): `toQrCodeDto(qrCode)` — ISO-string dates, never expose internals not meant to cross the JSON boundary (mirrors `passwordHash` never crossing per `toLinkDto`'s doc comment, lines 418-422).

---

### `apps/api/src/routes/qrCodes.ts` (route/controller, request-response)

**Analog:** `apps/api/src/routes/links.ts`

**Factory + auth pattern** (lines 1-41, 196-197):
```typescript
export function linksRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerLinksRoute(app: FastifyInstance): Promise<void> { ... };
}
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}
```
Copy this factory shape verbatim for `qrCodesRoute(prisma, auth)`.

**Zod allowlist pattern** (lines 48-94, `createLinkSchema`/`updateLinkSchema`): every request body field must be explicitly allowlisted through a Zod schema BEFORE reaching the service core — never pass `request.body` straight through (mass-assignment guard, T-04-MASS convention). QR create/update schemas need: `linkId` (static) or initial `targetLinkId` (dynamic), `variant`, styling fields (`color`, `roundedModules`, logo upload reference), never a client-settable `code` or `scanCount`.

**IDOR guard pattern** (`resolveOwnedLink`, lines 187-194):
```typescript
async function resolveOwnedLink(prisma: PrismaClient, userId: string, id: string): Promise<Link | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.link.findFirst({ where: { id, domainId: { in: domainIds } } });
}
```
Copy this exact two-step (membership-first, cost-uniform across found/not-found/forbidden — see WR-04 fix commentary, lines 166-186) for `resolveOwnedQrCode`, joining through the bound Link's `domainId` since QrCode has no `domainId` column of its own. 404 for both "not found" and "forbidden" — never distinguishable (no existence oracle).

**Error-code-to-status mapping pattern** (`statusForLinkError`, lines 133-152): exhaustive switch with a `never` compile-time check — copy this shape for `statusForQrError`.

**Rate limiting**: apply the same `config: { rateLimit: LINK_CREATE_RATE_LIMIT }` pattern (line 201) — reuse or add a sibling constant in `apps/api/src/plugins/rateLimit.ts`.

---

### `apps/api/src/routes/qrRedirect.ts` (`/q/:code`, route/controller, request-response)

**Analog:** `apps/api/src/routes/redirect.ts`

**Route registration + Cache-Control discipline** (lines 134-141):
```typescript
export function redirectRoute(prisma: PrismaClient) {
  return async function registerRedirectRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/:slug",
      config: { rateLimit: REDIRECT_RATE_LIMIT },
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store"); // every branch, first thing
        ...
      },
    });
  };
}
```
Copy verbatim for `/q/:code`: register a sibling factory `qrRedirectRoute(prisma)`, `Cache-Control: no-store` as the FIRST line of the handler on every branch (D-18 discipline).

**Resolution pattern**: `/q/:code` looks up `QrCode` by `code` (global, not host+slug like Link — no `resolveActiveDomainByHost` needed since QR codes aren't domain-scoped the way Links are), then resolves to the CURRENT `targetLinkId`'s `Link.targetUrl` (or directly stored target URL) — critically, re-pointing must never change the printed code (QR-02/03), i.e. this handler always reads the QrCode's CURRENT target fresh, never a cached/baked-in value.

**Click-tracking hook reuse**: `recordClickHook` (lines 82-112) should be called with `source: "qr"` instead of `source: "link"` (line 101: `data: { linkId: link.id, country, referrerHost, visitorHash, source: "link" }` — parameterize this call to accept a `source: ScanSource` argument, or add a QR-specific variant that calls the SAME transaction-batched insert against the underlying target Link's id). This is the exact seam CONTEXT.md references: "Scan tracking hooks the existing redirect click seam (Phase 6)." Do not duplicate the `$transaction([clickEvent.create, link.update])` batching logic — parameterize the existing function or extract a shared helper both `redirect.ts` and `qrRedirect.ts` call.

**Bot detection / not-found rendering**: reuse `isBotRequest`, `renderNotFoundPage` (imports lines 42, 47) — a QR code that doesn't resolve gets the same 404 HTML page shape as an unknown Link slug.

---

### `packages/shared/src/index.ts` — `QrCodeDTO` / `CreateQrCodeInput` / `UpdateQrCodeInput` / `QrRemapHistoryEntryDTO`

**Analog:** existing `LinkDTO`/`CreateLinkInput`/`UpdateLinkInput` block (lines 61-140), same file

**Pattern to copy:**
```typescript
export type LinkDTO = {
  id: string;
  domainId: string;
  ...
  createdAt: string;   // ISO 8601, never Date
  updatedAt: string;
};
export type CreateLinkInput = { domainId: string; targetUrl: string; slug?: string; ... };
export type UpdateLinkInput = { targetUrl?: string; slug?: string; ... };
```
Follow the exact same "mirrors `toXDto()` mapping" doc-comment convention (line 64: "mirrors `apps/api/src/lib/links.ts`'s `toLinkDto()` mapping") pointing at `qrCodes.ts`'s `toQrCodeDto()`. All date fields ISO strings, never `Date`. Add `QrRemapHistoryEntryDTO` alongside, following the `LinkAnalyticsDTO`'s array-of-entries shape (lines 155-162: `dailySeries: { day: string; count: number }[]`) — i.e. `QrCodeDTO.remapHistory?: QrRemapHistoryEntryDTO[]` or a separate `GET .../remap-history` endpoint returning `QrRemapHistoryEntryDTO[]`.

**`qrScans` seam already exists**: `GlobalAnalyticsDTO.qrScans` (lines 171-179) is already defined and wired to a live `source='qr'` COUNT query (`apps/api/src/lib/analytics.ts` lines 191-197) — no DTO or analytics-lib change needed there; Phase 7 only needs to start producing `source='qr'` ClickEvent rows for that number to stop reading `0`.

---

### `apps/web/src/views/QrCodesView.vue` (component/view, request-response)

**Analog:** `apps/web/src/views/LinksView.vue`

Read `LinksView.vue`'s list/search/create-modal-trigger/delete-confirm patterns directly (759 lines — not fully excerpted here per non-overlap discipline, but the file is the direct structural analog: table/list rendering, a "New Link" button opening `LinkFormModal`, per-row action menu, empty-state, loading-state). Copy:
- List container structure + design-token usage (`apps/web/src/styles/tokens.css`, per CONTEXT.md).
- Modal-open/close state management pattern (`ref` for `showModal`, `editingItem`).
- Error handling: `error` ref passed into the modal, mapped via a `mapXFormError`-style helper in `api.ts` (mirrors `mapLinkFormError`, referenced in `LinkFormModal.vue` line 28).
- Route replaces `ComingSoonView` at `/qr-codes` — this is a straightforward swap in `apps/web/src/router/index.ts` (path already registered, line 62-63; only the component import changes).

---

### `apps/web/src/components/QrFormModal.vue` (component, request-response)

**Analog:** `apps/web/src/components/LinkFormModal.vue`

**Props/emit shape pattern** (lines 30-76):
```typescript
type LinkFormModalProps = {
  mode: "create" | "edit";
  domains: DomainDTO[];
  initialTargetUrl?: string;
  ...
  error?: unknown;
};
const emit = defineEmits<{
  close: [];
  submit: [payload: { ... }];
}>();
```
Copy this exact `mode: "create" | "edit"` + `initial*` props + single `submit` emit-with-payload shape for `QrFormModal`. Add QR-specific fields: `variant: "static" | "dynamic"`, `linkOptions` (analog to `domains: DomainDTO[]`), styling controls (`color`, `roundedModules`), logo file input, and a live-preview binding (new — no analog; likely a `computed`/`watch`-driven `<img :src="previewDataUrl">` bound to a debounced call into `apps/web/src/api.ts`'s new preview endpoint, or a client-side re-render trigger).

**Field-error mapping pattern**: `computed(() => mapLinkFormError(props.error))` (line 98) — add a sibling `mapQrFormError` in `api.ts`, following the exact same shape (see `api.ts` line 77, `unknown): LinkFormFieldErrors`).

**Submit payload pattern** (lines 129-142, `handleSubmit`): build the emitted payload from local refs, using `undefined`/`null`/value tri-state discipline exactly like `password`/`expiresAt` do here (omitted = keep, `null` = clear, value = set) for any QR field needing the same semantics (e.g. clearing a logo).

---

### `apps/web/src/views/LinkDetailView.vue` (modified — add QR entry point)

**Analog:** itself (existing 963-line file) — add a "Create QR Code" button/section following the same accordion/panel convention already used for the Security section (Phase 5) and tracking toggle (Phase 6, "Surface C1" per `LinkFormModal.vue` line 92 comment). No new structural pattern — extend the existing view using its own established accordion/section idiom.

---

### `apps/web/src/api.ts` (add QR API client functions)

**Analog:** existing Link functions in the same file (lines ~236-294: `createLink`, `listLinks`, `getLink`, `getLinkAnalytics`, `updateLink`, `deleteLink`)

Copy the exact `fetch`-wrapper + typed-Promise-return shape for each new function: `createQrCode(input: CreateQrCodeInput): Promise<QrCodeDTO>`, `listQrCodes(...)`, `getQrCode(id): Promise<QrCodeDTO>`, `updateQrCode(id, data: UpdateQrCodeInput): Promise<QrCodeDTO>`, `deleteQrCode(id): Promise<void>`, `getQrRemapHistory(id): Promise<QrRemapHistoryEntryDTO[]>`.

---

### `apps/api/test/qrCodes.integration.test.ts` (test, CRUD)

**Analog:** `apps/api/test/links.integration.test.ts`

Copy the testcontainers-backed real-Postgres setup, the `describe`/`it` grouping by endpoint, and the IDOR-guard test pattern (identical-404-for-not-found-and-forbidden assertions) verbatim in structure. Add a dedicated negative test per CONTEXT.md's "Specific Ideas": re-point a dynamic QR's target, then assert the OLD printed `code` still resolves (dynamic-code-stability guarantee) — this is the headline correctness test for this phase and has no existing analog test to copy verbatim; write it fresh but house it in this same file/style.

### `apps/api/test/qrDecode.test.ts` (test, transform) — **No close analog**

No existing test in the codebase exercises binary image generation or QR decode round-trips. Structure the `describe`/`it` blocks the same way `links.integration.test.ts` does (arrange/act/assert, one `it` per scenario), but the actual assertions (decode a generated PNG buffer / parsed SVG string back to the encoded URL, for both no-logo and logo-enabled + forced `errorCorrectionLevel: 'H'`) are new territory — use a QR-decode library (e.g. `jsQR` against a rasterized buffer) as the test-only dependency; this is explicitly called out as a blocking test in CONTEXT.md ("Decode-round-trip test is a hard success criterion for BOTH PNG and SVG with a logo enabled").

### `apps/web/src/views/QrCodesView.test.ts` (test, request-response)

**Analog:** `apps/web/src/views/LinksView.test.ts` — copy `@vue/test-utils` mount pattern, `vi.mock('../api')` stubbing shape, and list-render/create-flow/delete-flow test cases verbatim in structure.

### `apps/web/src/components/QrFormModal.test.ts` (test, request-response)

**Analog:** `apps/web/src/components/LinkFormModal.test.ts` — copy prop-driven mount + emit-assertion pattern (`wrapper.emitted('submit')`) verbatim in structure; add cases for styling controls and logo upload that have no LinkFormModal equivalent.

---

## Shared Patterns

### Single-Write-Path Discipline (D-01 equivalent for QR)
**Source:** `apps/api/src/lib/links.ts` (header comment, lines 1-31, and `createLink`/`updateLink`, lines 347-415)
**Apply to:** `apps/api/src/lib/qrCodes.ts` — exactly one `prisma.qrCode.create` call site, exactly one `prisma.qrCode.update` (content-fields) call site, with a doc comment naming this file as the sole gate. The redirect handler's click hook is the one intentional narrow exception (mirrors `redirect.ts`'s `recordClickHook` touching only `lifetimeClicks`).

### IDOR Guard (identical-404 no-existence-oracle)
**Source:** `apps/api/src/routes/links.ts`'s `resolveOwnedLink` (lines 187-194) and `apps/api/src/routes/analytics.ts`'s copy of the same function (lines 50-57)
**Apply to:** `apps/api/src/routes/qrCodes.ts`, `apps/api/src/routes/qrRedirect.ts` (for QR ownership checks, not the public `/q/:code` GET itself which is intentionally public)
```typescript
async function resolveOwnedX(prisma: PrismaClient, userId: string, id: string): Promise<X | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.x.findFirst({ where: { id, domainId: { in: domainIds } } }); // adapt join path
}
```

### Mass-Assignment Guard (Zod allowlist)
**Source:** `apps/api/src/routes/links.ts`'s `createLinkSchema`/`updateLinkSchema` (lines 48-94)
**Apply to:** all QR route request bodies — never pass `request.body` through untouched; `code`, `scanCount`, `createdAt` etc. must never be client-settable.

### Click-Tracking Seam (parameterized `source`)
**Source:** `apps/api/src/routes/redirect.ts`'s `recordClickHook` (lines 82-112), `ScanSource.qr` enum value (schema.prisma lines 221-224), and `apps/api/src/lib/analytics.ts`'s already-live `qrScans` query (lines 191-197)
**Apply to:** `apps/api/src/routes/qrRedirect.ts` — call the same transaction-batched insert with `source: "qr"`; do not write a second/parallel ClickEvent-insert code path (mirrors the "one write site" discipline applied to Links).

### DTO / JSON-boundary convention
**Source:** `packages/shared/src/index.ts` (all DTOs) + each `toXDto()` mapper
**Apply to:** `QrCodeDTO`, `QrRemapHistoryEntryDTO` — ISO 8601 date strings only, never raw `Date`; internal-only fields (if any) never cross the boundary, mirroring `passwordHash` never appearing on `LinkDTO`.

### Vue Modal Props/Emit Shape
**Source:** `apps/web/src/components/LinkFormModal.vue` (lines 30-76, 129-142)
**Apply to:** `apps/web/src/components/QrFormModal.vue` — `mode: "create" | "edit"`, `initial*` props, single `submit` emit with a full payload object, `error?: unknown` mapped via a co-located `mapXFormError` helper in `api.ts`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/api/src/lib/qr.ts` (qrcode + sharp generation/compositing) | service/utility | transform | No existing binary-image-generation or file-compositing code in the codebase — this is genuinely new territory. Follow RESEARCH's/CONTEXT's stack guidance (`qrcode` for PNG buffer + SVG string, `sharp` for logo compositing, forced `errorCorrectionLevel: 'H'` when a logo is present) rather than an in-repo analog. |
| `apps/api/test/qrDecode.test.ts` (decode round-trip) | test | transform | No existing decode/image-assertion test exists; borrow only the `describe/it` structural convention from `links.integration.test.ts`, not its assertions. |
| Live-preview binding in `QrFormModal.vue` | component (sub-pattern) | streaming/transform | No existing live-preview-as-you-type UI pattern in the codebase (closest conceptual sibling is the accordion-summary `computed()` in `LinkFormModal.vue`, but that summarizes text, not a rendered image) — likely a debounced `watch` calling a preview endpoint or generating client-side; Claude's Discretion per CONTEXT.md. |

## Metadata

**Analog search scope:** `apps/api/src/lib/`, `apps/api/src/routes/`, `apps/api/test/`, `apps/api/prisma/schema.prisma`, `packages/shared/src/`, `apps/web/src/views/`, `apps/web/src/components/`, `apps/web/src/api.ts`
**Files scanned:** ~10 read in full (links.ts, links routes, redirect.ts, analytics.ts lib+route, shared/index.ts, LinkFormModal.vue head, schema.prisma model sections, api.ts export grep)
**Pattern extraction date:** 2026-07-20
