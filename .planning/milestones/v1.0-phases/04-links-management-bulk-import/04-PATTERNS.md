# Phase 04: Links Management & Bulk Import - Pattern Map

**Mapped:** 2026-07-11
**Files analyzed:** 11 new/modified files
**Analogs found:** 9 / 11 (2 files are purely frontend UI with no close precedent in prior phases)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/lib/links.ts` | service | CRUD + request-response | `apps/api/src/lib/authorization.ts` + `apps/api/src/routes/domains.ts` | role-match (pure validation logic + DB transaction patterns) |
| `apps/api/src/routes/links.ts` | controller | request-response | `apps/api/src/routes/domains.ts` | exact (Fastify route factory pattern, getSession, error handling) |
| `apps/api/prisma/schema.prisma` | model | CRUD | existing Domain/DomainMembership models | exact (composite unique, FK relations, indexes) |
| `apps/api/test/links.integration.test.ts` | test | CRUD | `apps/api/test/domains.integration.test.ts` | exact (testcontainers, transaction rollback, magic-link auth flow) |
| `apps/api/test/links-import.integration.test.ts` | test | CRUD + file-I/O | `apps/api/test/domains.integration.test.ts` | role-match (test harness + D-01 no-bypass proof) |
| `apps/web/src/views/LinksView.vue` | component | request-response | `apps/web/src/views/DomainsView.vue` | exact (list layout, modals, toast, search/filter pattern) |
| `apps/web/src/views/LinkDetailView.vue` | component | request-response | `apps/web/src/views/DomainsView.vue` + UI-SPEC detail section | role-match (detail view structure, chips, buttons) |
| `apps/web/src/views/LinksImportView.vue` | component | file-I/O + request-response | `apps/web/src/views/DomainsView.vue` (modal structure repurposed as screen) | role-match (modal shell, form layout, FileReader pattern from DomainsView pattern-basis) |
| `apps/web/src/api.ts` | utility | request-response | existing `apps/web/src/api.ts` | exact (ApiError class, fetch + parseJsonOrThrow pattern, typed client functions) |
| `apps/web/src/router/index.ts` | config | request-response | existing routes (no substantive pattern) | exact (simple route registration) |
| `packages/shared/src/index.ts` | model | CRUD | existing DTO structure (DomainDTO, AuthSession) | exact (type exports, discriminated unions) |

---

## Pattern Assignments

### `apps/api/src/lib/links.ts` (service, CRUD + validation core — D-01 single-write-path enforcement)

**Primary Analog:** `apps/api/src/lib/authorization.ts` (frozen-signature validation function pattern) + `apps/api/src/routes/domains.ts` (P2002 catch, transaction wrapper)

**Pure validation function pattern (lines 1-62, authorization.ts):**
```typescript
// Extract this structure as the model for validateLinkInput:
// A pure async function that takes prisma + input, returns a discriminated result
// { ok: true; data: ValidatedData } | { ok: false; error: ErrorCode }
// — never throws application errors, always returns a discriminated union

export class ForbiddenError extends Error {}

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

**P2002 catch pattern (domains.ts lines 216-220):**
```typescript
try {
  const domain = await prisma.$transaction(async (tx) => {
    // ... creation logic ...
  });
  return reply.code(201).send(toDomainDto(domain));
} catch (err) {
  if (isUniqueConstraintViolation(err)) {
    return reply.code(409).send({ error: "Domain already exists" });
  }
  throw err;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}
```

**Zod validation pattern (domains.ts lines 71-85):**
```typescript
import { z } from "zod";

const createDomainSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(255)
    .transform((v) => normalizeHostname(v))
    .pipe(
      z
        .string()
        .min(1)
        .max(HOSTNAME_MAX_LENGTH)
        .regex(HOSTNAME_FORMAT_RE, "Invalid hostname"),
    ),
  type: z.enum(["subdomain", "apex"]),
});
```

**Apply to Phase 04:** Implement `validateLinkInput` as a pure function (no DB write) that returns `{ ok: true; data } | { ok: false; error }`. Have both `createLink` (validate + insert with P2002 catch) and `previewLink` (validate only) call it. Use Zod for target-URL validation (`z.url({ protocol: /^https?$/ })`) and slug schema validation.

---

### `apps/api/src/routes/links.ts` (controller, request-response — thin HTTP layer)

**Analog:** `apps/api/src/routes/domains.ts`

**Route factory pattern (domains.ts lines 157-162):**
```typescript
export function domainsRoute(
  prisma: PrismaClient,
  auth: Auth,
  dnsResolver: DnsResolver = nodeDnsResolver,
) {
  return async function registerDomainsRoute(app: FastifyInstance): Promise<void> {
    // ... route handlers ...
  };
}
```

**Session resolution pattern (domains.ts lines 115-119):**
```typescript
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}

// In handler:
const userId = await resolveUserId(auth, request);
if (!userId) return reply.code(401).send({ error: "Unauthorized" });
```

**Authorization + error mapping pattern (domains.ts lines 238-252):**
```typescript
app.route({
  method: "POST",
  url: "/api/domains/:id/verify",
  config: { rateLimit: VERIFY_RATE_LIMIT },
  handler: async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = await resolveUserId(auth, request);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const { id } = request.params as { id: string };
    try {
      await requireDomainAccess(prisma, userId, id, "admin");
    } catch (err) {
      if (err instanceof ForbiddenError) return reply.code(403).send({ error: "Forbidden" });
      throw err;
    }
    // ... handler logic ...
  },
});
```

**Rate-limit override pattern (domains.ts lines 168-172):**
```typescript
app.route({
  method: "POST",
  url: "/api/domains",
  config: { rateLimit: DOMAIN_CREATE_RATE_LIMIT },
  handler: async (request: FastifyRequest, reply: FastifyReply) => {
    // ...
  },
});
```

**Apply to Phase 04:** Build `linksRoute(prisma, auth)` factory with the same structure. Implement:
- `POST /api/links` — create (rate-limited with `LINK_CREATE_RATE_LIMIT`)
- `GET /api/links` — list (scoped via `scopedDomainIds`)
- `GET /api/links/:id` — detail (with IDOR guard: resolve link, then `requireDomainAccess(link.domainId)`)
- `PATCH /api/links/:id` — update
- `DELETE /api/links/:id` — delete (with IDOR guard)
- `POST /api/links/import/preview` — dry-run CSV (rate-limited)
- `POST /api/links/import/commit` — execute CSV import (rate-limited)

---

### `apps/api/prisma/schema.prisma` (model — Link table with composite unique constraint)

**Analog:** Existing Domain/DomainMembership models (lines 100-161)

**Composite unique constraint pattern (schema.prisma lines 152-161):**
```prisma
model DomainMembership {
  userId   String
  domainId String
  role     Role

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  domain Domain @relation(fields: [domainId], references: [id], onDelete: Cascade)

  @@id([userId, domainId])
}
```

**FK + timestamp pattern (Domain model lines 100-114):**
```prisma
model Domain {
  id                 String             @id @default(cuid())
  hostname           String             @unique
  type               DomainType
  status             DomainStatus       @default(pending)
  verificationTarget String
  verifiedAt         DateTime?
  lastCheckedAt      DateTime?
  lastCheckError     String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  memberships        DomainMembership[]

  @@index([status])
}
```

**Apply to Phase 04:** Add Link model with:
```prisma
model Link {
  id        String   @id @default(cuid())
  domainId  String
  slug      String
  targetUrl String
  title     String?
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  domain  Domain @relation(fields: [domainId], references: [id], onDelete: Cascade)
  creator User?  @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  @@unique([domainId, slug])
  @@index([domainId])
}
```

Also add `links Link[]` relation to Domain model.

---

### `apps/api/test/links.integration.test.ts` (test — CRUD + authorization)

**Analog:** `apps/api/test/domains.integration.test.ts`

**Test harness setup pattern (domains.integration.test.ts lines 13-22):**
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { DnsResolver } from "../src/lib/dnsClient.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));
```

**Magic-link auth + session flow (domains.integration.test.ts lines 44-73):**
```typescript
async function requestMagicLinkUrl(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const url = call?.[0]?.url;
  if (!url) throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  return url;
}

async function signInAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);
  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}
```

**Apply to Phase 04:** 
- Reuse the same magic-link auth flow to get authenticated sessions
- Test LINK-01 (create with blank slug auto-gen), LINK-02 (custom slug, collision rejection)
- Test LINK-03 (list with domain filter via scopedDomainIds)
- Test LINK-05 (GET /api/links/:id with detail DTO)
- Test LINK-06 (update slug with repeated slug rejection)
- Test LINK-07 (delete with IDOR guard)
- Critical test: verify reserved-slug rejection (e.g. slug "api", "health")
- Critical test: verify slug uniqueness constraint per domain (same slug OK on different domains)

---

### `apps/api/test/links-import.integration.test.ts` (test — CSV import with D-01 no-bypass proof)

**Analog:** `apps/api/test/domains.integration.test.ts` (test harness + auth flow)

**Import-specific test structure:**
```typescript
// Test D-01 no-bypass: CSV row with reserved slug, domain unauthorized, 
// slug collision, invalid URL — verify exactly N skip-reasons match DB state

describe("CSV Import (D-01 no-bypass proof)", () => {
  it("should reject reserved slugs, unauthorized domains, collisions, and invalid URLs without inserting any row", async () => {
    const app = await buildApp({ prisma });
    const cookie = await signInAs(app, "admin@test");
    const ownDomain = await prisma.domain.findFirstOrThrow({ where: { hostname: "owned.test" } });
    const foreignDomain = await prisma.domain.findFirstOrThrow({ where: { hostname: "foreign.test" } });

    const csv = `ziel_url,slug,domain
https://example.com/1,api,owned.test
https://example.com/2,custom,foreign.test
https://invalid,custom2,owned.test
https://example.com/4,custom,owned.test
https://example.com/4,custom,owned.test`;

    // Preview should show 4 skipped, 1 valid
    const previewRes = await app.inject({
      method: "POST",
      url: "/api/links/import/preview",
      payload: { csv, defaultDomainId: ownDomain.id },
      cookies: { "better-auth.session_token": cookie },
    });
    expect(previewRes.json()).toMatchObject({
      validCount: 1,
      skipped: [
        { reason: "SLUG_RESERVED" },
        { reason: "UNAUTHORIZED_DOMAIN" },
        { reason: "INVALID_TARGET_URL" },
        { reason: "DUPLICATE_IN_FILE" },
      ],
    });

    // Query DB to verify no Links exist
    const linkCount = await prisma.link.count();
    expect(linkCount).toBe(0); // Preview did not write
  });
});
```

---

### `apps/web/src/views/LinksView.vue` (component, list + CRUD modals)

**Analog:** `apps/web/src/views/DomainsView.vue`

**Component structure pattern (DomainsView.vue lines 1-51):**
```typescript
// <script setup lang="ts">
import { ref } from "vue";
import type { DomainDTO } from "@kurzly/shared";
import { ApiError, createDomain, deleteDomain, listDomains } from "../api";

interface DomainUI extends DomainDTO {
  isVerifying: boolean;
  showInstructions: boolean;
  instructions?: DomainInstructions;
  verifyError?: string | null;
}

const domains = ref<DomainUI[]>([]);
const newHostname = ref("");
const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
const deleteTarget = ref<DomainUI | null>(null);

function showToast(message: string): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.value = message;
  toastTimeout = setTimeout(() => {
    toastMessage.value = null;
  }, 1700);
}

async function loadDomains(): Promise<void> {
  try {
    domains.value = (await listDomains()).map(toDomainUI);
  } catch {
    showToast("Domains konnten nicht geladen werden.");
  }
}

async function handleAddDomain(): Promise<void> {
  try {
    const created = await createDomain({ hostname, type });
    domains.value.push(toDomainUI(created));
    showToast("Domain hinzugefügt");
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      showToast("Domain already exists");
    } else {
      showToast("Error adding domain");
    }
  }
}
```

**Toast pattern (per-view ref + setTimeout):**
The toast is a simple `ref<string | null>` with a `setTimeout` clear — no global store. This is the per-view pattern used throughout Phase 2/3.

**Apply to Phase 04:**
- List structure: table with Kurzlink/Domain/Ziel/Erstellt columns + Kopieren/Bearbeiten/Löschen action buttons
- Search field (input with v-model, filter via API query param)
- Domain filter tabs (pills: "alle Domains" + one per accessible domain)
- Modals for create/edit/delete (same shell as DomainsView)
- Toast confirmations (Erstellen, Kopieren, Löschen)

---

### `apps/web/src/views/LinkDetailView.vue` (component, detail view)

**Analog:** `apps/web/src/views/DomainsView.vue` (component structure) + UI-SPEC detail section

**Apply to Phase 04:**
- Back link ("← Alle Links", navigate back to /links)
- Display slug (large, monospace)
- Display target URL (with ➜ prefix, monospace, word-break)
- Buttons: Kopieren/Bearbeiten/Löschen (mirroring DomainsView button styles)
- Chips: Domain + Erstellt-Datum
- Placeholder stats section (static UI, no backend work until Phase 6)
- Toast on copy/edit/delete (same ref-based pattern as DomainsView)

---

### `apps/web/src/views/LinksImportView.vue` (component, file-I/O + bulk import)

**Analog:** DomainsView.vue (modal shell structure, ref-based state) repurposed as a full screen

**File-picker + FileReader pattern (inferred from DomainsView pattern, explicit in UI-SPEC):**
```typescript
// Pseudo-code (full implementation in UI-SPEC)
const fileInput = ref<HTMLInputElement>();
const csvText = ref<string>("");

function handleFileSelect(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    csvText.value = e.target?.result as string;
    // Trigger preview
    loadPreview();
  };
  reader.readAsText(file);
}

async function loadPreview() {
  try {
    const result = await previewImport(csvText.value, defaultDomainId.value);
    // Display result.validCount, result.skipped[], result.results[]
  } catch (err) {
    showToast("CSV parse error");
  }
}

async function handleCommit() {
  try {
    await commitImport(csvText.value, defaultDomainId.value);
    showToast(`${validCount} Links importiert`);
    navigateTo("/links");
  } catch (err) {
    showToast("Import fehlgeschlagen");
  }
}
```

**Apply to Phase 04:**
- Dropzone (dashed border, file picker trigger)
- File chip (shows selected file name, "Datei ändern" link)
- Default-domain select (only active/accessible domains)
- Live preview list (scrollable, shows skip-reasons per row)
- Footer buttons: Abbrechen / Importieren (N) — disabled when N=0
- Toast confirmations (same pattern as DomainsView)

---

### `apps/web/src/api.ts` (utility, API client functions)

**Analog:** Existing `apps/web/src/api.ts`

**ApiError class + parseJsonOrThrow pattern (api.ts lines 18-44):**
```typescript
export class ApiError extends Error {
  status: number;
  constructor(status: number, statusText: string) {
    super(`Request failed: ${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
  return (await response.json()) as T;
}
```

**Typed client function pattern (api.ts lines 94-100+):**
```typescript
export async function createDomain(data: {
  hostname: string;
  type: "subdomain" | "apex";
}): Promise<DomainDTO> {
  const response = await fetch("/api/domains", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<DomainDTO>(response);
}
```

**Apply to Phase 04:** Add Link-specific functions:
```typescript
export async function createLink(data: {
  domainId: string;
  targetUrl: string;
  slug?: string;
  title?: string;
}): Promise<LinkDTO> { ... }

export async function listLinks(domainId?: string, q?: string): Promise<LinkDTO[]> { ... }
export async function getLink(id: string): Promise<LinkDTO> { ... }
export async function updateLink(id: string, data: Partial<LinkInput>): Promise<LinkDTO> { ... }
export async function deleteLink(id: string): Promise<void> { ... }

export async function previewImport(csv: string, defaultDomainId?: string): Promise<ImportPreviewResult> { ... }
export async function commitImport(csv: string, defaultDomainId?: string): Promise<ImportCommitResult> { ... }
```

---

### `apps/web/src/router/index.ts` (config, route registration)

**Analog:** Existing router structure (no substantive pattern needed — simple additions)

**Apply to Phase 04:** Register three new routes:
```typescript
{
  path: "/links",
  component: () => import("../views/LinksView.vue"),
  meta: { title: "Links" },
},
{
  path: "/links/:id",
  component: () => import("../views/LinkDetailView.vue"),
  meta: { title: "Link Details" },
},
{
  path: "/links/import",
  component: () => import("../views/LinksImportView.vue"),
  meta: { title: "Import Links" },
},
```

---

### `packages/shared/src/index.ts` (model, DTOs)

**Analog:** Existing DTO structure (index.ts lines 40-60)

**DTO export pattern:**
```typescript
export type DomainDTO = {
  id: string;
  hostname: string;
  type: "subdomain" | "apex";
  status: "pending" | "active" | "failed";
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  createdAt: string;
};
```

**Apply to Phase 04:** Add Link-related DTOs:
```typescript
export type LinkDTO = {
  id: string;
  domainId: string;
  slug: string;
  targetUrl: string;
  title: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type CreateLinkInput = {
  domainId: string;
  targetUrl: string;
  slug?: string;
  title?: string;
};

export type UpdateLinkInput = {
  targetUrl?: string;
  slug?: string;
  title?: string;
};

export type SkipReason = "invalid_url" | "slug_conflict" | "domain_unauthorized" | "duplicate_in_file";

export type ImportPreviewRow = {
  zielUrl?: string;
  slug?: string;
  domain?: string;
  reason?: SkipReason;
};

export type ImportPreviewResult = {
  validCount: number;
  skipped: Array<{ row: ImportPreviewRow; reason: SkipReason }>;
};

export type ImportCommitResult = {
  importedCount: number;
  skipped: Array<{ row: ImportPreviewRow; reason: SkipReason }>;
};
```

---

## Shared Patterns (Cross-Cutting Concerns)

### Authentication & Authorization
**Source:** `apps/api/src/lib/authorization.ts` + `apps/api/src/routes/domains.ts`
**Apply to:** All Link controller routes

Every route that reads/modifies Links must:
1. Resolve `userId` via `auth.api.getSession()`
2. For Link-by-ID routes (detail/edit/delete): lookup the Link, then call `requireDomainAccess(prisma, userId, link.domainId, "member")` before returning/mutating
3. Catch `ForbiddenError` and respond with 403

```typescript
const userId = await resolveUserId(auth, request);
if (!userId) return reply.code(401).send({ error: "Unauthorized" });

// For list endpoints:
const domainIds = await scopedDomainIds(prisma, userId);
const links = await prisma.link.findMany({ where: { domainId: { in: domainIds } } });

// For by-ID endpoints:
const link = await prisma.link.findUnique({ where: { id } });
if (!link) return reply.code(404).send({ error: "Not found" });
try {
  await requireDomainAccess(prisma, userId, link.domainId, "member");
} catch (err) {
  if (err instanceof ForbiddenError) return reply.code(404).send({ error: "Not found" }); // 404 for both not-found and forbidden to avoid existence leakage
  throw err;
}
```

### Error Handling
**Source:** `apps/api/src/routes/domains.ts`
**Apply to:** All controller routes, API client (web)

Backend:
```typescript
try {
  const result = await createLink(...);
  return reply.code(201).send(result);
} catch (err) {
  if (isUniqueConstraintViolation(err)) {
    return reply.code(409).send({ error: "Slug already taken" });
  }
  throw err; // Let unhandled errors bubble to Fastify's error handler
}
```

Frontend:
```typescript
try {
  const link = await createLink(data);
  showToast("Link erstellt");
} catch (err) {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      showToast("Slug already in use");
    } else if (err.status === 403) {
      showToast("Forbidden");
    } else {
      showToast("Error creating link");
    }
  } else {
    showToast("Unexpected error");
  }
}
```

### Validation
**Source:** `apps/api/src/routes/domains.ts` + Zod v4
**Apply to:** All controller POST/PATCH handlers, lib/links.ts

Target-URL validation (use Zod v4's top-level `z.url`):
```typescript
import { z } from "zod";

const targetUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

function validateTargetUrl(raw: string): string | undefined {
  const parsed = targetUrlSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
```

Slug validation (custom charset + length):
```typescript
const slugSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9_-]+$/, "Slug must contain only alphanumeric, hyphens, underscores");
```

### Rate Limiting
**Source:** `apps/api/src/plugins/rateLimit.ts` + `apps/api/src/routes/domains.ts`
**Apply to:** Link create and import endpoints

Add to `apps/api/src/plugins/rateLimit.ts`:
```typescript
export const LINK_CREATE_RATE_LIMIT = {
  max: 20,
  timeWindow: "15 minutes",
} as const;

export const LINK_IMPORT_RATE_LIMIT = {
  max: 5,
  timeWindow: "15 minutes",
} as const;
```

Apply in routes:
```typescript
app.route({
  method: "POST",
  url: "/api/links",
  config: { rateLimit: LINK_CREATE_RATE_LIMIT },
  handler: async (request, reply) => { ... },
});
```

### Toast Notifications (Frontend)
**Source:** `apps/web/src/views/DomainsView.vue` lines 37-59
**Apply to:** All Vue views (LinksView, LinkDetailView, LinksImportView)

Per-view pattern (NOT global store):
```typescript
const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.value = message;
  toastTimeout = setTimeout(() => {
    toastMessage.value = null;
  }, 1700);
}
```

Messages per D-06 (UI-06) Copywriting Contract:
- Create: `"{domain}/{slug} erstellt"`
- Copy: `"Link kopiert"`
- Import: `"{N} Links importiert"`
- Delete: `"Link gelöscht"`

---

## No Analog Found

Files with no direct precedent in the codebase (planner should rely on RESEARCH.md and UI-SPEC.md):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/lib/links.ts` | service | validation-core | No prior service module exists that performs pure validation + DB-layer coordination; authorization.ts is closest (validation only), routes/domains.ts shows the pattern (but is HTTP-layer only) — merge both patterns |

---

## Metadata

**Analog search scope:** `apps/api/src/lib/`, `apps/api/src/routes/`, `apps/api/src/plugins/`, `apps/api/test/`, `apps/web/src/views/`, `apps/web/src/`, `packages/shared/src/`

**Files scanned:** 9 existing files (domains.ts route, authorization.ts, schema.prisma, domains.integration.test.ts, DomainsView.vue, api.ts, env.ts, rateLimit.ts, shared index.ts)

**Pattern extraction date:** 2026-07-11

**Confidence:** HIGH — all analogs are from the completed Phase 2/3 codebase, patterns are stable and well-tested. No external assumptions.
