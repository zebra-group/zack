/**
 * Link core (D-01 single-write-path enforcement, LINK-01/02/03).
 *
 * `validateLinkInput` is the SOLE authorization + validation gate for every
 * Link write in the codebase: (1) `requireDomainAccess(prisma, userId,
 * domainId, "member")` — reused verbatim from
 * apps/api/src/lib/authorization.ts, zero new authorization code, (2)
 * `validateTargetUrl` — http(s)-only scheme enforcement, (3) `resolveSlug`
 * — custom-slug shape/reserved/collision checks or Base62 auto-generation.
 * It performs ZERO database writes — it is a pure read+validate function,
 * mirroring `requireDomainAccess`'s own pure-check shape.
 *
 * `createLink` is the ONLY `prisma.link.create` call site in the entire
 * codebase (D-01's structural no-bypass guarantee — grep-provable, see
 * 04-02-PLAN.md's verify command). `previewLink` calls `validateLinkInput`
 * and returns it untouched (zero writes) — 04-04's CSV preview endpoint
 * reuses this. `updateLink` is the ONLY `prisma.link.update` call site,
 * re-validating via the same core with `excludeLinkId` set so re-saving a
 * link's own slug is never a false collision (04-03 reuses this).
 *
 * Anti-pattern this file exists to prevent (RESEARCH Pitfall 1): a future
 * "optimization" that replaces the CSV import's row-by-row `createLink`
 * loop with `prisma.link.createMany(...)` would silently reintroduce a
 * parallel write path that skips every rule below. Do not add one.
 */
import type { ImportRowResult, LinkSkipReason } from "@kurzly/shared";
import { parse } from "csv-parse/sync";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import type { Link, PrismaClient } from "../generated/prisma/client.js";
import { ForbiddenError, requireDomainAccess } from "./authorization.js";
import { normalizeHostname } from "./hostname.js";

/**
 * Base62 alphabet (D-02) — mixed-case digits, no ambiguous-character
 * exclusion (per RESEARCH's Base62 generator example): a 7-char id over
 * this 62-symbol alphabet gives ~2.2 x 10^12 possible slugs per domain,
 * comfortably collision-resistant for the `AUTO_SLUG_RETRY_LIMIT`-bounded
 * retry loop below to matter only in pathological/contrived cases.
 */
export const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const generateSlug = customAlphabet(BASE62, 7);
export const AUTO_SLUG_RETRY_LIMIT = 5;

/**
 * Reserved slugs (RESEARCH Pattern 3, Pitfall 3) — a hand-maintained list,
 * NOT dynamically introspected from Fastify's route table (see this file's
 * header comment's citation of why: `@fastify/static`'s `wildcard: false`
 * glob only resolves at boot, and the SPA's client-only routes never
 * appear in Fastify's table at all). Sourced from:
 *   - real Fastify routes: `api`, `health` (apps/api/src/routes/*.ts)
 *   - the ACME/reverse-proxy convention path: `.well-known`
 *   - the built SPA's static asset routes (`@fastify/static`,
 *     apps/api/public/): `assets`, `favicon.ico`, `robots.txt`,
 *     `index.html`
 *   - every current Vue Router top-level path segment
 *     (apps/web/src/router/index.ts): `login`, `auth`, `domains`, `links`,
 *     `qr-codes`, `analytics`, `team`
 *   - the forward-looking QR short-URL namespace (Phase 7, `/q/:code`): `q`
 *
 * IMPORTANT: any future phase that adds a new top-level Fastify route or
 * Vue Router segment MUST add it here too — this is the single source of
 * truth for "a Link slug must never shadow a system/app route." Matching
 * is case-insensitive (`RESERVED_SLUGS.has(slug.toLowerCase())`) even
 * though per-domain slug UNIQUENESS stays case-sensitive.
 *
 * IN-01 (04-REVIEW.md): five entries below are currently unreachable AS
 * reserved-word checks specifically — `customSlugSchema` (below) rejects
 * them on SHAPE first (returning `SLUG_INVALID_SHAPE`, not `SLUG_RESERVED`,
 * per the WR-07 fix), so `RESERVED_SLUGS.has()` never actually runs for
 * these: `.well-known`/`favicon.ico`/`robots.txt`/`index.html` (all
 * contain `.`, which `customSlugSchema`'s `[a-zA-Z0-9_-]` regex forbids)
 * and `q` (1 char, below `customSlugSchema`'s `.min(2)`). Still correctly
 * rejected end-to-end today — just via the shape branch, not this Set —
 * so a future relaxation of `customSlugSchema` (e.g. allowing
 * single-character slugs or dots) must NOT assume this Set alone still
 * covers them; re-verify.
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "health",
  ".well-known",
  "assets",
  "favicon.ico",
  "robots.txt",
  "index.html",
  "login",
  "auth",
  "domains",
  "links",
  "qr-codes",
  "analytics",
  "team",
  "q",
]);

export type LinkErrorCode =
  | "UNAUTHORIZED_DOMAIN"
  | "INVALID_TARGET_URL"
  | "SLUG_TAKEN"
  | "SLUG_RESERVED"
  | "SLUG_INVALID_SHAPE"
  | "SLUG_GENERATION_EXHAUSTED";

/** Custom-slug shape (RESEARCH Open Question 2/A4): 2-32 chars, `[a-zA-Z0-9_-]`. */
const customSlugSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9_-]+$/);

/**
 * Zod v4 top-level `z.url()` idiom (NOT the deprecated `z.string().url()`)
 * with an explicit protocol allowlist — the documented mechanism for
 * scheme allowlisting, uses the WHATWG URL parser under the hood rather
 * than a hand-rolled regex (RESEARCH "Don't Hand-Roll").
 */
const targetUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

/** Validates+normalizes a raw target URL; `undefined` on any failure (bad scheme, malformed, over-length). */
export function validateTargetUrl(raw: string): string | undefined {
  const parsed = targetUrlSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

type SlugResolution = { ok: true; slug: string } | { ok: false; error: LinkErrorCode };

/**
 * Resolves the slug to persist: validates+checks a caller-supplied custom
 * slug (shape -> reserved -> per-domain collision), or generates+checks a
 * Base62 candidate up to `AUTO_SLUG_RETRY_LIMIT` times for a blank slug.
 * `excludeLinkId` lets `updateLink` re-save a link's own slug without a
 * false SLUG_TAKEN collision against itself.
 */
async function resolveSlug(
  prisma: PrismaClient,
  domainId: string,
  slug: string | undefined,
  excludeLinkId?: string,
): Promise<SlugResolution> {
  if (slug && slug.length > 0) {
    // WR-07 fix (04-REVIEW.md): a shape violation (too short/long, or a
    // character outside [a-zA-Z0-9_-]) is a DIFFERENT problem than an
    // actually-reserved word — it gets its own error code so the client
    // can render an accurate message ("invalid characters/length" vs
    // "this word is reserved") instead of a misleading "reserved" message
    // for e.g. a slug containing a space or a single-character slug.
    const shapeCheck = customSlugSchema.safeParse(slug);
    if (!shapeCheck.success) return { ok: false, error: "SLUG_INVALID_SHAPE" };

    if (RESERVED_SLUGS.has(slug.toLowerCase())) {
      return { ok: false, error: "SLUG_RESERVED" };
    }

    const existing = await prisma.link.findUnique({
      where: { domainId_slug: { domainId, slug } },
    });
    if (existing && existing.id !== excludeLinkId) {
      return { ok: false, error: "SLUG_TAKEN" };
    }

    return { ok: true, slug };
  }

  for (let attempt = 0; attempt < AUTO_SLUG_RETRY_LIMIT; attempt++) {
    const candidate = generateSlug();
    const existing = await prisma.link.findUnique({
      where: { domainId_slug: { domainId, slug: candidate } },
    });
    if (!existing || existing.id === excludeLinkId) {
      return { ok: true, slug: candidate };
    }
  }

  return { ok: false, error: "SLUG_GENERATION_EXHAUSTED" };
}

/**
 * `title?: string | null` (WR-02 fix, 04-REVIEW.md): `null` is a genuine
 * "clear the title" signal that must survive all the way to Prisma's
 * `update` call, distinct from `undefined` ("field omitted, don't touch
 * it"). Widened alongside `ValidateLinkInputParams.title` below so a
 * PATCH's `title: null` is never collapsed into `undefined` on the way
 * through this core.
 */
export type ValidatedLink = {
  domainId: string;
  targetUrl: string;
  slug: string;
  title?: string | null;
};
export type ValidationResult =
  | { ok: true; data: ValidatedLink }
  | { ok: false; error: LinkErrorCode };

export type ValidateLinkInputParams = {
  userId: string;
  domainId: string;
  targetUrl: string;
  slug?: string;
  title?: string | null;
  /** Set by `updateLink` so a link's own current slug never false-collides with itself. */
  excludeLinkId?: string;
};

/**
 * The D-01 pure validation core — ZERO database writes. Every Link write
 * path (`createLink`, `previewLink`, `updateLink`) calls this and nothing
 * else for authorization/validation; do not duplicate any of these checks
 * elsewhere.
 */
export async function validateLinkInput(
  prisma: PrismaClient,
  input: ValidateLinkInputParams,
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
  if (!slugResult.ok) return { ok: false, error: slugResult.error };

  return {
    ok: true,
    data: { domainId: input.domainId, targetUrl, slug: slugResult.slug, title: input.title },
  };
}

export type CreateLinkResult = { ok: true; link: Link } | { ok: false; error: LinkErrorCode };

/**
 * `createLink` = `validateLinkInput` + a single insert. This is the ONLY
 * `prisma.link.create` call site in the codebase — 04-04's CSV importer
 * calls this function row-by-row, it never inserts directly (RESEARCH
 * Pitfall 1: no `createMany`/batch-insert shortcut, ever).
 */
export async function createLink(
  prisma: PrismaClient,
  input: ValidateLinkInputParams,
): Promise<CreateLinkResult> {
  const validated = await validateLinkInput(prisma, input);
  if (!validated.ok) return validated;

  try {
    const link = await prisma.link.create({
      data: { ...validated.data, createdBy: input.userId },
    });
    return { ok: true, link };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    throw err;
  }
}

/** Dry-run: identical rules, zero DB writes — 04-04's CSV preview endpoint. */
export async function previewLink(
  prisma: PrismaClient,
  input: ValidateLinkInputParams,
): Promise<ValidationResult> {
  return validateLinkInput(prisma, input);
}

export type UpdateLinkResult =
  | { ok: true; link: Link }
  | { ok: false; error: LinkErrorCode | "NOT_FOUND" };

/**
 * `updateLink` re-validates via the same D-01 core (with `excludeLinkId`
 * set) then performs the ONLY `prisma.link.update` call site — 04-03's
 * edit flow calls this, never `prisma.link.update` directly.
 */
export async function updateLink(
  prisma: PrismaClient,
  linkId: string,
  input: Omit<ValidateLinkInputParams, "excludeLinkId">,
): Promise<UpdateLinkResult> {
  const existing = await prisma.link.findUnique({ where: { id: linkId } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  const validated = await validateLinkInput(prisma, { ...input, excludeLinkId: linkId });
  if (!validated.ok) return validated;

  try {
    const link = await prisma.link.update({
      where: { id: linkId },
      data: {
        targetUrl: validated.data.targetUrl,
        slug: validated.data.slug,
        title: validated.data.title,
      },
    });
    return { ok: true, link };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    throw err;
  }
}

/** Maps a `LinkDTO`-shaped response from a Prisma `Link` row (ISO-string dates, JSON-boundary convention). */
export function toLinkDto(link: Link) {
  return {
    id: link.id,
    domainId: link.domainId,
    slug: link.slug,
    targetUrl: link.targetUrl,
    title: link.title,
    createdBy: link.createdBy,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

/**
 * Prisma's known-request-error shape for a unique-constraint violation
 * (P2002) — checked structurally, mirrors
 * apps/api/src/routes/domains.ts's `isUniqueConstraintViolation`.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * CSV bulk import (LINK-08, D-01/D-05).
 *
 * `runImport` is the ONE parse + row-loop implementation shared by
 * `previewImport` (mutate=false, zero writes) and `commitImport`
 * (mutate=true) — they differ ONLY by the `mutate` boolean, so preview can
 * never drift from commit (RESEARCH Pattern 2, Pitfall 2). Each row calls
 * `previewLink` or `createLink` above — the exact same validated core a
 * manual `POST /api/links` uses. This file must never gain a second Link
 * write site: no batch/multi-row insert call, no raw SQL insert, appears
 * anywhere in this import code (RESEARCH Pitfall 1) — the importer's only
 * path to persistence is the single `createLink` insert already declared
 * above.
 */

/**
 * Safety cap on CSV rows processed per import request — a code-level
 * constant, not an ENV var (RESEARCH OQ-3: INFRA-02 governs deployment
 * config, not internal safety bounds). A file exceeding this is rejected
 * before any row is touched.
 */
export const MAX_IMPORT_ROWS = 500;

export type CsvRow = { ziel_url?: string; slug?: string; domain?: string };

/** Shared shape of `previewImport`/`commitImport`'s return — the caller (routes/links.ts) maps this onto `ImportPreviewResult`/`ImportCommitResult` (@kurzly/shared). */
export type ImportRunResult = {
  validCount: number;
  skippedCount: number;
  rows: ImportRowResult[];
};

/**
 * Resolves a CSV row's `domain` column to a `Domain.id` the caller MAY or
 * may not have access to. An empty/missing `domain` cell falls back to
 * `defaultDomainId`. An unknown hostname resolves to `undefined` — this is
 * deliberate: `validateLinkInput`'s `requireDomainAccess` then denies it
 * uniformly as `UNAUTHORIZED_DOMAIN`, so "unknown domain" and "domain I
 * can't access" are indistinguishable to the caller (no existence oracle).
 */
export async function resolveRowDomainId(
  prisma: PrismaClient,
  row: CsvRow,
  defaultDomainId: string | undefined,
): Promise<string | undefined> {
  if (!row.domain?.trim()) return defaultDomainId;
  const domain = await prisma.domain.findUnique({
    where: { hostname: normalizeHostname(row.domain) },
  });
  return domain?.id;
}

/** Maps a `validateLinkInput`/`createLink` failure code to one of the four CSV skip reasons. */
export function mapErrorToSkipReason(code: LinkErrorCode): LinkSkipReason {
  switch (code) {
    case "INVALID_TARGET_URL":
      return "invalid_url";
    case "SLUG_TAKEN":
    case "SLUG_RESERVED":
    case "SLUG_INVALID_SHAPE":
    case "SLUG_GENERATION_EXHAUSTED":
      return "slug_conflict";
    case "UNAUTHORIZED_DOMAIN":
      return "domain_unauthorized";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

/**
 * Parses `csvText` exactly once and loops rows SEQUENTIALLY — `await` runs
 * inside the `for...of` loop, never `Promise.all` — so row N+1's per-domain
 * slug uniqueness check sees row N's already-committed insert. `mutate`
 * selects `createLink` (commit) vs `previewLink` (dry-run preview); both
 * calls funnel through the exact same validated core.
 */
export async function runImport(
  prisma: PrismaClient,
  userId: string,
  csvText: string,
  defaultDomainId: string | undefined,
  mutate: boolean,
): Promise<ImportRunResult> {
  const rows: CsvRow[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`CSV exceeds ${MAX_IMPORT_ROWS} row limit`);
  }

  const seenSlugs = new Set<string>();
  const results: ImportRowResult[] = [];
  let validCount = 0;

  for (const row of rows) {
    const zielUrl = row.ziel_url ?? null;
    const slug = row.slug ?? null;
    const domain = row.domain ?? null;

    const domainId = await resolveRowDomainId(prisma, row, defaultDomainId);
    const customSlug = row.slug?.trim() || undefined;

    if (domainId && customSlug) {
      const dedupeKey = `${domainId}:${customSlug}`;
      if (seenSlugs.has(dedupeKey)) {
        results.push({ zielUrl, slug, domain, valid: false, reason: "duplicate_in_file" });
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
      : ({ ok: false, error: "UNAUTHORIZED_DOMAIN" } as const);

    if (!outcome.ok) {
      results.push({ zielUrl, slug, domain, valid: false, reason: mapErrorToSkipReason(outcome.error) });
    } else {
      validCount += 1;
      results.push({ zielUrl, slug, domain, valid: true, reason: null });
    }
  }

  return { validCount, skippedCount: results.length - validCount, rows: results };
}

/** Dry-run: previewLink per row, ZERO writes — 04-04's CSV preview endpoint. */
export const previewImport = (
  prisma: PrismaClient,
  userId: string,
  csv: string,
  defaultDomainId?: string,
): Promise<ImportRunResult> => runImport(prisma, userId, csv, defaultDomainId, false);

/** Writes only valid rows via createLink — the SAME insert site the manual-create route uses. */
export const commitImport = (
  prisma: PrismaClient,
  userId: string,
  csv: string,
  defaultDomainId?: string,
): Promise<ImportRunResult> => runImport(prisma, userId, csv, defaultDomainId, true);
