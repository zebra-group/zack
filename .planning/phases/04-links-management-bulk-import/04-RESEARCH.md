# Phase 4: Links Management & Bulk Import - Research

**Researched:** 2026-07-11
**Domain:** CRUD + bulk-import service architecture on Fastify/Prisma/Postgres, with a security-critical "single validated write path" invariant
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (core invariant):** Manual create (LINK-01/02) **and** CSV bulk import (LINK-08) go through the **same** `createLink` service (validation + authorization + slug/reserved rules). Import is a batch call of that service — **never** a parallel path that writes raw rows to the DB.
- **D-02 (slug strategy):** Auto-slug is **Base62** (`[a-zA-Z0-9]`), ~6–7 chars. Collision on auto-slug → re-roll with a retry limit; collision on custom slug (LINK-02) → clear error. **Reserved slugs** (`api`, `health`, `.well-known`, static asset paths, app/system routes) are rejected so a Link can never shadow a system route. Slug is **unique per domain**.
- **D-03 (authorization):** **All** domain members (owner/admin/member) with `requireDomainAccess(userId, domainId, 'member')` may create/edit/delete Links in that domain. The Link list (LINK-03) is domain-scoped via `scopedDomainIds(userId)` — users see only Links of domains they can access.
- **D-04 (edit & slug editability):** LINK-06 allows editing target URL, attributes, **and** the slug. A slug change shows a **clear warning** that existing shared links (and later QR codes) will break. A changed slug follows the same collision/reserved rules as creation.
- **D-05 (CSV bulk import):** CSV columns `ziel_url, slug, domain`. A **live validation preview** shows "N valid · M skipped" (LINK-08) **before** commit. Skipped rows carry a reason: invalid target URL, taken/reserved slug, unauthorized/unknown domain, in-file duplicate. Reasonable row limit is **Claude's discretion**.
- **D-06 (UI):** Toast confirmations (UI-06) for create, copy (LINK-04, clipboard), import, and delete. Copy always yields the **full** URL (`https://<domain>/<slug>`).

### Claude's Discretion

- Exact Link schema (`domainId` FK, slug unique-per-domain, `targetUrl`, `createdBy`, timestamps, optional `title`/tags).
- Slug-generator + reserved-list details.
- CSV parsing library + row limit.
- Search/filter query shape.
- Clipboard API.
- Detail-page statistics placeholder styling (real numbers land in the Analytics phase).

### Deferred Ideas (OUT OF SCOPE)

- Real click statistics on the detail page (LINK-05) — Analytics phase; this phase shows only attributes + a placeholder stats section.
- QR codes for Links — QR phase.
- Password protection / expiration of Links — later phase.
- Folder/tag organization beyond search/filter — separate phase if needed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LINK-01 | Create a Link via domain + target URL, blank slug → auto-generated | `createLink` service (Pattern 1), Base62 slug generator (Code Examples), targetUrl zod validation |
| LINK-02 | Custom slug | `resolveSlug` sub-step of `createLink`, reserved-list + per-domain uniqueness check, "slug taken" error mapping |
| LINK-03 | Search + domain filter on Link list | `GET /api/links?q=&domainId=` pattern, `scopedDomainIds` + Prisma `contains` filters |
| LINK-04 | Copy full URL to clipboard | Frontend-only; DTO must expose `domain.hostname` so `https://{hostname}/{slug}` can be built client-side; `navigator.clipboard.writeText` |
| LINK-05 | Detail page with attributes + stats placeholder | `GET /api/links/:id` DTO; stats section is static UI per D-05/UI-SPEC (no backend work) |
| LINK-06 | Edit Link settings (incl. slug + warning) | `updateLink` sharing `resolveSlug`/`validateTargetUrl` with `createLink` (Pattern 1); `excludeLinkId` param for self-slug re-save |
| LINK-07 | Delete Link | `DELETE /api/links/:id`, `requireDomainAccess(...,'member')` looked up via the link's own `domainId` |
| LINK-08 | CSV bulk import with live preview (N valid/M skipped) | Two-phase preview/commit architecture (Pattern 2), shared `validateLinkInput` dry-run, in-file duplicate tracking, 4 skip-reason mapping |
| UI-06 | Toast confirmations | Reuse Phase 2/3 per-view toast pattern (`ref` + `setTimeout`, no global store) — see Code Context |
</phase_requirements>

## Summary

Phase 4 is a standard multi-tenant CRUD-plus-bulk-import feature, but its correctness anchor is architectural, not functional: **one write path**. The plan must produce a `createLink` service that both the manual-create route and the CSV importer call, and the safest way to prove "bulk cannot bypass validation" by test is to make bypass structurally impossible rather than merely policy-enforced — by extracting a pure `validateLinkInput` step (authorization → target-URL validation → slug resolution/reserved/collision checks) that both `createLink` (validate + insert) and a new `previewLink` (validate, **no** insert) call. The CSV preview endpoint calls `previewLink` row-by-row; the CSV commit endpoint calls `createLink` row-by-row — literally the same function used by the manual-create route. This turns "no bypass" into a code-shape fact the plan-checker/verifier can assert on directly (grep for a single `prisma.link.create` call site) rather than a behavioral claim that needs elaborate mocking to prove.

Everything else follows existing Phase 2/3 patterns almost mechanically: `requireDomainAccess`/`scopedDomainIds` for authorization (already frozen, zero new authz code needed), Zod for request/CSV-row validation, Prisma's `@@unique([domainId, slug])` composite constraint plus a P2002 catch as the race-condition safety net, and the established per-view toast/modal/screen-container CSS conventions from `DomainsView.vue`. Two small libraries are needed that don't exist in the stack yet: `csv-parse` (server-side CSV parsing, used identically by both preview and commit so there is exactly one parsing implementation too) and `nanoid` (for `customAlphabet`-based Base62 slug generation). Both are extremely high-usage, long-established packages that the automated legitimacy gate nonetheless flagged `SUS` on a "too-new" signal — this is a false positive caused by a recent patch-version publish date, not package age (see Package Legitimacy Audit), but per protocol both still require a `checkpoint:human-verify` task before install.

One cross-phase risk worth flagging explicitly to the planner: the current redirect stub (`GET /:slug`, `apps/api/src/routes/redirect.ts`) is registered directly on the Fastify app and matches **any** single-segment path with no Host-header/domain scoping yet — including the dashboard's own client-only routes (`/login`, `/domains`, `/links`, etc.), which exist only in Vue Router, not as Fastify routes. A hard page-refresh on `/domains` today is intercepted by the parametric `/:slug` route before it can fall through to the SPA fallback. Phase 4 does not fix this (it belongs to Phase 5's Core Redirect Engine, which must add Host-based domain scoping so the dashboard's own domain never resolves through the Link-slug lookup at all), but Phase 4's reserved-slug list should still include every current top-level SPA route segment as defense in depth, and this note should carry forward into Phase 5's research.

**Primary recommendation:** Build a `lib/links.ts` service module with `validateLinkInput` (pure, no DB write) as the single validation core, `createLink` (validate + insert) and `previewLink` (validate only) as its two callers, and route both `POST /api/links` and the CSV commit path through `createLink` — never through a second, parallel insert.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Link creation, validation, slug/reserved rules | API / Backend | Database (unique constraint) | Security-critical single-write-path invariant (D-01) must be enforced server-side; DB constraint is the last-resort safety net for races |
| CSV parsing (structure) | API / Backend | — | Parsing must happen exactly once, server-side, so preview and commit see byte-identical row data — parsing client-side would create a second, divergent parsing implementation |
| CSV file selection + drag/drop | Browser / Client | — | Native `<input type="file">` + `FileReader.readAsText()`; the file never needs to leave the browser as anything but raw text sent to the backend |
| Live validation preview rendering (N valid/M skipped) | Browser / Client | API / Backend | Backend computes the valid/skip/reason list (dry-run); frontend only renders it — no client-side re-validation logic |
| Link list search/filter | API / Backend | Database | `scopedDomainIds` authorization must gate the query itself, not filter results client-side (T-03-09 precedent from Phase 3) |
| Copy full URL | Browser / Client | — | Pure client-side string composition (`https://{domain}/{slug}`) + Clipboard API, no server round-trip needed |
| Detail-page stats placeholder | Browser / Client | — | Static UI only in this phase (TRACK-* is Phase 6); no backend capability to map to |
| Domain-scoped authorization | API / Backend | — | `requireDomainAccess`/`scopedDomainIds` (Phase 2) — reused unchanged, zero new authorization logic this phase |
| Reserved-slug protection of system routes | API / Backend | — | Must be enforced at write time in the same process that owns the Fastify route table, so the reserved list can be kept in sync with actually-registered routes |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `csv-parse` | ^7.0.1 (verified on npm registry, published 2026-07-02) [ASSUMED: package name via WebSearch, see Package Legitimacy Audit] | Server-side CSV → row-object parsing (`csv-parse/sync`) | The de facto standard Node CSV parser (part of the `node-csv` project, 15.6M weekly downloads); `columns: true` + `skip_empty_lines: true` gives header-mapped row objects in one call, avoiding hand-rolled comma/quote-escaping logic |
| `nanoid` | ^5.1.16 (verified on npm registry, published 2026-06-24) [ASSUMED: package name via WebSearch, see Package Legitimacy Audit] | `customAlphabet` for Base62 auto-slug generation | Tiny (118 bytes), URL-safe, cryptographically secure random ID generator; `customAlphabet(BASE62_ALPHABET, 7)` matches D-02's spec exactly without hand-rolling a CSPRNG-backed charset sampler |
| `zod` | ^4.4.3 (already installed) | Target-URL validation, CSV row schema, request body schemas | Already the project's sole validation library (Phase 1–3 precedent); v4's top-level `z.url({ protocol: /^https?$/ })` restricts to http/https only, rejecting `javascript:`/`data:`/`file:` schemes by construction |
| `@prisma/client` / `prisma` | ^7.8.0 (already installed) | `Link` model, composite unique constraint, P2002 detection | Already the project's ORM; no new dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — (no new backend framework deps) | n/a | Reuse `@fastify/rate-limit` (already installed) | Add `LINK_CREATE_RATE_LIMIT` / `LINK_IMPORT_RATE_LIMIT` route-level overrides mirroring `DOMAIN_CREATE_RATE_LIMIT`'s existing pattern in `plugins/rateLimit.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `csv-parse` (server-side parsing) | Client-side CSV parsing (e.g. PapaParse in the browser) + send parsed JSON rows to the backend | Rejected: creates two parsing implementations (browser + any server-side re-validation) that can silently diverge on edge cases (quoted commas, BOM, CRLF) — violates the same "single source of truth" spirit as D-01. Sending raw CSV text and parsing once, server-side, keeps preview and commit byte-identical. |
| `csv-parse` | `@fastify/multipart` + streaming CSV parse | Rejected for this phase's scale: D-05's "reasonable row limit" (recommend 500) means the whole file comfortably fits in memory as a string; adding multipart handling is unnecessary complexity when the file can be read client-side via `FileReader.readAsText()` and POSTed as a JSON string field, avoiding a new Fastify plugin entirely. Revisit only if a future phase needs multi-MB imports. |
| `nanoid` `customAlphabet` | Hand-rolled `Math.random()`-based charset sampler | Rejected: `Math.random()` is not cryptographically secure and its distribution/seeding is engine-dependent; `nanoid` uses `crypto.randomBytes` under the hood and is the documented standard for exactly this use case (short, URL-safe unique IDs) |
| `nanoid` | `crypto.randomInt` hand-rolled loop | Viable but reinvents `customAlphabet`'s already-audited rejection-sampling logic (avoiding modulo bias) for no benefit — not recommended |

**Installation:**
```bash
pnpm --filter @kurzly/api add csv-parse nanoid
```

**Version verification:** Verified via `npm view csv-parse version` → `7.0.1` (published 2026-07-02) and `npm view nanoid version` → `5.1.16` (published 2026-06-24). Both packages' ESM `exports` maps were checked directly (`npm view <pkg> exports`) and confirmed compatible with this project's `"type": "module"` setup: `csv-parse/sync` exports a `.import` condition, `nanoid`'s root export resolves via `default`/`browser` conditions with no CJS-only trap.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `csv-parse` | npm | latest version published 2026-07-02 (package itself is `node-csv`, a multi-year project) | 15,606,118/week | `github.com/adaltas/node-csv` | `SUS` (reason: `too-new`) | **Kept** — flagged as suspicious purely because the automated check's "too-new" heuristic looks at the *latest published version's* date, not the package's founding date; 15.6M weekly downloads and an established multi-year GitHub repo are strong legitimacy signals a slopsquatted/hallucinated package would never have. **Planner must still insert a `checkpoint:human-verify` task before this install**, per protocol. |
| `nanoid` | npm | latest version published 2026-06-24 (package itself predates this by years — it is one of npm's most depended-upon utility packages) | 197,706,104/week | `github.com/ai/nanoid` | `SUS` (reason: `too-new`) | **Kept** — same false-positive pattern as `csv-parse`: recent patch release, not a new/suspicious package. 197.7M weekly downloads is among the highest of any npm package. **Planner must still insert a `checkpoint:human-verify` task before this install**, per protocol. |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `csv-parse`, `nanoid` — both are almost certainly legitimate (see disposition notes above), but the planner must gate each install behind a `checkpoint:human-verify` task per the Package Legitimacy Gate protocol, since both package names were discovered via WebSearch/training knowledge rather than an authoritative source and are therefore also tagged `[ASSUMED]` above.

No `postinstall` scripts were found for either package (`npm view <pkg> scripts.postinstall` returned empty for both).

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Browser (Vue SPA)                                                        │
│                                                                            │
│  LinksView (list/search/filter, create/edit modals, delete dialog)       │
│  LinkDetailView (attributes + stats placeholder)                         │
│  LinksImportView (file picker → live preview → commit)                   │
│                                                                            │
│  api.ts: createLink() / listLinks() / getLink() / updateLink() /         │
│          deleteLink() / previewImport(csvText) / commitImport(csvText)   │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │ fetch (same-origin, JSON)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Fastify API (apps/api)                                                   │
│                                                                            │
│  routes/links.ts                                                         │
│   POST   /api/links               ──┐                                    │
│   GET    /api/links                 │                                    │
│   GET    /api/links/:id             │   all resolve userId via           │
│   PATCH  /api/links/:id             │   auth.api.getSession(...)         │
│   DELETE /api/links/:id             │   (same pattern as routes/domains) │
│   POST   /api/links/import/preview  │                                    │
│   POST   /api/links/import/commit ──┘                                    │
│                     │                                                     │
│                     ▼                                                     │
│  lib/links.ts (THE single write-path core, D-01)                         │
│                                                                            │
│   validateLinkInput(prisma, {userId, domainId, targetUrl, slug?,         │
│                               excludeLinkId?})                           │
│     1. requireDomainAccess(prisma, userId, domainId, 'member')  ─────┐   │
│     2. validateTargetUrl(targetUrl)  — zod z.url({protocol:https?})  │   │
│     3. resolveSlug(prisma, domainId, slug?, excludeLinkId?)          │   │
│        - custom slug: reserved-list check → per-domain uniqueness    │   │
│        - blank slug: nanoid customAlphabet Base62 × N retries        │   │
│     → returns {ok:true, data} | {ok:false, error:<code>}             │   │
│                     │                                                 │   │
│         ┌───────────┴───────────┐                                    │   │
│         ▼                       ▼                                    │   │
│   createLink(...)          previewLink(...)                          │   │
│   = validateLinkInput      = validateLinkInput                       │   │
│     + prisma.link.create     (NO db write — dry run)                 │   │
│     + P2002 catch                                                    │   │
│         │                       │                                    │   │
│         ▼                       ▼                                    │   │
│  used by:                 used by:                                   │   │
│   - POST /api/links        - POST /api/links/import/preview          │   │
│   - PATCH /api/links/:id     (row-by-row, dry-run, in-file dup       │   │
│     (as updateLink,           tracking layered on top)               │   │
│     shares resolveSlug)                                              │   │
│   - POST /api/links/                                                 │   │
│     import/commit                                                    │   │
│     (row-by-row, SEQUENTIAL — never Promise.all, so each row's       │   │
│     insert is visible to the next row's uniqueness check)            │   │
│                     │                                                 │   │
│                     ▼                                                 │   │
└─────────────────────┼──────────────────────────────────────────────┘   │
                       ▼                                                  │
┌─────────────────────────────────────────────────────────────────────┐  │
│ PostgreSQL — Link table, @@unique([domainId, slug])                  │  │
│ DomainMembership table (queried by requireDomainAccess) ◄────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   └── links.ts          # validateLinkInput / createLink / previewLink / updateLink,
│                          # RESERVED_SLUGS, slug generator, targetUrl validator
├── routes/
│   └── links.ts           # thin HTTP layer: session resolution, error→status mapping,
│                          # CSV parse + import orchestration (preview/commit)
└── test/
    ├── links.integration.test.ts         # createLink/updateLink/list/detail/delete
    └── links-import.integration.test.ts  # CSV preview+commit, D-01 no-bypass proof

apps/web/src/
├── views/
│   ├── LinksView.vue           # list + search + domain filter + create/edit modals + delete dialog
│   ├── LinkDetailView.vue      # /links/:id
│   └── LinksImportView.vue     # /links/import
└── api.ts                      # extended with Link + import client functions

packages/shared/src/
└── index.ts                    # + LinkDTO, CreateLinkInput, UpdateLinkInput,
                                 #   ImportPreviewRow, ImportPreviewResult, ImportCommitResult
```

### Pattern 1: Shared Validation Core (`validateLinkInput`) — the D-01 enforcement mechanism
**What:** Extract every rule that must apply identically to manual creation, editing, and bulk import into one pure function that does authorization + target-URL validation + slug resolution, but performs **no** database write. `createLink` and `updateLink` call it and then write; `previewLink` calls it and returns the result untouched.
**When to use:** Any time two entry points (UI form + bulk importer) must be provably subject to the same rules — this is the general-purpose version of D-01, reusable for any future "bulk X" feature (e.g. bulk QR creation in Phase 7).
**Example:**
```typescript
// apps/api/src/lib/links.ts
import { ForbiddenError, requireDomainAccess } from "./authorization.js";
import { customAlphabet } from "nanoid";
import type { PrismaClient } from "../generated/prisma/client.js";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generateSlug = customAlphabet(BASE62, 7);
const AUTO_SLUG_RETRY_LIMIT = 5;

export const RESERVED_SLUGS = new Set([
  "api", "health", ".well-known", "assets", "favicon.ico", "robots.txt",
  "index.html", "login", "auth", "domains", "links", "qr-codes",
  "analytics", "team", "q", // reserved forward-looking for QR-02 (/q/:code)
]);

export type LinkErrorCode =
  | "UNAUTHORIZED_DOMAIN"
  | "INVALID_TARGET_URL"
  | "SLUG_TAKEN"
  | "SLUG_RESERVED"
  | "SLUG_GENERATION_EXHAUSTED";

type ValidatedLink = { domainId: string; targetUrl: string; slug: string; title?: string };
type ValidationResult =
  | { ok: true; data: ValidatedLink }
  | { ok: false; error: LinkErrorCode };

export async function validateLinkInput(
  prisma: PrismaClient,
  input: { userId: string; domainId: string; targetUrl: string; slug?: string; title?: string; excludeLinkId?: string },
): Promise<ValidationResult> {
  try {
    await requireDomainAccess(prisma, input.userId, input.domainId, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "UNAUTHORIZED_DOMAIN" };
    throw err;
  }

  const targetUrl = validateTargetUrl(input.targetUrl);
  if (!targetUrl) return { ok: false, error: "INVALID_TARGET_URL" };

  const slugResult = await resolveSlug(prisma, input.domainId, input.slug, input.excludeLinkId);
  if (!slugResult.ok) return slugResult;

  return { ok: true, data: { domainId: input.domainId, targetUrl, slug: slugResult.slug, title: input.title } };
}

export async function createLink(prisma: PrismaClient, input: Parameters<typeof validateLinkInput>[1]) {
  const validated = await validateLinkInput(prisma, input);
  if (!validated.ok) return validated;
  try {
    const link = await prisma.link.create({
      data: { ...validated.data, createdBy: input.userId },
    });
    return { ok: true as const, link };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { ok: false as const, error: "SLUG_TAKEN" as const };
    throw err;
  }
}

/** Dry-run: identical rules, zero DB writes — used by the CSV preview endpoint. */
export async function previewLink(prisma: PrismaClient, input: Parameters<typeof validateLinkInput>[1]) {
  return validateLinkInput(prisma, input);
}
```
Source: pattern synthesized from Phase 2/3's `requireDomainAccess` reuse convention (`apps/api/src/lib/authorization.ts`) and Prisma's own P2002-catch guidance [CITED: prisma.io/docs/orm/prisma-client/debugging-and-troubleshooting/handling-exceptions-and-errors].

### Pattern 2: Two-Phase CSV Import (Preview → Commit), Same Parser, Same Validator
**What:** `POST /api/links/import/preview` and `POST /api/links/import/commit` both accept `{ csv: string, defaultDomainId?: string }` (raw CSV text, read client-side via `FileReader.readAsText()` and sent as a JSON string field — no multipart needed). Both parse with the exact same `csv-parse/sync` call and run the exact same in-file-duplicate-tracking loop; **only** the terminal call differs (`previewLink` vs `createLink`).
**When to use:** Any CSV/bulk-import feature where a live "N valid / M skipped" preview must exactly predict what commit will do.
**Example:**
```typescript
// apps/api/src/lib/links.ts (continued)
import { parse } from "csv-parse/sync";
import { normalizeHostname } from "./hostname.js";

const MAX_IMPORT_ROWS = 500;

type CsvRow = { ziel_url?: string; slug?: string; domain?: string };
export type SkipReason = "invalid_url" | "slug_conflict" | "domain_unauthorized" | "duplicate_in_file";

async function resolveRowDomainId(
  prisma: PrismaClient,
  row: CsvRow,
  defaultDomainId: string | undefined,
): Promise<string | undefined> {
  if (!row.domain?.trim()) return defaultDomainId;
  const domain = await prisma.domain.findUnique({
    where: { hostname: normalizeHostname(row.domain) },
  });
  return domain?.id; // undefined → validateLinkInput's requireDomainAccess denies as UNAUTHORIZED_DOMAIN
}

/** Shared by preview (mutate=false) and commit (mutate=true) — see D-01. */
async function runImport(
  prisma: PrismaClient,
  userId: string,
  csvText: string,
  defaultDomainId: string | undefined,
  mutate: boolean,
) {
  const rows: CsvRow[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`CSV exceeds ${MAX_IMPORT_ROWS} row limit`);
  }

  const seenSlugs = new Set<string>(); // `${domainId}:${slug}` — only for explicit custom slugs
  const skipped: { row: CsvRow; reason: SkipReason }[] = [];
  const results: unknown[] = [];

  for (const row of rows) {
    const domainId = await resolveRowDomainId(prisma, row, defaultDomainId);
    const customSlug = row.slug?.trim() || undefined;

    if (domainId && customSlug) {
      const dedupeKey = `${domainId}:${customSlug}`;
      if (seenSlugs.has(dedupeKey)) {
        skipped.push({ row, reason: "duplicate_in_file" });
        continue;
      }
      seenSlugs.add(dedupeKey);
    }

    const outcome = domainId
      ? await (mutate ? createLink : previewLink)(prisma, {
          userId,
          domainId,
          targetUrl: row.ziel_url ?? "",
          slug: customSlug,
        })
      : { ok: false as const, error: "UNAUTHORIZED_DOMAIN" as const };

    if (!outcome.ok) {
      skipped.push({ row, reason: mapErrorToSkipReason(outcome.error) });
    } else {
      results.push(outcome);
    }
  }

  return { validCount: results.length, skipped, results };
}

export const previewImport = (prisma: PrismaClient, userId: string, csv: string, defaultDomainId?: string) =>
  runImport(prisma, userId, csv, defaultDomainId, false);

export const commitImport = (prisma: PrismaClient, userId: string, csv: string, defaultDomainId?: string) =>
  runImport(prisma, userId, csv, defaultDomainId, true);
```
**Critical detail:** the `for...of` loop above is **sequential** (`await` inside the loop, no `Promise.all`) — this is what makes per-domain slug uniqueness checks correct across rows in the same file without extra bookkeeping: row 2's `createLink` call only runs after row 1's `prisma.link.create` has committed (within the test-harness transaction) or the request-scoped connection, so row 2's own uniqueness check sees row 1's insert. Parallelizing this loop would reintroduce exactly the TOCTOU race the in-file dedup set only partially covers (custom slugs), and would NOT help auto-generated slugs at all (nanoid's own low collision probability is the only protection there, per-retry).

Source: assembled from Prisma error-handling docs [CITED: prisma.io/docs/orm/prisma-client/debugging-and-troubleshooting/handling-exceptions-and-errors] and `csv-parse` sync API docs [CITED: csv.js.org/parse/api/sync].

### Pattern 3: Reserved-Slug List Sourced From the Actual Route Table
**What:** `RESERVED_SLUGS` (see Pattern 1) is a hand-maintained `Set<string>` — not dynamically introspected from Fastify's router — because `@fastify/static`'s `wildcard: false` mode only registers routes for files present in `public/` **at boot time**, which is not statically knowable at slug-validation time. Instead, the list is derived by reading `app.ts`'s registration list plus the SPA's own top-level route segments (`router/index.ts`), and is committed as a single source of truth with a comment pointing back to both files so it's revisited whenever a new top-level route/segment is added.
**When to use:** Any time a user-supplied path segment must never shadow a system route.
**Reserved list to seed from this codebase (verified by reading the actual route registrations):**
- `api`, `health` — real Fastify routes (`routes/*.ts`)
- `.well-known` — no current Kurzly route, but a conventional reverse-proxy/ACME path an operator may route to the app; reserve forward-looking per D-02's explicit example
- `assets`, `favicon.ico`, `robots.txt`, `index.html` — the built SPA's static file routes (`@fastify/static`, `apps/api/public/`)
- `login`, `auth`, `domains`, `links`, `qr-codes`, `analytics`, `team` — every current Vue Router top-level path segment (`apps/web/src/router/index.ts`) — these are **not** Fastify routes today, but see the SPA-shadowing pitfall below for why reserving them anyway is defense in depth
- `q` — reserved forward-looking for QR-02's dynamic QR short-URL namespace (`/q/xxxx`, Phase 7) so a Link can never claim a slug that later collides with a QR code's own namespace

**Reserved-list matching should be case-insensitive** (`RESERVED_SLUGS.has(slug.toLowerCase())`) even though per-domain slug **uniqueness** stays case-sensitive (matching D-02's explicit mixed-case Base62 charset, and Postgres's default case-sensitive string equality — no `citext` needed). Rationale: Fastify's router (`find-my-way`) is case-sensitive by default [CITED: fastify.dev/docs/latest/Reference/Server, find-my-way README], so `API` would not literally collide with `/api` today — but reserving case-insensitively avoids visually-confusing near-collisions and is cheap insurance if `caseSensitive` routing config ever changes.

### Anti-Patterns to Avoid
- **A second `prisma.link.create` call site for bulk import:** the single most important thing to avoid this phase. If the CSV commit path ever calls `prisma.link.create` directly (even "just for performance"), D-01's guarantee is void and the reserved-slug/collision/authorization rules can silently diverge between the two paths over time as one gets a bugfix the other doesn't.
- **`Promise.all` over CSV rows:** breaks sequential-consistency of per-domain slug uniqueness checks (see Pattern 2) and makes the in-file duplicate detection race-prone.
- **Validating CSV rows against a duplicated/handwritten copy of `createLink`'s rules:** even a "just for preview, close enough" reimplementation risks preview showing "N valid" while commit actually imports a different N — exactly the class of bug D-05's live-preview requirement exists to prevent users from hitting.
- **Deriving the reserved-slug list dynamically from Fastify's route table at request time:** `@fastify/static`'s `wildcard: false` glob happens once at boot; a purely dynamic reserved-list lookup would also need to special-case the SPA's client-only routes (which never appear in Fastify's table at all), so a maintained static list is actually more correct here, not less.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| CSV parsing (quoted fields, embedded commas, CRLF/LF, BOM) | A `String.split(',')`-based parser | `csv-parse/sync` | RFC 4180 CSV quoting/escaping rules have enough edge cases (quoted commas, escaped quotes, mixed line endings) that a naive split silently corrupts data on real-world exported CSVs (e.g. from Excel) — this is a well-solved problem with a mature, 15M-download/week library |
| Random unique slug generation | `Math.random().toString(36)` | `nanoid`'s `customAlphabet` | `Math.random()` is not cryptographically secure and has engine-dependent bias; `customAlphabet` uses rejection sampling over `crypto.randomBytes` to guarantee uniform distribution over the given alphabet with no modulo bias |
| URL scheme/format validation | A hand-written regex for "looks like a URL" | Zod's `z.url({ protocol: /^https?$/ })` | Zod v4's `z.url()` uses the WHATWG URL parser under the hood (not a naive regex), correctly handles internationalized domains, ports, and query strings, and the `protocol` option is exactly the documented mechanism for scheme allowlisting — a hand-rolled regex is also the documented root cause of the `z.string().url()`-accepts-`javascript:` CVE-class issue in older Zod versions |
| Composite-unique-constraint race handling | A `SELECT ... then INSERT` check with no catch | Prisma's `@@unique([domainId, slug])` + P2002 catch as the authoritative safety net | A pre-check `findUnique` (used for the fast/friendly-error path) is inherently racy under concurrent requests; only the DB constraint itself is the real guarantee — the P2002 catch (already an established pattern in `routes/domains.ts`) closes that gap |

**Key insight:** Every "don't hand-roll" item above maps to a place where a hand-rolled version would be *plausible-looking but subtly wrong on real-world input* — CSV files from Excel, adversarial URLs, and concurrent writes are exactly the inputs that expose naive implementations, and this phase's CONTEXT.md explicitly frames the whole phase around "no bypass, no smuggled invalid data," so cutting corners here directly undermines the phase's own stated goal.

## Common Pitfalls

### Pitfall 1: Bulk import "optimizing" into a batch insert
**What goes wrong:** A future refactor (or an under-specified initial implementation) replaces the row-by-row `createLink` loop with `prisma.link.createMany({ data: rows })` for performance, silently reintroducing a parallel write path that skips authorization/slug/reserved checks entirely.
**Why it happens:** `createMany` looks like the "obviously more efficient" choice for bulk writes, and Prisma's own docs present it as the standard bulk-insert API without flagging that it bypasses any application-level hooks.
**How to avoid:** Keep the import loop sequential and calling `createLink` per row (Pattern 2); add a code comment at the top of the import function pointing back to D-01; add an integration test that imports a CSV containing one row with a reserved slug and asserts the resulting Link count is `validCount` exactly (not `validCount + 1`), proving the reserved check actually ran during commit, not just preview.
**Warning signs:** Any `createMany`/`insertMany`/raw SQL `INSERT ... VALUES (...), (...), (...)` appearing anywhere in the Links feature's code.

### Pitfall 2: Preview/commit drift from re-parsing or re-validating differently
**What goes wrong:** Preview and commit each independently call `parse()` with slightly different options (e.g. preview trims whitespace, commit doesn't), producing a preview that says "12 valid" but commit actually imports 11 (or errors on the 12th).
**Why it happens:** Preview and commit are naturally built as two separate route handlers; without deliberate code-sharing, options drift over time as each handler gets tweaked independently.
**How to avoid:** Route both through the single `runImport(..., mutate)` function (Pattern 2) with `mutate` as the only branching parameter — never duplicate the `parse()` call or the row-validation loop.
**Warning signs:** Two different `parse(csvText, {...})` call sites with different option objects; two different loops iterating `rows`.

### Pitfall 3: Reserved-slug list omission lets a Link shadow a real route
**What goes wrong:** A user creates a Link with slug `health` on any domain; if the redirect engine (Phase 5) ever resolves slugs without first checking Fastify's own static route table (which it inherently can't, since Fastify's router already claimed `/health` before any handler code runs) — this specific pitfall is actually pre-empted by Fastify's own routing precedence (static routes always beat parametric ones), so a Link named `health` is not a live security bypass. The real risk is **the opposite**: the Link becomes permanently unreachable and non-obviously so (a confused user who created `/health` as a slug will find it silently 404s or serves the health-check JSON instead of redirecting).
**Why it happens:** Reserved-slug lists are typically written once at phase-start and not revisited as new routes are added in later phases (e.g. Phase 7's `/q/:code`).
**How to avoid:** Keep `RESERVED_SLUGS` (Pattern 3) as a single exported constant with a comment instructing future phases to add their own top-level route segments to it; add a test that asserts every string in `RESERVED_SLUGS` is rejected by `createLink`.
**Warning signs:** A new top-level Fastify route or SPA route added in a later phase without a corresponding `RESERVED_SLUGS` update.

### Pitfall 4: IDOR on Link detail/edit/delete via a guessed ID
**What goes wrong:** `GET/PATCH/DELETE /api/links/:id` looks up the Link by ID and returns/mutates it without first checking that the caller has `requireDomainAccess` on that **specific Link's** `domainId` — a member of domain A could guess or enumerate a Link ID belonging to domain B and read/edit/delete it.
**Why it happens:** Unlike Domain routes (where `:id` IS the domain, so `requireDomainAccess(prisma, userId, id, role)` is a direct one-step call), Link routes have `:id` = the Link, one join away from the domain — it's easy to forget the extra `prisma.link.findUnique` lookup step before authorizing.
**How to avoid:** Every Link-by-ID route must: (1) `findUnique` the Link (404 if not found — do this before authorization to avoid leaking existence via a different status code than the auth-denial path, OR treat "not found" and "found but forbidden" identically as 404 to avoid existence leakage, matching this codebase's `T-03-04`-style information-disclosure discipline seen in `tlsCheck.ts`), then (2) `requireDomainAccess(prisma, userId, link.domainId, 'member')` before returning/mutating anything.
**Warning signs:** A route handler that reads `request.params.id`, does a `findUnique`, and returns/mutates the result with no `requireDomainAccess` call in between.

### Pitfall 5: `/:slug` redirect stub currently shadows dashboard SPA routes (cross-phase risk, not this phase's fix)
**What goes wrong:** `apps/api/src/routes/redirect.ts` registers `GET /:slug` with no Host-header scoping. A hard page-load of `https://dashboard.example.com/domains` matches this parametric route (since `/domains` is not a real Fastify route — it only exists in Vue Router) and is currently intercepted by the redirect stub's 404 JSON instead of falling through to the SPA's `index.html` fallback.
**Why it happens:** The redirect handler is a phase-1 placeholder that intentionally has zero resolution logic yet (documented in its own header comment as "Phase 5 replaces this route entirely"); it hasn't yet learned to distinguish "this Host is the operator's own dashboard domain" from "this Host is a registered custom shortlink domain."
**How to avoid (this phase):** Not fixable here — the fix requires Host-based domain resolution, which is explicitly Phase 5's scope (`resolveActiveDomainByHost` already exists and is the right tool, just not wired into `redirect.ts` yet). This phase should only make sure its own reserved-slug list (Pattern 3) includes every current SPA route segment as partial mitigation, and this note should be carried into Phase 5's own research so the redirect engine's Host-scoping fix is not missed.
**Warning signs:** Any manual test of a hard-refresh on `/domains`, `/links`, etc. in the current (pre-Phase-5) codebase returning the redirect stub's JSON 404 instead of the SPA shell.

## Code Examples

### Zod target-URL schema (rejects javascript:/data:/file:, enforces http/https)
```typescript
// Source: zod.dev/api (Zod v4 z.url() docs, fetched directly)
import { z } from "zod";

const targetUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

function validateTargetUrl(raw: string): string | undefined {
  const parsed = targetUrlSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
```

### Prisma composite unique constraint + P2002 catch (mirrors `routes/domains.ts`'s existing `isUniqueConstraintViolation`)
```prisma
// apps/api/prisma/schema.prisma addition
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
```typescript
// Source: prisma.io/docs/orm/prisma-client/debugging-and-troubleshooting/handling-exceptions-and-errors
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}
```

### CSV sync parse (Source: csv.js.org/parse/api/sync)
```typescript
import { parse } from "csv-parse/sync";

const rows = parse(csvText, {
  columns: true,        // header row → object keys (ziel_url, slug, domain)
  skip_empty_lines: true,
  trim: true,
});
```

### Base62 slug generator with retry (Source: nanoid README, github.com/ai/nanoid)
```typescript
import { customAlphabet } from "nanoid";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generateSlug = customAlphabet(BASE62, 7);

async function generateUniqueSlug(prisma: PrismaClient, domainId: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < AUTO_SLUG_RETRY_LIMIT; attempt++) {
    const candidate = generateSlug();
    const exists = await prisma.link.findUnique({
      where: { domainId_slug: { domainId, slug: candidate } },
    });
    if (!exists) return candidate;
  }
  return undefined; // → SLUG_GENERATION_EXHAUSTED
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `z.string().url()` (Zod v3 style) | Top-level `z.url({ protocol, hostname })` | Zod v4 (already the project's installed major) | v4's form supports first-class protocol/hostname allowlisting without a wrapper regex; this project should use `z.url(...)` directly, not the deprecated `.string().url()` chain |
| Hand-rolled short-ID generators | `nanoid`'s `customAlphabet` | Long-standing (pre-dates this project) | No new change to flag; already the ecosystem standard |

**Deprecated/outdated:**
- `z.string().url()` — superseded by top-level `z.url()` in Zod v4; the old chained form still has a documented history of accepting dangerous schemes (`javascript:`) unless explicitly restricted.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `csv-parse` is the right package name/choice for CSV parsing (discovered via WebSearch, not an authoritative source) | Standard Stack, Package Legitimacy Audit | If this is somehow a wrong/squatted name, the install would fail (`npm view` already confirmed it exists and resolves to a real, well-known GitHub repo) — low practical risk given the download-count/repo evidence, but formally unverified against an authoritative source this session |
| A2 | `nanoid` is the right package name/choice for slug generation (discovered via WebSearch) | Standard Stack, Package Legitimacy Audit | Same as A1 — extremely low practical risk (197M weekly downloads), formally `[ASSUMED]` per provenance rule |
| A3 | Reasonable CSV import row limit = 500 | CONTEXT.md D-05 discretion, Pattern 2 | If the operator's real usage needs more, a 500-row cap could be too restrictive; low risk since it's a simple constant to raise later, and the sequential-write architecture (Pattern 2) means very large imports would be slow regardless |
| A4 | Custom slug charset = alphanumeric + hyphen/underscore, length 2–32 (not explicitly specified in CONTEXT.md, which only specifies the AUTO-slug charset as Base62) | Pattern 1 (`resolveSlug`) | If the project owner actually wants custom slugs restricted to Base62 only (matching the auto-slug charset), the schema would need tightening — low risk, easy follow-up change, but worth a quick confirmation at plan-review time since it's user-facing behavior |
| A5 | `createdBy` should be nullable with `onDelete: SetNull` (not `Cascade` like `DomainMembership`), so removing a team member (Phase 9's TEAM-05) doesn't delete their previously-created Links | Code Examples (Prisma schema) | If the project owner actually wants Links to cascade-delete with their creator, this is a meaningful behavior difference — flagging explicitly since Phase 9 (not yet built) is where this would actually get exercised/tested |
| A6 | Reserved-list matching should be case-insensitive while slug uniqueness stays case-sensitive | Pattern 3 | Low risk — this is a defense-in-depth choice, not a correctness requirement, since Fastify's router is case-sensitive by default anyway [CITED: fastify.dev docs] |

**If this table is empty:** N/A — see entries above; all are low-to-moderate risk and none block planning.

## Open Questions (RESOLVED)

> All three resolved with the recommended option and bound to the plans (confirmed at plan-review, 2026-07-11):
> 1. **createdBy on user removal** → RESOLVED: nullable `createdBy` + `onDelete: SetNull` (data-preserving) — applied in 04-02 Task 1 (Link schema).
> 2. **Custom-slug charset/length** → RESOLVED: `[a-zA-Z0-9_-]`, length 2–32 — applied in 04-02 Task 2 (validateLinkInput custom-slug rule).
> 3. **CSV row limit as ENV var?** → RESOLVED: No — `MAX_IMPORT_ROWS = 500` stays a code-level safety constant (not operator-tunable), applied in 04-04 Task 1. INFRA-02 governs deployment/instance config, not internal safety bounds.

1. **Should `createdBy` cascade-delete or null-out when a User is removed (Phase 9, TEAM-05)?**
   - What we know: `DomainMembership.userId` uses `onDelete: Cascade`. Links reference a creator too.
   - What's unclear: whether Links should survive their creator's removal from the team (a reasonable product expectation — a shortlink shouldn't vanish because the person who made it left) or whether the project owner wants stricter data cleanup.
   - Recommendation: default to nullable `createdBy` + `onDelete: SetNull` (A5 above) since this is safer (data preservation) and easy to tighten later if the owner disagrees; flag for confirmation at plan-review/discuss time if not already settled.

2. **Exact custom-slug charset/length bounds.**
   - What we know: D-02 specifies the AUTO-slug charset precisely (Base62, ~6–7 chars). It does not specify a charset for CUSTOM slugs (LINK-02).
   - What's unclear: whether custom slugs should be restricted to the same Base62 charset, or allowed a broader URL-safe set (hyphens/underscores are common in real-world custom-alias UX, e.g. `summer-sale-2026`).
   - Recommendation: allow `[a-zA-Z0-9_-]`, length 2–32 (A4) — matches common URL-shortener custom-alias conventions and stays safely within a single path segment's URL-safe character set (no percent-encoding surprises).

3. **Does the CSV import row limit (500, A3) need to be configurable via ENV, matching the project's `INFRA-02` "everything via environment variables" constraint?**
   - What we know: `.claude/CLAUDE.md` states the project is configured entirely via ENV vars (`INFRA-02`, already delivered in Phase 1).
   - What's unclear: whether a hardcoded `MAX_IMPORT_ROWS = 500` constant violates that constraint's spirit, or whether it's fine as a code-level safety limit (not a deployment-configuration concern).
   - Recommendation: treat as a code constant, not an ENV var — `INFRA-02`'s constraint is about deployment configuration (DB URL, SMTP, secrets), not internal safety limits; revisit only if a real operator requests a higher limit.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Backend runtime | ✓ | 24.x (per CLAUDE.md pin) | — |
| PostgreSQL (via testcontainers in tests) | `Link` model, unique constraint tests | ✓ | 18-alpine (existing harness) | — |
| pnpm | Dependency install (`csv-parse`, `nanoid`) | ✓ (workspace already using pnpm) | — | — |
| `csv-parse`, `nanoid` (new deps) | LINK-08, LINK-01/02 | ✗ (not yet installed) | — | Install via `pnpm --filter @kurzly/api add csv-parse nanoid` — no fallback needed, install is the intended action; gated by `checkpoint:human-verify` per Package Legitimacy Audit |

**Missing dependencies with no fallback:** none — `csv-parse`/`nanoid` are simply not-yet-installed, not unavailable in this environment; installing them is the plan's own Wave-1-style task.

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.10 (already configured, `apps/api/vitest.config.ts` + `test/globalSetup.ts` + `test/setupFileEach.ts`) |
| Config file | `apps/api/vitest.config.ts` |
| Quick run command | `pnpm --filter @kurzly/api test -- links` (Vitest name-filter, or run the specific new test file directly) |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|--------------|
| LINK-01 | Create Link, blank slug auto-generates | integration (`fastify.inject`, real Postgres) | `pnpm --filter @kurzly/api test -- links.integration` | ❌ Wave 0 |
| LINK-02 | Create Link with custom slug; taken slug → clear error | integration | same file as above | ❌ Wave 0 |
| LINK-03 | List search + domain filter, scoped to `scopedDomainIds` | integration | same file | ❌ Wave 0 |
| LINK-04 | Copy full URL | unit/component (Vue) | `pnpm --filter @kurzly/web test -- LinksView` | ❌ Wave 0 |
| LINK-05 | Detail page attributes + placeholder | integration (`GET /api/links/:id`) + component | `links.integration.test.ts` + web component test | ❌ Wave 0 |
| LINK-06 | Edit incl. slug change + warning shown | integration + component | `links.integration.test.ts` + `LinksView`/edit-modal component test | ❌ Wave 0 |
| LINK-07 | Delete Link | integration | `links.integration.test.ts` | ❌ Wave 0 |
| LINK-08 | CSV import preview + commit, D-01 no-bypass proof | integration (real Postgres, the security-critical suite) | `pnpm --filter @kurzly/api test -- links-import.integration` | ❌ Wave 0 |
| UI-06 | Toast confirmations render on create/copy/import/delete | component | web component tests per view | ❌ Wave 0 |

**The single most important test in this phase:** an integration test that imports a CSV containing (a) one row with a reserved slug, (b) one row targeting a domain the caller has no membership on, (c) two rows with the identical custom slug in the same domain, and (d) one row with an invalid target URL — then asserts: exactly the expected `validCount`, exactly 4 skipped rows with the 4 distinct reasons, and — critically — queries the DB directly afterward to assert **zero** Link rows exist for any of the 4 skipped rows. This directly proves D-01's "no bypass" claim against the actual database state, not just the HTTP response shape.

### Sampling Rate
- **Per task commit:** `pnpm --filter @kurzly/api test -- links` (and `--filter @kurzly/web test` for frontend tasks)
- **Per wave merge:** `pnpm -r test` (full suite, matches Phase 1–3 precedent)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/test/links.integration.test.ts` — covers LINK-01, LINK-02, LINK-03, LINK-05, LINK-06, LINK-07
- [ ] `apps/api/test/links-import.integration.test.ts` — covers LINK-08 including the D-01 no-bypass proof described above
- [ ] `apps/web/src/views/LinksView.test.ts`, `LinkDetailView.test.ts`, `LinksImportView.test.ts` — covers LINK-04, UI-06, and component-level rendering of the preview/skip-reason UI
- Framework install: none — Vitest/testcontainers/`@vue/test-utils` harness already exists project-wide; no new test tooling needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V1 Architecture | yes | Single validated write path (D-01) — `validateLinkInput` as the sole authorization+validation gate; no route ever calls `prisma.link.create`/`update` without going through it |
| V4 Access Control | yes | Reuse `requireDomainAccess`/`scopedDomainIds` unchanged (Phase 2); every Link-by-ID route resolves the Link's `domainId` before authorizing (Pitfall 4) |
| V5 Input Validation | yes | Zod schemas for target URL (`z.url({protocol})`), slug charset/length, CSV row shape; reserved-slug allowlist-style rejection |
| V6 Cryptography | yes (narrow) | `nanoid`'s `customAlphabet` uses CSPRNG (`crypto.randomBytes`) for slug generation — never `Math.random()` |
| V12 File/Resource Handling | yes | CSV row-count cap (`MAX_IMPORT_ROWS`, A3) prevents unbounded memory/DB-write load from an oversized upload; file content is read as text client-side, never written to disk server-side |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Route/slug squatting (a Link's slug shadows a system route) | Tampering | Reserved-slug allowlist rejection (Pattern 3), case-insensitive matching |
| IDOR on Link detail/edit/delete via guessed ID | Elevation of Privilege | `findUnique` + `requireDomainAccess(link.domainId)` before every read/write, 404-for-both-not-found-and-forbidden (matches `tlsCheck.ts`'s existing information-disclosure discipline) |
| Mass assignment (client sends extra fields like `createdBy` or `id` in the create/edit body) | Tampering | Zod schema with an explicit allowlisted field set for the request body — never `prisma.link.create({ data: request.body })` |
| Open redirect via unvalidated target URL scheme (`javascript:`, `data:`) | Tampering / Info Disclosure | `z.url({ protocol: /^https?$/ })` rejects any non-http(s) scheme at creation/edit time — note the actual redirect *execution* (fetching/302-ing to this URL) is Phase 5's concern; Phase 4 only stores a pre-validated value |
| CSV-import DoS via an oversized file or pathological row count | Denial of Service | `MAX_IMPORT_ROWS` cap (500, A3) enforced before any row processing begins; existing global `@fastify/rate-limit` plus a recommended tighter `LINK_IMPORT_RATE_LIMIT` override (mirrors `DOMAIN_CREATE_RATE_LIMIT`'s precedent) |
| Bulk-import bypass of authorization/validation (D-01's own threat model) | Tampering / Elevation of Privilege | Structural enforcement via `validateLinkInput`/`createLink`/`previewLink` (Pattern 1) rather than policy alone — verified by the integration test described in Validation Architecture |
| SSRF via server-side fetch of the target URL | (N/A — explicitly out of scope) | Not applicable this phase: target URLs are stored, never fetched server-side, matching `REQUIREMENTS.md`'s explicit "Auto-Fetch von OG-Daten" exclusion (out of scope, SSRF-hardening deferred) |

## Sources

### Primary (HIGH confidence)
- Direct codebase reads: `apps/api/prisma/schema.prisma`, `apps/api/src/lib/authorization.ts`, `apps/api/src/lib/hostname.ts`, `apps/api/src/lib/domainResolution.ts`, `apps/api/src/routes/domains.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/redirect.ts`, `apps/api/src/app.ts`, `apps/api/src/plugins/rateLimit.ts`, `apps/api/src/plugins/static.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/routes/tlsCheck.ts`, `apps/api/test/domains.integration.test.ts`, `apps/api/test/globalSetup.ts`, `apps/api/test/setupFileEach.ts`, `apps/web/src/views/DomainsView.vue`, `apps/web/src/api.ts`, `apps/web/src/router/index.ts`, `apps/web/src/views/ComingSoonView.vue`, `packages/shared/src/index.ts`, `apps/api/package.json`, `apps/web/package.json`
- `gsd-tools query package-legitimacy check --ecosystem npm csv-parse nanoid` — direct tool output, npm registry signals
- `npm view csv-parse version/exports`, `npm view nanoid version/exports`, `npm view csv-parse scripts.postinstall`, `npm view nanoid scripts.postinstall` — direct registry queries
- zod.dev/api — fetched directly via WebFetch, confirms `z.url({protocol, hostname})` API shape

### Secondary (MEDIUM confidence)
- WebSearch: csv.js.org/parse/api/sync, csv-parse npm page — CSV sync API usage
- WebSearch: github.com/ai/nanoid — `customAlphabet` usage pattern for URL-shortener slug generation
- WebSearch: prisma.io/docs/orm/prisma-client/debugging-and-troubleshooting/handling-exceptions-and-errors — P2002 catch pattern
- WebSearch: fastify.dev/docs/latest/Reference/Server, find-my-way README — router `caseSensitive` default

### Tertiary (LOW confidence)
- None — all findings this session were either direct codebase reads, direct tool/registry queries, or WebSearch results cross-checked against an official source (docs site or GitHub repo) before being cited.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for Zod/Prisma/Fastify (already installed, directly read from `package.json`); MEDIUM for `csv-parse`/`nanoid` (WebSearch-discovered package names, `[ASSUMED]` per provenance rule, but registry signals — huge download counts, established repos — are strong)
- Architecture: HIGH — the shared-validation-core pattern (Pattern 1) is derived directly from this codebase's own established conventions (`requireDomainAccess` reuse, `isUniqueConstraintViolation` precedent in `routes/domains.ts`), not external speculation
- Pitfalls: HIGH for Pitfalls 1–4 (directly reasoned from D-01's stated threat model and this codebase's existing IDOR-avoidance precedent in `tlsCheck.ts`); MEDIUM for Pitfall 5 (a genuine architectural observation from reading `redirect.ts`/`app.ts`/`router/index.ts` together, not yet empirically reproduced by a test in this session)

**Research date:** 2026-07-11
**Valid until:** 2026-08-10 (30 days — stable stack, no fast-moving dependencies in this phase's scope)
