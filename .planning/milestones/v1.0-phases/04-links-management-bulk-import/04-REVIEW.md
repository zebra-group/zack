---
phase: 04-links-management-bulk-import
reviewed: 2026-07-11T21:07:55Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - apps/api/prisma/schema.prisma
  - apps/api/src/app.ts
  - apps/api/src/lib/links.ts
  - apps/api/src/plugins/rateLimit.ts
  - apps/api/src/routes/links.ts
  - apps/web/src/api.ts
  - apps/web/src/router/index.ts
  - apps/web/src/components/LinkFormModal.vue
  - apps/web/src/views/LinksView.vue
  - apps/web/src/views/LinkDetailView.vue
  - apps/web/src/views/LinksImportView.vue
  - packages/shared/src/index.ts
  - apps/api/test/links.integration.test.ts
  - apps/api/test/links-import.integration.test.ts
  - apps/web/src/views/LinksView.test.ts
  - apps/web/src/components/LinkFormModal.test.ts
  - apps/web/src/views/LinkDetailView.test.ts
  - apps/web/src/views/LinksImportView.test.ts
findings:
  critical: 0
  warning: 10
  info: 5
  total: 15
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-11T21:07:55Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

The D-01 single-write-path invariant (one `prisma.link.create` site, one `prisma.link.update` site, CSV import routed row-by-row through the same `createLink`/`previewLink` core) is genuinely upheld — verified structurally (`grep` confirms exactly one `.link.create(` and one `.link.update(` call site, both in `lib/links.ts`) and behaviorally (the integration suite's "no-bypass proof" asserts zero DB leakage for every skip reason). The IDOR guard (`resolveOwnedLink`) correctly collapses "not found" and "forbidden" into an identical 404 body for GET/PATCH/DELETE `/api/links/:id`. Open-redirect/scheme validation uses Zod's WHATWG-URL-backed `z.url({ protocol })`, not a hand-rolled regex, and is covered by tests for `javascript:`/`data:`/`file:`. The auto-slug retry loop is bounded (`AUTO_SLUG_RETRY_LIMIT = 5`) with no infinite-loop risk, and CSV import enforces `MAX_IMPORT_ROWS` before any row is processed.

No BLOCKER-tier defects were found. However, several WARNING-tier correctness gaps surfaced on close inspection of the edges of these same invariants: a `PATCH` request can silently regenerate a link's slug via an empty string (undermining the D-04 "always warn before slug change" design intent), `title: null` can never actually clear a title despite the schema explicitly supporting it, Domain `status` (pending/active/failed) is never checked before a Link is created against it (manual or CSV), the auto-generated-slug path skips the `RESERVED_SLUGS` check entirely (low-probability but real gap in an explicitly-documented invariant), two IDOR-adjacent code paths do one extra DB query on the "exists but forbidden" branch vs. "does not exist" (a timing side channel the codebase's own stated goal is to avoid), the live-search input on `/links` has no debounce/cancellation (classic out-of-order response race), and CSV import isn't atomic so a mid-loop unexpected error leaves partial rows committed while reporting a bare failure.

## Warnings

### WR-01: `PATCH /api/links/:id` with an empty-string slug silently regenerates the slug instead of no-op or validation error

**File:** `apps/api/src/routes/links.ts:255`, `apps/api/src/lib/links.ts:128`
**Issue:** `updateLinkSchema.slug` is `z.string().optional()` with no `.min(1)`. The route does `slug: parsed.data.slug ?? link.slug` — since `""` is not nullish, an explicit `slug: ""` in the PATCH body is passed straight through (not coalesced to the current slug). Inside `resolveSlug` (`lib/links.ts:128`), the guard is `if (slug && slug.length > 0)`, so an empty string falls into the **auto-generation branch** exactly like an omitted slug — producing a brand-new random Base62 slug and silently breaking the link's existing shared URL. This directly undermines D-04's design intent (a slug change must always be visible/warned-about to the user) since it can happen without the user ever seeing the slug-change warning banner, purely by a client (script, curl, future integration) sending `{ "slug": "" }`. The built-in `LinkFormModal.vue` avoids this by converting a blank field to `undefined` client-side, but nothing on the server enforces that — the server is supposed to be the authoritative validation boundary per this file's own header comment.
**Fix:**
```ts
// routes/links.ts — normalize blank strings to "keep current" before calling updateLink
const requestedSlug = parsed.data.slug?.trim() || undefined;
const result = await updateLink(prisma, id, {
  userId,
  domainId: link.domainId,
  targetUrl: parsed.data.targetUrl ?? link.targetUrl,
  slug: requestedSlug ?? link.slug,
  title: /* ... */,
});
```

### WR-02: `PATCH /api/links/:id` can never actually clear `title` via `null`

**File:** `apps/api/src/routes/links.ts:256-257`
**Issue:** `updateLinkSchema.title` is `z.string().max(200).nullable().optional()`, explicitly supporting a client sending `title: null` to clear it. But the route's mapping is:
```ts
title:
  parsed.data.title !== undefined ? (parsed.data.title ?? undefined) : (link.title ?? undefined),
```
When `parsed.data.title === null`, the outer ternary takes the "provided" branch, but `null ?? undefined` evaluates to `undefined` — and Prisma's `update` treats an `undefined` field value as "omit this field," not "set it to NULL." So a PATCH with `{ "title": null }` leaves the existing title completely unchanged, contradicting both the schema's stated capability and `ValidateLinkInputParams`/`ValidatedLink`'s `title?: string` type (which has no `| null` member at all — the null-clearing pathway is type-incompatible one layer down, confirming this was never actually wired through). Untested (no PATCH test in `links.integration.test.ts` exercises `title` at all).
**Fix:** Either drop `.nullable()` from the schema (if title-clearing isn't in scope for this phase) or thread `null` through properly: widen `ValidateLinkInputParams.title`/`ValidatedLink.title` to `string | null | undefined` and pass `parsed.data.title` straight through without the `?? undefined` collapse, converting `null` into a genuine Prisma `null` write, not an omission.

### WR-03: Manual create and CSV import never check `Domain.status` — links can be created against pending/failed (unverified) domains

**File:** `apps/api/src/lib/links.ts:180-201` (`validateLinkInput`), `apps/api/src/lib/links.ts:345-355` (`resolveRowDomainId`)
**Issue:** `validateLinkInput`'s only domain-related check is `requireDomainAccess(prisma, userId, domainId, "member")`, which validates role membership but never inspects `Domain.status`. The frontend filters the domain picker to `status === "active"` (`activeDomains` computed in `LinksView.vue`/`LinkFormModal.vue`/`LinksImportView.vue`), but this is UI-only convenience, not enforced server-side (matches this codebase's own stated principle that the client is never the access boundary — `api.ts`'s header comment). A member+ caller can `POST /api/links` (or CSV-import) directly with a `domainId` for a domain still `pending` or `failed` verification, and the write succeeds. Since the redirect engine (Phase 5) presumably should only serve traffic for `active` domains, this produces Link rows that are either premature (domain not yet verified — DNS ownership not proven) or permanently orphaned (domain verification failed) with no server-side guard preventing their creation.
**Fix:**
```ts
const domain = await prisma.domain.findUnique({ where: { id: input.domainId } });
if (!domain || domain.status !== "active") {
  return { ok: false, error: "UNAUTHORIZED_DOMAIN" }; // or a new DOMAIN_NOT_ACTIVE code
}
```
Add this check to `validateLinkInput` right after `requireDomainAccess` so both the manual-create and CSV-import paths inherit it automatically (D-01 single-core benefit).

### WR-04: Timing/query-count side channel between "link not found" and "link forbidden" in `resolveOwnedLink`

**File:** `apps/api/src/routes/links.ts:119-135`
**Issue:** `resolveOwnedLink` is explicitly documented as needing to make "not found" and "forbidden" indistinguishable to the caller (matches `tlsCheck.ts`'s established no-existence-oracle discipline, and is verified by a test asserting identical JSON bodies). However, the two paths are NOT symmetric in DB work: "not found" short-circuits after exactly one query (`prisma.link.findUnique`); "exists but forbidden" additionally awaits `requireDomainAccess`, which issues a second DB query (`prisma.domainMembership.findUnique`) before returning null. This is a genuine, structural timing/query-count asymmetry between the two cases this code explicitly set out to make indistinguishable — a caller doing statistical timing analysis over many requests could distinguish "this link id exists (in a domain I can't see)" from "this link id does not exist," partially defeating the no-existence-oracle goal for GET/PATCH/DELETE `/api/links/:id`.
**Fix:** Consider making both branches perform the same fixed DB work regardless of outcome (e.g. always run a role-membership lookup keyed off a resolved-or-dummy domainId before branching on the combined result), or explicitly document this as an accepted low-severity residual risk if the team decides the network-timing signal isn't practically exploitable at this endpoint's request volume.

### WR-05: Same timing/query-count asymmetry in CSV import's per-row domain resolution

**File:** `apps/api/src/lib/links.ts:345-355` (`resolveRowDomainId`), `apps/api/src/lib/links.ts:415-422` (`runImport`)
**Issue:** Mirrors WR-04 one layer up: `resolveRowDomainId` does one query (`prisma.domain.findUnique` by hostname). If the hostname doesn't exist, `runImport` short-circuits to `UNAUTHORIZED_DOMAIN` with **zero** further queries. If the hostname exists but the caller lacks membership, `createLink`/`previewLink` is invoked, which runs `requireDomainAccess` — a **second** query — before arriving at the same `UNAUTHORIZED_DOMAIN` code and `domain_unauthorized` skip reason. The response body is identical either way (by design, per the file's own comment: "unknown domain" and "domain I can't access" are meant to be indistinguishable), but the extra per-row query for existing-but-foreign domains is a measurable timing signal an attacker could use to enumerate valid hostnames registered on the instance via CSV import row timing, at 5 requests/15min per the `LINK_IMPORT_RATE_LIMIT`.
**Fix:** Same remediation direction as WR-04 — normalize the DB work performed on both branches, or accept and document the residual risk.

### WR-06: Auto-generated slugs never check `RESERVED_SLUGS`

**File:** `apps/api/src/lib/links.ts:146-157`
**Issue:** The custom-slug branch of `resolveSlug` checks `RESERVED_SLUGS.has(slug.toLowerCase())` before accepting a caller-supplied slug (`lib/links.ts:132-134`). The **auto-generation branch** (blank slug → Base62 `generateSlug()`) has no equivalent check — it only verifies DB collision via `prisma.link.findUnique`. `RESERVED_SLUGS` is explicitly documented as "the single source of truth for 'a Link slug must never shadow a system/app route'" (file header comment), but that guarantee only actually holds for the custom-slug path. Given `generateSlug` draws from a 62-character mixed-case alphabet at 7 characters, the odds of colliding with a 7-character-or-shorter reserved word (e.g. all-lowercase `"domains"`, exactly 7 chars) are astronomically low (~1 in 3.5×10¹²) but not zero, and the invariant as documented is not actually universal.
**Fix:**
```ts
for (let attempt = 0; attempt < AUTO_SLUG_RETRY_LIMIT; attempt++) {
  const candidate = generateSlug();
  if (RESERVED_SLUGS.has(candidate.toLowerCase())) continue; // treat as a collision, retry
  const existing = await prisma.link.findUnique({ where: { domainId_slug: { domainId, slug: candidate } } });
  if (!existing || existing.id === excludeLinkId) return { ok: true, slug: candidate };
}
```

### WR-07: Custom-slug shape failures are mapped to the same `SLUG_RESERVED` error code as genuinely-reserved words, producing a misleading message

**File:** `apps/api/src/lib/links.ts:128-134`
**Issue:**
```ts
const shapeCheck = customSlugSchema.safeParse(slug);
if (!shapeCheck.success) return { ok: false, error: "SLUG_RESERVED" };
if (RESERVED_SLUGS.has(slug.toLowerCase())) return { ok: false, error: "SLUG_RESERVED" };
```
Any shape violation — too short (`<2` chars), too long (`>32`), or containing a character outside `[a-zA-Z0-9_-]` (space, dot, unicode, punctuation) — returns the exact same `SLUG_RESERVED` code as an actually-reserved word like `"api"`. On the frontend, `mapLinkFormError` (`apps/web/src/api.ts:75-76`) renders this as "Dieser Slug ist reserviert und kann nicht verwendet werden." ("This slug is reserved and cannot be used") even when the real problem is invalid characters or length — actively misleading the user about how to fix their input. This also means the `RESERVED_SLUGS` set-membership test for the single-character entry `"q"` (`links.integration.test.ts:184`, `"SLUG_RESERVED: rejects a reserved custom slug case-insensitively"`) passes for the wrong reason: `"q"` is 1 character and already fails `customSlugSchema.min(2)` before the `RESERVED_SLUGS.has()` line is ever reached, so that specific assertion provides false confidence that the reserved-word check (as opposed to the shape check) is exercised for `"q"`.
**Fix:** Introduce a distinct `SLUG_INVALID_SHAPE` (or similar) `LinkErrorCode` for the shape-check branch, map it to its own 400 message client-side (e.g. "Slug darf nur Buchstaben, Zahlen, `-` und `_` enthalten, 2–32 Zeichen"), and reserve `SLUG_RESERVED` exclusively for the `RESERVED_SLUGS.has()` branch so the test actually proves what its name claims.

### WR-08: No debounce or response-ordering guard on the live search input — concurrent requests can overwrite results out of order

**File:** `apps/web/src/views/LinksView.vue:200-206` (template), `apps/web/src/views/LinksView.vue:57-66` (`loadLinks`)
**Issue:** `<input v-model="searchQuery" @input="loadLinks" />` fires an independent `listLinks({ q, domainId })` request on every keystroke. Each call is a plain `async function loadLinks()` that unconditionally assigns `links.value = await listLinks(params)` on resolution — there is no request sequencing (no `AbortController`, no discard-if-stale-request guard, no debounce). If a user types quickly (e.g. "a", "ab", "abc"), three requests fire concurrently; if the network returns them out of order (a well-known race for anything but a same-tick synchronous mock), the UI can end up displaying results for a stale, already-superseded query — visibly wrong data with no indication anything went wrong. `selectDomain()` triggers the same unguarded `loadLinks()` call and can race with an in-flight search request too.
**Fix:**
```ts
let requestId = 0;
async function loadLinks(): Promise<void> {
  const thisRequest = ++requestId;
  try {
    const params: { q?: string; domainId?: string } = {};
    if (searchQuery.value.trim()) params.q = searchQuery.value.trim();
    if (selectedDomainId.value) params.domainId = selectedDomainId.value;
    const result = await listLinks(params);
    if (thisRequest === requestId) links.value = result; // discard stale responses
  } catch {
    if (thisRequest === requestId) showToast("Links konnten nicht geladen werden.");
  }
}
```
Consider also debouncing the `@input` handler (e.g. 200–300ms) to reduce request volume.

### WR-09: Non-`ApiError` failures during create/edit submit fail completely silently — no inline error, no toast

**File:** `apps/web/src/views/LinksView.vue:97-109` (`handleCreateSubmit`), `apps/web/src/views/LinksView.vue:129-141` (`handleEditSubmit`), `apps/web/src/views/LinkDetailView.vue:101-112` (`handleEditSubmit`)
**Issue:** All three handlers do:
```ts
try {
  const created = await createLink({ ... });
  // ...
} catch (err) {
  formError.value = err;
}
```
`formError` is passed to `LinkFormModal`'s `error` prop, which is mapped through `mapLinkFormError` — and `mapLinkFormError` explicitly returns `{}` for anything that is not an instance of `ApiError` (`apps/web/src/api.ts:70`: `if (!(err instanceof ApiError)) return {};`). A raw network failure (`fetch` rejecting with `TypeError: Failed to fetch`), a CORS error, or any other non-`ApiError` exception is silently swallowed: no inline field error renders, no toast fires, the modal just... does nothing, and the user has zero feedback that their submission failed. Contrast with `confirmDelete()` in the same files, which correctly falls back to a generic toast on any error.
**Fix:**
```ts
} catch (err) {
  formError.value = err;
  if (!(err instanceof ApiError)) {
    showToast("Speichern fehlgeschlagen. Bitte erneut versuchen.");
  }
}
```

### WR-10: CSV commit is not atomic — a mid-loop unexpected error leaves partial rows committed while the caller sees a bare failure

**File:** `apps/api/src/lib/links.ts:382-433` (`runImport`), `apps/api/src/routes/links.ts:319-352` (commit route handler)
**Issue:** `runImport` loops rows sequentially, calling `createLink` (a real, immediately-committed `prisma.link.create`, not wrapped in a transaction) per valid row. If an unexpected error occurs partway through the loop (e.g. a transient DB connectivity blip, not a `LinkErrorCode` outcome and not the `MAX_IMPORT_ROWS` `Error`), it propagates up through `commitImport` → the route handler, whose `catch` block only special-cases `isImportRowLimitError` and rethrows everything else (`routes/links.ts:345-350`), producing a generic 500. At that point, however, every row processed *before* the failure has already been durably written via `createLink`'s own commit — there is no rollback. The frontend (`LinksImportView.vue:132-137`) shows a flat "Import fehlgeschlagen." toast with no indication that some rows may have actually imported, and the user has no way to know which rows succeeded without navigating to `/links` and diffing manually.
**Fix:** At minimum, catch unexpected mid-loop errors inside `runImport`, and return the partial results collected so far (with an explicit `error` field) rather than letting the exception unwind past already-committed rows silently; surface the partial-success count to the user instead of a flat failure message.

## Info

### IN-01: `RESERVED_SLUGS` contains entries that are structurally unreachable via the check they're meant to power

**File:** `apps/api/src/lib/links.ts:67-83`, `apps/api/src/lib/links.ts:93-97`
**Issue:** `customSlugSchema` forbids dots (`/^[a-zA-Z0-9_-]+$/`) and requires `.min(2)`. This makes four `RESERVED_SLUGS` entries dead code specifically as *reserved-word* checks (they still get rejected, but via the shape-check branch, which returns the same error code per WR-07): `.well-known"`, `"favicon.ico"`, `"robots.txt"`, `"index.html"` (all contain `.`, always shape-rejected first) and `"q"` (1 char, always shape-rejected first by `.min(2)`). Not a functional bug given WR-07's error-code overlap, but worth noting so a future relaxation of `customSlugSchema` (e.g. allowing single-character slugs) doesn't silently reopen a gap that looks covered today.
**Fix:** Add a comment near `RESERVED_SLUGS` noting which entries are currently shape-check-shadowed and why, or add a small `it.each` unit test asserting each entry independently reaches the `RESERVED_SLUGS.has()` branch (bypassing shape rejection) once WR-07 gives shape failures their own error code.

### IN-02: `importCsvSchema.csv` has no explicit maximum length

**File:** `apps/api/src/routes/links.ts:73-76`
**Issue:** `csv: z.string().min(1)` has no `.max()`. The only practical ceiling is Fastify's implicit default `bodyLimit` (1 MiB), which is not configured explicitly anywhere in `app.ts`. Relying on an un-stated framework default for a resource-sensitive endpoint (CSV parsing + up to `MAX_IMPORT_ROWS` DB round-trips) is fragile — a future change to Fastify's constructor options or default value would silently change this endpoint's effective abuse ceiling with no local signal.
**Fix:** Add an explicit `.max(N)` (sized comfortably above `MAX_IMPORT_ROWS` realistic row width) to `importCsvSchema.csv`, and/or set `bodyLimit` explicitly in `Fastify({...})`'s options in `app.ts` so the limit is visible and intentional rather than implicit.

### IN-03: `formatDate()` duplicated verbatim

**File:** `apps/web/src/views/LinksView.vue:183-188`, `apps/web/src/views/LinkDetailView.vue:142-147`
**Issue:** Identical `dd.mm.yyyy` formatting function copy-pasted in two view files.
**Fix:** Extract to a shared util (e.g. `apps/web/src/lib/format.ts`) and import in both.

### IN-04: No friendly error when CSV headers don't match the documented column names

**File:** `apps/api/src/lib/links.ts:389, 398-401`
**Issue:** `parse(csvText, { columns: true, ... })` builds row objects keyed by whatever the first CSV row's literal header strings are. If a user's CSV uses different casing/naming (e.g. `Ziel_URL` instead of `ziel_url`), every row silently resolves `row.ziel_url` to `undefined`, and every row is reported as `invalid_url` with no indication the actual problem is a header mismatch, not a bad URL.
**Fix:** Consider validating the parsed header row against the expected `["ziel_url", "slug", "domain"]` set before entering the row loop, and surfacing a distinct top-level error (not a per-row skip reason) when it doesn't match.

### IN-05: `csv-parse`'s full parse runs before the `MAX_IMPORT_ROWS` cap is enforced

**File:** `apps/api/src/lib/links.ts:389-392`
**Issue:** `parse(csvText, {...})` parses the entire CSV text into an array before `rows.length > MAX_IMPORT_ROWS` is checked. For a CSV within the (implicit, see IN-02) body-size ceiling but with extremely short rows, this means the full parse cost is paid before rejection. Low practical impact given the current 1 MiB implicit body limit and 5-requests/15-minutes rate limit, but worth noting alongside IN-02 since both bound the same resource.
**Fix:** Low priority; consider a streaming parse with early-abort if this ever becomes a measured problem. No action needed at current scale.

---

_Reviewed: 2026-07-11T21:07:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
