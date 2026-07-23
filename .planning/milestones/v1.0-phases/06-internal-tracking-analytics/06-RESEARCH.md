# Phase 6: Internal Tracking & Analytics - Research

**Researched:** 2026-07-12
**Domain:** Privacy-first click tracking (redirect-hot-path event write) + local GeoIP + SQL analytics aggregation
**Confidence:** MEDIUM-HIGH

## Summary

Phase 6 fills the `recordClickHook({ linkId })` no-op seam Phase 5 already built into `apps/api/src/routes/redirect.ts` (line 58, called at line 132 exactly on the `state === "ok"` 302 path — bots/expired/still-protected requests never reach it). The seam already gives Phase 6 natural bot exclusion and a single, well-understood insertion point; this phase's job is to (1) extend the seam's inputs (link + trustProxy-aware request context), (2) resolve country locally via a bundled MaxMind-format `.mmdb` reader (`maxmind` npm package, MIT, 757k weekly downloads, zero postinstall scripts), (3) compute a privacy-safe daily-rotating visitor hash, (4) write one `ClickEvent` row + increment `Link.lifetimeClicks` atomically via `prisma.$transaction`, all gated on `trackingEnabled` so a link with tracking off performs literally zero database calls in the hook (verified by never entering the write branch — no display filter anywhere), and (5) expose two new read endpoints backed by parameterized raw SQL aggregation (Prisma's typed `groupBy` cannot express the `date_trunc`-bucketed 30-day time series this phase needs).

The `maxmind` package works against ANY MMDB-spec-compliant file — DB-IP's Country Lite `.mmdb` (already locked in CONTEXT.md D-01, CC-BY 4.0, no account required) is fully compatible, confirmed against the DB-IP format spec. The bundled DB is fetched at Docker **build** time from `https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz` (confirmed live on db-ip.com's own download page) and `COPY`'d into the runtime image next to the pruned API — mirroring the existing `apps/web/dist` → `public/` copy pattern already in the Dockerfile. `GEOIP_DB_PATH` (D-03) lets an operator override this with a bind-mounted `.mmdb` without rebuilding.

**Primary recommendation:** Extend `recordClickHook`'s signature to accept the already-fetched `link` row plus `request.ip` (already trust-proxy-aware via the existing `TRUST_PROXY`/`trustProxy` wiring from Phase 1/5 — no new proxy config needed), `user-agent`, and `referer` headers; wrap the entire hook body in try/catch so a GeoIP/DB hiccup can never break the 302; do the INSERT+increment as one `prisma.$transaction([...])` batch; and build analytics reads as a new `lib/analytics.ts` using tagged-template `$queryRaw` (never string-concatenated SQL) with a `generate_series` zero-fill for the 30-day chart so the frontend never has to guess which days are missing.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (GeoIP source):** Local GeoIP DB: **DB-IP Country Lite** (CC-BY 4.0, monthly updates, `.mmdb`), chosen over MaxMind GeoLite2 specifically because DB-IP needs **no account/license key** — fits a `docker compose up` self-hosted tool. CC-BY attribution required in footer/README.
- **D-02 (Bundling):** DB is **baked into the Docker image at build time** (downloaded in the build step) for offline/air-gapped operation out of the box. Updates = new image build (monthly).
- **D-03 (Override):** Optional `GEOIP_DB_PATH` ENV overrides the bundled DB — operator can mount a newer/custom `.mmdb` via volume.
- **D-04 (Unresolvable IPs):** Non-resolvable IPs (localhost, private ranges, unknown range, missing DB) → country recorded as **"Unbekannt"**; the click is **still counted** (referrer/count/unique intact) — never an error, never a skip.
- **D-05 (Proxy IP):** Behind a reverse proxy, the **real client IP** is determined via trust-proxy / `X-Forwarded-For` (not the proxy's IP). Concrete trust-proxy config = Planner/Researcher discretion, reconciled with the existing Fastify config from Phase 3/5.
- **D-06 (Unique visitors):** Daily-rotating, salted hash (Plausible-style): per click, `visitorHash = hash(dailySalt | ip | userAgent | linkId)`. **Only the hash is persisted** — never raw IP, never UA plaintext. The daily salt rotates (old salt discarded) → visitors are **not re-identifiable across days**. No tracking cookie on the public redirect. Unique = `COUNT(DISTINCT visitorHash)`; the unique window is deliberately **day-granular**.
- **D-07 (Referrer):** Referrer stored **normalized to the source host** (e.g. `t.co`, `google.com`) — path/query discarded. Missing/empty `Referer` → **"Direkt"**.
- **D-08 (Salt discretion):** Salt generation/rotation (persistence of the daily salt, rotation mechanics, hash algorithm) = Planner discretion, but MUST guarantee D-06's "no PII at rest / no cross-day tracking" property.
- **D-09 (Event model / zero-rows):** One raw `ClickEvent` row per tracked click. Fields: `linkId`, `createdAt`, `country`, `referrerHost`, `visitorHash`, `source`. Tracking off → `recordClickHook` **writes nothing** (no INSERT) → literally zero rows (TRACK-02 satisfied directly at the write path, no downstream display filter). DB-verifiable via direct row-count test.
- **D-10 (Live aggregation):** Analytics = live SQL aggregation over the event table: 30-day time series via `date_trunc('day')`, uniques via `COUNT(DISTINCT visitorHash)`, top referrers/countries via `GROUP BY`. No separate rollup system for MVP (exception: the lifetime counter, D-13).
- **D-11 (Toggle-off semantics):** Turning tracking off stops **only future writes**; already-recorded historical events **remain** and stay visible in analytics. Non-destructive, no surprise data loss. TRACK-02 refers to **newly written** rows — semantics remain satisfied.
- **D-12 (Retention):** Optional `CLICK_RETENTION_DAYS` ENV (default: unlimited/off). If set, a periodic cleanup deletes events older than N days. Concrete cleanup mechanism (cron/job/interval) = Planner discretion.
- **D-13 (Pruning-resistant total):** `Link.lifetimeClicks` (Int, default 0) increments on every click write. **All-time total clicks come from this counter** and survive pruning; time series/uniques/top-N/countries/referrers aggregate live over the (possibly pruned) raw events. INSERT + increment must be consistent within the same write path.
- **D-14 (QR-scan seam prep):** `ClickEvent.source` (enum `link` | `qr`, default `link`) is added to the schema **now**. All Phase 6 clicks are `source='link'`. The global overview's "QR-Scans" tile = `COUNT(source='qr')` → currently **0**. Phase 7 only sets `source='qr'` on the QR redirect — no schema change/reopening needed, exactly analogous to Phase 5's D-17 seam.
- **D-15 (Toggle/default):** Per-link toggle `Link.trackingEnabled` (Boolean, default `true`). Runs through the one authorized write path (`lib/links.ts` `createLink`/`updateLink`, D-01 pattern from Phase 5) — no parallel bypass. UI integration into the existing link form/detail (Phase 4).

### Claude's Discretion

Concrete GeoIP reader library (e.g. `mmdb-lib`/`maxmind` npm against `.mmdb`), hash algorithm & daily-salt persistence/rotation, trust-proxy fine-tuning, cleanup-job mechanics for retention, exact aggregation SQL/query shape (raw SQL vs. Prisma `groupBy`), index strategy on `ClickEvent` (`linkId`, `createdAt`, `source`), split/layout of the analytics screens (per-link tab vs. global overview) within the prototype design, ENV naming-scheme details.

### Deferred Ideas (OUT OF SCOPE)

- QR codes / QR-scan write path → Phase 7. Phase 6 only adds `ClickEvent.source` (link|qr); the QR-scans metric stays 0 until then.
- Domain-scoped member authorization of the analytics endpoints (members see only analytics for their assigned domains, server-enforced incl. denial test) → Phase 9 (Team Management & Domain-Scoped Authorization Enforcement).
- Analytics export (CSV/API), alerting, real-time streaming, heavier rollup/materialized-view performance work → future phase if needed; MVP uses live SQL aggregation.
- Referrer/UTM campaign analysis beyond the plain source host (e.g. landing-URL campaign dimensions) → possible later analytics deepening.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRACK-01 | Per-link internal click tracking toggle (default on) | `Link.trackingEnabled` schema addition + extension of the existing D-01 `createLink`/`updateLink` write path (see Architecture Patterns, Pattern 1) |
| TRACK-02 | Tracking off → zero click rows written for that link (DB-verified, not a display filter) | Hook-body early-return-on-`!trackingEnabled` design (Pattern 2) + Validation Architecture's DB-row-count test |
| TRACK-03 | Tracked link records click count, referrer, country — no third-party calls | `maxmind` local `.mmdb` reader (Pattern 3), referrer host normalization (Pattern 4), `lifetimeClicks` increment |
| TRACK-04 | Per-link analytics: total, 30-day time series, top referrers, countries | `lib/analytics.ts` raw-SQL aggregation (Pattern 5) + zero-fill `generate_series` pattern |
| TRACK-05 | Global analytics overview: clicks, unique visitors, active links, QR scans, top links, referrers | Same `lib/analytics.ts` module, global-scope query variants; `source='qr'` always 0 this phase (D-14) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Click-event capture (write) | API / Backend (`routes/redirect.ts` hook body) | Database (`ClickEvent` insert) | Must happen inline with the redirect hot path, server-side only — a client-side beacon would leak the tracking-off signal to the browser and cannot guarantee the zero-rows property |
| Country resolution | API / Backend (`lib/geoip.ts`) | — | Purely local, in-process `.mmdb` lookup — no network tier involved by design (privacy requirement: no third-party call, ever) |
| Unique-visitor hashing | API / Backend (`lib/geoip.ts` or `lib/visitorHash.ts`) | — | Must happen server-side before persistence — raw IP/UA must never reach any other tier |
| Per-link / global analytics aggregation | API / Backend (`lib/analytics.ts`, raw SQL) | Database (query execution) | Live aggregation is a read-time SQL responsibility; no client-side aggregation (would require shipping raw events to the browser, defeating privacy intent) |
| Analytics UI rendering (charts, stat cards, skeleton/zero/data states) | Browser / Client (`LinkDetailView.vue`, `AnalyticsView.vue`) | — | Pure presentation of already-aggregated DTOs; UI-SPEC's 3-state contract (skeleton/zero-data/data) lives entirely here |
| Tracking toggle persistence | API / Backend (`lib/links.ts` `createLink`/`updateLink`) | Browser / Client (`LinkFormModal.vue`, optimistic UI) | Single authorized write path per D-15/D-01; client only reflects state optimistically, server is authoritative |
| GeoIP DB provisioning | CDN / Static (Docker build step) | — | The `.mmdb` is a static build-time artifact baked into the image, not a runtime service call |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `maxmind` | ^5.0.6 [VERIFIED: npm registry — `npm view maxmind version`, MIT license, github.com/runk/node-maxmind, 757k weekly downloads, no postinstall script] | Reads any MMDB-spec `.mmdb` file (works with DB-IP's mmdb — same binary format) and looks up country by IP | The de-facto standard Node reader for the MaxMind DB binary format; typed `Reader<T>`/`open<T>()` API, handles IPv4/IPv6, returns `null` for unresolvable ranges rather than throwing — matches D-04's "never error, map to Unbekannt" requirement directly |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (builtin) | Node 24.x | `createHmac('sha256', dailySalt).update(ip+userAgent+linkId).digest('hex')` for D-06's visitor hash | Always — no new dependency needed; HMAC (not a bare hash) is required so an attacker with only the salt cannot pre-compute the full IP/UA space cheaper than brute force |
| `URL` (builtin) | Node 24.x | Referer header → host normalization (D-07) | Always — `new URL(referer).hostname`, never a hand-rolled regex; wrap in try/catch since `Referer` is untrusted input and can be malformed |
| Prisma `$queryRaw`/`Prisma.sql` (bundled with `prisma`@^7.8.0, already a dependency) | 7.8.0 | Parameterized raw SQL for `date_trunc`-bucketed time series and multi-column `GROUP BY` aggregation | Prisma's typed `groupBy` cannot express `date_trunc` bucketing or `generate_series` zero-fill — this is a first-party Prisma escape hatch, not a new dependency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `maxmind` | `mmdb-lib` | Environment-agnostic (works in browser too), but this project never needs a browser-side reader — `maxmind`'s Node-focused API (`maxmind.open()`, typed `CountryResponse`) is a better fit and has 10x the download count/community usage |
| `maxmind` | `@maxmind/geoip2-node` | MaxMind's own official wrapper — heavier API surface (city/ASN/ISP response types this project doesn't need) and its `Reader.open()` `watchForUpdates` feature is irrelevant here since the DB only changes on image rebuild, not live |
| Build-time-baked `.mmdb` (D-02, locked) | Runtime download on first boot | Rejected by the user's own D-02 — breaks the air-gapped/offline-out-of-the-box guarantee; documented here only for completeness |
| Raw `$queryRaw` SQL for aggregation | Prisma `groupBy`/`aggregate` DSL | `groupBy` works fine for the simple single-column top-referrer/top-country GROUP BY, but cannot express `date_trunc('day', "createdAt")` bucketing or a `generate_series` zero-fill LEFT JOIN — reserve raw SQL for the 30-day time series specifically, `groupBy` is fine (and arguably more readable) for the flat top-N lists |
| Stored per-day random salt (`DailySalt` table) | Deterministic salt derived from `HMAC(BETTER_AUTH_SECRET, currentUtcDate)` | The derived approach needs no extra table/cleanup job, but provides no forward secrecy — if the master secret ever leaks, every historical day's hash becomes re-computable. A stored, randomly-generated, later-deletable per-day salt (mirroring Plausible's actual model) is the more defensible privacy choice and is what this research recommends as primary |

**Installation:**
```bash
pnpm --filter @kurzly/api add maxmind
```

**Version verification:** `npm view maxmind version` → `5.0.6` (confirmed live against the npm registry during this research session, 2026-07-12). No other new runtime dependency needed — hashing and referrer parsing use Node builtins already available.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `maxmind` | npm | actively maintained, mature (multi-year history) | ~757k/week | github.com/runk/node-maxmind | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

`maxmind` was discovered via WebSearch (training-knowledge-adjacent, common recommendation) and independently confirmed via `npm view maxmind version` (registry) and `gsd-tools query package-legitimacy check` (verdict `OK`, no postinstall script, real GitHub source repo) — tagged `[VERIFIED: npm registry]` per the provenance rule since both the registry check and the legitimacy-gate check passed against an identifiable, long-lived, high-download package with a real source repository. No `checkpoint:human-verify` required, but standard operator supply-chain sign-off convention already used in Phases 2/4/5 of this project (`T-0X-SC-Gate`) should still apply per project convention.

## Architecture Patterns

### System Architecture Diagram

```
                         VISITOR (public redirect, no auth)
                                  │
                                  ▼
                    GET /:slug  (routes/redirect.ts)
                                  │
                 resolveActiveDomainByHost + link lookup
                                  │
                    bot? ─────────┴───── yes → renderBotOgPage (200), STOP
                     │ no
                    expired? ──────────── yes → 410, STOP
                     │ no
                    protected+no cookie? ── yes → password page (200), STOP
                     │ no  (state === "ok")
                     ▼
        recordClickHook({ link, ip, userAgent, referer })  ◄── D-17 seam, Phase 6 fills body
                     │
          trackingEnabled === false? ── yes → return immediately, ZERO db calls
                     │ no
                     ▼
        try {
          country = geoLookup(ip)              // lib/geoip.ts, local .mmdb, sync in-memory
          referrerHost = normalizeReferrer(ref) // lib/referrer.ts, builtin URL, host-only
          visitorHash = hmac(dailySalt, ip+ua+linkId)
          await prisma.$transaction([
            clickEvent.create({ linkId, country, referrerHost, visitorHash, source:'link' }),
            link.update({ lifetimeClicks: { increment: 1 } }),
          ])
        } catch { /* swallow — tracking failure must never break the redirect */ }
                     │
                     ▼
                302 redirect to targetUrl   (unaffected by hook outcome)


                    DASHBOARD USER (authenticated)
                                  │
                 GET /api/links/:id/analytics  or  GET /api/analytics
                                  │
                requireDomainAccess("member") / session check  (existing pattern)
                                  │
                     lib/analytics.ts (new)
              ┌───────────────────┼────────────────────┐
              ▼                   ▼                     ▼
     date_trunc('day')     GROUP BY referrerHost   GROUP BY country
     + generate_series      ORDER BY count DESC     ORDER BY count DESC
     zero-fill (30 rows)      LIMIT N                  LIMIT N
              │                   │                     │
              └───────────────────┴────────────────────┘
                                  │
                        AnalyticsDTO (JSON)
                                  │
                                  ▼
           Vue: LinkDetailView.vue / AnalyticsView.vue
      skeleton (loading) → zero-data-state | data-state   (UI-SPEC 3-state contract)
```

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   ├── geoip.ts          # NEW — .mmdb loader (lazy singleton) + getCountryForIp(ip): string|null
│   ├── referrer.ts        # NEW — normalizeReferrer(headerValue): string|null (host-only)
│   ├── visitorHash.ts     # NEW — computeVisitorHash(salt, ip, ua, linkId): string + daily salt resolve/rotate
│   ├── analytics.ts       # NEW — per-link + global aggregation queries (raw SQL via $queryRaw/Prisma.sql)
│   └── links.ts           # EXTENDED — trackingEnabled added to ValidateLinkInputParams/ValidatedLink
├── routes/
│   ├── redirect.ts        # EXTENDED — recordClickHook body filled in, signature extended
│   ├── links.ts           # EXTENDED — PATCH/POST accept trackingEnabled
│   └── analytics.ts       # NEW — GET /api/links/:id/analytics, GET /api/analytics
└── prisma/
    └── schema.prisma      # EXTENDED — ClickEvent model, ScanSource enum, Link.trackingEnabled/lifetimeClicks

apps/web/src/
├── views/
│   ├── LinkDetailView.vue # EXTENDED — replaces .stats-placeholder with Surface A (per UI-SPEC)
│   ├── AnalyticsView.vue  # NEW — replaces ComingSoonView at /analytics (Surface B)
│   └── LinksView.vue      # EXTENDED — Klicks column + Tracking-aus badge (Surface C2)
├── components/
│   └── LinkFormModal.vue  # EXTENDED — footer tracking toggle (Surface C1)
└── router/index.ts        # EXTENDED — /analytics now points to AnalyticsView, not ComingSoonView

Dockerfile                 # EXTENDED — build-stage curl-download of the DB-IP .mmdb, COPY into runtime
```

### Pattern 1: Extending the single authorized write path (D-01/D-15)
**What:** `trackingEnabled` flows through `validateLinkInput`/`createLink`/`updateLink` exactly like `forwardQuery` did in Phase 5 — a plain boolean, no new validation branch needed, Prisma column default (`true`) covers the create-time default.
**When to use:** Any time a new persisted Link field is introduced — never add a second write path.
**Example:**
```typescript
// apps/api/src/lib/links.ts — extends the existing ValidateLinkInputParams/ValidatedLink shape
export type ValidateLinkInputParams = {
  // ...existing fields (targetUrl, slug, password, expiresAt, forwardQuery)...
  /** TRACK-01/D-15: omitted keeps current value on update / defaults true on create (Prisma column default). */
  trackingEnabled?: boolean;
};
// validateLinkInput: just pass input.trackingEnabled through to ValidatedLink.data, no extra checks
// updateLink's prisma.link.update data block: add trackingEnabled: validated.data.trackingEnabled
```

### Pattern 2: Zero-rows-guaranteed click hook (TRACK-02, D-09)
**What:** The hook checks `trackingEnabled` on the ALREADY-FETCHED `link` object from earlier in the handler (never re-queries) and returns before any Prisma call if false — the "zero rows" guarantee is structural (no code path reaches `.create()`), not a filtered read.
**When to use:** This is the ONE insertion point for click writes — do not add a second call site.
**Example:**
```typescript
// apps/api/src/routes/redirect.ts
async function recordClickHook(ctx: {
  link: Link; ip: string; userAgent: string | undefined; referer: string | undefined;
}): Promise<void> {
  if (!ctx.link.trackingEnabled) return; // structural zero-rows guarantee — no DB call below this line

  try {
    const country = await getCountryForIp(ctx.ip);           // never throws, "Unbekannt"/null on miss
    const referrerHost = normalizeReferrer(ctx.referer);       // null → displayed as "Direkt"
    const salt = await resolveDailySalt(prisma);
    const visitorHash = computeVisitorHash(salt, ctx.ip, ctx.userAgent ?? "", ctx.link.id);

    await prisma.$transaction([
      prisma.clickEvent.create({
        data: { linkId: ctx.link.id, country, referrerHost, visitorHash, source: "link" },
      }),
      prisma.link.update({
        where: { id: ctx.link.id },
        data: { lifetimeClicks: { increment: 1 } },
      }),
    ]);
  } catch (err) {
    // D-04/RESEARCH: tracking must NEVER break the redirect — log and swallow.
    request.log?.warn({ err }, "click tracking write failed");
  }
}
```

### Pattern 3: Local GeoIP lookup with graceful degradation (TRACK-03, D-04)
**What:** A lazily-initialized module-level singleton reader, loaded once, never re-opened per request; missing/unreadable DB degrades to always-null rather than crashing boot.
**When to use:** Any code path needing country resolution.
**Example:**
```typescript
// apps/api/src/lib/geoip.ts — Source: maxmind README (github.com/runk/node-maxmind), MEDIUM confidence (WebSearch-verified)
import maxmind, { type CountryResponse, type Reader } from "maxmind";

let readerPromise: Promise<Reader<CountryResponse> | null> | null = null;

function resolveDbPath(): string {
  return process.env.GEOIP_DB_PATH ?? "/prod/api/geo/dbip-country-lite.mmdb"; // D-03 override
}

async function getReader(): Promise<Reader<CountryResponse> | null> {
  if (!readerPromise) {
    readerPromise = maxmind
      .open<CountryResponse>(resolveDbPath())
      .catch(() => null); // missing/corrupt DB → degrade, never crash boot or a request
  }
  return readerPromise;
}

/** D-04: never throws, never returns undefined-shaped ambiguity — null means "store as Unbekannt". */
export async function getCountryForIp(ip: string): Promise<string | null> {
  const reader = await getReader();
  if (!reader) return null;
  try {
    const result = reader.get(ip); // returns null for private/reserved/unmapped ranges — no throw
    return result?.country?.iso_code ?? null;
  } catch {
    return null; // malformed IP string, etc. — still never throw into the hot path
  }
}
```

### Pattern 4: Referrer host normalization (D-07)
**What:** Extract only the hostname from `Referer`, discard path/query; treat missing/malformed as "no referrer" (`null`), let the DTO/view layer render the German "Direkt" label — keep raw storage locale-neutral.
**Example:**
```typescript
// apps/api/src/lib/referrer.ts
export function normalizeReferrer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname || null;
  } catch {
    return null; // malformed Referer header — untrusted input, never throw
  }
}
```

### Pattern 5: Time-bucketed analytics via raw SQL with zero-fill
**What:** `date_trunc` + `generate_series` LEFT JOIN guarantees exactly 30 chart bars even on days with zero clicks — matches UI-SPEC's fixed `30 Balken = 30 Tage` chart contract without frontend date-gap-filling logic.
**Example:**
```typescript
// apps/api/src/lib/analytics.ts — Source: Postgres date_trunc/generate_series docs (WebSearch, MEDIUM confidence)
import { Prisma } from "../generated/prisma/client.js";

export async function getDailyClickSeries(prisma: PrismaClient, linkId: string) {
  return prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
    SELECT d.day, COALESCE(COUNT(ce."id"), 0) AS count
    FROM generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    ) AS d(day)
    LEFT JOIN "ClickEvent" ce
      ON date_trunc('day', ce."createdAt") = d.day AND ce."linkId" = ${linkId}
    GROUP BY d.day
    ORDER BY d.day;
  `);
}

export async function getTopReferrers(prisma: PrismaClient, linkId: string, limit = 5) {
  // Simple flat GROUP BY — Prisma's groupBy DSL is fine here too, raw SQL kept
  // only for consistency/co-location with the time-series query above.
  return prisma.$queryRaw<{ referrerHost: string | null; count: bigint }[]>(Prisma.sql`
    SELECT COALESCE("referrerHost", 'Direkt') AS "referrerHost", COUNT(*) AS count
    FROM "ClickEvent"
    WHERE "linkId" = ${linkId}
    GROUP BY "referrerHost"
    ORDER BY count DESC
    LIMIT ${limit};
  `);
}
```

### Anti-Patterns to Avoid
- **Second click-write call site:** never call `prisma.clickEvent.create` anywhere except inside `recordClickHook`'s body — mirrors the project's existing D-01 single-write-path discipline (`lib/links.ts`'s header comment explicitly warns about exactly this class of drift for `createLink`).
- **String-concatenated raw SQL:** never build `$queryRawUnsafe` with linkId/date interpolated as a JS template string — always `Prisma.sql`/tagged-template `$queryRaw` so Prisma parameterizes automatically (SQL injection, ASVS V5).
- **Awaiting a network call inside the click hook:** the GeoIP lookup MUST be a synchronous/in-memory `.mmdb` read, never an `await fetch(...)` to any third party — this is both a privacy requirement (D-01/D-04) and a hot-path latency requirement.
- **Storing "Unbekannt"/"Direkt" as literal strings in the DB:** store `null`, translate to the German label only at the DTO/view boundary — keeps raw data locale-neutral for any future export feature (deferred, but don't paint into a corner).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| IP → country resolution | A hand-rolled CIDR-range binary search over a CSV | `maxmind` npm reading the DB-IP `.mmdb` | The MMDB binary format's search-tree encoding is a solved, spec'd problem (MaxMind DB format v2.0) — reimplementing it is high-risk, low-value |
| 30-day chart date bucketing | JS-side date-gap-filling after a flat `GROUP BY` query | Postgres `generate_series` + `LEFT JOIN` (Pattern 5) | Timezone/DST edge cases in hand-rolled date-range generation are a classic source of off-by-one bugs; Postgres's own date arithmetic is authoritative |
| Referrer URL parsing | A regex extracting the host from a URL string | builtin `new URL(referer).hostname` | URLs have many edge cases (userinfo, IPv6 literals, punycode) the WHATWG URL parser already handles correctly — this project's own `lib/links.ts` already established this exact "use `z.url()`/WHATWG parser, not regex" convention for target URLs |
| Visitor de-duplication hashing | A bare unsalted `sha256(ip+ua)` | `HMAC-SHA256(dailySalt, ip+ua+linkId)` | A bare hash of a small IP+UA space is trivially reversible via a lookup table; HMAC with a secret, rotated, deletable salt is the standard construction (matches Plausible's own documented approach) |

**Key insight:** every "don't hand-roll" item above maps to an existing, already-used pattern elsewhere in this codebase (WHATWG `z.url()` for target URLs, Postgres-native date handling, parameterized queries via Prisma) — Phase 6 extends established conventions rather than introducing new ones.

## Common Pitfalls

### Pitfall 1: Referer header casing
**What goes wrong:** Reading `request.headers['Referer']` (capitalized) or `.referrer` (the nonstandard alternate spelling) returns `undefined` even when the header is present.
**Why it happens:** Node/Fastify lowercase all incoming header names; the HTTP header itself is also historically misspelled `Referer` (single-r) by the spec, not `Referrer`.
**How to avoid:** Always read `request.headers.referer` (all-lowercase, single-r).
**Warning signs:** Referrer normalization always resolves to `null`/"Direkt" in manual testing even when following a real link.

### Pitfall 2: mmdb load failure crashing boot instead of degrading
**What goes wrong:** If `maxmind.open()` (or the fallback path) is called eagerly at module-import time and awaited synchronously without a catch, a missing/misconfigured `GEOIP_DB_PATH` or a Docker build that failed to download the DB crashes the whole app at startup — even though D-04 explicitly requires "never an error."
**Why it happens:** Treating the GeoIP DB like a hard boot dependency (similar to `DATABASE_URL`) instead of a soft, gracefully-degradable one.
**How to avoid:** Lazy singleton (Pattern 3) with `.catch(() => null)`; `getCountryForIp` always returns `null` on any failure, never throws.
**Warning signs:** `pnpm dev`/container fails to boot with a `maxmind`-related stack trace; integration tests that don't set up a real `.mmdb` file fail across the board instead of just returning "Unbekannt" country values.

### Pitfall 3: Prisma `groupBy` silently can't express the time-series query
**What goes wrong:** Attempting `prisma.clickEvent.groupBy({ by: ['createdAt'] })` groups by the exact millisecond timestamp, not by day — producing one "bucket" per row instead of 30 daily buckets.
**Why it happens:** Prisma's `groupBy` has no `date_trunc`-equivalent expression support; it can only group by raw column values.
**How to avoid:** Use `$queryRaw`/`Prisma.sql` with `date_trunc('day', "createdAt")` for the time series specifically (Pattern 5); `groupBy` remains fine for flat referrer/country top-N lists.
**Warning signs:** The 30-day chart renders far more than 30 bars, or bars with fractional/duplicate day labels.

### Pitfall 4: `trackingEnabled` re-query race inside the hook
**What goes wrong:** If `recordClickHook` re-fetches the `Link` row from the DB (instead of reusing the one the handler already loaded earlier in the same request) to check `trackingEnabled`, a toggle flip between the handler's initial read and the hook's re-read introduces an unnecessary extra query and a (harmless but wasteful) TOCTOU window.
**Why it happens:** Treating the hook as a fully independent unit rather than a continuation of the same request's already-resolved `link` object.
**How to avoid:** Pass the already-fetched `link` object into the hook (Pattern 2's signature) — one Link read per request, already happening today for state resolution.
**Warning signs:** Redirect handler's query count per request increases beyond what Phase 5 already established.

### Pitfall 5: INSERT and `lifetimeClicks` increment left non-atomic
**What goes wrong:** If the `ClickEvent` insert and the `Link.lifetimeClicks` increment are two separate, un-batched `await` calls, a crash/connection drop between them can desync the "pruning-resistant total" (D-13) from the actual (pre-pruning) event count.
**Why it happens:** Treating them as two independent side effects instead of one logical write.
**How to avoid:** `prisma.$transaction([create, update])` (batch form is sufficient here — no need for the interactive transaction callback form since there's no conditional branching between the two operations).
**Warning signs:** A row-count integrity test comparing `SUM` of `ClickEvent` rows against `lifetimeClicks` (before any pruning has occurred) shows drift.

### Pitfall 6: Docker build-stage missing `curl`/network for the `.mmdb` download
**What goes wrong:** `node:24-alpine` does not ship `curl` by default; adding a bare `RUN curl ...` step to the existing Dockerfile's `build` stage fails with "curl: not found."
**Why it happens:** Alpine's minimal base image intentionally omits most CLI utilities.
**How to avoid:** `RUN apk add --no-cache curl` before the download step (or use `wget`, which alpine's busybox does include — verify at implementation time which is already present) in the `build` stage, then `COPY --from=build` the resulting `geo/` directory into the `runtime` stage, mirroring the existing `apps/web/dist` → `public/` copy pattern already in this Dockerfile.
**Warning signs:** `docker build` fails at the new GeoIP download `RUN` step with a "command not found" error.

## Code Examples

Verified patterns from official/community sources:

### GeoIP reader usage (Source: maxmind README, github.com/runk/node-maxmind — WebSearch-verified, MEDIUM confidence)
```typescript
import maxmind, { type CountryResponse } from "maxmind";

const lookup = await maxmind.open<CountryResponse>("/prod/api/geo/dbip-country-lite.mmdb");
const result = lookup.get("203.0.113.5"); // null for unresolvable/private ranges
console.log(result?.country?.iso_code); // e.g. "DE", or undefined if null
```

### Dockerfile build-stage GeoIP download (Source: db-ip.com official download page, WebFetch-verified, MEDIUM confidence)
```dockerfile
# In the existing `build` stage, after `pnpm install` and before the prune step:
RUN apk add --no-cache curl \
 && mkdir -p /usr/src/app/geo \
 && curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$(date +'%Y-%m').mmdb.gz" \
      -o /usr/src/app/geo/dbip-country-lite.mmdb.gz \
 && gunzip /usr/src/app/geo/dbip-country-lite.mmdb.gz

# In the `runtime` stage, alongside the existing apps/web/dist copy:
COPY --from=build --chown=node:node /usr/src/app/geo /prod/api/geo
```
CC-BY 4.0 attribution requirement (confirmed on db-ip.com's own download page): a visible link back to db-ip.com must appear wherever results from the database are displayed — add `<a href="https://db-ip.com">IP Geolocation by DB-IP</a>` to the dashboard footer/README per D-01.

### Daily-rotating salted visitor hash (Source: Plausible Analytics' documented approach — WebSearch, MEDIUM confidence, industry precedent for D-06)
```typescript
import { createHmac, randomBytes } from "node:crypto";

// Recommended: a small DailySalt table (date PK, random 32-byte value),
// lazily created on first click of a new UTC day, prunable independently
// of CLICK_RETENTION_DAYS for true forward secrecy (old salts deletable).
export async function resolveDailySalt(prisma: PrismaClient): Promise<string> {
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const existing = await prisma.dailySalt.findUnique({ where: { date: today } });
  if (existing) return existing.value;
  const value = randomBytes(32).toString("hex");
  // race-safe: two concurrent first-clicks of the day both attempt create,
  // whichever loses the unique-constraint race just re-reads the winner's row
  try {
    const created = await prisma.dailySalt.create({ data: { date: today, value } });
    return created.value;
  } catch {
    const winner = await prisma.dailySalt.findUniqueOrThrow({ where: { date: today } });
    return winner.value;
  }
}

export function computeVisitorHash(salt: string, ip: string, userAgent: string, linkId: string): string {
  return createHmac("sha256", salt).update(`${ip}|${userAgent}|${linkId}`).digest("hex");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| MaxMind GeoLite2 as the default free local GeoIP source | DB-IP Lite (no account/key required) increasingly preferred for self-hosted OSS tools | Ongoing (MaxMind tightened GeoLite2 license-key requirements in recent years) | Already reflected in this project's locked D-01 — no action needed, documented here for context only |
| Client-side/cookie-based analytics identifiers | Server-side daily-rotating salted-hash "uniques" (Plausible/Fathom/Simple Analytics model) | Established privacy-analytics pattern since ~2019-2020, now mainstream for privacy-first tools | Directly informs D-06's design — this project follows an established, not novel, pattern |

**Deprecated/outdated:**
- Storing raw IP addresses "for analytics" — increasingly considered a GDPR/privacy-compliance liability even when aggregated later; this project's D-06 (hash-only persistence) already avoids this entirely.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `maxmind`'s `Reader.get()` returns `null` (not a throw) for private/reserved/unmapped IP ranges | Pattern 3, Code Examples | If it actually throws for some input shapes, the try/catch in Pattern 3 already covers this as defense-in-depth — low risk, but verify empirically in the first plan's tests |
| A2 | The DB-IP Country Lite `.mmdb` format's top-level response shape matches `maxmind`'s typed `CountryResponse` (i.e. `result.country.iso_code` is the correct field path for a Country-only, non-City database) | Pattern 3, Code Examples | If the field path differs (e.g. DB-IP's country-only DB might not populate a `city` object but should still populate `country.iso_code` per the MMDB Country DB convention) — verify against a real downloaded `.mmdb` file in the first plan's tests before committing to the exact field path |
| A3 | `https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz` remains stable/unauthenticated indefinitely (no rate limit or bot-block on scripted `curl` downloads) | Code Examples, Pitfall 6 | If DB-IP adds bot-detection to this URL, the Docker build would fail — mitigate by testing the exact `curl` command during first implementation and having `GEOIP_DB_PATH` (D-03) as an already-locked-in escape hatch |
| A4 | A stored, randomly-generated, per-UTC-day `DailySalt` table (rather than a stateless HMAC-derived salt) is the right choice for D-08's "planner discretion" | Code Examples, Standard Stack alternatives | If the team prefers zero-extra-table simplicity over forward secrecy, the alternative (HMAC-derive from `BETTER_AUTH_SECRET` + date string) is a valid, simpler fallback — documented as an explicit alternative, not hidden |

**If this table is empty:** N/A — see entries above; all are implementation-detail-level risks with documented low blast radius, not scope-level assumptions.

## Open Questions

1. **Exact MMDB response shape for DB-IP's Country Lite database with the `maxmind` npm reader**
   - What we know: `maxmind` supports a generic `CountryResponse` type and DB-IP's format spec confirms MMDB v2.0 compliance.
   - What's unclear: Whether DB-IP's exact field naming inside the country object matches MaxMind's own `CountryResponse` TypeScript shape 1:1, or needs a locally-defined narrower type.
   - Recommendation: First plan's task list should include downloading a real `.mmdb` and writing an integration test asserting the exact shape (`result.country.iso_code`) before wiring `lib/geoip.ts`'s return type — cheap to verify empirically, don't guess.

2. **Whether the daily-salt cleanup job also needs to run independent of `CLICK_RETENTION_DAYS`**
   - What we know: D-12's retention pruning is opt-in (`CLICK_RETENTION_DAYS` unset = never prune events). D-06 requires old salts to be "discarded."
   - What's unclear: If `CLICK_RETENTION_DAYS` is unset (the default), should `DailySalt` rows still be pruned on their own (e.g. keep only the last 2-3 days) to preserve forward secrecy, even though `ClickEvent` rows are kept forever?
   - Recommendation: Yes — prune `DailySalt` rows older than ~2 days unconditionally (independent of `CLICK_RETENTION_DAYS`), since keeping old salts around indefinitely defeats the entire point of D-06's privacy guarantee even if the events themselves are retained. Flag this explicitly in the plan since it's a privacy-property, not just a housekeeping detail.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Docker build-time network access | GeoIP `.mmdb` download (D-02) | Assumed ✓ (already required for `pnpm install` in the existing Dockerfile) | — | `GEOIP_DB_PATH` bind-mount override (D-03) for air-gapped build environments |
| `curl` or `wget` in `node:24-alpine` build stage | `.mmdb` download step | ✗ `curl` not present by default | — | `apk add --no-cache curl` (Pitfall 6) — trivial, no blocker |
| Real Postgres (testcontainers) | Zero-rows DB-verified test (TRACK-02), all aggregation tests | ✓ already established (Phase 1, `@testcontainers/postgresql`) | 12.0.4 | — |
| `maxmind` npm package | Country resolution | ✓ available on npm registry (confirmed `npm view`) | 5.0.6 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `curl`/`wget` in the Alpine build stage — trivial one-line fix (`apk add --no-cache curl`), not a real blocker.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.10 (backend), `@vue/test-utils` ^2.4.11 (frontend) — both already configured |
| Config file | `apps/api/vitest.config.ts` (testcontainers globalSetup + per-test BEGIN/ROLLBACK) |
| Quick run command | `pnpm --filter @kurzly/api test -- test/analytics.test.ts` (or the relevant new test file) |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| TRACK-01 | Toggle persists via `createLink`/`updateLink`, default `true` on create | unit + integration | `pnpm --filter @kurzly/api test -- test/links.integration.test.ts` | ❌ Wave 0 — extend existing file |
| TRACK-02 | Tracking off → 0 `ClickEvent` rows after N redirects (DB row-count assertion, not UI) | integration (real Postgres) | `pnpm --filter @kurzly/api test -- test/redirect-tracking.integration.test.ts` | ❌ Wave 0 — new file |
| TRACK-02 | Toggling off mid-history does NOT delete prior events (D-11) | integration | same file as above | ❌ Wave 0 |
| TRACK-03 | Tracked link records exactly 1 `ClickEvent` with `referrerHost`, `country`, `visitorHash`, `source='link'` populated per click | integration | same file as above | ❌ Wave 0 |
| TRACK-03 | Unresolvable IP → `country` stored as `null`/mapped to "Unbekannt", click still counted (D-04) | unit (`lib/geoip.ts`) + integration | `pnpm --filter @kurzly/api test -- test/geoip.test.ts` | ❌ Wave 0 — new file |
| TRACK-03 | No third-party network call ever made during click write (privacy guarantee) | unit/structural | `pnpm --filter @kurzly/api test -- test/geoip.test.ts` (assert `lib/geoip.ts` never imports a fetch/HTTP client) | ❌ Wave 0 |
| TRACK-03 | Missing `Referer` → `referrerHost` null → displayed as "Direkt" (D-07) | unit | `pnpm --filter @kurzly/api test -- test/referrer.test.ts` | ❌ Wave 0 — new file |
| TRACK-04 | Per-link 30-day time series always returns exactly 30 buckets, zero-filled | integration | `pnpm --filter @kurzly/api test -- test/analytics.test.ts` | ❌ Wave 0 — new file |
| TRACK-04 | Per-link top referrers/countries, total clicks (from `lifetimeClicks`) | integration | same file | ❌ Wave 0 |
| TRACK-05 | Global overview: clicks, unique visitors (`COUNT(DISTINCT visitorHash)`), active links, QR scans (always 0 this phase), top links, referrers | integration | same file | ❌ Wave 0 |
| D-13 | `lifetimeClicks` increment stays atomic/consistent with `ClickEvent` insert (no drift pre-pruning) | integration | `pnpm --filter @kurzly/api test -- test/redirect-tracking.integration.test.ts` | ❌ Wave 0 |
| D-12 | Retention pruning deletes events older than `CLICK_RETENTION_DAYS` but leaves `lifetimeClicks` untouched | unit (pruning function tested directly, not the scheduler) | `pnpm --filter @kurzly/api test -- test/retention.test.ts` | ❌ Wave 0 — new file |
| D-06 | `visitorHash` differs for the same IP+UA across two different simulated UTC days (rotation proof) | unit (`lib/visitorHash.ts` with an injectable salt resolver) | `pnpm --filter @kurzly/api test -- test/visitorHash.test.ts` | ❌ Wave 0 — new file |
| UI-SPEC 3-state contract | Skeleton → zero-data-state / data-state, never both simultaneously | component | `pnpm --filter @kurzly/web test -- src/views/LinkDetailView.test.ts` (extend) + new `AnalyticsView.test.ts` | ❌ Wave 0 for `AnalyticsView.test.ts` |

### Sampling Rate
- **Per task commit:** the specific new/extended test file for that task (e.g. `pnpm --filter @kurzly/api test -- test/geoip.test.ts`)
- **Per wave merge:** `pnpm --filter @kurzly/api test` (backend) + `pnpm --filter @kurzly/web test` (frontend)
- **Phase gate:** `pnpm -r test` green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/prisma/schema.prisma` — `ClickEvent` model, `ScanSource` enum, `Link.trackingEnabled`/`lifetimeClicks` columns, `DailySalt` model (needed before any of the above tests can even compile against the generated Prisma client)
- [ ] `apps/api/test/redirect-tracking.integration.test.ts` — covers TRACK-02/TRACK-03/D-13
- [ ] `apps/api/test/geoip.test.ts` — covers TRACK-03 (country resolution + no-network structural assertion)
- [ ] `apps/api/test/referrer.test.ts` — covers TRACK-03/D-07
- [ ] `apps/api/test/visitorHash.test.ts` — covers D-06
- [ ] `apps/api/test/analytics.test.ts` — covers TRACK-04/TRACK-05
- [ ] `apps/api/test/retention.test.ts` — covers D-12
- [ ] `apps/web/src/views/AnalyticsView.test.ts` — covers Surface B's 3-state contract
- [ ] A real downloaded `.mmdb` test fixture (or a small synthetic MMDB test file) — needed for `geoip.test.ts` to assert actual country resolution rather than only the null-degradation path; recommend either committing a tiny synthetic test-only `.mmdb` fixture (a few well-known IP ranges) or downloading DB-IP's real file into a gitignored test-fixtures directory at test-setup time

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | no (new work) | Analytics endpoints reuse the existing better-auth session — no new auth surface |
| V3 Session Management | no (new work) | Same — no new session concept introduced |
| V4 Access Control | yes | Per-link analytics reuse `requireDomainAccess(prisma, userId, domainId, "member")` exactly as `routes/links.ts` already does; global analytics overview requires only an authenticated session for MVP (domain-scoped member visibility is explicitly deferred to Phase 9 per CONTEXT.md — document this as a known, intentional gap, not an oversight, in the plan) |
| V5 Input Validation | yes | `Referer`/`User-Agent` headers are untrusted input — `normalizeReferrer` and the country lookup must never throw on malformed input (Pattern 3/4); raw SQL aggregation queries must use `Prisma.sql`/parameterized `$queryRaw`, never string interpolation of `linkId`/date ranges (injection) |
| V6 Cryptography | yes | Visitor hash MUST be HMAC-SHA256 with a random, rotated, deletable salt — never a bare unsalted hash, never MD5/SHA1 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| SQL injection via raw `$queryRaw` aggregation (linkId/date range string-concatenated into SQL) | Tampering | `Prisma.sql` tagged template / parameterized `$queryRaw` exclusively — never `$queryRawUnsafe` with interpolated values |
| Analytics endpoint IDOR — a member reading another domain's link analytics by guessing/incrementing a linkId | Elevation of Privilege / Information Disclosure | Reuse the existing `resolveOwnedLink`/`requireDomainAccess("member")` pattern from `routes/links.ts` for the per-link analytics endpoint — do not write a fresh ad-hoc ownership check |
| Cross-day visitor re-identification if the daily salt isn't actually rotated+deleted | Information Disclosure | `DailySalt` table with true per-day random values, pruned independently of `CLICK_RETENTION_DAYS` (Open Question 2) — verify with a dedicated rotation-proof unit test (`visitorHash.test.ts`) |
| Referer/User-Agent header stuffing (pathologically long header values bloating `ClickEvent` rows) | Denial of Service (storage) | `normalizeReferrer` only ever stores a hostname (naturally short, ≤253 chars per DNS spec); do not store raw `User-Agent` at all (D-06 already forbids this — only its hash is used, never persisted as plaintext) |
| GeoIP DB tampering via a maliciously mounted `GEOIP_DB_PATH` | Tampering | Out of scope for MVP threat model — `GEOIP_DB_PATH` is an operator-controlled deployment setting (same trust level as `DATABASE_URL`), not attacker-reachable input |

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `apps/api/src/routes/redirect.ts`, `apps/api/src/lib/links.ts`, `apps/api/src/app.ts`, `apps/api/src/plugins/rateLimit.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts`, `apps/api/prisma/schema.prisma`, `apps/api/test/globalSetup.ts`, `apps/api/test/setupFileEach.ts`, `Dockerfile`, `apps/web/src/router/index.ts`, `apps/web/src/views/LinkDetailView.vue` — direct reads, ground truth for all "reuse existing pattern" claims
- `npm view maxmind version` — direct registry query, confirmed 5.0.6
- `gsd-tools query package-legitimacy check --ecosystem npm maxmind` — verdict `OK`, structured legitimacy signals

### Secondary (MEDIUM confidence)
- db-ip.com official download page (`https://db-ip.com/db/download/ip-to-country-lite`) via WebFetch — confirmed scriptable download URL pattern, CC-BY 4.0 attribution text, monthly update cadence
- `maxmind` npm package README / github.com/runk/node-maxmind via WebSearch — `Reader`/`open()` API shape, `getWithPrefixLength`
- Prisma official docs ("Write Your Own SQL in Prisma Client") + community discussion (`prisma/prisma#21563`) via WebSearch — `groupBy` limitations vs. `$queryRaw` for time-bucketed aggregation
- Plausible Analytics' documented privacy model (plausible.io/data-policy and related posts) via WebSearch — daily-salt-rotation visitor-hash precedent for D-06
- Fastify GitHub issues/discussions (`fastify/fastify#5865`, `#5304`) + fastify.dev Request reference via WebSearch — `trustProxy`/`request.ip` behavior and its "still untrusted input" caveat

### Tertiary (LOW confidence)
- None used as load-bearing claims — all package/API claims above were cross-checked against at least one authoritative source (npm registry, official docs, or the project's own already-shipped code).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `maxmind` verified via registry + legitimacy gate; no other new dependencies introduced (hashing/URL parsing use Node builtins)
- Architecture: HIGH — every pattern extends an already-shipped, already-verified project convention (D-01 single-write-path, D-17 seam, existing trustProxy wiring, existing testcontainers harness)
- Pitfalls: MEDIUM — GeoIP/mmdb-specific pitfalls (Pitfall 2, 3, 6) are WebSearch-sourced and should be empirically re-verified against a real downloaded `.mmdb` file during the first implementation plan (see Open Question 1)

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (30 days — stable domain; the one fast-moving element, DB-IP's monthly `.mmdb` release cadence, is already handled by the build-time-refresh design, not a research-freshness concern)
