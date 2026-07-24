/**
 * Rate-limit E2E bypass tests (INFRA-06, T-11-01, T-11-02) — pins the three
 * behaviors the env-gated `x-e2e-bypass` allowList in `registerRateLimit`
 * must satisfy (11-02-PLAN.md Task 1/Task 2).
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres) via `buildApp({ prisma })`, mirroring
 * `canary.integration.test.ts`'s pattern. A fresh app is built per test
 * because `@fastify/rate-limit` buckets are per-instance (in-memory store) —
 * reusing one app across tests would let an earlier test's exhausted bucket
 * bleed into a later one. `process.env.E2E_RATE_LIMIT_BYPASS_SECRET` is
 * set/deleted per test and restored in `afterEach` so tests never leak env
 * state into each other or into later test files.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { envSchema } from "../src/env.js";
import { prisma } from "./setupFileEach.js";

const BYPASS_SECRET = "test-only-e2e-bypass-secret";
const PROBE_EMAIL = "ratelimit-probe@example.com";
const REQUEST_COUNT = 6; // MAGIC_LINK_RATE_LIMIT is 5/15min — the 6th request is the one that would trip it.

describe("Rate-limit E2E bypass (INFRA-06)", () => {
  const originalSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    } else {
      process.env.E2E_RATE_LIMIT_BYPASS_SECRET = originalSecret;
    }
  });

  it("Test A: a request carrying the correct x-e2e-bypass header is excluded from the magic-link limit", async () => {
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    const app = await buildApp({ prisma });

    try {
      for (let i = 0; i < REQUEST_COUNT; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/sign-in/magic-link",
          headers: { "x-e2e-bypass": BYPASS_SECRET },
          payload: { email: PROBE_EMAIL },
        });
        expect(res.statusCode).not.toBe(429);
      }
    } finally {
      await app.close();
    }
  });

  it("Test B: with the secret set but no header, the real per-route limit still returns 429", async () => {
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    const app = await buildApp({ prisma });

    try {
      let lastStatus = 0;
      for (let i = 0; i < REQUEST_COUNT; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/sign-in/magic-link",
          payload: { email: PROBE_EMAIL },
        });
        lastStatus = res.statusCode;
      }
      expect(lastStatus).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("Test C: with E2E_RATE_LIMIT_BYPASS_SECRET unset, a leaked x-e2e-bypass header does nothing (still 429)", async () => {
    delete process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    const app = await buildApp({ prisma });

    try {
      let lastStatus = 0;
      for (let i = 0; i < REQUEST_COUNT; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/sign-in/magic-link",
          headers: { "x-e2e-bypass": "anything" },
          payload: { email: PROBE_EMAIL },
        });
        lastStatus = res.statusCode;
      }
      expect(lastStatus).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe("E2E bypass secret is not a configurable production key", () => {
  it("E2E_RATE_LIMIT_BYPASS_SECRET is not a key of envSchema.shape", () => {
    expect(Object.keys(envSchema.shape)).not.toContain("E2E_RATE_LIMIT_BYPASS_SECRET");
  });
});
