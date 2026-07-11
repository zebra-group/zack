import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for `src/db.ts`'s exported `prisma` singleton (D-06 —
 * closes the gap flagged by REVIEW.md WR-01: no test previously imported
 * `db.ts` directly, so its fail-fast-vs-silent-fallback behavior around
 * `DATABASE_URL` was entirely unverified).
 *
 * `db.ts` reads `process.env.DATABASE_URL` at module-eval time and must
 * throw immediately if it is unset, instead of silently constructing a
 * `PrismaPg` adapter against an empty connection string. Each test
 * resets the module registry so `db.ts`'s top-level code re-runs against
 * a fresh `process.env.DATABASE_URL`, mirroring `prisma-generate.test.ts`'s
 * "construct with a syntactically-valid placeholder, no real connection
 * attempted" pattern — `PrismaPg`/`pg.Pool` connect lazily on first
 * query, so no DB is touched here either way.
 */
describe("db.ts prisma singleton (resolves WR-01 coverage gap)", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    vi.resetModules();
  });

  it("throws at import time when DATABASE_URL is unset (fail-fast, D-06)", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    await expect(import("../src/db.js")).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it("constructs the prisma singleton without throwing when DATABASE_URL is a valid placeholder", async () => {
    process.env.DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";
    vi.resetModules();

    const { prisma } = await import("../src/db.js");

    expect(prisma).toBeDefined();
  });
});
