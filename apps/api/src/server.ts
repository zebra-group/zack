/**
 * Server entrypoint (D-06 fail-fast boot; D-01 single-image).
 *
 * Boot order: validate ENV first (`loadEnv()` prints formatted issues and
 * calls `process.exit(1)` on invalid config) BEFORE building or listening
 * on the Fastify app — so a misconfigured operator environment never
 * reaches the DB/SMTP layers (see env.ts). `app.js` (and, transitively,
 * db.ts's Prisma client construction) is imported dynamically so its
 * module-level code runs strictly after ENV has been validated, not
 * hoisted ahead of it.
 */
import { loadEnv } from "./env.js";

const env = loadEnv();

const { buildApp } = await import("./app.js");

const app = await buildApp({ nodeEnv: env.NODE_ENV });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
