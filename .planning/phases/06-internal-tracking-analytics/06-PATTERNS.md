# Phase 6: Internal Tracking & Analytics - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 14 (new/modified)
**Analogs found:** 12 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `apps/api/prisma/schema.prisma` (ClickEvent, ScanSource, DailySalt, Link fields) | model | CRUD | `apps/api/prisma/schema.prisma` (`Link`/`DomainMembership` models) | exact |
| `apps/api/src/lib/geoip.ts` | utility | transform | `apps/api/src/lib/domainResolution.ts` (lazy resolve helper) | role-match |
| `apps/api/src/lib/referrer.ts` | utility | transform | `apps/api/src/lib/hostname.ts` (`normalizeHostname`) | role-match |
| `apps/api/src/lib/visitorHash.ts` | utility | transform | `apps/api/src/lib/links.ts` (`derivePasswordHash`/`deriveExpiresAt`) | role-match |
| `apps/api/src/lib/analytics.ts` | service | CRUD (read-aggregate) | `apps/api/src/lib/links.ts` (query/DTO shaping) + `apps/api/src/lib/authorization.ts` (`scopedDomainIds`) | partial |
| `apps/api/src/routes/redirect.ts` (`recordClickHook` body) | controller | event-driven | same file, existing `recordClickHook` no-op seam | exact |
| `apps/api/src/lib/links.ts` (`trackingEnabled` in validate/create/update) | service | CRUD | same file, `forwardQuery` field precedent | exact |
| `apps/api/src/routes/links.ts` (allowlist `trackingEnabled`) | controller | request-response | same file, `forwardQuery` in `createLinkSchema`/`updateLinkSchema` | exact |
| `apps/api/src/routes/analytics.ts` | controller | request-response | `apps/api/src/routes/links.ts` (`GET /api/links/:id`, `resolveOwnedLink`) | role-match |
| `apps/api/src/lib/retention.ts` | utility | batch | `apps/api/src/lib/links.ts` (`runImport` batch loop) | partial |
| `packages/shared` (Analytics DTOs, `trackingEnabled`/`lifetimeClicks` on `LinkDTO`) | model | transform | `packages/shared` `LinkDTO` (existing) | exact |
| `apps/web/src/views/AnalyticsView.vue` | component | request-response | `apps/web/src/views/DomainsView.vue` or `LinksView.vue` (list + stat-card view) | role-match |
| `apps/web/src/views/LinkDetailView.vue` (Statistik-Platzhalter → live) | component | request-response | same file, existing static placeholder card | exact |
| `apps/web/src/components/LinkFormModal.vue` (tracking toggle) | component | request-response | same file, existing `forwardQuery` toggle field | exact |
| `apps/web/src/router/index.ts` (`/analytics` → `AnalyticsView`) | route | request-response | same file, existing route table entries | exact |
| `Dockerfile` (GeoIP `.mmdb` build step) | config | file-I/O | same file, existing `apps/web/dist` → `public/` COPY pattern | exact |
| `apps/api/test/redirect-tracking.integration.test.ts` | test | integration | `apps/api/test/redirect.integration.test.ts` | exact |
| `apps/api/test/analytics.test.ts` | test | integration | `apps/api/test/links.integration.test.ts` | role-match |
| `apps/api/test/geoip.test.ts`, `referrer.test.ts`, `visitorHash.test.ts` | test | unit | `apps/api/test/domainResolution.test.ts` / `redirectEngine.test.ts` | role-match |

## Pattern Assignments

### `apps/api/prisma/schema.prisma` (model, CRUD)

**Analog:** same file — `Link` model (lines 165-206) and enum precedent (`Role`, lines 143-147)

**Field-addition pattern** — new boolean/counter columns are added directly onto `Link` with a doc-comment explaining the field and its default, exactly like `forwardQuery`:
```prisma
/// Query-parameter forwarding (Phase 5, D-12) — when true, incoming
/// query params are merged onto targetUrl at redirect time (target URL
/// wins on conflict, D-13). Defaults off so existing links are unaffected.
forwardQuery Boolean   @default(false)
```
Apply the same doc-comment + `@default(...)` convention for `trackingEnabled Boolean @default(true)` and `lifetimeClicks Int @default(0)`.

**New model + enum pattern** — mirror `DomainMembership`'s composite structure and `DomainType`'s enum precedent for `ClickEvent`/`ScanSource`/`DailySalt`:
```prisma
enum DomainType {
  subdomain
  apex
}

model DomainMembership {
  userId   String
  domainId String
  role     Role

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  domain Domain @relation(fields: [domainId], references: [id], onDelete: Cascade)

  @@id([userId, domainId])
}
```
Index convention: `@@index([domainId])` on `Link` (line 205) is the precedent for `ClickEvent`'s planned `linkId`/`createdAt`/`source` indexes — always add `@@index` explicitly, never rely on the FK alone.

---

### `apps/api/src/routes/redirect.ts` (controller, event-driven)

**Analog:** same file — the existing `recordClickHook` seam (lines 53-60, called at line 132)

**Seam-fill pattern** — do NOT add a second call site; replace only the function body, keep the call site untouched:
```typescript
// Current no-op (lines 53-60):
async function recordClickHook(_ctx: { linkId: string }): Promise<void> {
  // intentionally empty — Phase 6's tracking write lands here.
}

// Call site (unchanged, line 130-132):
// state === "ok" -> normal link, or protected link with a valid
// unlock cookie. D-17 seam: Phase 6 hooks its click-write in here.
await recordClickHook({ linkId: link.id });
```
Extend the signature to accept `{ link, ip, userAgent, referer }` (the already-fetched `link` object from line 101's `findUnique`, per RESEARCH Pitfall 4 — never re-query). Wrap the whole body in try/catch per file header's `no-store`/never-break-redirect discipline (mirrors the file's existing "every branch sets Cache-Control first" defensiveness).

**Reads-only discipline note** (file header, lines 25-28): `routes/redirect.ts` was previously read-only Prisma-wise (`findUnique` only). Phase 6 is the first write inside this file — call this out explicitly in the plan since it changes a documented invariant; the write must stay confined to `recordClickHook`'s body, exactly one `$transaction` call.

---

### `apps/api/src/lib/links.ts` (service, CRUD) — `trackingEnabled` field threading

**Analog:** same file — `forwardQuery`'s threading through `ValidateLinkInputParams` → `createLink`/`updateLink` (D-01 pattern, Phase 5)

**Imports pattern** (lines 26-33):
```typescript
import type { ImportRowResult, LinkSkipReason } from "@kurzly/shared";
import bcrypt from "bcryptjs";
import { parse } from "csv-parse/sync";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import type { Link, PrismaClient } from "../generated/prisma/client.js";
import { ForbiddenError, requireDomainAccess } from "./authorization.js";
import { normalizeHostname } from "./hostname.js";
```

**Derive-value pattern** (lines 60-79) — `derivePasswordHash`/`deriveExpiresAt` show the `undefined`-keeps / `null`-clears / value-sets convention to follow for any new optional field derivation (not needed for a plain boolean like `trackingEnabled`, but is the template if a future field needs tri-state semantics):
```typescript
async function derivePasswordHash(
  password: string | null | undefined,
): Promise<string | null | undefined> {
  if (password === undefined) return undefined;
  if (password === null) return null;
  if (password.length === 0) return undefined;
  return bcrypt.hash(password, resolvePasswordHashCost());
}
```

**Sole-write-path discipline** (file header, lines 13-19): `createLink` is the ONLY `prisma.link.create` call site; `updateLink` the ONLY `prisma.link.update` call site. `trackingEnabled` must be threaded through `ValidateLinkInputParams`/`ValidatedLink` and passed straight through — no new validation branch needed (plain boolean, Prisma column default `true` covers create-time default), exactly as RESEARCH Pattern 1 specifies.

**Reserved-slugs single-source-of-truth reminder** (lines 92-140): if any new top-level Vue Router segment is added (none expected for Phase 6 — `/analytics` already reserved at line ~105), it would need to be added to `RESERVED_SLUGS`. Not applicable here since `analytics` is already reserved, but the file's own header comment mandates checking this for every phase.

---

### `apps/api/src/routes/links.ts` (controller, request-response) — allowlist extension

**Analog:** same file — `createLinkSchema`/`updateLinkSchema`'s `forwardQuery: z.boolean().optional()` (lines 62, 86)

**Zod allowlist pattern** (lines 48-63, 71-87):
```typescript
const createLinkSchema = z.object({
  domainId: z.string().min(1),
  targetUrl: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().max(200).optional(),
  password: z.string().optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  forwardQuery: z.boolean().optional(),
});
```
Add `trackingEnabled: z.boolean().optional()` to both schemas — mirrors `forwardQuery` exactly (plain optional boolean, no nullable/tri-state needed since D-15 has no "clear" semantics, just true/false).

**IDOR-guarded ownership resolution pattern** (lines 180-187) — reuse verbatim for the new analytics routes:
```typescript
async function resolveOwnedLink(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<Link | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.link.findFirst({ where: { id, domainId: { in: domainIds } } });
}
```

**Route registration + 401/404 pattern** (lines 189-217, 253-264):
```typescript
export function linksRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerLinksRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/links",
      config: { rateLimit: LINK_CREATE_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const parsed = createLinkSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid link data" });
        }
        const result = await createLink(prisma, { userId, ...parsed.data });
        if (!result.ok) {
          return reply.code(statusForLinkError(result.error)).send({ error: result.error });
        }
        return reply.code(201).send(toLinkDto(result.link));
      },
    });
  };
}
```
Use this exact `resolveUserId` → 401 → `resolveOwnedLink`/`safeParse` → 404/400 → handler shape for the new `apps/api/src/routes/analytics.ts` (`GET /api/links/:id/analytics`, `GET /api/analytics`).

---

### `apps/api/src/lib/analytics.ts` (service, CRUD read-aggregate) — new file, no direct analog

**Closest partial analog:** `apps/api/src/lib/links.ts`'s query/DTO-shaping style (`toLinkDto`) + `apps/api/src/lib/authorization.ts`'s `scopedDomainIds` for scoping.

**Auth pattern to reuse** (`authorization.ts` lines 29-62, 70-80):
```typescript
export async function requireDomainAccess(
  prisma: PrismaClient,
  userId: string,
  domainId: string,
  minRole: Role,
): Promise<void> {
  const membership = await prisma.domainMembership.findUnique({
    where: { userId_domainId: { userId, domainId } },
  });
  const membershipRank = membership ? ROLE_RANK[membership.role] : undefined;
  const requiredRank = ROLE_RANK[minRole];
  if (membershipRank === undefined || requiredRank === undefined || membershipRank < requiredRank) {
    throw new ForbiddenError(`User ${userId} lacks ${minRole}+ access to domain ${domainId}`);
  }
}
```
Per-link analytics reuses `requireDomainAccess(prisma, userId, domainId, "member")` (or `resolveOwnedLink`'s `scopedDomainIds` pattern) exactly as `routes/links.ts` already does — do not write a fresh ad-hoc ownership check (RESEARCH ASVS V4 note). Global analytics overview for MVP requires only an authenticated session (domain-scoped visibility deferred to Phase 9 per CONTEXT.md — must be called out as an intentional gap in the plan, not an oversight).

**No raw-SQL precedent exists yet in this codebase** — `Prisma.sql`/`$queryRaw` tagged-template usage (RESEARCH Pattern 5) is net-new; follow RESEARCH's own verified example directly since there's no in-repo analog to copy from. Never use `$queryRawUnsafe` with string-interpolated `linkId`/dates (RESEARCH Anti-Pattern, ASVS V5).

---

### `apps/web/src/views/LinkDetailView.vue` (component, request-response)

**Analog:** same file — existing load/toast/error patterns (lines 1-100)

**Data-load + error-classification pattern** (lines 61-72):
```typescript
async function load(): Promise<void> {
  const id = route.params.id as string;
  try {
    link.value = await getLink(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
      return;
    }
    showToast("Link konnte nicht geladen werden.");
  }
}
```
Follow this exact try/catch + `ApiError`-status-check + toast-fallback shape for a new `loadAnalytics()` function that replaces the "Statistik-Platzhalter" static card (file header, lines 8-9, explicitly documents this card is the Phase-6 hand-off point).

**Toast pattern** (lines 34-43) — per-view `ref` + `setTimeout`, no global store; reuse verbatim, do not introduce a Pinia toast store for analytics errors.

---

### `apps/web/src/router/index.ts` (route, request-response)

**Analog:** same file — `ComingSoonView` → real-view swap precedent already established for `/links`, `/links/:id`, `/domains`

**Route-table entry pattern** (lines 66-71):
```typescript
{
  path: "/analytics",
  name: "analytics",
  component: ComingSoonView,
  meta: { requiresAuth: true, label: "Analytics" },
},
```
Change 1 line: swap `component: ComingSoonView` → `component: AnalyticsView` (new import alongside the existing `LinkDetailView`/`LinksView` imports at lines 16-19), keep `meta` unchanged. No guard logic changes needed — the `beforeEach` block (lines 87-118) is generic over `meta.requiresAuth` and already covers this route.

---

### `Dockerfile` (config, file-I/O)

**Analog:** same file — `apps/web/dist` → `public/` COPY pattern (lines 60-62)

**Build-stage-artifact-then-copy pattern**:
```dockerfile
# In `build` stage — existing precedent for producing a static artifact:
RUN pnpm run -r build
...
# In `runtime` stage — existing precedent for copying a build artifact in:
COPY --from=build --chown=node:node /usr/src/app/apps/web/dist /prod/api/public
```
Apply the same `build`-stage-produce → `runtime`-stage-`COPY --from=build --chown=node:node` shape for the GeoIP `.mmdb` download (RESEARCH Code Examples' `curl`/`gunzip` step + `COPY --from=build ... /usr/src/app/geo /prod/api/geo`). The file's own header comment (lines 16-17: "Migrations are NEVER run in a RUN step... only at container start") is the precedent for keeping the `.mmdb` download strictly a build-time `RUN`, never a runtime fetch — consistent with D-02's air-gapped requirement.

---

## Shared Patterns

### Domain-scoped authorization (analytics endpoints)
**Source:** `apps/api/src/lib/authorization.ts` (`requireDomainAccess`, `scopedDomainIds`) + `apps/api/src/routes/links.ts` (`resolveOwnedLink`, lines 180-187)
**Apply to:** `apps/api/src/routes/analytics.ts` (both `GET /api/links/:id/analytics` and `GET /api/analytics`)
```typescript
async function resolveOwnedLink(prisma: PrismaClient, userId: string, id: string): Promise<Link | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.link.findFirst({ where: { id, domainId: { in: domainIds } } });
}
```
Note the explicit, documented scope-narrowing gap: full domain-scoped *member* visibility enforcement is deferred to Phase 9 (CONTEXT.md deferred section) — Phase 6 should use `scopedDomainIds` (an already-authenticated-user's owned domains) for the global overview, not a no-op auth check.

### Sole-authorized-write-path discipline (D-01/D-17)
**Source:** `apps/api/src/lib/links.ts` header comment (lines 1-24) + `apps/api/src/routes/redirect.ts` header comment (lines 24-28)
**Apply to:** `recordClickHook`'s body (only `prisma.clickEvent.create` call site in the codebase) and `trackingEnabled`'s threading through `createLink`/`updateLink` (only two `prisma.link.update`/`.create` call sites). Any new plan task must grep-verify no second call site was introduced — mirrors the project's existing verification convention (04-02-PLAN.md's verify command, cited in `links.ts`'s header).

### 401/404/400 response shape
**Source:** `apps/api/src/routes/links.ts` (lines 195-217, 253-264)
**Apply to:** All new/extended controller routes (`routes/analytics.ts`, `routes/links.ts` extensions)
```typescript
const userId = await resolveUserId(auth, request);
if (!userId) return reply.code(401).send({ error: "Unauthorized" });
// ... resolveOwnedLink / safeParse ...
if (!link) return reply.code(404).send({ error: "Not found" }); // IDOR: same 404 for not-found and denied
```

### Never-throw-into-hot-path degradation
**Source:** `apps/api/src/routes/redirect.ts` file header (D-18 discipline: every branch sets `Cache-Control` first, no branch can skip it) + RESEARCH Pattern 3's `.catch(() => null)` singleton
**Apply to:** `lib/geoip.ts`, `lib/referrer.ts`, `lib/visitorHash.ts`, and the `recordClickHook` body's outer try/catch — none of these may ever throw an uncaught error into the redirect response path.

### Parameterized raw SQL only
**Source:** RESEARCH Pattern 5 (no in-repo precedent yet — this is the first `$queryRaw` usage in the codebase)
**Apply to:** `lib/analytics.ts`'s time-series/top-N queries
```typescript
prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
  SELECT ... WHERE ce."linkId" = ${linkId} ...
`);
```
Never `$queryRawUnsafe` with string-concatenated `linkId`/date values.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/lib/analytics.ts` (raw-SQL time-series/zero-fill query shape specifically) | service | transform | No `$queryRaw`/`Prisma.sql` usage exists anywhere in the codebase yet — follow RESEARCH Pattern 5's verified example directly instead of a codebase analog |
| `apps/api/src/lib/retention.ts` (periodic cleanup job mechanics) | utility | batch | No cron/scheduled-job pattern exists yet in this codebase (Fastify app has no job runner precedent) — Planner discretion per CONTEXT D-12; consider a simple `setInterval` in `server.ts` or an on-request lazy-check, whichever fits the existing `entrypoint.sh`/`server.ts` boot structure (read those two files at plan time before deciding) |

## Metadata

**Analog search scope:** `apps/api/src/{routes,lib}`, `apps/api/prisma`, `apps/web/src/{views,components,router}`, `Dockerfile`, `apps/api/test`
**Files scanned:** ~20 (targeted reads/greps, no full-repo scan needed — phase is additive to an already-mapped Phase 4/5 codebase)
**Pattern extraction date:** 2026-07-13
