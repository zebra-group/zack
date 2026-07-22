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
import { describe, expect, it, inject } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { prisma } from "./setupFileEach.js";

const CANARY_TOKEN = `tx-isolation-canary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const INTERACTIVE_TOKEN = `${CANARY_TOKEN}-interactive`;

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

/**
 * The canary above only ever exercises a PLAIN write. Production routes also
 * write through `prisma.$transaction` — and `routes/domains.ts` uses the
 * *interactive* form, which every domain-seeding test reaches. Postgres has no
 * nested transactions, so a naive per-test wrapper that opens its own `BEGIN`
 * gets committed out from under itself by the inner transaction's `COMMIT`,
 * turning the per-test rollback into a silent no-op and leaking rows into the
 * database other tests read. These two tests close that gap.
 */
describe("isolation holds for writes made through $transaction", () => {
  async function countCommitted(token: string): Promise<number> {
    // An independent connection can only ever observe COMMITTED rows, so a
    // non-zero count here means the write escaped this test's isolation.
    const observer = new PrismaClient({
      adapter: new PrismaPg({ connectionString: inject("dbUrl"), max: 1 }),
    });
    try {
      return await observer.persistenceCanary.count({ where: { token } });
    } finally {
      await observer.$disconnect();
    }
  }

  it("batch form does not commit its writes", async () => {
    const token = `${CANARY_TOKEN}-batch`;

    await prisma.$transaction([prisma.persistenceCanary.create({ data: { token } })]);

    expect(await countCommitted(token)).toBe(0);
  });

  it("interactive form does not commit its writes", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.persistenceCanary.create({ data: { token: INTERACTIVE_TOKEN } });
    });

    expect(await countCommitted(INTERACTIVE_TOKEN)).toBe(0);
  });

  it("does not see the interactive write from the previous test", async () => {
    const found = await prisma.persistenceCanary.findFirst({
      where: { token: INTERACTIVE_TOKEN },
    });

    expect(found).toBeNull();
  });
});
