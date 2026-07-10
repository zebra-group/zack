import { describe, expect, it } from "vitest";

/**
 * Regression guard for RESEARCH Pitfall 1: pnpm 11's build-script gate can
 * silently block Prisma's postinstall `prisma generate` hook, leaving
 * `apps/api/src/generated/prisma` missing while `pnpm install` still exits
 * 0. This is a fast unit test (no testcontainers, no DB connection) that
 * fails loudly the moment the generated client module fails to resolve.
 *
 * NOTE: Prisma 7.8.0's `PrismaClientOptions` requires either a driver
 * `adapter` or an `accelerateUrl` (see apps/api/src/db.ts for the full
 * explanation) — `new PrismaClient()` with no arguments no longer
 * type-checks, so this test constructs via `@prisma/adapter-pg` with a
 * syntactically-valid placeholder connection string. `PrismaPg`/`pg.Pool`
 * connect lazily on first query, so no DB connection is attempted here.
 */
describe("generated Prisma client resolves (Pitfall 1 guard)", () => {
  it("resolves the generated client module and exposes a PrismaClient constructor", async () => {
    const clientModule = await import("../src/generated/prisma/client.js");
    expect(clientModule.PrismaClient).toBeTypeOf("function");
  });

  it("constructs PrismaClient without throwing (no DB connection attempted)", async () => {
    const { PrismaClient } = await import("../src/generated/prisma/client.js");
    const { PrismaPg } = await import("@prisma/adapter-pg");

    const adapter = new PrismaPg("postgresql://placeholder:placeholder@localhost:5432/placeholder");

    expect(() => new PrismaClient({ adapter })).not.toThrow();
  });
});
