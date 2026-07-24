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
import { envSchema, parseEnv } from "../src/env.js";
import { prisma } from "./setupFileEach.js";

const BYPASS_SECRET = "test-only-e2e-bypass-secret";
const PROBE_EMAIL = "ratelimit-probe@example.com";
const REQUEST_COUNT = 6; // MAGIC_LINK_RATE_LIMIT is 5/15min — the 6th request is the one that would trip it.

describe("Rate-limit E2E bypass (INFRA-06)", () => {
  const originalSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  const originalOverlay = process.env.E2E_COMPOSE_OVERLAY;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    } else {
      process.env.E2E_RATE_LIMIT_BYPASS_SECRET = originalSecret;
    }
    if (originalOverlay === undefined) {
      delete process.env.E2E_COMPOSE_OVERLAY;
    } else {
      process.env.E2E_COMPOSE_OVERLAY = originalOverlay;
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

  it("Test D (CR-02, 11-REVIEW.md): with nodeEnv 'production', a correct x-e2e-bypass header does nothing (still 429) even though the secret is set", async () => {
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    const app = await buildApp({ prisma, nodeEnv: "production" });

    try {
      let lastStatus = 0;
      for (let i = 0; i < REQUEST_COUNT; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/sign-in/magic-link",
          headers: { "x-e2e-bypass": BYPASS_SECRET },
          payload: { email: PROBE_EMAIL },
        });
        lastStatus = res.statusCode;
      }
      expect(lastStatus).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("Test E (CR-05, 11-REVIEW.md iteration 2): with nodeEnv 'production' AND E2E_COMPOSE_OVERLAY set (the real docker-compose.e2e.yml shape), the bypass header works again", async () => {
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    process.env.E2E_COMPOSE_OVERLAY = "true";
    const app = await buildApp({ prisma, nodeEnv: "production" });

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

  // CR-06 (11-REVIEW.md, discovered via live E2E testing against the built
  // image — no unit test caught it because `buildApp({ prisma })` here
  // never passes `nodeEnv: "production"`, so better-auth's own
  // `enabled: options.rateLimit?.enabled ?? isProduction` default rate
  // limiter stayed OFF the whole time in every prior test in this file.
  // Live testing under NODE_ENV=production revealed better-auth's internal
  // rate limiter (a SEPARATE gate from this file's own `plugins/
  // rateLimit.ts`, with no knowledge of `x-e2e-bypass`) kept 429-ing an
  // already-tripped bucket even with the correct bypass header — exactly
  // reproducing the E2E spec's "already-tripped bucket" scenario
  // (apps/e2e/tests/smoke/rate-limit-bypass.spec.ts) that this file's own
  // Test A never covered (Test A always sends the header from the very
  // first request, never first exhausting the limit without it).
  it("Test F (CR-06): under nodeEnv 'production' + E2E_COMPOSE_OVERLAY (the real merged E2E env), an already-tripped bucket is still fully bypassed once the header is added", async () => {
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    process.env.E2E_COMPOSE_OVERLAY = "true";
    const app = await buildApp({ prisma, nodeEnv: "production" });

    try {
      // First, trip the bucket WITHOUT the header (mirrors Test B).
      for (let i = 0; i < REQUEST_COUNT; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/sign-in/magic-link",
          payload: { email: PROBE_EMAIL },
        });
        if (i === REQUEST_COUNT - 1) {
          expect(res.statusCode).toBe(429);
        }
      }

      // Now, against the SAME already-tripped bucket, every bypassed
      // request must succeed — including via better-auth's own internal
      // rate limiter, not just this file's `plugins/rateLimit.ts`.
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
});

describe("CR-05 regression: docker-compose.e2e.yml's exact merged boot env must not crash-loop", () => {
  // Shaped exactly like the merged environment scripts/e2e-compose.sh +
  // docker-compose.e2e.yml produce for the `app` service's real boot:
  // NODE_ENV=production (inherited from .env via docker-compose.yml's
  // env_file, INFRA-01) + a real E2E_RATE_LIMIT_BYPASS_SECRET (INFRA-06) +
  // the E2E_COMPOSE_OVERLAY marker literal hardcoded in
  // docker-compose.e2e.yml. This is the exact interaction that was missed
  // by testing WR-03 and CR-02's own fixes in isolation (11-REVIEW.md
  // iteration 2, CR-05) — asserted directly here so it can never regress
  // silently again.
  const E2E_COMPOSE_MERGED_ENV: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PORT: "3000",
    DATABASE_URL: "postgresql://kurzly:changeme@db:5432/kurzly",
    SMTP_HOST: "mailpit",
    SMTP_PORT: "1025",
    SMTP_SECURE: "false",
    SMTP_FROM: "no-reply@e2e.kurzly.local",
    BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "a".repeat(32),
    INITIAL_ADMIN_EMAIL: "admin@e2e.kurzly.local",
    E2E_RATE_LIMIT_BYPASS_SECRET: "some-generated-hex-secret",
    E2E_COMPOSE_OVERLAY: "true",
  };

  it("parseEnv() succeeds against the real merged docker-compose.e2e.yml env (no crash-loop)", () => {
    const result = parseEnv(E2E_COMPOSE_MERGED_ENV);

    expect(result.success).toBe(true);
  });

  it("parseEnv() still FAILS the same shape minus the E2E_COMPOSE_OVERLAY marker (real production stays protected)", () => {
    const { E2E_COMPOSE_OVERLAY, ...withoutOverlay } = E2E_COMPOSE_MERGED_ENV;
    void E2E_COMPOSE_OVERLAY;

    const result = parseEnv(withoutOverlay);

    expect(result.success).toBe(false);
  });
});

describe("E2E bypass secret is not a configurable production key", () => {
  it("E2E_RATE_LIMIT_BYPASS_SECRET is not a key of envSchema.shape", () => {
    expect(Object.keys(envSchema.shape)).not.toContain("E2E_RATE_LIMIT_BYPASS_SECRET");
  });
});
