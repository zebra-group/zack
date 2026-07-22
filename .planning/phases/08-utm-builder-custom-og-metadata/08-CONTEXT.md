# Phase 8: UTM Builder + Custom OG Metadata - Context

**Gathered:** 2026-07-22
**Status:** Ready for planning
**Mode:** Auto-decided during an authorised unattended autonomous run (see `.planning/STATE.md`). Every grey area below was resolved by Claude rather than asked; each records its rationale so the choices can be reviewed and reversed.

<domain>
## Phase Boundary

Users can enrich links with campaign-tracking parameters and custom social-preview metadata, entirely through user-typed fields — no server-side fetching of the destination, sidestepping the SSRF surface entirely.

**Requirements:** META-01 (UTM builder with live preview of the final destination URL), META-02 (per-link custom OG title/description/image with social-card preview, and those exact values served to bots).

**In scope:** the six new Link fields, their validation, their effect on the redirect path and the bot/OG path, and the two accordion sections in the link form plus the corresponding badges/chips.

**Out of scope:** UTM term/content (the requirement names source/medium/campaign only), OG image upload/hosting (a URL field only), per-domain or per-team OG defaults, and any server-side fetch of the destination for preview purposes — that last one is explicitly forbidden, not merely deferred.
</domain>

<decisions>
## Implementation Decisions

### D-08-01 — UTM parameters are stored as their own columns, not baked into `targetUrl`

The prototype README describes the parameters as "beim Erstellen an die Ziel-URL angehängt", which reads as string concatenation at save time. Storing them separately instead, and appending them when the redirect is built, is the better shape and still produces exactly the behaviour the prototype shows:

- The link list and detail screens have to render a "UTM" badge / "UTM-Parameter gesetzt" chip. That requires knowing the parameters are set, which a concatenated URL cannot tell you apart from a target that always had them.
- Re-opening the form to edit a link has to repopulate the three inputs.
- `targetUrl` stays the clean thing the user typed, so editing the target later does not silently drop or duplicate campaign parameters.

The live preview in the form shows `targetUrl` + parameters, which is what "Live-Vorschau der finalen Ziel-URL" asks for.

### D-08-02 — Owner-configured UTM parameters override same-named parameters already on the target

`mergeQuery` (D-13, Phase 5) resolves conflicts in favour of the target when forwarding a *visitor's* incoming query — the visitor must not be able to rewrite the destination. UTM parameters are the opposite situation: the link owner typed them into this link's own builder, so they express the owner's intent and win over whatever the stored target happens to carry.

Resulting order when building a redirect target:
1. start from `targetUrl`
2. apply the link's UTM parameters, overriding same-named keys
3. if `forwardQuery` is on, merge the visitor's incoming query with `mergeQuery`'s existing target-wins rule (the result of step 2 being "the target")

This keeps D-13 intact for the visitor-facing case while making the builder actually authoritative.

### D-08-03 — Custom OG values are served to bots for every link state

D-06 gives detected bots a generic branded 200 for every link, including protected and expired ones, so that a crawler never receives a redirect and never sees the destination. Custom OG values are owner-authored text that never touches the destination, so serving them preserves the property D-06 exists to protect while satisfying META-02's "these user-typed values are exactly what bots/crawlers receive".

Concretely: bots still get a 200, still never get redirected, and the response still never embeds `targetUrl`. Only the title/description/image content changes, and only to values the owner typed. Fields the owner left blank keep their current generic brand fallback.

### D-08-04 — The OG image is a URL the server never fetches

`ogImageUrl` is validated for shape only (absolute `http:`/`https:` URL) and emitted into the `og:image` attribute escaped. The server never requests it — that is the whole anti-SSRF point of the phase. The form preview loads the image in the *browser*, which is the user's own request to a URL they typed, not a server-side fetch.

Rejecting non-`http(s)` schemes matters: `javascript:` or `data:` in an `og:image` is both useless to crawlers and a needless injection surface.

### D-08-05 — Validation limits

UTM values: max 200 characters each, and percent-encoded when appended so a user-typed space or ampersand cannot corrupt the query string. No character allowlist — campaign names legitimately contain punctuation and non-ASCII.

OG title: max 200 characters. OG description: max 500. OG image URL: max 2048. These are storage limits, deliberately looser than the ~60/~155 characters social platforms actually display; the form shows the platform-relevant guidance without blocking longer values.

All six fields are optional and nullable, and follow the existing three-state PATCH contract already used for `password`/`expiresAt` (absent = keep, `null`/empty = clear, value = set).

### D-08-06 — Writes go through `lib/links.ts`

The six fields are threaded through `createLink`/`updateLink` exactly like `forwardQuery` and `trackingEnabled` before them (D-01's single-write-path rule). No route may write them directly, and they are never mass-assignable — each is an explicit field on the Zod allowlist.

### Claude's Discretion

Naming, file layout, component decomposition, and test breakdown follow the conventions the codebase has already established over phases 4-7.
</decisions>

<code_context>
## Existing Code Insights

- `apps/api/src/lib/links.ts` — the sole write path (D-01). `forwardQuery` and `trackingEnabled` are the closest analogues for threading a new optional field end to end; `expiresAt`/`password` are the analogue for the three-state PATCH contract.
- `apps/api/src/lib/redirectEngine.ts` — pure, Fastify-free. `mergeQuery` already implements target-wins merging and is the natural place for the UTM application helper, which keeps it unit-testable without a database.
- `apps/api/src/routes/redirect.ts` — builds the final target in the `state === "ok"` branch. Phase 7 added the `?qr=` marker strip here; the UTM application belongs in the same spot.
- `apps/api/src/lib/publicHtml.ts` — `renderBotOgPage` currently hardcodes brand-only OG tags and already escapes everything through `escapeHtml`. It takes a `BotOgPageCtx`, so custom values are an additive change to that context type.
- Both `routes/redirect.ts` and `routes/qrRedirect.ts` call `renderBotOgPage`, so a signature change has two call sites.
- `apps/web/src/components/LinkFormModal.vue` — already implements the accordion pattern with the "Passwort & Ablauf" section and the `· N gesetzt` header summary. The two new sections slot in beside it.
- `apps/web/src/api.ts` — `mapLinkFormError` maps typed API error codes to inline field errors; new validation codes follow that pattern.
- `packages/shared` — `LinkDTO` gains the six fields. Remember the shared package needs rebuilding before the API/web type-checks see the change.

## Prototype Contract (design_handoff README §3)

- Three accordion sections, only one open at a time, header `padding:10px 14px`, 13px/500, ▸/▾ indicator, summary in the header (e.g. `· 2 gesetzt`).
- **UTM section:** three inputs side by side (source/medium/campaign) plus a live preview of the assembled URL — monospace, `var(--chip)` background box, `word-break:break-all`.
- **OG section:** title/description/image-URL inputs on the left, a fixed 210px social-card live preview on the right (image placeholder 76px with a hatch pattern, title 11.5px/600, description 10.5px muted, domain 9.5px monospace). Caption: „Vorschau · Slack / X / LinkedIn".
- **Badges/chips:** link list rows show pill badges (10.5px, `var(--chip)`) including „UTM" and „OG"; the link detail chips row shows „UTM-Parameter gesetzt" and „Custom OG-Tags".
</code_context>

<specifics>
## Specific Ideas

- The UTM preview must handle a target that already has a query string, producing `?`/`&` correctly — the prototype calls this out explicitly.
- The preview should update live as the user types, with no request to the server.
- The social-card preview shows the link's own short domain in its domain line, not the destination host — consistent with the no-leak posture everywhere else in the product.
- An OG image URL that fails to load in the browser should degrade to the hatched placeholder rather than showing a broken image.
</specifics>

<deferred>
## Deferred Ideas

- UTM `term` and `content` parameters — outside META-01's stated three.
- Uploading an OG image to Kurzly instead of linking one.
- Reusable campaign presets or per-domain OG defaults.
- Rendering a real preview of how each individual social platform crops the card.
</deferred>
