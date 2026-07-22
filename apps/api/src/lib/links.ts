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
 * reuses this. `updateLink` is the ONLY `prisma.link.update` call site for
 * link *content* fields (slug/target/password/expiry/forwardQuery/
 * trackingEnabled), re-validating via the same core with `excludeLinkId`
 * set so re-saving a link's own slug is never a false collision (04-03
 * reuses this). Phase 6 (D-13/D-17) adds one narrow, intentional second
 * `prisma.link.update` call site — `routes/redirect.ts`'s
 * `recordClickHook`, which touches ONLY `lifetimeClicks` (an
 * atomically-incremented counter, batched in the same `$transaction` as
 * the click-event insert) and never any field this file validates.
 *
 * Anti-pattern this file exists to prevent (RESEARCH Pitfall 1): a future
 * "optimization" that replaces the CSV import's row-by-row `createLink`
 * loop with `prisma.link.createMany(...)` would silently reintroduce a
 * parallel write path that skips every rule below. Do not add one.
 */
import type { ImportRowResult, LinkSkipReason } from "@kurzly/shared";
import bcrypt from "bcryptjs";
import { parse } from "csv-parse/sync";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import type { Link, PrismaClient } from "../generated/prisma/client.js";
import { ForbiddenError, requireDomainAccess } from "./authorization.js";
import { normalizeHostname } from "./hostname.js";

/**
 * bcrypt hash cost (Phase 5, D-02) — read directly from `process.env`
 * (mirrors `routes/domains.ts`'s `computeVerificationTarget` convention of
 * reading raw env rather than `loadEnv()`'s parsed object), so this module
 * doesn't require boot-time ENV validation to have run first (e.g. under
 * Vitest, which never calls `loadEnv()`). Falls back to the exact same
 * default `env.ts`'s `PASSWORD_HASH_COST` schema key documents (11), so
 * behavior is identical whether or not `loadEnv()` ran.
 */
const PASSWORD_HASH_COST_DEFAULT = 11;
function resolvePasswordHashCost(): number {
  const raw = Number(process.env.PASSWORD_HASH_COST);
  return Number.isInteger(raw) && raw > 0 ? raw : PASSWORD_HASH_COST_DEFAULT;
}

/**
 * Derives the `passwordHash` value to persist from the raw `password`
 * input (D-02, T-05-PLAINTEXT — the plaintext is hashed here and nowhere
 * else, never logged, never stored as-is):
 *   - `undefined` (field omitted) or `""` (blank) -> `undefined` ("no
 *     change" on update; on create this omits the key so the column's
 *     nullable-with-no-default resolves to `null`, i.e. "not protected").
 *   - `null` (explicit) -> `null` ("clear the password").
 *   - a non-empty string -> a fresh bcrypt hash ("set/replace the password").
 */
async function derivePasswordHash(
  password: string | null | undefined,
): Promise<string | null | undefined> {
  if (password === undefined) return undefined;
  if (password === null) return null;
  if (password.length === 0) return undefined;
  return bcrypt.hash(password, resolvePasswordHashCost());
}

/**
 * Derives the `expiresAt` Date to persist from the raw `YYYY-MM-DD` input
 * (D-03): `undefined` keeps/omits, `null` clears, a date string is
 * converted to the UTC end-of-day instant (23:59:59.999Z) — day
 * granularity, server-side comparison, per RESEARCH's timezone discretion.
 */
function deriveExpiresAt(expiresAt: string | null | undefined): Date | null | undefined {
  if (expiresAt === undefined) return undefined;
  if (expiresAt === null) return null;
  return new Date(`${expiresAt}T23:59:59.999Z`);
}

/**
 * D-08-05 storage limits for the six UTM/OG fields — named constants (not
 * inline magic numbers) so `routes/links.ts`'s Zod allowlist and every test
 * that exercises them reference one source of truth.
 */
export const UTM_VALUE_MAX_LENGTH = 200;
export const OG_TITLE_MAX_LENGTH = 200;
export const OG_DESCRIPTION_MAX_LENGTH = 500;
export const OG_IMAGE_URL_MAX_LENGTH = 2048;

/**
 * Three-state derivation for the six UTM/OG fields (D-08-05), modelled on
 * `deriveExpiresAt`'s shape: `undefined` (omitted) keeps/no-change,
 * explicit `null` clears, an empty/whitespace-only string ALSO clears
 * (deliberately unlike `password`, where a blank string means "keep" —
 * these six fields have no equivalent "accidentally submitted blank"
 * concern), and any other string is trimmed and returned as-is. Does NOT
 * percent-encode or HTML-escape anything — percent-encoding happens only
 * when the redirect target is assembled (08-02's redirectEngine.ts) and
 * HTML escaping happens only when the bot OG page is rendered (08-02's
 * publicHtml.ts).
 */
function deriveMetaField(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

type MetaFieldResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: LinkErrorCode };

/** Applies `deriveMetaField` then enforces `maxLength`, reporting `tooLongError` on overflow. */
function validateMetaField(
  raw: string | null | undefined,
  maxLength: number,
  tooLongError: LinkErrorCode,
): MetaFieldResult {
  const value = deriveMetaField(raw);
  if (typeof value === "string" && value.length > maxLength) {
    return { ok: false, error: tooLongError };
  }
  return { ok: true, value };
}

/**
 * Zod v4 top-level `z.url()` idiom (same WHATWG-parser-backed mechanism
 * `targetUrlSchema` above uses) with an explicit http(s)-only protocol
 * allowlist (D-08-04) — `javascript:`/`data:`/relative values are rejected.
 * The server never fetches this URL; shape validation only.
 */
const ogImageUrlSchema = z.url({ protocol: /^https?$/ });

/**
 * `validateMetaField` first (length check BEFORE shape check, so an
 * over-long value reports `OG_IMAGE_URL_TOO_LONG` rather than
 * `OG_IMAGE_URL_INVALID`), then the http(s)-only shape check.
 */
function validateOgImageUrl(raw: string | null | undefined): MetaFieldResult {
  const lengthResult = validateMetaField(raw, OG_IMAGE_URL_MAX_LENGTH, "OG_IMAGE_URL_TOO_LONG");
  if (!lengthResult.ok) return lengthResult;
  if (typeof lengthResult.value === "string" && !ogImageUrlSchema.safeParse(lengthResult.value).success) {
    return { ok: false, error: "OG_IMAGE_URL_INVALID" };
  }
  return lengthResult;
}

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
  | "SLUG_GENERATION_EXHAUSTED"
  | "DOMAIN_NOT_ACTIVE"
  /** Phase 8 (D-08-05): any of utmSource/utmMedium/utmCampaign exceeds `UTM_VALUE_MAX_LENGTH`. */
  | "UTM_VALUE_TOO_LONG"
  /** Phase 8 (D-08-05): ogTitle exceeds `OG_TITLE_MAX_LENGTH`. */
  | "OG_TITLE_TOO_LONG"
  /** Phase 8 (D-08-05): ogDescription exceeds `OG_DESCRIPTION_MAX_LENGTH`. */
  | "OG_DESCRIPTION_TOO_LONG"
  /** Phase 8 (D-08-05): ogImageUrl exceeds `OG_IMAGE_URL_MAX_LENGTH`. */
  | "OG_IMAGE_URL_TOO_LONG"
  /** Phase 8 (D-08-04): ogImageUrl is not an absolute http(s) URL. */
  | "OG_IMAGE_URL_INVALID";

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
    // WR-06 fix (04-REVIEW.md): RESERVED_SLUGS is documented as "the single
    // source of truth for a Link slug must never shadow a system/app
    // route" — that guarantee must hold for AUTO-generated slugs too, not
    // only caller-supplied ones. A reserved-word collision here is treated
    // exactly like a DB collision: skip this candidate and retry.
    if (RESERVED_SLUGS.has(candidate.toLowerCase())) continue;
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
  /** bcrypt hash (D-02) — `undefined` no-change, `null` clear, string = new hash. Never plaintext. */
  passwordHash?: string | null;
  /** UTC end-of-day instant (D-03) — `undefined` no-change, `null` clear, `Date` = new expiry. */
  expiresAt?: Date | null;
  /** D-12 — `undefined` no-change (update) / defaults false (create via Prisma column default). */
  forwardQuery?: boolean;
  /**
   * TRACK-01/D-15 — `undefined` no-change (update) / defaults true (create
   * via Prisma column default). A plain boolean, no tri-state derivation
   * needed (unlike password/expiresAt) — there is no "clear" semantic.
   */
  trackingEnabled?: boolean;
  /** D-08-01/D-08-05 — `undefined` no-change, `null`/blank clears, string sets (trimmed, raw, not percent-encoded). */
  utmSource?: string | null;
  /** D-08-01/D-08-05 — see `utmSource`. */
  utmMedium?: string | null;
  /** D-08-01/D-08-05 — see `utmSource`. */
  utmCampaign?: string | null;
  /** D-08-03/D-08-05 — `undefined` no-change, `null`/blank clears, string sets (trimmed). */
  ogTitle?: string | null;
  /** D-08-03/D-08-05 — see `ogTitle`. */
  ogDescription?: string | null;
  /** D-08-04/D-08-05 — see `ogTitle`; additionally shape-validated to absolute http(s) only. */
  ogImageUrl?: string | null;
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
  /** Phase 5 (D-02): keep/clear/set — see `derivePasswordHash`'s doc comment. */
  password?: string | null;
  /** Phase 5 (D-03): keep/clear/set — see `deriveExpiresAt`'s doc comment. */
  expiresAt?: string | null;
  /** Phase 5 (D-12): omitted keeps current value on update / defaults false on create. */
  forwardQuery?: boolean;
  /** Phase 6 (TRACK-01/D-15): omitted keeps current value on update / defaults true on create. */
  trackingEnabled?: boolean;
  /** Phase 8 (D-08-01/D-08-05): keep/clear/set — see `deriveMetaField`'s doc comment. */
  utmSource?: string | null;
  /** Phase 8 (D-08-01/D-08-05): see `utmSource`. */
  utmMedium?: string | null;
  /** Phase 8 (D-08-01/D-08-05): see `utmSource`. */
  utmCampaign?: string | null;
  /** Phase 8 (D-08-03/D-08-05): keep/clear/set — see `deriveMetaField`'s doc comment. */
  ogTitle?: string | null;
  /** Phase 8 (D-08-03/D-08-05): see `ogTitle`. */
  ogDescription?: string | null;
  /** Phase 8 (D-08-04/D-08-05): see `ogTitle`; additionally shape-validated to absolute http(s) only. */
  ogImageUrl?: string | null;
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

  // WR-03 fix (04-REVIEW.md, high-value): membership alone is not enough —
  // a pending domain has never proven DNS ownership, and a failed domain's
  // verification is broken, so a Link created against either is either
  // premature or permanently orphaned once the redirect engine (Phase 5)
  // only serves `active` domains. This lives HERE (not in the route layer)
  // so both manual create AND CSV import inherit it automatically, per
  // D-01's single-core guarantee — do not duplicate this check elsewhere.
  const domain = await prisma.domain.findUnique({ where: { id: input.domainId } });
  if (!domain || domain.status !== "active") {
    return { ok: false, error: "DOMAIN_NOT_ACTIVE" };
  }

  const targetUrl = validateTargetUrl(input.targetUrl);
  if (!targetUrl) return { ok: false, error: "INVALID_TARGET_URL" };

  const slugResult = await resolveSlug(prisma, input.domainId, input.slug, input.excludeLinkId);
  if (!slugResult.ok) return { ok: false, error: slugResult.error };

  const passwordHash = await derivePasswordHash(input.password);
  const expiresAtDate = deriveExpiresAt(input.expiresAt);

  // Phase 8 (D-08-01..05) — UTM trio + OG trio, validated after every
  // pre-existing check above so an authorization/target/slug failure is
  // always reported first (unchanged precedence for existing callers).
  const utmSourceResult = validateMetaField(input.utmSource, UTM_VALUE_MAX_LENGTH, "UTM_VALUE_TOO_LONG");
  if (!utmSourceResult.ok) return utmSourceResult;
  const utmMediumResult = validateMetaField(input.utmMedium, UTM_VALUE_MAX_LENGTH, "UTM_VALUE_TOO_LONG");
  if (!utmMediumResult.ok) return utmMediumResult;
  const utmCampaignResult = validateMetaField(
    input.utmCampaign,
    UTM_VALUE_MAX_LENGTH,
    "UTM_VALUE_TOO_LONG",
  );
  if (!utmCampaignResult.ok) return utmCampaignResult;
  const ogTitleResult = validateMetaField(input.ogTitle, OG_TITLE_MAX_LENGTH, "OG_TITLE_TOO_LONG");
  if (!ogTitleResult.ok) return ogTitleResult;
  const ogDescriptionResult = validateMetaField(
    input.ogDescription,
    OG_DESCRIPTION_MAX_LENGTH,
    "OG_DESCRIPTION_TOO_LONG",
  );
  if (!ogDescriptionResult.ok) return ogDescriptionResult;
  const ogImageUrlResult = validateOgImageUrl(input.ogImageUrl);
  if (!ogImageUrlResult.ok) return ogImageUrlResult;

  return {
    ok: true,
    data: {
      domainId: input.domainId,
      targetUrl,
      slug: slugResult.slug,
      title: input.title,
      passwordHash,
      expiresAt: expiresAtDate,
      forwardQuery: input.forwardQuery,
      trackingEnabled: input.trackingEnabled,
      utmSource: utmSourceResult.value,
      utmMedium: utmMediumResult.value,
      utmCampaign: utmCampaignResult.value,
      ogTitle: ogTitleResult.value,
      ogDescription: ogDescriptionResult.value,
      ogImageUrl: ogImageUrlResult.value,
    },
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
        passwordHash: validated.data.passwordHash,
        expiresAt: validated.data.expiresAt,
        forwardQuery: validated.data.forwardQuery,
        trackingEnabled: validated.data.trackingEnabled,
        utmSource: validated.data.utmSource,
        utmMedium: validated.data.utmMedium,
        utmCampaign: validated.data.utmCampaign,
        ogTitle: validated.data.ogTitle,
        ogDescription: validated.data.ogDescription,
        ogImageUrl: validated.data.ogImageUrl,
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

/**
 * Maps a `LinkDTO`-shaped response from a Prisma `Link` row (ISO-string
 * dates, JSON-boundary convention). `passwordHash` is intentionally NEVER
 * read onto this object (T-05-DTO-LEAK) — only the derived
 * `passwordProtected` boolean crosses the JSON boundary.
 */
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
    passwordProtected: link.passwordHash !== null,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    forwardQuery: link.forwardQuery,
    trackingEnabled: link.trackingEnabled,
    lifetimeClicks: link.lifetimeClicks,
    // Phase 8 (D-08-01/02/03/04) — UTM/OG values cross the JSON boundary
    // verbatim: no percent-encoding (that's a redirect-time concern,
    // 08-02) and no HTML escaping (that's a bot-page-render-time concern,
    // 08-02's publicHtml.ts).
    utmSource: link.utmSource,
    utmMedium: link.utmMedium,
    utmCampaign: link.utmCampaign,
    ogTitle: link.ogTitle,
    ogDescription: link.ogDescription,
    ogImageUrl: link.ogImageUrl,
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

/**
 * The documented CSV column names (D-05, 04-UI-SPEC.md's format hint) —
 * IN-04 fix (04-REVIEW.md): `runImport` checks the parsed header row
 * against this set BEFORE entering the row loop, so a header that doesn't
 * match (wrong casing, wrong names, a completely different file) produces
 * ONE clear top-level error instead of every row silently resolving
 * `row.ziel_url` to `undefined` and being reported as `invalid_url` with
 * no hint that the real problem is the header itself.
 */
export const EXPECTED_CSV_COLUMNS = ["ziel_url", "slug", "domain"] as const;

/** Shared shape of `previewImport`/`commitImport`'s return — the caller (routes/links.ts) maps this onto `ImportPreviewResult`/`ImportCommitResult` (@kurzly/shared). */
export type ImportRunResult = {
  validCount: number;
  skippedCount: number;
  rows: ImportRowResult[];
  /**
   * WR-10 fix (04-REVIEW.md): `true` when `runImport`'s row loop stopped
   * EARLY because of an unexpected (non-validation) error — e.g. a
   * transient DB connectivity blip — partway through the CSV. `rows`
   * reflects exactly the rows processed (and, for `commitImport`, durably
   * written) before that point; any rows after it were never attempted.
   * Always `false`/omitted for a run that processed every row, including
   * one where every row was a normal validation skip.
   */
  partial?: boolean;
};

/**
 * Resolves a CSV row's `domain` column to a `Domain.id` the caller MAY or
 * may not have access to. An empty/missing `domain` cell falls back to
 * `defaultDomainId`. An unknown hostname resolves to `undefined` — this is
 * deliberate: `validateLinkInput`'s `requireDomainAccess` then denies it
 * uniformly as `UNAUTHORIZED_DOMAIN`, so "unknown domain" and "domain I
 * can't access" are indistinguishable to the caller (no existence oracle).
 *
 * WR-05 (04-REVIEW.md, accepted residual risk): the response BODY is
 * identical for "unknown hostname" vs. "hostname exists but I'm not a
 * member" by design (both bucket to `domain_unauthorized`), but the DB
 * work is NOT symmetric — an unknown hostname short-circuits after this
 * one query, while a known-but-foreign hostname additionally pays
 * `validateLinkInput`'s membership + `DOMAIN_NOT_ACTIVE` (WR-03) queries
 * before reaching the same result. That is a per-row timing/query-count
 * signal an attacker could in principle use to enumerate hostnames
 * registered on this instance via CSV import row timing. Deliberately NOT
 * fixed the way WR-04 was (a single normalized query the way
 * `resolveOwnedLink` now does): doing so here would mean resolving
 * membership BEFORE knowing whether the hostname exists at all, which
 * would require restructuring `runImport`'s per-row control flow (it
 * currently short-circuits before ever calling `createLink`/`previewLink`
 * for an unknown domain) — a materially larger change for a low-severity
 * signal that only fires 5 requests/15min (`LINK_IMPORT_RATE_LIMIT`,
 * plugins/rateLimit.ts) at a rate-limited, authenticated-only endpoint.
 * Per the review's own stated fallback ("accept and document this as a
 * low-severity residual risk"), this is the accepted resolution — revisit
 * if this endpoint's rate limit is ever relaxed.
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
    // WR-03 fix (04-REVIEW.md): a pending/failed domain is bucketed under
    // the same "domain_unauthorized" skip reason as a genuinely
    // inaccessible/unknown domain — deliberate, mirrors this file's
    // existing no-existence-oracle stance for CSV rows (a caller doing a
    // bulk import should not learn precisely WHY a domain can't be used,
    // only that it can't).
    case "DOMAIN_NOT_ACTIVE":
      return "domain_unauthorized";
    // Phase 8 (D-08-05): CSV import rows only ever carry ziel_url/slug/domain
    // (`EXPECTED_CSV_COLUMNS`) — `createLink`/`previewLink` are never called
    // from `runImport` with any UTM/OG field set, so these five codes can
    // never actually be produced here. Kept explicit (not folded into the
    // `default`) so the mapping stays total and a future CSV column addition
    // can't silently fall through.
    case "UTM_VALUE_TOO_LONG":
    case "OG_TITLE_TOO_LONG":
    case "OG_DESCRIPTION_TOO_LONG":
    case "OG_IMAGE_URL_TOO_LONG":
    case "OG_IMAGE_URL_INVALID":
      throw new Error(`Unreachable: CSV import cannot produce UTM/OG error code ${code}`);
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
  // IN-05 (04-REVIEW.md, accepted — no action, per the review's own
  // recommendation): `csv-parse` fully parses `csvText` into `rows` BEFORE
  // the `MAX_IMPORT_ROWS` cap below is checked, so an oversized-but-short
  // row CSV pays the full parse cost ahead of rejection. Low practical
  // impact given IN-02's now-EXPLICIT `CSV_MAX_LENGTH` (routes/links.ts)
  // and the endpoint's `LINK_IMPORT_RATE_LIMIT` (5 req/15min,
  // plugins/rateLimit.ts) both already bound the same resource. A
  // streaming parse with early-abort would close this fully but is not
  // justified at current scale — revisit only if this becomes a measured
  // problem.
  const rows: CsvRow[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`CSV exceeds ${MAX_IMPORT_ROWS} row limit`);
  }

  // IN-04 fix (04-REVIEW.md): validate the parsed header BEFORE the row
  // loop — see EXPECTED_CSV_COLUMNS's doc comment. Skipped when there are
  // zero data rows (a header-only or blank file) so this never fires a
  // false positive ahead of the real "no rows" case.
  if (rows.length > 0) {
    const headerKeys = new Set(Object.keys(rows[0] ?? {}));
    const missingColumns = EXPECTED_CSV_COLUMNS.filter((col) => !headerKeys.has(col));
    if (missingColumns.length > 0) {
      throw new Error(
        `CSV header does not match the expected columns (${EXPECTED_CSV_COLUMNS.join(", ")}); missing: ${missingColumns.join(", ")}`,
      );
    }
  }

  const seenSlugs = new Set<string>();
  const results: ImportRowResult[] = [];
  let validCount = 0;

  for (const row of rows) {
    const zielUrl = row.ziel_url ?? null;
    const slug = row.slug ?? null;
    const domain = row.domain ?? null;

    // WR-10 fix (04-REVIEW.md): each row's work is wrapped so an
    // UNEXPECTED error (e.g. a transient DB connectivity blip — NOT a
    // validation outcome, those are handled below via `outcome.ok`)
    // cannot unwind past rows already durably written by `createLink`
    // (mutate=true) and leave the caller with a bare failure and no idea
    // which rows actually committed. On such an error, stop processing
    // immediately and return exactly what was collected so far, flagged
    // `partial: true`, instead of letting the exception propagate.
    try {
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
        results.push({
          zielUrl,
          slug,
          domain,
          valid: false,
          reason: mapErrorToSkipReason(outcome.error),
        });
      } else {
        validCount += 1;
        results.push({ zielUrl, slug, domain, valid: true, reason: null });
      }
    } catch {
      return {
        validCount,
        skippedCount: results.length - validCount,
        rows: results,
        partial: true,
      };
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
