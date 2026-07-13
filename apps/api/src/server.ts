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
 *
 * `dotenv/config` loads `.env` into `process.env` for local `pnpm dev`
 * (`tsx watch src/server.ts`), BEFORE `loadEnv()` reads it — mirroring
 * `.env.example`'s documented "copy to `.env`" workflow (WR-05). This is
 * a no-op in the Docker runtime image: `.env` is excluded via
 * `.dockerignore` and never copied into the container, so `dotenv`
 * silently finds nothing to load there and production continues to get
 * its config exclusively from real process env vars (`docker-compose.yml`'s
 * `env_file: .env` on the host, not a file inside the image).
 *
 * Phase 2 (D-01, RESEARCH Pitfall 1/A3): after ENV validation and before
 * the app starts accepting requests, `seedInitialAdmin` upserts a real
 * `User` row for `INITIAL_ADMIN_EMAIL` so `disableSignUp: true`
 * (lib/auth.ts) never locks out the first admin's own first login. `db.js`
 * is imported dynamically here for the same reason `app.js` already is —
 * its Prisma client construction must run strictly after `loadEnv()`.
 *
 * Phase 6 (D-12): after `app.listen` succeeds, a simple daily retention
 * scheduler (`setInterval` over `RETENTION_INTERVAL_MS` + one immediate
 * run at boot) prunes `ClickEvent`/`DailySalt` rows via `lib/retention.ts`
 * — the pruning FUNCTIONS are what the test suite exercises directly
 * against real Postgres (RESEARCH's Validation Architecture note); this
 * file only wires the timer, since `server.ts` is never imported by tests
 * (no isolation concern).
 */
import "dotenv/config";
import { loadEnv } from "./env.js";

const env = loadEnv();

const { prisma } = await import("./db.js");
const { seedInitialAdmin } = await import("./lib/admin-seed.js");
await seedInitialAdmin(prisma, env.INITIAL_ADMIN_EMAIL);

const { buildApp } = await import("./app.js");

const app = await buildApp({ nodeEnv: env.NODE_ENV, trustProxy: env.TRUST_PROXY });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

async function runRetentionPrune(): Promise<void> {
  const { pruneClickEvents, pruneDailySalts } = await import("./lib/retention.js");
  try {
    const [clickEventsDeleted, dailySaltsDeleted] = await Promise.all([
      pruneClickEvents(prisma),
      pruneDailySalts(prisma),
    ]);
    app.log.info({ clickEventsDeleted, dailySaltsDeleted }, "retention prune complete");
  } catch (err) {
    app.log.error(err, "retention prune failed");
  }
}

void runRetentionPrune();
setInterval(() => void runRetentionPrune(), RETENTION_INTERVAL_MS);
