/**
 * Skeleton DTOs shared between apps/api and apps/web.
 * Real domain DTOs (Link, Domain, QRCode, etc.) are added in later phases.
 */

export type HealthStatus = {
  status: "ok";
};

export type CanaryResult = {
  token: string;
  total: number;
};

// Phase 2 (magic-link auth + domain authorization core, D-02/D-02b)

/**
 * Domain-scoped role hierarchy (owner > admin > member). Higher numeric
 * rank implies every permission of the ranks below it — this const is the
 * single source of truth `apps/api/src/lib/authorization.ts`'s
 * `requireDomainAccess` compares against (kept in sync there under the
 * name `ROLE_RANK` — same values, do not let the two drift).
 */
export const ROLE_HIERARCHY = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_HIERARCHY;

export type SessionUser = {
  id: string;
  email: string;
};

export type DomainMembership = {
  userId: string;
  domainId: string;
  role: Role;
};

// Phase 3 (domains & multi-domain TLS routing, D-01..04)

/**
 * Full domain lifecycle DTO — replaces the Phase-2 placeholder `Domain`
 * type above once every field crosses the JSON boundary. Date fields are
 * `string | null` (ISO 8601), not `Date`, since DTOs only ever travel as
 * JSON (apps/api's `toDomainDto()` mapping, apps/web's `api.ts` client).
 */
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

export type AuthSession = {
  user: SessionUser | null;
};

// Phase 4 (links management & bulk import, D-01..05, LINK-01..08)

/**
 * Full Link DTO — mirrors `apps/api/src/lib/links.ts`'s `toLinkDto()`
 * mapping. Date fields are ISO 8601 strings (same JSON-boundary convention
 * as `DomainDTO` above), never `Date` — DTOs only ever travel as JSON.
 */
export type LinkDTO = {
  id: string;
  domainId: string;
  slug: string;
  targetUrl: string;
  title: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Phase 5 (D-02, T-05-DTO-LEAK): derived boolean only — the bcrypt hash
   * itself (`Link.passwordHash`) NEVER crosses the JSON boundary. See
   * `apps/api/src/lib/links.ts`'s `toLinkDto()`.
   */
  passwordProtected: boolean;
  /** Phase 5 (D-03): UTC end-of-day ISO string, or `null` if the link never expires. */
  expiresAt: string | null;
  /** Phase 5 (D-12): whether incoming query params are merged onto targetUrl at redirect time. */
  forwardQuery: boolean;
};

/**
 * `POST /api/links` request body shape — the SAME shape `validateLinkInput`
 * (apps/api/src/lib/links.ts, D-01) accepts sans `userId` (resolved
 * server-side from the session, never client-supplied). A blank/omitted
 * `slug` auto-generates a Base62 slug (D-02).
 */
export type CreateLinkInput = {
  domainId: string;
  targetUrl: string;
  slug?: string;
  title?: string;
  /** Phase 5 (D-02): plaintext password, hashed server-side; omitted = not protected. */
  password?: string;
  /** Phase 5 (D-03): `YYYY-MM-DD`; server persists the UTC end-of-day instant. */
  expiresAt?: string;
  /** Phase 5 (D-12): omitted defaults to `false` server-side. */
  forwardQuery?: boolean;
};

/**
 * `PATCH /api/links/:id` request body shape (04-03) — every field optional
 * since an update may touch only one of targetUrl/slug/title; routed
 * through the same `validateLinkInput` core with `excludeLinkId` set so
 * re-saving a link's own slug is never a false collision.
 */
export type UpdateLinkInput = {
  targetUrl?: string;
  slug?: string;
  title?: string;
  /**
   * Phase 5 (D-02): keep/clear/set semantics — omitted or blank keeps the
   * current password unchanged, explicit `null` clears it, a non-empty
   * string re-hashes and replaces it.
   */
  password?: string | null;
  /** Phase 5 (D-03): omitted keeps, `null` clears, a `YYYY-MM-DD` string sets. */
  expiresAt?: string | null;
  /** Phase 5 (D-12): omitted keeps the current value. */
  forwardQuery?: boolean;
};

/**
 * Discriminates why a single CSV row was skipped during bulk import
 * (04-04, D-05) — surfaced per-row in `ImportRowResult.reason` so the
 * preview/commit UI can explain each skip precisely instead of a generic
 * "invalid row" message.
 */
export type LinkSkipReason =
  | "invalid_url"
  | "slug_conflict"
  | "domain_unauthorized"
  | "duplicate_in_file";

/**
 * Per-row CSV import result — one entry per input row, valid or not. Field
 * names (`zielUrl`/`slug`/`domain`) mirror the German CSV column headers
 * the import UI documents (04-UI-SPEC.md), not the English DTO field names
 * elsewhere, since these values echo the user's own raw input back for
 * review (not a persisted Link).
 */
export type ImportRowResult = {
  zielUrl: string | null;
  slug: string | null;
  domain: string | null;
  valid: boolean;
  reason: LinkSkipReason | null;
};

/** `POST /api/links/import/preview` response (04-04, D-05) — zero writes. */
export type ImportPreviewResult = {
  validCount: number;
  skippedCount: number;
  rows: ImportRowResult[];
};

/** `POST /api/links/import/commit` response (04-04, D-05) — after writing. */
export type ImportCommitResult = {
  importedCount: number;
  skippedCount: number;
  rows: ImportRowResult[];
  /**
   * WR-10 fix (04-REVIEW.md): `true` when the commit stopped EARLY due to
   * an unexpected (non-validation) error partway through the CSV — `rows`
   * reflects exactly the rows that were durably imported/skipped before
   * that point; any rows after it were never attempted. Optional/`false`
   * for a run that processed the entire CSV normally.
   */
  partial?: boolean;
};
