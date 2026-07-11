/**
 * Dev-only CORS (D-01, T-01-12).
 *
 * Production is single-origin: Fastify serves `/api/*`, the redirect
 * handler, and the built Vue SPA from one origin (D-01), so CORS is not
 * needed in production and is never registered there. In development the
 * Vite dev server runs on a separate origin/port and needs cross-origin
 * access to this API, so `@fastify/cors` is registered only when
 * `nodeEnv` is a known non-production value.
 *
 * Opt-in (allowlist known dev/test values) rather than opt-out (block only
 * `"production"`), so an unset/unrecognized `NODE_ENV` fails safe to "no
 * CORS" instead of silently defaulting to permissive `origin: true` (WR-07).
 * The Dockerfile bakes `ENV NODE_ENV=production` into the image, but this
 * guard also protects any other way the built server could be run
 * (bare-metal, PM2, systemd) without `NODE_ENV` explicitly set.
 */
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

const CORS_ENABLED_NODE_ENVS = new Set(["development", "test"]);

export async function registerCors(app: FastifyInstance, nodeEnv: string): Promise<void> {
  if (!CORS_ENABLED_NODE_ENVS.has(nodeEnv)) return;
  await app.register(cors, { origin: true });
}
