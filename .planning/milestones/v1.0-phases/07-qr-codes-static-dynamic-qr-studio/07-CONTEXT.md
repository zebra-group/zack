# Phase 7: QR Codes (Static + Dynamic, QR Studio) - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning
**Mode:** Auto-generated (smart-discuss, autonomous hands-off — grey-area defaults auto-accepted)

<domain>
## Phase Boundary

Users can generate scannable static and dynamic QR codes for their links —
static QR (bound to an existing short link, PNG + SVG export) and dynamic QR
(own short URL `/q/xxxx`, re-pointable without invalidating the printed code,
with visible remap history), plus centered logo overlay (auto EC-level H),
color + rounded-module styling in a QR Studio, and a per-code scan count.

In scope: QR generation service (qrcode + sharp), QrCode + remap-history data
model, `/q/:code` dynamic redirect handler, QR Studio UI, scan tracking via the
existing `source='qr'` ClickEvent seam. Out of scope: bulk QR generation,
non-link QR payloads (vCard/wifi), print/PDF layout sheets — defer.

</domain>

<decisions>
## Implementation Decisions

### QR Generation & Export
- Server-side generation via `qrcode` (node-qrcode) for PNG buffer + SVG string; no client-side QR rendering (single tested code path).
- Export both PNG and SVG for every code; each format covered by an automated decode-round-trip test (QR-01, QR-05).
- Logo overlay: centered composite via `sharp` for PNG; `<image>` data-URI injection into the SVG string for SVG. Whenever a logo is enabled, force `errorCorrectionLevel: 'H'` automatically (QR-05).
- Styling: foreground color + rounded-module toggle applied at generation time (QR-06).

### Dynamic QR Model & Routing
- New `QrCode` model: `static` variant references a Link directly; `dynamic` variant owns its own `/q/:code` short code and points at a current target Link.
- Dynamic redirect handler lives at `/q/:code` (namespace already reserved in `apps/api/src/lib/links.ts`), resolving to the current target — re-pointing never changes the printed code (QR-02, QR-03).
- `QrRemapHistory` rows record every target change (from→to link, timestamp) for the visible remap history (QR-04).
- Single-write-path discipline mirrored from Links: exactly one `createQrCode`/`updateQrCode` path; styling/target fields never mass-assignable outside it.

### QR Studio (UI)
- Surfaces: the existing `/qr-codes` route (currently ComingSoonView) becomes the QR list/studio; QR creation also reachable from Link detail.
- Controls: color picker + rounded-module toggle with a live preview of the rendered code (QR-06).
- Per-code scan count displayed (QR-07), derived from `source='qr'` ClickEvents.
- Visual language: reuse `apps/web/src/styles/tokens.css` and the component/state patterns established in 04-UI-SPEC (list/table + form modal) and 06-UI-SPEC (stat display). UI-SPEC to be generated next.

### Scan Tracking
- Dynamic QR scans recorded through the Phase-6 click seam with `source='qr'` (enum + analytics query already prepared in Phase 6).
- Same privacy guarantees as Phase 6 (no raw IP, salted visitor hash, zero-rows-when-off semantics as applicable).
- Scan counter pruning-resistant, analogous to `Link.lifetimeClicks`.

### Claude's Discretion
- Exact QrCode schema field names, code-generation alphabet/length for `/q/:code`, and QR Studio component decomposition are at Claude's discretion, guided by codebase conventions and the forthcoming UI-SPEC.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ScanSource.qr` enum value already exists (Prisma schema); Phase-6 analytics already has a `source='qr'` scan-count query stub (`apps/api/src/lib/analytics.ts`).
- `/q` short-URL namespace already reserved in `apps/api/src/lib/links.ts` reserved-slug list.
- `/qr-codes` route + nav entry already wired (`apps/web/src/router/index.ts`, `AppShell.vue`) — currently ComingSoonView.
- Design tokens in `apps/web/src/styles/tokens.css`; LinkFormModal + LinksView are the closest UI analogs.

### Established Patterns
- Single-write-path (`lib/links.ts`), Zod input validation with mass-assignment guards, DTO mapping in `packages/shared`, IDOR-safe domain-scoped routes (identical-body 404), real-Postgres integration tests via testcontainers.

### Integration Points
- QR routes register alongside existing `/api/links/*`; `/q/:code` redirect handler registers near the existing redirect handler (before `@fastify/static` fallback).
- Scan tracking hooks the existing redirect click seam (Phase 6).

</code_context>

<specifics>
## Specific Ideas

- Decode-round-trip test is a hard success criterion for BOTH PNG and SVG with a logo enabled — treat as a blocking test.
- Dynamic-code stability across remap is the headline correctness guarantee — negative test: re-point target, assert old printed code still resolves.

</specifics>

<deferred>
## Deferred Ideas

- Bulk QR generation, non-link payloads (vCard/wifi), print/PDF sheet layouts, animated/gradient QR styling — out of scope for v1.

</deferred>
