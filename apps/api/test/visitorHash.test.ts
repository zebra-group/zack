/**
 * Daily-rotating salted visitor hash unit suite (Phase 6, 06-03-PLAN.md
 * Task 1, D-06/D-08).
 *
 * `computeVisitorHash` is a pure Node-builtin (`node:crypto` HMAC-SHA256)
 * transform with zero DB access — tested with plain fixtures, mirroring
 * `test/redirectEngine.test.ts`'s pure-function shape.
 *
 * `resolveDailySalt` DOES touch the database (`DailySalt` table, added in
 * 06-02) — it takes an injectable `prisma` parameter, so these assertions
 * run against `setupFileEach.ts`'s transaction-wrapped real-Postgres client
 * (D-09), matching `test/domainResolution.test.ts`'s harness usage.
 *
 * Covers:
 * - computeVisitorHash: deterministic HMAC-SHA256 hex digest; differs when
 *   salt differs (same ip+ua+linkId across two distinct salts -> two
 *   distinct hashes = the rotation proof); raw ip/ua never appear in output
 * - resolveDailySalt: idempotent within a UTC day; race-safe on a
 *   simulated unique-constraint collision (re-reads the winner, never
 *   throws into the caller)
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeVisitorHash, resolveDailySalt } from "../src/lib/visitorHash.js";
import { prisma } from "./setupFileEach.js";

describe("computeVisitorHash (D-06, HMAC-SHA256, hex digest)", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeVisitorHash("salt-a", "203.0.113.5", "Mozilla/5.0", "link_1");
    const b = computeVisitorHash("salt-a", "203.0.113.5", "Mozilla/5.0", "link_1");
    expect(a).toBe(b);
  });

  it("differs when the daily salt differs (rotation proof) — same ip+ua+linkId, two distinct salts", () => {
    const dayOne = computeVisitorHash("salt-day-1", "203.0.113.5", "Mozilla/5.0", "link_1");
    const dayTwo = computeVisitorHash("salt-day-2", "203.0.113.5", "Mozilla/5.0", "link_1");
    expect(dayOne).not.toBe(dayTwo);
  });

  it("differs when the ip differs (same salt/ua/linkId)", () => {
    const a = computeVisitorHash("salt-a", "203.0.113.5", "Mozilla/5.0", "link_1");
    const b = computeVisitorHash("salt-a", "198.51.100.9", "Mozilla/5.0", "link_1");
    expect(a).not.toBe(b);
  });

  it("differs when the linkId differs (same salt/ip/ua) — hash is scoped per link", () => {
    const a = computeVisitorHash("salt-a", "203.0.113.5", "Mozilla/5.0", "link_1");
    const b = computeVisitorHash("salt-a", "203.0.113.5", "Mozilla/5.0", "link_2");
    expect(a).not.toBe(b);
  });

  it("produces a hex HMAC-SHA256 digest (64 lowercase hex chars) matching a direct node:crypto computation", () => {
    const salt = "salt-a";
    const ip = "203.0.113.5";
    const ua = "Mozilla/5.0";
    const linkId = "link_1";
    const expected = createHmac("sha256", salt).update(`${ip}|${ua}|${linkId}`).digest("hex");
    const actual = computeVisitorHash(salt, ip, ua, linkId);
    expect(actual).toBe(expected);
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never leaks the raw ip or user-agent in the output digest", () => {
    const result = computeVisitorHash("salt-a", "203.0.113.5", "Mozilla/5.0", "link_1");
    expect(result).not.toContain("203.0.113.5");
    expect(result).not.toContain("Mozilla");
  });
});

describe("resolveDailySalt (D-08, idempotent per UTC day, race-safe)", () => {
  it("creates one DailySalt row on the first call of a UTC day", async () => {
    const value = await resolveDailySalt(prisma);
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);

    const count = await prisma.dailySalt.count();
    expect(count).toBe(1);
  });

  it("a second call the same day returns the identical value (no second row)", async () => {
    const first = await resolveDailySalt(prisma);
    const second = await resolveDailySalt(prisma);
    expect(second).toBe(first);

    const count = await prisma.dailySalt.count();
    expect(count).toBe(1);
  });

  it("returns a random 32-byte hex value (64 hex chars) when creating a fresh salt", async () => {
    const value = await resolveDailySalt(prisma);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("re-reads the winner rather than throwing on a simulated create-race (unique constraint on date)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Simulate a concurrent winner having already created today's row.
    await prisma.dailySalt.create({ data: { date: today, value: "existing-winner-value" } });

    const resolved = await resolveDailySalt(prisma);
    expect(resolved).toBe("existing-winner-value");

    const count = await prisma.dailySalt.count();
    expect(count).toBe(1);
  });
});
