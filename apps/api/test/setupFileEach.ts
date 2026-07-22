/**
 * Per-file database isolation (D-09, RESEARCH Pattern 5) — layered on top of
 * globalSetup's shared testcontainers Postgres.
 *
 * Every test FILE gets its own database, cloned from the migrated template
 * database that globalSetup prepared (`CREATE DATABASE … TEMPLATE …` is a
 * file-level copy, so this stays cheap). Vitest evaluates this setup module
 * once per test file, so the name computed below is unique per file, and the
 * database is dropped again in `afterAll`.
 *
 * Why not a shared database with a per-test BEGIN/ROLLBACK wrapper (the
 * previous design): Postgres has no nested transactions. Production routes
 * write through `prisma.$transaction` — `routes/domains.ts` uses the
 * interactive form, which every domain-seeding test reaches — and that inner
 * transaction's COMMIT commits the wrapper's outer BEGIN along with it. The
 * afterEach ROLLBACK then finds no open transaction and silently does nothing,
 * so the rows persist into the database every other test file reads. Absolute
 * assertions (e.g. `expect(await prisma.link.count()).toBe(1)`) consequently
 * failed depending on which files happened to run first. `test/tx-isolation.
 * test.ts` is the canary that proves both directions of this; keep it green.
 *
 * Per-TEST isolation within a file is a TRUNCATE in `afterEach`. That is only
 * safe because the database belongs to this file alone — under the old shared
 * database it would have wiped other files' in-flight rows. It is also immune
 * to the nesting problem above, since it does not rely on transaction state.
 *
 * The pool stays pinned to `max: 1`: `@prisma/adapter-pg` issues one
 * `pool.query()` per statement, and a single physical connection keeps
 * session-scoped state predictable.
 */
import { afterAll, afterEach, beforeAll, inject } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

/** Unique per test file — Vitest re-evaluates this module for each one. */
const dbName = `t_${randomUUID().replace(/-/g, "")}`;

const templateUrl = new URL(inject("dbUrl"));
const templateName = decodeURIComponent(templateUrl.pathname.replace(/^\//, ""));

function urlForDatabase(name: string): string {
  const url = new URL(templateUrl);
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

/**
 * `CREATE DATABASE … TEMPLATE …` requires that no session is connected to the
 * template, so the admin connection deliberately targets the `postgres`
 * maintenance database rather than the template itself.
 */
const adminUrl = urlForDatabase("postgres");

export const prisma = new PrismaClient({
  // Lazy: Prisma does not connect until the first query, which cannot happen
  // before the beforeAll below has created the database.
  adapter: new PrismaPg({ connectionString: urlForDatabase(dbName), max: 1 }),
});

/** Tables to clear between tests — resolved once, excludes Prisma's own ledger. */
let truncateStatement: string | undefined;

async function withAdmin<T>(fn: (admin: PrismaClient) => Promise<T>): Promise<T> {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl, max: 1 }),
  });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    // Concurrent workers cloning the same template can transiently collide
    // ("source database is being accessed by other users"); retry briefly.
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await admin.$executeRawUnsafe(
          `CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`,
        );
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 50));
      }
    }
    throw lastError;
  });

  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );

  truncateStatement = tables.length
    ? `TRUNCATE TABLE ${tables
        .map((t) => `"public"."${t.tablename}"`)
        .join(", ")} RESTART IDENTITY CASCADE`
    : undefined;
});

afterEach(async () => {
  if (truncateStatement) {
    await prisma.$executeRawUnsafe(truncateStatement);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await withAdmin((admin) => admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`));
});
