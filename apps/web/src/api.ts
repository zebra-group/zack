/**
 * Typed client for the walking skeleton's PersistenceCanary endpoints
 * (apps/api/src/routes/canary.ts). Calls `/api/canary` on the SAME origin
 * (D-01) — in dev, Vite's proxy (vite.config.ts) forwards `/api/*` to the
 * Fastify backend; in production both are served by the same Fastify
 * instance via @fastify/static.
 */
import type { AuthSession, DomainDTO, SessionUser } from "@kurzly/shared";
import type { CanaryResult } from "@kurzly/shared";

/**
 * Thrown by `parseJsonOrThrow` (and any manual non-ok checks below) on a
 * failed request — carries the HTTP status so callers can branch on
 * specific codes (e.g. 409 duplicate-domain, 429 rate-limited) without
 * re-parsing `response.statusText`. Extends `Error` so existing
 * `catch (err) { ... err.message ... }` call sites are unaffected.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, statusText: string) {
    super(`Request failed: ${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
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
    throw new ApiError(response.status, response.statusText);
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
