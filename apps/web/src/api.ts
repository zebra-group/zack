/**
 * Typed client for the walking skeleton's PersistenceCanary endpoints
 * (apps/api/src/routes/canary.ts). Calls `/api/canary` on the SAME origin
 * (D-01) — in dev, Vite's proxy (vite.config.ts) forwards `/api/*` to the
 * Fastify backend; in production both are served by the same Fastify
 * instance via @fastify/static.
 */
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
