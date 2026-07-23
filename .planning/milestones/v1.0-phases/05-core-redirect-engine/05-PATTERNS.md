# Phase 5: Core Redirect Engine - Pattern Map

**Mapped:** 2026-07-12
**Files analyzed:** 12
**Analogs found:** 11 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/routes/redirect.ts` (replaced) | route | request-response | `apps/api/src/routes/tlsCheck.ts` (host-resolution route) + `apps/api/src/routes/links.ts` (multi-route factory + rate-limit config) | role-match (composite) |
| `apps/api/src/lib/redirectEngine.ts` (new) | service/utility (pure fn) | transform | `apps/api/src/lib/domainResolution.ts` (pure, DB-read, zero side effects) | role-match |
| `apps/api/src/lib/botDetection.ts` (new) | utility | transform | `apps/api/src/lib/hostname.ts` (thin pure string-normalizer wrapper) | role-match |
| `apps/api/src/lib/unlockCookie.ts` (new) | utility/service | event-driven (cookie issue/verify) | `apps/api/src/lib/auth.ts` (session/cookie-adjacent factory) — pattern-derived, no direct cookie analog exists yet | partial |
| `apps/api/src/lib/publicHtml.ts` (new) | utility (render) | transform | none in `apps/api` — closest structural analog is `apps/web/src/views/AuthErrorView.vue` (standalone branded card page, but Vue not raw HTML) | no analog (flagged) |
| `apps/api/src/lib/links.ts` (extended) | service | CRUD | itself (extend in place) — pattern to copy: `validateLinkInput`/`createLink`/`updateLink` single-write-path shape | exact (self) |
| `apps/api/src/routes/links.ts` (extended) | controller/route | CRUD | itself (extend in place) — `createLinkSchema`/`updateLinkSchema` Zod allowlist pattern | exact (self) |
| `apps/api/prisma/schema.prisma` (`model Link` extended) | model/migration | CRUD | itself — additive nullable/defaulted columns, mirrors Phase 3's `Domain` model additive fields | exact (self) |
| `apps/api/src/plugins/rateLimit.ts` (extended) | config | request-response | itself — `TLS_CHECK_RATE_LIMIT`/`LINK_CREATE_RATE_LIMIT` const-export shape | exact (self) |
| `apps/api/src/env.ts` (extended: `BRAND_NAME`, `BRAND_ACCENT`, `PASSWORD_HASH_COST`) | config | n/a | itself — `CNAME_TARGET`/`A_RECORD_IP` optional-with-fail-safe-default pattern | exact (self) |
| `packages/shared/src/index.ts` (`LinkDTO` extended) | model (DTO) | transform | itself — `DomainDTO`/`LinkDTO` ISO-string-date JSON-boundary convention | exact (self) |
| `apps/web/src/components/LinkFormModal.vue` (extended) | component | CRUD (form) | itself — existing `.field`/`.field-input` + `emit('submit', payload)` pattern | exact (self) |
| `apps/api/test/redirect.integration.test.ts` (new) | test | request-response | `apps/api/test/tlsCheck.integration.test.ts` (host-resolution + `app.inject` + rate-limit test shape) | exact |
| `apps/api/test/redirectEngine.test.ts` (new) | test | transform | `apps/api/test/domainResolution.test.ts` (pure-function unit test, no Fastify) | role-match |

## Pattern Assignments

### `apps/api/src/routes/redirect.ts` (route, request-response)

**Analogs:** `apps/api/src/routes/tlsCheck.ts` (host-resolution shape) + `apps/api/src/routes/links.ts` (multi-route Fastify-plugin-factory shape, rate-limit config)

**Imports pattern** (`tlsCheck.ts` lines 29-32):
```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { resolveActiveDomainByHost } from "../lib/domainResolution.js";
import { TLS_CHECK_RATE_LIMIT } from "../plugins/rateLimit.js";
```

**Factory + route-registration pattern** (`links.ts` lines 164-188, adapt to a plugin factory returning an inner registration function, mirroring `tlsCheckRoute(prisma)`):
```typescript
export function tlsCheckRoute(prisma: PrismaClient) {
  return async function registerTlsCheckRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/tls-check",
      config: { rateLimit: TLS_CHECK_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => { /* ... */ },
    });
  };
}
```
Copy this exact `export function xRoute(prisma) { return async function registerXRoute(app) { app.route({...}) } }` shape for `redirectRoute(prisma)` — it must expose **two** `app.route({...})` calls (`GET /:slug`, `POST /:slug/verify`) inside the same registration function, same as `linksRoute` registers 6 routes inside one factory.

**Host-resolution call pattern** (`tlsCheck.ts` lines 51-56, this call is FROZEN — copy verbatim, never re-derive):
```typescript
const resolved = await resolveActiveDomainByHost(prisma, domain);
if (!resolved) return reply.code(404).send();
```
For the redirect route, substitute `request.hostname` (not a query param) as RESEARCH's Pattern 1 specifies, and branch to `renderNotFoundPage` instead of empty-body 404.

**Query-param defensive-parsing pattern** (`tlsCheck.ts` lines 41-53, WR-01 fix) — apply the same "never trust an unchecked `request.query`/`request.params` type assertion without a runtime guard" discipline to `:slug`/`password` body parsing in the new route.

**Rate-limit route-level config pattern** (`links.ts` lines 166-169):
```typescript
app.route({
  method: "POST",
  url: "/api/links",
  config: { rateLimit: LINK_CREATE_RATE_LIMIT },
  handler: async (request, reply) => { /* ... */ },
});
```
Apply identically for `GET /:slug` (`REDIRECT_RATE_LIMIT`, D-16 generous) and `POST /:slug/verify` (`VERIFY_RATE_LIMIT_PER_LINK`, D-15 tight, custom `keyGenerator` per Pitfall 4 — no existing analog for a custom `keyGenerator`, write it fresh following the `${request.ip}:${request.hostname}:${slug}` shape from RESEARCH).

**Registration-order pattern** (`app.ts` lines 121-139) — `redirectRoute` stays registered exactly where the stub is today: AFTER `linksRoute` (so `/api/links` is never shadowed) and BEFORE `registerStatic`/`setNotFoundHandler` (Pitfall 5). Only the **body** of `routes/redirect.ts` changes; `app.ts`'s call site `await app.register(redirectRoute);` at line 137 either stays a bare import (if `redirectRoute` stays a plain plugin function) or becomes `await app.register(redirectRoute(prisma));` (if converted to the `tlsCheckRoute(prisma)` factory shape, recommended — needs a one-line `app.ts` update to pass `prisma`, following the exact precedent at line 128-129 `domainsRoute(prisma, auth, ...)`/`tlsCheckRoute(prisma)`).

---

### `apps/api/src/lib/redirectEngine.ts` (service/utility, transform)

**Analog:** `apps/api/src/lib/domainResolution.ts`

**Pure-function-with-header-doc-comment pattern** (whole file, lines 1-36) — copy the shape: a single/couple of exported pure functions, zero Fastify/HTTP types imported, a header comment stating "this is the SINGLE X path... signature FROZEN" style discipline for `resolveLinkState`/`mergeQuery`. No DB write ever happens in this file — mirrors `domainResolution.ts`'s read-only `prisma.domain.findUnique` shape, but `resolveLinkState`/`mergeQuery` here take the already-fetched `Link` row (no DB access at all — pure in-memory classification), per RESEARCH Pattern 2's code example.

**Error/deny-by-default framing** — mirrors `domainResolution.ts` lines 22-33's "absence of exact match = deny, never fallback" discipline: `resolveLinkState` must default to the SAFEST branch (`expired` before `protected` before `ok`) with no implicit fallthrough, exactly like `resolveActiveDomainByHost` never falls back to a substring/first-domain match.

---

### `apps/api/src/lib/botDetection.ts` (utility, transform)

**Analog:** `apps/api/src/lib/hostname.ts` (not read in full this session, but referenced/imported at `domainResolution.ts` line 16 as `normalizeHostname` — a thin, single-purpose pure wrapper function). Follow the same "one exported pure function, no side effects, no Fastify awareness" shape for `isBotRequest(userAgent: string | undefined): boolean` wrapping `isbot`.

---

### `apps/api/src/lib/unlockCookie.ts` (utility/service, event-driven)

**No direct existing cookie-handling analog in this codebase** (no prior `@fastify/cookie` usage — better-auth owns its own session cookies internally via `lib/auth.ts`, never exposed as a reusable pattern). Build fresh, following RESEARCH's Pattern 4 code example verbatim (hash-digest-bound payload, `signed: true`, `httpOnly: true`, `sameSite: "strict"`, scoped `path`). Structurally mirror `lib/hostname.ts`'s "one file, few small exported pure-ish functions, header comment justifying the design" shape from `botDetection.ts`'s analog above.

---

### `apps/api/src/lib/publicHtml.ts` (utility/render, transform)

**No existing raw-HTML-render analog in `apps/api`** — this is genuinely new (D-09 explicitly excludes these pages from the Vue/SPA layer). Closest STYLE analog for the visual/copy contract (not the render mechanism) is `apps/web/src/views/AuthErrorView.vue` (lines 1-157) and `LoginView.vue` — copy the CSS token values (`--bg`/`--panel`/`--border`/`--text`/`--mut`/`--chip`/`--accent`, `.wrapper`/`.brand-row`/`.logo-mark`/`.card`/`.footer-text` class shapes) 1:1 from `AuthErrorView.vue`'s `<style scoped>` block (lines 44-157) into the new module's inline `<style>` string, per 05-UI-SPEC.md's explicit instruction ("Wrapper... wiederverwendet 1:1 aus LoginView.vue/AuthErrorView.vue"). The render mechanism itself (tagged template strings + `escapeHtml()`) has no codebase precedent — implement per RESEARCH Pattern 6's code example, and treat `escapeHtml()` as security-critical per Pitfall 1 (never skip escaping the slug).

**Escaping discipline note:** every interpolation of `domain`/`slug`/`expDate` MUST route through `escapeHtml()` — this is the single highest-value check in this file, called out explicitly by RESEARCH Pitfall 1 and 05-UI-SPEC's No-Leak contract.

---

### `apps/api/src/lib/links.ts` (service, CRUD) — EXTEND, do not duplicate

**Analog:** itself — extend in place, following the D-01 single-write-path discipline documented in its own header comment (lines 1-25).

**Extension points (concrete):**
- `ValidateLinkInputParams` (lines 203-211) gains `password?: string`, `expiresAt?: string | null`, `forwardQuery?: boolean`.
- `validateLinkInput` (lines 219-252) is where `password` gets bcrypt-hashed (D-02) — hash INSIDE this function, never in the route layer, mirroring how `validateTargetUrl`/`resolveSlug` are called inline here and nowhere else.
- `createLink`/`updateLink` (lines 262-326) — the `prisma.link.create`/`prisma.link.update` `data: {...}` objects gain `passwordHash`, `expiresAt`, `forwardQuery` fields, following the exact same spread-plus-explicit-field pattern already used (lines 270-272, 311-318).
- `toLinkDto` (lines 329-340) — add `passwordProtected: link.passwordHash !== null` (never the hash itself), `expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null`, `forwardQuery: link.forwardQuery`, following the existing ISO-string-date convention (`createdAt.toISOString()` at line 337).
- `LinkErrorCode` union (lines 97-104) — no new error codes anticipated unless password validation needs one (e.g. weak-password rejection is out of scope per CONTEXT.md discretion notes).

**Anti-pattern warning to carry forward:** this file's own header comment (lines 20-24) — do not let a "password hashing helper" become a second write site; hash inline inside `validateLinkInput`/`createLink`/`updateLink` only.

---

### `apps/api/src/routes/links.ts` (controller/route, CRUD) — EXTEND, do not duplicate

**Analog:** itself.

**Zod allowlist extension pattern** (lines 45-62):
```typescript
const createLinkSchema = z.object({
  domainId: z.string().min(1),
  targetUrl: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().max(200).optional(),
});
const updateLinkSchema = z.object({
  targetUrl: z.string().min(1).optional(),
  slug: z.string().optional(),
  title: z.string().max(200).nullable().optional(),
});
```
Add `password: z.string().optional()` (empty string / omitted = no password / keep current per edit-mode semantics), `expiresAt: z.string().nullable().optional()` (ISO date string or `null` to clear), `forwardQuery: z.boolean().optional()` to BOTH schemas, following the exact `.nullable().optional()` idiom already used for `title` on the update schema (WR-02 precedent, lines 294-301 in `links.ts` for the `null`-vs-`undefined` distinction — apply the same discipline to `password`/`expiresAt` clearing semantics).

**No route-layer write access** — this file's header comment (lines 10-18) states the route layer NEVER inserts/updates directly; the new fields flow through `createLink`/`updateLink` exactly like `targetUrl`/`slug`/`title` do today (lines 181, 289-302).

---

### `apps/api/prisma/schema.prisma` (`model Link`) — EXTEND, additive only

**Analog:** itself — `model Link` (lines 177-192).

**Additive-column pattern** (mirrors `model Domain`'s Phase-3 additive fields, e.g. `verificationTarget`/`verifiedAt`/`lastCheckedAt` at lines 106-109, all nullable/defaulted so the migration needs no destructive `ALTER`):
```prisma
model Link {
  id           String    @id @default(cuid())
  domainId     String
  slug         String
  targetUrl    String
  title        String?
  passwordHash String?
  expiresAt    DateTime?
  forwardQuery Boolean   @default(false)
  createdBy    String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  domain  Domain @relation(fields: [domainId], references: [id], onDelete: Cascade)
  creator User?  @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  @@unique([domainId, slug])
  @@index([domainId])
}
```
Per RESEARCH Pitfall 3: try plain `prisma migrate dev` first — all three columns are nullable/defaulted, unlike Phase 3's `03-01` non-interactive-confirmation case (new `UNIQUE` constraint on an existing table). Fall back to the `migrate diff` + throwaway-shadow-container workaround only if the confirmation gate unexpectedly fires.

---

### `apps/api/src/plugins/rateLimit.ts` — EXTEND, do not restructure

**Analog:** itself — const-export-per-endpoint shape (e.g. lines 48-51 `TLS_CHECK_RATE_LIMIT`, lines 75-78 `LINK_CREATE_RATE_LIMIT`).

**Pattern to copy:**
```typescript
export const TLS_CHECK_RATE_LIMIT = {
  max: 60,
  timeWindow: "1 minute",
} as const;
```
Add `REDIRECT_RATE_LIMIT` (D-16, generous — e.g. `{ max: 300, timeWindow: "1 minute" }`, higher than `TLS_CHECK_RATE_LIMIT` since real browser traffic hits this, not just a reverse proxy) and `VERIFY_RATE_LIMIT_PER_LINK` (D-15, tight — e.g. `{ max: 5, timeWindow: "1 minute" }`, needs a custom `keyGenerator` per Pitfall 4, which has no existing analog in this file — all current entries rely on `@fastify/rate-limit`'s default per-IP key; write the custom `keyGenerator` function fresh in `routes/redirect.ts` or inline in the route-level `config.rateLimit` object, following the `config: { rateLimit: X }` wiring shape already used in `links.ts`/`tlsCheck.ts`).

---

### `packages/shared/src/index.ts` (`LinkDTO`) — EXTEND, do not duplicate

**Analog:** itself — `LinkDTO` (lines 68-77), `DomainDTO` (lines 46-55) for the ISO-string-date convention.

**Extension pattern** — add `passwordProtected: boolean`, `expiresAt: string | null`, `forwardQuery: boolean` to `LinkDTO`, matching `DomainDTO`'s `verifiedAt: string | null` idiom (never expose `passwordHash` itself — the DTO comment at lines 63-67 already states DTOs mirror `toLinkDto()` exactly, so this extension must stay in lockstep with the `lib/links.ts` change above). Also extend `CreateLinkInput` (lines 85-90) and `UpdateLinkInput` (lines 98-102) with the same three optional fields, following the exact "mirrors `validateLinkInput` minus `userId`" comment convention already present.

---

### `apps/web/src/components/LinkFormModal.vue` — EXTEND, do not duplicate

**Analog:** itself.

**Field pattern to copy** (lines 62-71, `.field`/`.field-label`/`.field-input`/`.field-error` structure):
```html
<div class="field">
  <label class="field-label">Ziel-URL</label>
  <input v-model="targetUrl" type="text" class="field-input mono" placeholder="..." />
  <p v-if="fieldErrors.targetUrlError" class="field-error">{{ fieldErrors.targetUrlError }}</p>
</div>
```
Add the new Security-Accordion section (collapsed by default, `secOpen` ref) between the existing `.slug-warning` block (lines 94-103) and `.modal-footer` (lines 105-110), per 05-UI-SPEC.md's exact layout contract. Reuse `.field-input` styling verbatim (no new input variant) — 05-UI-SPEC.md explicitly calls this out.

**Submit-payload pattern** (lines 34-51):
```typescript
const emit = defineEmits<{
  close: [];
  submit: [payload: { domainId?: string; targetUrl: string; slug?: string }];
}>();
function handleSubmit(): void {
  emit("submit", { domainId: ..., targetUrl: targetUrl.value, slug: ... });
}
```
Extend the `submit` payload type + `handleSubmit` to include `password?: string`, `expiresAt?: string | null`, `forwardQuery?: boolean`, following the identical optional-field composition pattern.

**Error-mapping pattern** (line 43, `mapLinkFormError` in `apps/web/src/api.ts`) — extend that function (not read this session, but referenced) to map new `LinkErrorCode` values if any are added; otherwise no change needed since password/expiry validation errors are expected to reuse generic 400 handling.

---

### `apps/api/test/redirect.integration.test.ts` (test, request-response)

**Analog:** `apps/api/test/tlsCheck.integration.test.ts` (whole file, 182 lines)

**Structure to copy:**
```typescript
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "./setupFileEach.js";

describe("GET /:slug (redirect engine, REDIR-01..05)", () => {
  it("returns 302 to the target for a valid link", async () => {
    const app = await buildApp({ prisma });
    await prisma.domain.create({ data: { hostname: "...", type: "subdomain", status: "active", verificationTarget: "..." } });
    // ... create Link ...
    const response = await app.inject({ method: "GET", url: "/slug", headers: { host: "..." } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("...");
  });
});
```
Copy the `buildApp({ prisma })` + `prisma.domain.create` + `app.inject({ method, url, headers: { host } })` shape exactly (`tlsCheck.integration.test.ts` uses a `?domain=` query param since it's the ask endpoint; the redirect test instead sets `headers: { host: "..." }` to exercise `request.hostname`, per RESEARCH Pattern 1). Copy the rate-limit test pattern verbatim (lines 167-181, `Promise.all` of many concurrent `app.inject` calls, assert `filter(r => r.statusCode === 429).length > 0`).

**No-leak canary test** — no existing precedent for a "assert a string never appears in body" test in this codebase; write fresh per RESEARCH's Validation Architecture, asserting `response.body` (and, for the 410/password branches, headers) never contains a distinctive canary target-URL constant.

---

### `apps/api/test/redirectEngine.test.ts` (test, transform)

**Analog:** `apps/api/test/domainResolution.test.ts` (pure-function unit test file, no `buildApp`/Fastify/DB — direct function calls with hand-built fixture objects). Copy that shape for `resolveLinkState()`/`mergeQuery()` unit tests: construct a fake `Link`-shaped object literal, call the pure function directly, assert the returned classification/string — no `fastify.inject`, no testcontainers needed.

---

## Shared Patterns

### Host Resolution (FROZEN)
**Source:** `apps/api/src/lib/domainResolution.ts` (`resolveActiveDomainByHost`)
**Apply to:** `routes/redirect.ts`'s both handlers (GET and POST verify)
```typescript
const domain = await resolveActiveDomainByHost(prisma, request.hostname);
if (!domain) return /* 404 branch */;
```
Never re-derive host resolution logic; never read `request.headers.host` or `X-Forwarded-Host` directly.

### Single-Write-Path Discipline (D-01)
**Source:** `apps/api/src/lib/links.ts` (header comment, lines 1-25)
**Apply to:** all new `password`/`expiresAt`/`forwardQuery` persistence — must go through `createLink`/`updateLink`, never a new `prisma.link.update` call site in `routes/redirect.ts` or elsewhere.

### Zod Request-Body Allowlist (Mass-Assignment Defense)
**Source:** `apps/api/src/routes/links.ts` (`createLinkSchema`/`updateLinkSchema`, lines 45-62)
**Apply to:** `routes/links.ts`'s extended schemas (new fields) and `routes/redirect.ts`'s `POST /:slug/verify` body (`{ password: z.string() }` — never trust `request.body` unchecked, mirrors WR-01's `tlsCheck.ts` query-param coercion discipline for redirect params).

### Rate-Limit Route-Level Config
**Source:** `apps/api/src/plugins/rateLimit.ts` + call sites in `routes/tlsCheck.ts`/`routes/links.ts`
**Apply to:** `routes/redirect.ts`'s `GET /:slug` (`REDIRECT_RATE_LIMIT`) and `POST /:slug/verify` (`VERIFY_RATE_LIMIT_PER_LINK` with a custom per-(IP,host,slug) `keyGenerator`).

### Additive, Non-Destructive Prisma Migrations
**Source:** `apps/api/prisma/schema.prisma` (`model Domain`'s Phase-3 additive fields) + `03-01-SUMMARY.md`'s documented workaround (referenced, not re-read this session)
**Apply to:** the three new `Link` columns — all nullable/defaulted, try plain `prisma migrate dev` first.

### ISO-String-Date DTO Boundary Convention
**Source:** `packages/shared/src/index.ts` (`DomainDTO`, `LinkDTO`) + `apps/api/src/lib/links.ts`'s `toLinkDto()`
**Apply to:** `expiresAt` field on both the extended `LinkDTO` and `toLinkDto()` — always `string | null` (ISO 8601), never a raw `Date` crossing the JSON boundary.

### Standalone Branded Public-Page Shell (Wrapper/Card/Brand-Row/Footer)
**Source:** `apps/web/src/views/AuthErrorView.vue` (and `LoginView.vue`, not re-read but referenced identically by 05-UI-SPEC.md)
**Apply to:** all 3 new server-rendered HTML pages (`publicHtml.ts`) — copy the `.wrapper`/`.brand-row`/`.logo-mark`/`.card`/`.footer-text` CSS class shapes and token values 1:1 into the inline `<style>` string (05-UI-SPEC.md mandates this explicitly).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/lib/publicHtml.ts` (render mechanism itself — tagged template strings + `escapeHtml()`) | utility/render | transform | No prior server-rendered raw-HTML module exists in `apps/api`; the codebase's only rendering today is `@fastify/static`'s SPA passthrough. Use RESEARCH Pattern 6's code example directly; borrow only the CSS/token *values* from `AuthErrorView.vue`. |
| `apps/api/src/lib/unlockCookie.ts` (cookie signing mechanics) | utility/service | event-driven | No prior `@fastify/cookie` usage in the codebase (better-auth manages its own cookies internally, not a reusable pattern). Use RESEARCH Pattern 4's code example directly. |
| Custom `keyGenerator` for per-(IP, hostname, slug) rate-limiting | config | request-response | No existing `keyGenerator` override in `plugins/rateLimit.ts` — all current limits use the default per-IP key. Write fresh per RESEARCH Pitfall 4. |

## Metadata

**Analog search scope:** `apps/api/src/{lib,routes,plugins}`, `apps/api/prisma/schema.prisma`, `apps/api/test`, `apps/web/src/{views,components}`, `packages/shared/src`
**Files scanned:** 12 read directly (domainResolution.ts, redirect.ts, app.ts, links.ts×2, tlsCheck.ts, schema.prisma, rateLimit.ts, AuthErrorView.vue, index.ts (shared), auth.ts, tlsCheck.integration.test.ts, LinkFormModal.vue)
**Pattern extraction date:** 2026-07-12
