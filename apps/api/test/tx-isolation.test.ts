/**
 * Transaction-rollback isolation canary (D-09, RESEARCH Pattern 5,
 * Assumption A4).
 *
 * Two sequential tests in one file:
 *   1. Writes a `PersistenceCanary` row with a distinctive token.
 *   2. Asserts that token is ABSENT — proving test 1's write was rolled
 *      back by `test/setupFileEach.ts`'s `afterEach` and did not leak into
 *      this test.
 *
 * A green result resolves A4 (Prisma's raw BEGIN/ROLLBACK works cleanly
 * through `@prisma/adapter-pg`'s connection pooling here because
 * `setupFileEach.ts` pins the pool to `max: 1`, guaranteeing every
 * statement in this file shares one physical connection/session). If this
 * ever goes red, the pool-size-1 mitigation in `setupFileEach.ts` needs to
 * be revisited before any broader test build-out relies on it.
 *
 * Also logs `process.pid` (diagnostic only) so it can be cross-referenced
 * against `test/db.diagnostic.test.ts`'s own pid log for A3.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";

const CANARY_TOKEN = `tx-isolation-canary-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("transaction-rollback isolation canary (resolves A4)", () => {
  it("writes a PersistenceCanary row with a distinctive token", async () => {
    console.log(`[A3 diagnostic] tx-isolation.test.ts running in worker pid=${process.pid}`);

    await prisma.persistenceCanary.create({ data: { token: CANARY_TOKEN } });

    const found = await prisma.persistenceCanary.findUnique({ where: { token: CANARY_TOKEN } });
    expect(found?.token).toBe(CANARY_TOKEN);
  });

  it("does not see the previous test's row — proves the rollback isolated it", async () => {
    const found = await prisma.persistenceCanary.findFirst({ where: { token: CANARY_TOKEN } });

    expect(found).toBeNull();
  });
});
