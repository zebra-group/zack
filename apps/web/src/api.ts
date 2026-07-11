/**
 * Typed client for the walking skeleton's PersistenceCanary endpoints
 * (apps/api/src/routes/canary.ts). Calls `/api/canary` on the SAME origin
 * (D-01) — in dev, Vite's proxy (vite.config.ts) forwards `/api/*` to the
 * Fastify backend; in production both are served by the same Fastify
 * instance via @fastify/static.
 */
import type { AuthSession, SessionUser } from "@kurzly/shared";
import type { CanaryResult } from "@kurzly/shared";

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
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
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
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
}
