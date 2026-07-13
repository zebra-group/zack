/**
 * Typed client for the walking skeleton's PersistenceCanary endpoints
 * (apps/api/src/routes/canary.ts). Calls `/api/canary` on the SAME origin
 * (D-01) — in dev, Vite's proxy (vite.config.ts) forwards `/api/*` to the
 * Fastify backend; in production both are served by the same Fastify
 * instance via @fastify/static.
 */
import type {
  AuthSession,
  CreateLinkInput,
  DomainDTO,
  ImportCommitResult,
  ImportPreviewResult,
  LinkAnalyticsDTO,
  LinkDTO,
  SessionUser,
  UpdateLinkInput,
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
 */
export interface LinkFormFieldErrors {
  targetUrlError?: string;
  slugError?: string;
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
    default:
      // No parsed code (e.g. non-JSON body) — fall back to status alone.
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
