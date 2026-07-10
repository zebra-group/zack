/**
 * Dev-only CORS (D-01, T-01-12).
 *
 * Production is single-origin: Fastify serves `/api/*`, the redirect
 * handler, and the built Vue SPA from one origin (D-01), so CORS is not
 * needed in production and is never registered there. In development the
 * Vite dev server runs on a separate origin/port and needs cross-origin
 * access to this API, so `@fastify/cors` is registered only when
 * `nodeEnv !== 'production'`.
 */
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

export async function registerCors(app: FastifyInstance, nodeEnv: string): Promise<void> {
  if (nodeEnv === "production") return;
  await app.register(cors, { origin: true });
}
