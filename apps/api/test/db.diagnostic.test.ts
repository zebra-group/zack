/**
 * Real-Postgres harness diagnostic (D-09, RESEARCH Pattern 5 / Pitfall 5).
 *
 * Proves the Wave 0 harness actually works before any feature-shaped test
 * relies on it:
 *   1. A raw `SELECT 1` round-trips against the testcontainers Postgres.
 *   2. A `PersistenceCanary` row can be written and read back — proving
 *      `prisma migrate deploy` actually ran against the container in
 *      globalSetup (RESEARCH "harness" row in the Phase Requirements →
 *      Test Map).
 *   3. `process.pid` is logged once (diagnostic only, not an assertion) to
 *      empirically confirm the single-shared-container assumption (A3) —
 *      see RESEARCH Pitfall 5 / Open Question 1.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";

describe("real-Postgres harness diagnostic (resolves A3)", () => {
  it("round-trips a raw SELECT 1 against the testcontainers Postgres", async () => {
    const rows = await prisma.$queryRawUnsafe<{ result: number }[]>("SELECT 1 AS result");

    expect(rows[0]?.result).toBe(1);
  });

  it("writes and reads back a PersistenceCanary row (confirms migrate deploy ran)", async () => {
    const token = `diagnostic-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await prisma.persistenceCanary.create({ data: { token } });
    const found = await prisma.persistenceCanary.findUnique({ where: { token } });

    expect(found?.token).toBe(token);
  });

  it("logs process.pid once (diagnostic only — empirically confirms A3, single shared container)", () => {
    // Not an assertion. RESEARCH Pitfall 5 / Open Question 1 flagged
    // Vitest globalSetup's per-worker-vs-shared-container semantics as
    // needing empirical confirmation (via this log line, cross-referenced
    // against test/tx-isolation.test.ts's own pid log) before committing
    // to more elaborate per-worker container plumbing.
    console.log(`[A3 diagnostic] db.diagnostic.test.ts running in worker pid=${process.pid}`);

    expect(true).toBe(true);
  });
});
