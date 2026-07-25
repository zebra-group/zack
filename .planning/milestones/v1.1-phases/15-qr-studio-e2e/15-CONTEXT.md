# Phase 15: QR Studio E2E - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss — user is AFK, proceeding without pausing for questions.

<domain>
## Phase Boundary

Prove static QR generation with customization (color/rounding/logo) decodes back to its real target URL, dynamic `/q/:code` QR remapping resolves correctly across a remap (with an ordered history record), and both PNG and SVG export produce valid downloadable files. Reuses the Phase 14 links fixture pattern (a Link must exist before a QR code can target it).

</domain>

<decisions>
## Known facts (verified against actual source, not assumed)

- **QR generation stack** per project CLAUDE.md: `qrcode` (node-qrcode) for QR matrix/PNG/SVG generation with `errorCorrectionLevel: 'H'` when a logo overlay is requested, `sharp` for raster logo compositing, manual SVG string `<image>` injection for the SVG logo path. Confirm the ACTUAL implementation in apps/api during phase research — do not assume the CLAUDE.md's stack recommendation was followed exactly; verify against real source.
- **Decode round-trip** for QR-E2E-01 needs a real QR-decoding library in the E2E harness (not part of the app itself) — research must identify and, if needed, add a QR-decode npm package (e.g. `jsqr` or similar) as an `apps/e2e` devDependency, or determine whether Playwright/a headless approach can decode the rendered image content some other way.
- **Static vs. dynamic QR distinction**: static QR encodes the target URL directly; dynamic QR encodes a stable `/q/:code` redirect URL that can be remapped without regenerating the QR image itself — confirm the actual DB schema/route naming for this (QrCode model, remap history table) during research, do not assume field names.
- **Reuses Phase 14's link fixture pattern**: a Link (or equivalent target) must exist for a QR code to be generated against — direct-Prisma link fixture creation via `apps/e2e/src/links.ts`'s `createE2eLink` is the established pattern to reuse here for setup, with real-UI QR generation being this phase's own subject (mirroring Phase 14's "the feature under test IS the UI flow" principle).

## Claude's Discretion

- Exact npm package for QR decode verification in the E2E harness — planner/researcher's call once the real QR image format (PNG buffer vs. SVG string vs. data URL) is confirmed.
- Whether QR customization (color/rounding/logo) is asserted via decode-round-trip alone, or whether the customization itself needs a secondary visual/structural assertion (e.g. confirming a logo was actually composited) — read the actual Studio UI/backend during research to judge what's practically assertable in an E2E context vs. what belongs to existing v1.0 unit/integration tests.
- Spec file layout under `apps/e2e/tests/authed/` (same testMatch constraint discovered in Phase 14 research — confirm this still applies, and whether QR specs need chromium-admin only or also chromium-member).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/e2e/src/links.ts` (Phase 12/14) — `createE2eLink`, `fetchWithFixtureRaceRetry` — reusable for link-fixture setup.
- `apps/e2e/src/db.ts` — seedBaseline/admin+member fixtures.
- Phase 14's established pattern: real-UI-driven test for the phase's own subject, direct-Prisma fixtures for setup-only dependencies.

### Established Patterns
- `apps/e2e/tests/authed/` is the ONLY directory Playwright's `chromium-admin`/`chromium-member` projects will pick up (confirmed Phase 14 research) — QR specs must live there too unless research finds a reason otherwise.
- Zero `data-testid` attributes exist anywhere in `apps/web/src` (confirmed Phase 14 research) — use role/placeholder/CSS-class-based selectors verified against actual QR Studio markup.

</code_context>

<specifics>
## Specific Ideas

None beyond what's captured above — read the actual QR generation backend routes/lib, the Studio Vue view/components, and the QR remap-history schema during phase research before planning.

</specifics>

<deferred>
## Deferred Ideas

- Analytics/click-tracking on QR-code-driven redirects — Phase 16's job.
- Team/domain-scoped authorization on QR CRUD — Phase 17's job.

</deferred>
