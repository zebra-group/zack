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

// Phase 9 (team management & domain-scoped authorization, D-09-01)

/**
 * Global account role — what a user IS on this installation, distinct from
 * the per-domain `Role` above (what a user may do WITHIN one domain).
 * Mirrors `apps/api/prisma/schema.prisma`'s `AccountRole` enum and
 * `apps/api/src/lib/accountRole.ts`'s `isAccountAdmin`. Admin = everything;
 * Member = only assigned domains (Links/QR/Analytics).
 */
export const ACCOUNT_ROLES = ["admin", "member"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type SessionUser = {
  id: string;
  email: string;
  /**
   * UI-09-02 data contract — always present because the server always
   * provides it (better-auth's `user.additionalFields.accountRole`, wired
   * in `apps/api/src/lib/auth.ts`). Never client-settable.
   */
  accountRole: AccountRole;
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
  /** Phase 6 (TRACK-01/D-15): whether the redirect engine records clicks for this link. Defaults true. */
  trackingEnabled: boolean;
  /**
   * Phase 6 (D-13): pruning-resistant all-time click counter — read-only,
   * incremented only by the redirect click hook. NEVER settable via
   * `CreateLinkInput`/`UpdateLinkInput` (T-06-MASS).
   */
  lifetimeClicks: number;
  /**
   * Phase 8 UTM builder trio (D-08-01/D-08-02) — stored separately from
   * `targetUrl`, applied at redirect time. `null` = not set. When set,
   * overrides same-named query keys already present on the target.
   */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /**
   * Phase 8 custom OG trio (D-08-03/D-08-04) — owner-authored text served
   * to bots for every link state; `ogImageUrl` is shape-validated only
   * (http/https), the server never fetches it. `null` = keep the generic
   * brand fallback for that field.
   */
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
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
  /** Phase 6 (TRACK-01/D-15): omitted defaults to `true` server-side. */
  trackingEnabled?: boolean;
  /**
   * Phase 8 (D-08-01/D-08-05): UTM trio, each optional, max 200 chars.
   * Stored raw (not percent-encoded) — percent-encoding happens only when
   * the redirect target is assembled.
   */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Phase 8 (D-08-03/D-08-05): optional, max 200 chars. */
  ogTitle?: string;
  /** Phase 8 (D-08-03/D-08-05): optional, max 500 chars. */
  ogDescription?: string;
  /** Phase 8 (D-08-04/D-08-05): optional, absolute http(s) URL only, max 2048 chars. */
  ogImageUrl?: string;
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
  /** Phase 6 (TRACK-01/D-15): omitted keeps the current value. */
  trackingEnabled?: boolean;
  /**
   * Phase 8 (D-08-05): keep/clear/set — omitted keeps the current value,
   * `null` OR an empty/whitespace-only string clears it (deliberately
   * unlike `password`, where an empty string means "keep"), a non-empty
   * string sets/replaces it.
   */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
};

// Phase 6 (internal tracking analytics, TRACK-04/05, D-10)

/**
 * `GET /api/links/:id/analytics` response (TRACK-04). Mirrors
 * `apps/api/src/lib/analytics.ts`'s `getLinkAnalytics()` — `totalClicks`
 * comes from the pruning-resistant `Link.lifetimeClicks` (D-13), never a
 * live `COUNT` over `ClickEvent` rows. `dailySeries` is ALWAYS exactly 30
 * entries (oldest first), zero-filled for days with no clicks (RESEARCH
 * Pattern 5) — the UI never has to gap-fill dates itself. `host`/`country`
 * are `null` (never a literal "Direkt"/"Unbekannt" string) when unknown —
 * translated to the German label only at the view boundary (RESEARCH
 * Anti-Patterns: raw data stays locale-neutral).
 */
export type LinkAnalyticsDTO = {
  totalClicks: number;
  last7Days: number;
  topReferrer: string | null;
  dailySeries: { day: string; count: number }[];
  topReferrers: { host: string | null; count: number }[];
  topCountries: { country: string | null; count: number }[];
};

// Phase 9 (team management, D-09-03/D-09-04)

/**
 * Derived-only status (D-09-03) — `"active"` iff the User's `emailVerified`
 * is `true`, `"pending"` otherwise. Computed ONCE, server-side, by
 * `apps/api/src/lib/team.ts`'s `toTeamMemberDto` — the ONLY place this is
 * derived. The frontend reads this field verbatim and never re-derives it
 * from `emailVerified` (which never crosses the JSON boundary on this DTO).
 */
export type MemberStatus = "pending" | "active";

/**
 * `GET /api/team` list entry (TEAM-01/TEAM-02). Mirrors
 * `apps/api/src/lib/team.ts`'s `toTeamMemberDto()` mapping. `domains` is
 * always `[]` for an `accountRole: "admin"` member (D-09-02: an admin
 * already reaches every domain, so no `DomainMembership` rows are ever
 * created for one) — the UI renders the "alle Domains" pill for `admin`
 * based on `accountRole`, not on this array being non-empty.
 */
export type TeamMemberDTO = {
  id: string;
  email: string;
  name: string | null;
  accountRole: AccountRole;
  status: MemberStatus;
  domains: { id: string; hostname: string }[];
};

/**
 * `POST /api/team/invite` request body shape (TEAM-01, D-09-04). Reusing an
 * already-invited/existing `email` is a no-op resend — it never changes
 * `accountRole` and never mutates `domainIds` (see `lib/team.ts`'s
 * `inviteMember` header comment). `domainIds` is only meaningful when
 * `accountRole` is `"member"` — ignored for `"admin"` (D-09-02 makes
 * per-domain assignment meaningless for an account admin).
 */
export type InviteMemberInput = {
  email: string;
  accountRole: AccountRole;
  domainIds?: string[];
};

/**
 * Typed mutation error codes (Phase 9 Plan 4, TEAM-03/04/05) shared between
 * `apps/api`'s team mutation functions/routes (`lib/team.ts`,
 * `routes/team.ts`) and the frontend's `ApiError.code`-driven inline
 * messaging (UI-09-07) — one source of truth for both sides of the JSON
 * boundary. `NOT_FOUND`: the `:id` does not reference an existing User.
 * `LAST_ADMIN` (D-09-07): the mutation would leave the installation with
 * zero `accountRole: "admin"` users — refused, nothing changed.
 * `INVALID_DOMAIN`: an assigned `domainId` does not reference an existing
 * Domain. `CONFLICT` (WR-02): a lockout-guard transaction could not complete
 * under lock contention (Prisma `P2028` timeout) — the mutation was NOT
 * applied and the request is safe to retry; mapped to HTTP 409 so a
 * transient contention retry is never surfaced as a raw 500.
 */
export type TeamErrorCode = "NOT_FOUND" | "LAST_ADMIN" | "INVALID_DOMAIN" | "CONFLICT";

/**
 * `PATCH /api/team/:id/role` request body (TEAM-04). Promoting to `"admin"`
 * clears the target's domain assignments atomically (D-09-05); demoting to
 * `"member"` is refused with `LAST_ADMIN` if the target is the sole admin
 * (D-09-07).
 */
export type UpdateMemberRoleInput = {
  accountRole: AccountRole;
};

/**
 * `PUT /api/team/:id/domains` request body (TEAM-03) — replaces the
 * target's domain-membership set with EXACTLY this list; `[]` clears every
 * assignment.
 */
export type AssignDomainsInput = {
  domainIds: string[];
};

/**
 * `GET /api/analytics` response (TRACK-05) — scoped to the caller's own
 * domains (`scopedDomainIds`), never the whole instance. Mirrors
 * `apps/api/src/lib/analytics.ts`'s `getGlobalAnalytics()`. `qrScans`
 * reads `COUNT(source='qr')` — always `0` this phase (D-14 seam; Phase 7
 * starts writing `'qr'` rows, no DTO change needed then).
 */
export type GlobalAnalyticsDTO = {
  clicks30Days: number;
  uniqueVisitors: number;
  activeLinks: number;
  qrScans: number;
  dailySeries: { day: string; count: number }[];
  topLinks: { id: string; slug: string; domainId: string; clicks: number }[];
  topReferrers: { host: string | null; count: number }[];
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

// Phase 7 (QR codes: static/dynamic, QR Studio — QR-02/03/04)

/**
 * Full QrCode DTO — mirrors `apps/api/src/lib/qrCodes.ts`'s `toQrCodeDto()`
 * mapping. `code` is `null` for a `static` QR (permanently bound to
 * `linkId`, its target) and a stable 7-char `/q/:code` short code for a
 * `dynamic` QR. Re-pointing a dynamic QR (`remapQrCode`, QR-03's headline
 * guarantee) changes `linkId` (its CURRENT target) but NEVER `code` — a
 * printed dynamic QR keeps working forever even as its destination
 * changes. `logoEnabled` is a derived boolean only — the raw `logoData`
 * bytes NEVER cross the JSON boundary (T-07-DTO-LEAK, mirrors
 * `LinkDTO.passwordProtected` deriving from `passwordHash` without ever
 * exposing the hash itself).
 */
export type QrCodeDTO = {
  id: string;
  variant: "static" | "dynamic";
  /** The bound Link (static) or the CURRENT target Link (dynamic). */
  linkId: string;
  /** `null` for a static QR; a stable 7-char short code for a dynamic QR — never changes across remaps. */
  code: string | null;
  name: string;
  color: string;
  roundedModules: boolean;
  /** Derived from whether a logo is stored — never the raw bytes (T-07-DTO-LEAK). */
  logoEnabled: boolean;
  /**
   * Whether logo bytes are ACTUALLY stored, independent of `logoEnabled`
   * (a QR can have the toggle on with nothing uploaded yet — see
   * `UpdateQrCodeInput.logoEnabled`'s doc comment). Exists purely so a
   * client can tell "toggle on, no upload" apart from "toggle on, real
   * logo from a past session" without the raw bytes ever crossing the
   * JSON boundary (T-07-DTO-LEAK) — QrStudioPanel.vue needs this to avoid
   * drawing its decorative placeholder tile over an already-composited
   * real logo once a QR is reselected (its session-local upload-tracking
   * flag resets on every selection change).
   */
  hasLogo: boolean;
  /**
   * Pruning-resistant all-time scan counter (mirrors `LinkDTO.lifetimeClicks`,
   * D-13 precedent) — read-only, incremented only by the `/q` scan hook
   * (07-06). NEVER settable via `CreateQrCodeInput`/`UpdateQrCodeInput`
   * (T-07-MASS).
   */
  lifetimeScans: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `POST /api/qr-codes` request body shape (07-05) — the SAME shape
 * `createQrCode` (apps/api/src/lib/qrCodes.ts, D-01
 * equivalent for QR) accepts sans `userId` (resolved server-side from the
 * session, never client-supplied). `code`/`lifetimeScans` are NEVER
 * present here — they are server-owned (T-07-MASS), mirroring
 * `CreateLinkInput` never accepting `lifetimeClicks`.
 */
export type CreateQrCodeInput = {
  variant: "static" | "dynamic";
  /** The Link to bind (static) or the initial target Link (dynamic). */
  linkId: string;
  name: string;
  color?: string;
  roundedModules?: boolean;
};

/**
 * `PATCH /api/qr-codes/:id` request body shape (07-05) — style fields,
 * routed through `updateQrCode`'s single style-update site, PLUS the
 * one-field remap trigger. `code`, `variant`, and `linkId` are
 * deliberately absent: re-pointing a dynamic QR's target is a distinct,
 * separately-audited operation (`remapQrCode`, QR-04's history-recording
 * remap) — `apps/api/src/routes/qrCodes.ts` routes the ENTIRE request
 * through `remapQrCode` instead of `updateQrCode` whenever `targetLinkId`
 * is present, never combining a remap with a style update in one call
 * (T-07-WRITEPATH).
 */
export type UpdateQrCodeInput = {
  name?: string;
  color?: string;
  roundedModules?: boolean;
  /**
   * Independently toggleable from `logoData` itself (07-08, Studio "Logo
   * in der Mitte" toggle) — the server's `updateQrCodeSchema` (Zod
   * allowlist, `routes/qrCodes.ts`) already accepts this field and this
   * file's own PATCH-body comment on that schema already documents it;
   * this type was simply missing it (Rule 3 fix, 07-08-SUMMARY.md). `true`
   * with no `logoData` ever stored renders the QR with no composited logo
   * server-side — the Studio preview's decorative placeholder tile is a
   * client-only affordance, never a claim about the exported bytes.
   */
  logoEnabled?: boolean;
  /**
   * Omitted keeps the current logo unchanged, `null` clears it, a base64
   * data string (PNG or SVG) sets/replaces it. The server independently
   * re-validates the decoded bytes via `normalizeLogo` (magic-byte
   * sniffing, never a client-declared MIME) before ever persisting them —
   * mirrors `UpdateLinkInput.password`'s keep/clear/set tri-state.
   */
  logoData?: string | null;
  /** Present -> re-points a `dynamic` QR's CURRENT target via `remapQrCode` (QR-03); never present alongside the style fields above in the same call. */
  targetLinkId?: string;
};

/**
 * `GET /api/qr-codes/:id/remap-history` response entry (QR-04) — mirrors
 * `apps/api/src/lib/qrCodes.ts`'s `toQrRemapHistoryEntryDto()` mapping.
 * The full history array is always chronological, oldest-first (mirrors
 * `LinkAnalyticsDTO.dailySeries`'s oldest-first convention).
 */
export type QrRemapHistoryEntryDTO = {
  id: string;
  qrCodeId: string;
  fromLinkId: string;
  toLinkId: string;
  createdAt: string;
};

// Phase 10 (OIDC/SSO, D-10-02/UI-10-02)

/**
 * `GET /api/sso/status` response (10-03) — mirrors
 * `apps/api/src/lib/ssoConfig.ts`'s `readSsoConfig()`/`maskClientId()`/
 * `ssoCallbackPath()`. Per D-10-02 the admin "Authentifizierung" OIDC card
 * is a status + setup-guidance surface (not a live credential-entry form):
 * OIDC is configured entirely via ENV, and this DTO deliberately carries NO
 * client-secret field — leaking the secret to the browser is a TypeScript
 * compile error, not a runtime discipline (T-10-SECRET-SHAPE). `issuer` and
 * `clientIdMasked` are `null` when `enabled` is `false`; `callbackPath` is
 * ALWAYS present (UI-10-06) — even the disabled card shows the exact
 * callback URL to register with an IdP ahead of enabling SSO.
 */
export type SsoStatusDTO = {
  enabled: boolean;
  issuer: string | null;
  clientIdMasked: string | null;
  callbackPath: string;
};
