/**
 * Analytics read side (TRACK-04/05, D-10) — live SQL aggregation, no
 * pre-computed rollup tables. Every query here is a parameterized
 * tagged-template `Prisma.sql`/`$queryRaw` call — NEVER `$queryRawUnsafe`
 * with a string-interpolated `linkId`/`domainIds`/date range (SQL
 * injection, ASVS V5; T-06-SQLI). This is the first raw-SQL usage in the
 * codebase (06-PATTERNS.md "No Analog Found") — follows RESEARCH Pattern 5
 * directly.
 *
 * `getLinkAnalytics`/`getGlobalAnalytics` are pure read functions: they
 * perform ZERO writes and accept an already-authorized `linkId`/
 * `domainIds` — the route layer (`routes/analytics.ts`) is solely
 * responsible for the IDOR guard / domain scoping BEFORE calling in here
 * (mirrors `lib/links.ts`'s validate-then-write separation, just for
 * reads).
 *
 * `totalClicks` for a single link is read from the pruning-resistant
 * `Link.lifetimeClicks` counter (D-13) — never a live `COUNT` over
 * `ClickEvent`, which is pruned on a retention schedule (06-04) and would
 * silently under-count old links otherwise.
 *
 * A `null` `referrerHost`/`country` is returned AS `null` — never coerced
 * to a literal "Direkt"/"Unbekannt" string here (RESEARCH Anti-Patterns:
 * raw data stays locale-neutral; the German label is a view-layer
 * concern only).
 */
import type { GlobalAnalyticsDTO, LinkAnalyticsDTO } from "@kurzly/shared";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/** Row shape shared by both the per-link and global 30-day time-series queries. */
type DailyBucketRow = { day: Date; count: bigint };

/** How many top referrers/countries/links to surface per query. */
const TOP_N = 5;

/** Converts a raw `date_trunc`/`generate_series` result into the JSON-boundary `{day, count}[]` shape. */
function toDailySeries(rows: DailyBucketRow[]): { day: string; count: number }[] {
  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    count: Number(row.count),
  }));
}

/** Sums the trailing 7 entries of an already-ascending-ordered 30-bucket series. */
function sumLast7(series: { day: string; count: number }[]): number {
  return series.slice(-7).reduce((sum, bucket) => sum + bucket.count, 0);
}

/**
 * A 30-entry, all-zero, correctly-dated series — used only for the
 * `getGlobalAnalytics` empty-`domainIds` short-circuit (T-06-EMPTY), so
 * that branch never issues `Prisma.join([])` (invalid SQL) yet still
 * returns the same fixed-length shape the chart always expects.
 */
function emptyDailySeries(): { day: string; count: number }[] {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: { day: string; count: number }[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const bucket = new Date(todayUtc - offset * 24 * 60 * 60 * 1000);
    days.push({ day: bucket.toISOString().slice(0, 10), count: 0 });
  }
  return days;
}

/**
 * Per-link analytics (TRACK-04). `linkId` is assumed already
 * IDOR-authorized by the caller (routes/analytics.ts).
 */
export async function getLinkAnalytics(
  prisma: PrismaClient,
  linkId: string,
): Promise<LinkAnalyticsDTO> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    select: { lifetimeClicks: true },
  });
  const totalClicks = link?.lifetimeClicks ?? 0;

  // 30-day zero-filled series (RESEARCH Pattern 5) — generate_series LEFT
  // JOINed to ClickEvent guarantees exactly 30 rows even on all-zero days.
  const dailyRows = await prisma.$queryRaw<DailyBucketRow[]>(Prisma.sql`
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
  const dailySeries = toDailySeries(dailyRows);

  const referrerRows = await prisma.$queryRaw<{ referrerHost: string | null; count: bigint }[]>(
    Prisma.sql`
      SELECT "referrerHost", COUNT(*) AS count
      FROM "ClickEvent"
      WHERE "linkId" = ${linkId}
      GROUP BY "referrerHost"
      ORDER BY count DESC
      LIMIT ${TOP_N};
    `,
  );
  const topReferrers = referrerRows.map((row) => ({
    host: row.referrerHost,
    count: Number(row.count),
  }));

  const countryRows = await prisma.$queryRaw<{ country: string | null; count: bigint }[]>(Prisma.sql`
    SELECT "country", COUNT(*) AS count
    FROM "ClickEvent"
    WHERE "linkId" = ${linkId}
    GROUP BY "country"
    ORDER BY count DESC
    LIMIT ${TOP_N};
  `);
  const topCountries = countryRows.map((row) => ({
    country: row.country,
    count: Number(row.count),
  }));

  return {
    totalClicks,
    last7Days: sumLast7(dailySeries),
    topReferrer: topReferrers[0]?.host ?? null,
    dailySeries,
    topReferrers,
    topCountries,
  };
}

/**
 * Global analytics overview (TRACK-05) — scoped to `domainIds` (the
 * caller's own domains via `scopedDomainIds`, resolved by
 * routes/analytics.ts). An empty `domainIds` array (a user with zero
 * domain memberships) short-circuits to an all-zero/empty result WITHOUT
 * touching the database with an invalid `Prisma.join([])` (T-06-EMPTY) —
 * this is a scope, not a no-op auth check: full member-role visibility
 * enforcement + the denial-test suite are deferred to Phase 9
 * (documented intentional gap, T-06-GLOBALSCOPE).
 */
export async function getGlobalAnalytics(
  prisma: PrismaClient,
  domainIds: string[],
): Promise<GlobalAnalyticsDTO> {
  if (domainIds.length === 0) {
    return {
      clicks30Days: 0,
      uniqueVisitors: 0,
      activeLinks: 0,
      qrScans: 0,
      dailySeries: emptyDailySeries(),
      topLinks: [],
      topReferrers: [],
    };
  }

  const activeLinks = await prisma.link.count({ where: { domainId: { in: domainIds } } });

  const dailyRows = await prisma.$queryRaw<DailyBucketRow[]>(Prisma.sql`
    SELECT d.day, COALESCE(COUNT(ce."id"), 0) AS count
    FROM generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    ) AS d(day)
    LEFT JOIN "ClickEvent" ce
      ON date_trunc('day', ce."createdAt") = d.day
      AND ce."linkId" IN (
        SELECT "id" FROM "Link" WHERE "domainId" IN (${Prisma.join(domainIds)})
      )
    GROUP BY d.day
    ORDER BY d.day;
  `);
  const dailySeries = toDailySeries(dailyRows);
  const clicks30Days = dailySeries.reduce((sum, bucket) => sum + bucket.count, 0);

  const uniqueVisitorRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT ce."visitorHash") AS count
    FROM "ClickEvent" ce
    JOIN "Link" l ON l."id" = ce."linkId"
    WHERE l."domainId" IN (${Prisma.join(domainIds)});
  `);
  const uniqueVisitors = Number(uniqueVisitorRows[0]?.count ?? 0n);

  // Always 0 this phase (D-14 seam) — read live, never hardcoded, so
  // Phase 7 (which starts writing source='qr' rows) needs no change here.
  const qrScanRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM "ClickEvent" ce
    JOIN "Link" l ON l."id" = ce."linkId"
    WHERE l."domainId" IN (${Prisma.join(domainIds)}) AND ce."source" = ${"qr"}::"ScanSource";
  `);
  const qrScans = Number(qrScanRows[0]?.count ?? 0n);

  const topLinkRows = await prisma.$queryRaw<
    { id: string; slug: string; domainId: string; clicks: bigint }[]
  >(Prisma.sql`
    SELECT l."id", l."slug", l."domainId", COUNT(ce."id") AS clicks
    FROM "Link" l
    LEFT JOIN "ClickEvent" ce ON ce."linkId" = l."id"
    WHERE l."domainId" IN (${Prisma.join(domainIds)})
    GROUP BY l."id", l."slug", l."domainId"
    ORDER BY clicks DESC
    LIMIT ${TOP_N};
  `);
  const topLinks = topLinkRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    domainId: row.domainId,
    clicks: Number(row.clicks),
  }));

  const referrerRows = await prisma.$queryRaw<{ referrerHost: string | null; count: bigint }[]>(
    Prisma.sql`
      SELECT ce."referrerHost", COUNT(*) AS count
      FROM "ClickEvent" ce
      JOIN "Link" l ON l."id" = ce."linkId"
      WHERE l."domainId" IN (${Prisma.join(domainIds)})
      GROUP BY ce."referrerHost"
      ORDER BY count DESC
      LIMIT ${TOP_N};
    `,
  );
  const topReferrers = referrerRows.map((row) => ({
    host: row.referrerHost,
    count: Number(row.count),
  }));

  return {
    clicks30Days,
    uniqueVisitors,
    activeLinks,
    qrScans,
    dailySeries,
    topLinks,
    topReferrers,
  };
}
