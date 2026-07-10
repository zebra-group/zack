/**
 * Per-test isolation layer (D-09, RESEARCH Pattern 5) — layered on top of
 * globalSetup's shared testcontainers Postgres. Every test in every file
 * that imports `prisma` from this module runs inside a transaction opened
 * in `beforeEach` and rolled back in `afterEach`, so writes never leak
 * between tests without paying for a fresh container/schema per test.
 *
 * Sharp edge (RESEARCH Assumption A4): a Prisma driver adapter backed by a
 * default `pg.Pool` can route each query to a *different* physical
 * connection, which would send `ROLLBACK` to a connection that never ran
 * the matching `BEGIN` — silently defeating the isolation this file exists
 * to provide (`@prisma/adapter-pg`'s adapter calls `pool.query()` per
 * statement, and a pool with more than one connection does not guarantee
 * the same physical connection across calls). Pinning `max: 1` forces the
 * underlying pool to a single physical connection for this test file's
 * lifetime, so BEGIN/…/ROLLBACK always share one session.
 * `test/tx-isolation.test.ts` is the canary that empirically proves this
 * actually isolates data — resolve A4 there, don't assume it from this
 * comment alone.
 */
import { afterAll, afterEach, beforeEach, inject } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: inject("dbUrl"), max: 1 });

export const prisma = new PrismaClient({ adapter });

beforeEach(async () => {
  await prisma.$executeRawUnsafe("BEGIN");
});

afterEach(async () => {
  await prisma.$executeRawUnsafe("ROLLBACK");
});

afterAll(async () => {
  await prisma.$disconnect();
});
