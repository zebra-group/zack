---
phase: 08-utm-builder-custom-og-metadata
reviewed: 2026-07-22T22:15:09Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - apps/api/prisma/schema.prisma
  - apps/api/prisma/migrations/20260722202851_add_link_utm_and_og_metadata/migration.sql
  - apps/api/src/lib/links.ts
  - apps/api/src/routes/links.ts
  - apps/api/src/lib/redirectEngine.ts
  - apps/api/src/lib/publicHtml.ts
  - apps/api/src/routes/redirect.ts
  - apps/api/src/routes/qrRedirect.ts
  - packages/shared/src/index.ts
  - apps/web/src/lib/utm.ts
  - apps/web/src/api.ts
  - apps/web/src/components/LinkFormModal.vue
  - apps/web/src/views/LinksView.vue
  - apps/web/src/views/LinkDetailView.vue
findings:
  critical: 1
  warning: 1
  info: 1
  total: 3
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-22T22:15:09Z
**Depth:** standard
**Files Reviewed:** 12 source files (+ their tests)
**Status:** issues_found

## Summary

Phase 8 adds six per-link fields (UTM trio + OG trio) with a single validated
write path, a redirect-time UTM applicator, bot-facing OG rendering, and the
frontend builder UI.

The four security properties called out for the hardest scrutiny all hold:

- **No server-side fetch of `ogImageUrl`.** A repo-wide grep for
  `fetch(`/`axios`/`got`/`undici`/`http.get` against the image URL (and across
  `apps/api/src` generally) finds nothing. The value is validated http(s)-only
  at write time (`ogImageUrlSchema`, `lib/links.ts:139`), re-validated at render
  (`isAbsoluteHttpUrl`, `publicHtml.ts:342`), and only ever emitted as an escaped
  attribute value. The anti-SSRF invariant is intact.
- **OG HTML escaping is airtight.** Every interpolated field in
  `renderBotOgPage` (`title`, `og:title`, `og:description`, `og:image`,
  `og:url`) is routed through `escapeHtml`, which escapes `& < > " '` with `&`
  first. Attribute-breakout (`"`) and tag-injection (`<`/`>`) are both covered;
  fallbacks that interpolate `ctx.domain`/`ctx.brand` unescaped are re-escaped by
  the final `escapeHtml(resolved…)` call. `javascript:`/`data:` image URLs are
  rejected at both write and render.
- **`applyUtmParams` never touches scheme/host/path** — only `searchParams` is
  mutated, and it returns the raw input string byte-for-byte when no UTM value is
  set (no `new URL()` round-trip), preserving the Phase-5 "redirect to exactly
  what was saved" guarantee.
- **The `?qr=` marker is stripped before the `forwardQuery` merge** on `/:slug`
  (`redirect.ts:297`), so the Kurzly-internal marker cannot leak to the
  destination.

However, one real correctness defect was found: the UTM applicator is wired into
the direct-`GET` redirect on both handlers but **not** into the
password-unlock (`POST …/verify`) redirect, so protected links silently lose UTM
attribution. Details below.

The API test harness (per-file cloned DB + truncation) is respected: the new
integration tests scope every `clickEvent.count(...)` by `linkId` and assert no
absolute cross-file row counts, so none of them assume a shared database.

## Critical Issues

### CR-01: UTM parameters are dropped on the password-unlock redirect

**File:** `apps/api/src/routes/redirect.ts:368`, `apps/api/src/routes/qrRedirect.ts:244`
**Issue:**
The `GET /:slug` and `GET /q/:code` "ok" branches correctly build the redirect
target via `applyUtmParams(link.targetUrl, link)` (`redirect.ts:307`,
`qrRedirect.ts:181`). But the `POST /:slug/verify` and `POST /q/:code/verify`
success branches redirect straight to the bare stored target:

```ts
issueUnlockCookie(reply, link.id, `/${slug}`, link.passwordHash);
return reply.code(302).redirect(link.targetUrl); // <-- no applyUtmParams
```

For a **password-protected link that has UTM parameters set**, the only path to
the destination is: `GET /:slug` → password page (no redirect) → `POST verify` →
302 to `link.targetUrl`. Because the verify branch bypasses `applyUtmParams`, the
owner's `utm_source`/`utm_medium`/`utm_campaign` are **never applied** for
protected links — the headline feature of this phase silently fails on a
first-class link configuration.

The in-code comment (`redirect.ts:363-367`) justifies omitting the `forwardQuery`
merge here (the visitor's query arrived on the original `GET`), which is valid —
but that reasoning does **not** extend to UTM parameters, which are
owner-configured and independent of any visitor query. This is an oversight, not
a deliberate exclusion. The test suite confirms the gap: the protected+UTM test
(`redirect.integration.test.ts:702`) only asserts the pre-unlock `GET` returns
200 with no `Location`; no test exercises UTM on the post-verify redirect.

**Fix:** Apply UTM at the verify redirect exactly as the GET branch does (the
`forwardQuery` merge is correctly still skipped — there is no visitor query on the
POST):

```ts
// redirect.ts (POST /:slug/verify success branch)
issueUnlockCookie(reply, link.id, `/${slug}`, link.passwordHash);
return reply.code(302).redirect(applyUtmParams(link.targetUrl, link));

// qrRedirect.ts (POST /q/:code/verify success branch)
issueUnlockCookie(reply, link.id, `/q/${code}`, link.passwordHash);
return reply.code(302).redirect(applyUtmParams(link.targetUrl, link));
```

Add an integration test asserting a protected link with `utmSource` set carries
the UTM param in the post-verify `Location`.

## Warnings

### WR-01: `applyUtmParams` deletes a target's manually-embedded UTM keys the builder did not set

**File:** `apps/api/src/lib/redirectEngine.ts:146-153` (mirrored in `apps/web/src/lib/utm.ts:70-73`)
**Issue:**
Once *any* of the three builder fields is set, `applyUtmParams` unconditionally
deletes all three canonical keys from the target and then re-sets only the ones
that are non-empty:

```ts
target.searchParams.delete("utm_source");
target.searchParams.delete("utm_medium");
target.searchParams.delete("utm_campaign");
if (isSetUtmValue(utm.utmSource)) target.searchParams.set("utm_source", ...);
// medium / campaign only set if present
```

Consequence: if an owner stored `targetUrl = https://shop.com/?utm_campaign=fall`
and later fills only `utm_source` in the builder (leaving `utm_campaign` blank),
the redirect emits `https://shop.com/?utm_source=…` — the owner's manually-typed
`utm_campaign=fall` is silently dropped, causing attribution loss on a value the
owner never intended to clear. The `delete` is documented as being for
canonical-ordering, but the code deletes keys it does not re-set, which goes
beyond ordering.

This is not a security issue, and the client preview (`utm.ts`) mirrors the same
behavior so the UI is at least WYSIWYG-consistent, which lowers the surprise. But
it is a real footgun: partial use of the builder erases pre-existing UTM params on
the target.

**Fix:** Only remove keys that will be re-set (delete-then-set per present field),
so an unset builder field leaves any target-embedded value untouched:

```ts
if (isSetUtmValue(utm.utmSource)) {
  target.searchParams.delete("utm_source");
  target.searchParams.set("utm_source", utm.utmSource);
}
// repeat for medium / campaign
```

Mirror the same change in `apps/web/src/lib/utm.ts` so the preview stays accurate.
If the current "the builder owns all three keys" semantics are intentional,
document it explicitly in the builder UI (the accordion copy) so owners know
opening the builder clears any UTM already in their target URL.

## Info

### IN-01: `LinkDetailView` edit modal silently ignores the modal's tracking toggle

**File:** `apps/web/src/views/LinkDetailView.vue:324-336`
**Issue:**
`handleEditSubmit` forwards every Phase 8 field to `updateLink` but omits
`trackingEnabled`, which `LinkFormModal` still renders and emits in its footer
toggle. In the detail view a separate optimistic toggle owns that field
(`LinkDetailView.vue:202-213`), so a change made via the *modal's* toggle is
discarded on save. This predates Phase 8 (the omission is not introduced by the
UTM/OG threading) and does not affect the UTM/OG feature, so it is noted only for
awareness — verify the detail-view modal does not expose a tracking toggle at all,
or forward the value like `LinksView.vue` does.

---

_Reviewed: 2026-07-22T22:15:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
