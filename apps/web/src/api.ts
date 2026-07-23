/**
 * Typed client for the walking skeleton's PersistenceCanary endpoints
 * (apps/api/src/routes/canary.ts). Calls `/api/canary` on the SAME origin
 * (D-01) — in dev, Vite's proxy (vite.config.ts) forwards `/api/*` to the
 * Fastify backend; in production both are served by the same Fastify
 * instance via @fastify/static.
 */
import type {
  AccountRole,
  AssignDomainsInput,
  AuthSession,
  CreateLinkInput,
  CreateQrCodeInput,
  DomainDTO,
  GlobalAnalyticsDTO,
  ImportCommitResult,
  ImportPreviewResult,
  InviteMemberInput,
  LinkAnalyticsDTO,
  LinkDTO,
  QrCodeDTO,
  QrRemapHistoryEntryDTO,
  SessionUser,
  TeamMemberDTO,
  UpdateLinkInput,
  UpdateMemberRoleInput,
  UpdateQrCodeInput,
} from "@kurzly/shared";
import type { CanaryResult } from "@kurzly/shared";

/**
 * Thrown by `parseJsonOrThrow` (and any manual non-ok checks below) on a
 * failed request — carries the HTTP status so callers can branch on
 * specific codes (e.g. 409 duplicate-domain, 429 rate-limited) without
 * re-parsing `response.statusText`. Extends `Error` so existing
 * `catch (err) { ... err.message ... }` call sites are unaffected.
 *
 * `code` (Rule 2 addition, 04-05): best-effort mirror of the JSON error
 * body's `error` field (e.g. Link routes' `LinkErrorCode` strings like
 * `"SLUG_TAKEN"`/`"SLUG_RESERVED"`/`"INVALID_TARGET_URL"`) — several Link
 * mutations share the same HTTP status for distinct causes (both
 * `INVALID_TARGET_URL` and `SLUG_RESERVED` return 400), so status alone
 * cannot drive precise inline field errors. Optional and best-effort: a
 * non-JSON or bodyless error response (e.g. some rate-limit replies)
 * simply leaves `code` undefined — existing call sites that only read
 * `.status` are unaffected.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, statusText: string, code?: string) {
    super(`Request failed: ${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Maps a submit-time `ApiError` to inline Link-form field errors per
 * 04-UI-SPEC.md's Copywriting Contract (LinkFormModal.vue, LINK-02/06).
 * Lives here (not inside LinkFormModal.vue) because the generic `*.vue`
 * module shim (`vite-env.d.ts`) only declares a `default` export — a named
 * export from inside an SFC's `<script>` block would not type-check
 * against that shim under plain `tsc --noEmit` (no vue-tsc in this repo,
 * per STATE.md's Phase-1 decision). Both `INVALID_TARGET_URL` and
 * `SLUG_RESERVED` share HTTP 400 — the `code` field (when present)
 * disambiguates precisely; the status-only fallback covers a body that
 * couldn't be parsed as JSON.
 *
 * Phase 8 (08-04 Task 2, META-01/02): the four `utmError`/`ogTitleError`/
 * `ogDescriptionError`/`ogImageUrlError` fields were added here — not a
 * separate error channel — because `LinkFormModal.vue` already consumes
 * this interface through its single `error` prop, mapped internally via
 * `fieldErrors`. This mapping lands in THIS plan (rather than the later
 * OG-specific plan) because both this plan's UTM section (Task 3) and the
 * next plan's OG section render off the same `fieldErrors` computed,
 * which would not type-check if the interface arrived two waves later.
 */
export interface LinkFormFieldErrors {
  targetUrlError?: string;
  slugError?: string;
  /** Phase 8 (D-08-05): any of utmSource/utmMedium/utmCampaign exceeded 200 chars. */
  utmError?: string;
  /** Phase 8 (D-08-05): ogTitle exceeded 200 chars. */
  ogTitleError?: string;
  /** Phase 8 (D-08-05): ogDescription exceeded 500 chars. */
  ogDescriptionError?: string;
  /**
   * Phase 8 (D-08-04/D-08-05): ogImageUrl either exceeded 2048 chars or is
   * not an absolute http(s) URL — two distinct backend codes surface on
   * this ONE field with two different messages (see the switch below).
   */
  ogImageUrlError?: string;
}

const LINK_TARGET_URL_INVALID_MESSAGE = "Das sieht nicht wie eine gültige URL aus (https://…).";
const LINK_SLUG_TAKEN_MESSAGE = "Dieser Slug ist bereits vergeben.";
const LINK_SLUG_RESERVED_MESSAGE = "Dieser Slug ist reserviert und kann nicht verwendet werden.";
// WR-07 fix (04-REVIEW.md): a distinct message from LINK_SLUG_RESERVED_MESSAGE
// — a shape violation (length/characters) is a different problem than an
// actually-reserved word, and telling the user "reserved" when the real
// issue is invalid characters was actively misleading.
const LINK_SLUG_INVALID_SHAPE_MESSAGE =
  "Slug darf nur Buchstaben, Zahlen, - und _ enthalten, 2–32 Zeichen.";
// Phase 8 (08-UI-SPEC.md Copywriting Contract, D-08-05) — copied character
// for character, including German punctuation.
const LINK_UTM_VALUE_TOO_LONG_MESSAGE = "Maximal 200 Zeichen pro UTM-Wert.";
const LINK_OG_TITLE_TOO_LONG_MESSAGE = "Maximal 200 Zeichen.";
const LINK_OG_DESCRIPTION_TOO_LONG_MESSAGE = "Maximal 500 Zeichen.";
const LINK_OG_IMAGE_URL_TOO_LONG_MESSAGE = "Maximal 2048 Zeichen.";
const LINK_OG_IMAGE_URL_INVALID_MESSAGE =
  "Bitte eine vollständige Bild-URL mit http:// oder https:// angeben.";

export function mapLinkFormError(err: unknown): LinkFormFieldErrors {
  if (!(err instanceof ApiError)) return {};

  switch (err.code) {
    case "INVALID_TARGET_URL":
      return { targetUrlError: LINK_TARGET_URL_INVALID_MESSAGE };
    case "SLUG_RESERVED":
      return { slugError: LINK_SLUG_RESERVED_MESSAGE };
    case "SLUG_INVALID_SHAPE":
      return { slugError: LINK_SLUG_INVALID_SHAPE_MESSAGE };
    case "SLUG_TAKEN":
      return { slugError: LINK_SLUG_TAKEN_MESSAGE };
    case "UTM_VALUE_TOO_LONG":
      return { utmError: LINK_UTM_VALUE_TOO_LONG_MESSAGE };
    case "OG_TITLE_TOO_LONG":
      return { ogTitleError: LINK_OG_TITLE_TOO_LONG_MESSAGE };
    case "OG_DESCRIPTION_TOO_LONG":
      return { ogDescriptionError: LINK_OG_DESCRIPTION_TOO_LONG_MESSAGE };
    case "OG_IMAGE_URL_TOO_LONG":
      return { ogImageUrlError: LINK_OG_IMAGE_URL_TOO_LONG_MESSAGE };
    case "OG_IMAGE_URL_INVALID":
      return { ogImageUrlError: LINK_OG_IMAGE_URL_INVALID_MESSAGE };
    default:
      // No parsed code (e.g. non-JSON body) — fall back to status alone.
      // All five Phase 8 codes above are HTTP 400 like INVALID_TARGET_URL,
      // so leaving this branch untouched is intentional: an unparseable
      // 400 body still falls back to the target-url message, exactly as
      // before Phase 8.
      if (err.status === 409) return { slugError: LINK_SLUG_TAKEN_MESSAGE };
      if (err.status === 400) return { targetUrlError: LINK_TARGET_URL_INVALID_MESSAGE };
      return {};
  }
}

/**
 * `GET /api/canary`'s actual response shape (apps/api/src/routes/canary.ts):
 * `{ total, latest }`, NOT the shared `CanaryResult` DTO (`{ token, total }`)
 * — the route was built with a `latest` field (the most recent token, or
 * `null` if none exist yet) rather than reusing `CanaryResult` verbatim.
 * `POST /api/canary` does return the shared `CanaryResult` DTO.
 */
export type CanaryStatus = {
  total: number;
  latest: string | null;
};

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      code = typeof body?.error === "string" ? body.error : undefined;
    } catch {
      // Body absent or not JSON (e.g. some rate-limit responses) — code
      // stays undefined, callers fall back to status-only branching.
    }
    throw new ApiError(response.status, response.statusText, code);
  }
  return (await response.json()) as T;
}

export async function getCanary(): Promise<CanaryStatus> {
  const response = await fetch("/api/canary", { method: "GET" });
  return parseJsonOrThrow<CanaryStatus>(response);
}

export async function createCanary(): Promise<CanaryResult> {
  const response = await fetch("/api/canary", { method: "POST" });
  return parseJsonOrThrow<CanaryResult>(response);
}

/**
 * better-auth's `GET /api/auth/get-session` raw response body: `null` when
 * unauthenticated, or `{ session, user }` when a valid session cookie is
 * present (confirmed empirically in
 * apps/api/test/auth.integration.test.ts#AUTH-03/AUTH-04). This is NOT the
 * shape of the shared `AuthSession` DTO (`{ user: SessionUser | null }`) —
 * `getSession()` below normalizes the raw response into that DTO.
 */
type RawSessionResponse = { session: unknown; user: SessionUser } | null;

/**
 * `GET /api/auth/get-session` — same-origin request, the httpOnly session
 * cookie auto-attaches (fetch's default `credentials: "same-origin"|"include"`
 * for same-origin requests). Normalizes better-auth's raw `null | {user}`
 * response into the shared `AuthSession` DTO.
 */
export async function getSession(): Promise<AuthSession> {
  const response = await fetch("/api/auth/get-session", { method: "GET" });
  const raw = await parseJsonOrThrow<RawSessionResponse>(response);
  return { user: raw?.user ?? null };
}

/** `POST /api/auth/sign-out` — clears the session server-side. */
export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/sign-out", { method: "POST" });
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
}

/**
 * Domain management API client (Phase 3, DOMAIN-01/02/04) — mirrors the
 * same-origin `fetch` + `parseJsonOrThrow<T>` shape used by the
 * canary/auth clients above. The httpOnly session cookie auto-attaches to
 * every call (same-origin request, D-01) — the server independently
 * re-authorizes every request (T-03-09), the client is a convenience only.
 */

/** `POST /api/domains` — creates a pending Domain + owner membership. */
export async function createDomain(data: {
  hostname: string;
  type: "subdomain" | "apex";
}): Promise<DomainDTO> {
  const response = await fetch("/api/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<DomainDTO>(response);
}

/** `GET /api/domains` — scoped to the caller's own domains. */
export async function listDomains(): Promise<DomainDTO[]> {
  const response = await fetch("/api/domains", { method: "GET" });
  return parseJsonOrThrow<DomainDTO[]>(response);
}

/** `POST /api/domains/:id/verify` — on-demand DNS check (admin+-gated). */
export async function verifyDomain(domainId: string): Promise<DomainDTO> {
  const response = await fetch(`/api/domains/${domainId}/verify`, {
    method: "POST",
  });
  return parseJsonOrThrow<DomainDTO>(response);
}

/** `DELETE /api/domains/:id` — admin+-gated; 204 No Content on success. */
export async function deleteDomain(domainId: string): Promise<void> {
  const response = await fetch(`/api/domains/${domainId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
}

/**
 * `GET /api/domains/:id/instructions` response shape
 * (apps/api/src/routes/domains.ts's `toInstructions()`).
 */
export type DomainInstructions = {
  hostname: string;
  type: string;
  verificationTarget: string;
  instructions: string;
  alternativeForApex: string | null;
};

/** `GET /api/domains/:id/instructions` — admin+-gated. */
export async function getDomainInstructions(domainId: string): Promise<DomainInstructions> {
  const response = await fetch(`/api/domains/${domainId}/instructions`, {
    method: "GET",
  });
  return parseJsonOrThrow<DomainInstructions>(response);
}

/**
 * Link management + CSV bulk-import API client (Phase 4, LINK-01..08,
 * D-01/D-04/D-05) — mirrors the same same-origin `fetch` +
 * `parseJsonOrThrow<T>` shape as the domain client above. The server
 * independently re-authorizes/re-validates every call (T-04-UIAUTHZ); this
 * client is convenience only, never the access boundary.
 */

/** `POST /api/links` — creates a Link (blank slug auto-generates, D-02). */
export async function createLink(data: CreateLinkInput): Promise<LinkDTO> {
  const response = await fetch("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<LinkDTO>(response);
}

/** `GET /api/links` — scoped to the caller's accessible domains (D-03); optional `q`/`domainId` filters. */
export async function listLinks(params?: { q?: string; domainId?: string }): Promise<LinkDTO[]> {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.domainId) query.set("domainId", params.domainId);
  const qs = query.toString();
  const response = await fetch(`/api/links${qs ? `?${qs}` : ""}`, { method: "GET" });
  return parseJsonOrThrow<LinkDTO[]>(response);
}

/** `GET /api/links/:id` — IDOR-guarded detail lookup (404 for both not-found and forbidden, LINK-05). */
export async function getLink(id: string): Promise<LinkDTO> {
  const response = await fetch(`/api/links/${id}`, { method: "GET" });
  return parseJsonOrThrow<LinkDTO>(response);
}

/**
 * `GET /api/links/:id/analytics` — per-link click analytics (TRACK-04);
 * mirrors `getLink`'s same IDOR-guarded 404-for-both shape (06-05,
 * `resolveOwnedLink`). Renders only this server-authorized, already-scoped
 * DTO (T-06-UIAUTHZ2) — the client never re-derives analytics itself.
 */
export async function getLinkAnalytics(id: string): Promise<LinkAnalyticsDTO> {
  const response = await fetch(`/api/links/${id}/analytics`, { method: "GET" });
  return parseJsonOrThrow<LinkAnalyticsDTO>(response);
}

/**
 * `GET /api/analytics` — account-wide global analytics overview (TRACK-05);
 * scoped to the caller's own domains server-side (`scopedDomainIds`, 06-05).
 * Renders only this server-authorized, already-scoped DTO (T-06-GLOBALUI) —
 * the client never re-derives analytics itself.
 */
export async function getGlobalAnalytics(): Promise<GlobalAnalyticsDTO> {
  const response = await fetch("/api/analytics", { method: "GET" });
  return parseJsonOrThrow<GlobalAnalyticsDTO>(response);
}

/** `PATCH /api/links/:id` — edits target/slug/title through the validated update core (LINK-06, D-04). */
export async function updateLink(id: string, data: UpdateLinkInput): Promise<LinkDTO> {
  const response = await fetch(`/api/links/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<LinkDTO>(response);
}

/** `DELETE /api/links/:id` — IDOR-guarded (LINK-07); 204 No Content on success. */
export async function deleteLink(id: string): Promise<void> {
  const response = await fetch(`/api/links/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
}

/**
 * `POST /api/links/import/preview` — zero-write CSV dry-run (LINK-08,
 * D-05). Renders ONLY this backend-computed result — no client-side CSV
 * parsing/re-validation (T-04-PREVIEWDRIFT).
 */
export async function previewImport(
  csv: string,
  defaultDomainId?: string,
): Promise<ImportPreviewResult> {
  const response = await fetch("/api/links/import/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv, defaultDomainId }),
  });
  return parseJsonOrThrow<ImportPreviewResult>(response);
}

/**
 * `POST /api/links/import/commit` — writes only valid rows (LINK-08, D-05)
 * through the same insert path as manual create.
 */
export async function commitImport(
  csv: string,
  defaultDomainId?: string,
): Promise<ImportCommitResult> {
  const response = await fetch("/api/links/import/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv, defaultDomainId }),
  });
  return parseJsonOrThrow<ImportCommitResult>(response);
}

/**
 * QR code management API client (Phase 7, QR-02/03/04/07) — the SOLE fetch
 * layer for QR data, consumed by `QrCodesView.vue` (this plan) AND the two
 * downstream frontend plans (07-08 QR Studio panel, 07-09 Link-Detail entry
 * point) — neither of those ever calls `fetch()` against `/api/qr-codes*`
 * directly, mirroring the Link/Domain client's single-fetch-layer
 * convention above. Mirrors the exact same same-origin `fetch` +
 * `parseJsonOrThrow<T>` shape; the server independently re-authorizes every
 * call (IDOR-guarded, `resolveOwnedQrCode`) — this client is convenience
 * only, never the access boundary.
 */

/** `POST /api/qr-codes` — creates a static|dynamic QR (QR-01/02/03). */
export async function createQrCode(data: CreateQrCodeInput): Promise<QrCodeDTO> {
  const response = await fetch("/api/qr-codes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<QrCodeDTO>(response);
}

/** `GET /api/qr-codes` — scoped to the caller's accessible domains (via the bound Link). */
export async function listQrCodes(): Promise<QrCodeDTO[]> {
  const response = await fetch("/api/qr-codes", { method: "GET" });
  return parseJsonOrThrow<QrCodeDTO[]>(response);
}

/**
 * `PATCH /api/qr-codes/:id` — style-only update (name/color/roundedModules/
 * logoData). NEVER combined with a remap (`targetLinkId`) in the same call
 * — the backend routes those two shapes through entirely separate write
 * paths (T-07-WRITEPATH); use `remapQrCode` below for re-pointing.
 */
export async function updateQrCode(id: string, data: UpdateQrCodeInput): Promise<QrCodeDTO> {
  const response = await fetch(`/api/qr-codes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<QrCodeDTO>(response);
}

/**
 * `PATCH /api/qr-codes/:id` with `{ targetLinkId }` — re-points a dynamic
 * QR's CURRENT target (QR-03's headline guarantee: the printed `/q/:code`
 * URL never changes). A distinct call from `updateQrCode` above so callers
 * never accidentally combine a remap with a style update in one request.
 */
export async function remapQrCode(id: string, targetLinkId: string): Promise<QrCodeDTO> {
  const response = await fetch(`/api/qr-codes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetLinkId }),
  });
  return parseJsonOrThrow<QrCodeDTO>(response);
}

/** `GET /api/qr-codes/:id/remap-history` — full history, oldest-first (QR-04). */
export async function getQrRemapHistory(id: string): Promise<QrRemapHistoryEntryDTO[]> {
  const response = await fetch(`/api/qr-codes/${id}/remap-history`, { method: "GET" });
  return parseJsonOrThrow<QrRemapHistoryEntryDTO[]>(response);
}

/**
 * Render URL builders (QR-06) — build `<img>`/download URLs for the
 * server-rendered PNG/SVG. NEVER redrawn client-side (CONTEXT single-
 * code-path lock); every thumbnail/preview/export points at these same two
 * endpoints, rendered fresh from the QrCode's CURRENTLY stored style.
 */
export function qrRenderPngUrl(id: string): string {
  return `/api/qr-codes/${id}/render.png`;
}

export function qrRenderSvgUrl(id: string): string {
  return `/api/qr-codes/${id}/render.svg`;
}

/**
 * `GET /api/qr-codes/:id/render.png|svg` — fetched as a `Blob` (07-08, QR
 * Studio export buttons). A real file download needs the actual bytes (a
 * plain `<img src>` cannot trigger a save-as), so this is the one
 * exception to "render URLs are only for `<img>`/`<a>` attributes" above —
 * still routed through this file (never a bare `fetch()` inside
 * `QrStudioPanel.vue`), keeping api.ts the sole fetch layer for QR data
 * (this file's QR client header comment, T-07-FETCHLAYER convention).
 */
export async function fetchQrRenderBlob(id: string, format: "png" | "svg"): Promise<Blob> {
  const url = format === "png" ? qrRenderPngUrl(id) : qrRenderSvgUrl(id);
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
  return response.blob();
}

/**
 * Maps a submit-time `ApiError` to inline QR-form field/general errors,
 * mirroring `mapLinkFormError` above (04-05's convention: lives in api.ts,
 * not inside an SFC, since the generic `*.vue` module shim only declares a
 * `default` export). Covers the two backend `QrCodeErrorCode`s a form
 * submission can realistically surface (`INVALID_LOGO`, bad logo bytes)
 * plus the shared rate-limit posture (`@fastify/rate-limit`, 429) that
 * applies uniformly to QR create/remap per 07-UI-SPEC.md's Copywriting
 * Contract. `NOT_DYNAMIC`/`CODE_GENERATION_EXHAUSTED`/`UNAUTHORIZED_DOMAIN`
 * have no dedicated inline copy in the locked contract — they fall back to
 * `generalError` via the status-only branch below, same discipline as
 * `mapLinkFormError`'s `default` case.
 */
export interface QrFormFieldErrors {
  logoError?: string;
  generalError?: string;
}

const QR_LOGO_UPLOAD_FAILED_MESSAGE = "Logo-Upload fehlgeschlagen. Bitte erneut versuchen.";
const QR_RATE_LIMIT_MESSAGE = "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.";
const QR_SAVE_FAILED_MESSAGE = "Speichern fehlgeschlagen. Bitte erneut versuchen.";

export function mapQrFormError(err: unknown): QrFormFieldErrors {
  if (!(err instanceof ApiError)) return {};

  if (err.status === 429) return { generalError: QR_RATE_LIMIT_MESSAGE };

  switch (err.code) {
    case "INVALID_LOGO":
      return { logoError: QR_LOGO_UPLOAD_FAILED_MESSAGE };
    case "NOT_DYNAMIC":
    case "CODE_GENERATION_EXHAUSTED":
    case "UNAUTHORIZED_DOMAIN":
      return { generalError: QR_SAVE_FAILED_MESSAGE };
    default:
      // No parsed code (e.g. non-JSON body) — fall back to status alone.
      if (err.status === 400) return { generalError: QR_SAVE_FAILED_MESSAGE };
      return {};
  }
}

/**
 * Team management API client (Phase 9, TEAM-01..05, UI-09-*) — mirrors the
 * same-origin `fetch` + `parseJsonOrThrow<T>` shape used by the
 * domain/link/QR clients above. The server independently re-authorizes
 * every call (admin-gated via `isAccountAdmin`, apps/api's `routes/team.ts`)
 * — this client is convenience only, never the access boundary
 * (T-09-UI-BOUNDARY). `listTeamMembers` (09-06) is the sole read; the four
 * mutation clients below (09-07) let `TeamView.vue`/`InviteMemberModal.vue`/
 * `AssignDomainsModal.vue` wire role changes, domain assignment, invites,
 * and removal against the 09-04 mutation routes.
 */

/** `GET /api/team` — admin-gated full member roster (TEAM-01/TEAM-02). */
export async function listTeamMembers(): Promise<TeamMemberDTO[]> {
  const response = await fetch("/api/team", { method: "GET" });
  return parseJsonOrThrow<TeamMemberDTO[]>(response);
}

/**
 * `PATCH /api/team/:id/role` — immediate role commit (TEAM-04, UI-09-03).
 * Promoting to `"admin"` clears the target's domain assignments atomically
 * server-side (D-09-05); demoting the sole admin is refused with a
 * `LAST_ADMIN`-coded `ApiError` (D-09-07, UI-09-07).
 */
export async function changeMemberRole(id: string, accountRole: AccountRole): Promise<TeamMemberDTO> {
  const response = await fetch(`/api/team/${id}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountRole } satisfies UpdateMemberRoleInput),
  });
  return parseJsonOrThrow<TeamMemberDTO>(response);
}

/**
 * `PUT /api/team/:id/domains` — replaces a member's domain-membership set
 * exactly (TEAM-03, UI-09-05). `[]` clears every assignment.
 */
export async function assignMemberDomains(id: string, domainIds: string[]): Promise<TeamMemberDTO> {
  const response = await fetch(`/api/team/${id}/domains`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domainIds } satisfies AssignDomainsInput),
  });
  return parseJsonOrThrow<TeamMemberDTO>(response);
}

/**
 * `DELETE /api/team/:id` — removes a member (TEAM-05, D-09-06); 204 No
 * Content on success. Manually extracts the JSON error `code` on failure
 * (mirroring `parseJsonOrThrow`'s error branch) since a 204 body can't be
 * parsed as `T` — `removeMember`'s LAST_ADMIN lockout (D-09-07, UI-09-07)
 * needs that typed code to render the in-dialog error correctly.
 */
export async function removeMember(id: string): Promise<void> {
  const response = await fetch(`/api/team/${id}`, { method: "DELETE" });
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      code = typeof body?.error === "string" ? body.error : undefined;
    } catch {
      // Body absent or not JSON — code stays undefined.
    }
    throw new ApiError(response.status, response.statusText, code);
  }
}

/**
 * `POST /api/team/invite` — creates a pending member (`emailVerified:false`)
 * and sends the magic link, or resends it as a no-op for an existing
 * address (TEAM-01, D-09-04). Rate-limited server-side
 * (`MAGIC_LINK_RATE_LIMIT`, T-09-INVITE-BOMB).
 */
export async function inviteMember(input: InviteMemberInput): Promise<TeamMemberDTO> {
  const response = await fetch("/api/team/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<TeamMemberDTO>(response);
}

const TEAM_LAST_ADMIN_MESSAGE = "Es muss mindestens ein Admin bestehen bleiben.";
const TEAM_GENERIC_ERROR_MESSAGE = "Aktion fehlgeschlagen. Bitte erneut versuchen.";

/**
 * Maps a team-mutation `ApiError` to the locked inline/dialog message
 * (09-UI-SPEC.md Copywriting Contract, UI-09-07) — mirrors
 * `mapLinkFormError`/`mapQrFormError`'s "lives in api.ts, not the SFC"
 * convention (the generic `*.vue` module shim only declares a `default`
 * export). Unlike those two, this returns a single string rather than a
 * field-error object: every one of this plan's error surfaces
 * (`.member-error-row`, `.dialog-error`, the invite modal's `.field-error`
 * fallback) is a single flat message, never a multi-field form.
 */
export function mapTeamError(err: unknown): string {
  if (err instanceof ApiError && err.code === "LAST_ADMIN") {
    return TEAM_LAST_ADMIN_MESSAGE;
  }
  return TEAM_GENERIC_ERROR_MESSAGE;
}
