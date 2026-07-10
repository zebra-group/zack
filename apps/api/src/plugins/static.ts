/**
 * @fastify/static wiring for the D-01 single-image SPA (Pattern 6).
 *
 * `wildcard: false` makes @fastify/static glob the actual files present in
 * `root` at registration time and register routes only for those — it does
 * NOT add a catch-all `GET /*` route. That catch-all behavior is exactly
 * what app.ts's `setNotFoundHandler` implements explicitly instead, so API
 * routes registered earlier can never be shadowed by the static plugin
 * (RESEARCH Anti-Patterns; T-01-10).
 */
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export async function registerStatic(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
  });
}
