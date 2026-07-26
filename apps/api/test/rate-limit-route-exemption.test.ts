/**
 * Rate-limit route-exemption tests (D-17-05-02 — resolves the two residual
 * full-E2E-suite 429 failures left after c43adc3's x-e2e-bypass header
 * mechanism).
 *
 * ROOT CAUSE (see .planning/debug/e2e-rate-limit-429.md): `registerRateLimit`
 * installs a `global: true, max: 100, timeWindow: "15 minutes"` default
 * bucket that applies to EVERY route without a per-route `config.rateLimit`
 * override — including `GET /health` and the entire `/api/auth/*` wildcard
 * (the OIDC sign-in initiation + callback). In the docker E2E stack every
 * host->app request arrives via ~one Docker-gateway source IP, so the whole
 * suite's header-less request volume drains this single per-IP bucket. Once
 * exhausted:
 *   - `GET /health` (boot.spec.ts, hit via Playwright's header-less `request`
 *     fixture) returns 429 instead of 200 (failure 1); and
 *   - the OIDC callback (a third-party mock-IdP browser redirect that cannot
 *     carry the `x-e2e-bypass` header) is 429'd before better-auth's own
 *     reject-and-redirect logic runs, so the SSO flow never reaches
 *     /auth/error (failure 2).
 *
 * The `x-e2e-bypass` allowList (INFRA-06) only exempts requests that CARRY
 * the header, so it structurally cannot cover either header-less case.
 *
 * FIX (asserted by this file):
 *   1. `GET /health` gets `config: { rateLimit: false }` UNCONDITIONALLY — a
 *      liveness probe must never be throttled in ANY environment (this is a
 *      genuine production-correctness fix, not just a test accommodation).
 *   2. Under `isE2EComposeOverlay(process.env)` ONLY, `registerRateLimit`
 *      registers with `global: false`, dropping the blanket global default
 *      bucket for the E2E overlay while KEEPING every per-route override
 *      (`MAGIC_LINK_RATE_LIMIT` etc.) and the `allowList`. Production keeps
 *      `global: true, max: 100` byte-identical.
 *
 * SAFETY: the enforcement specs (test/rate-limit-bypass.test.ts,
 * apps/e2e/.../rate-limit-bypass.spec.ts, resend-rate-limit.spec.ts) all
 * target `POST /api/auth/sign-in/magic-link`, which has its OWN
 * `config: { rateLimit: MAGIC_LINK_RATE_LIMIT }` (5/15min) — independent of
 * the global default. The "enforcement preserved" cases below pin that this
 * per-route 429 survives the `global: false` E2E reconfiguration, and the
 * "production unchanged" case pins that the global default bucket is still
 * active in real production.
 *
 * Runs against setupFileEach.ts's transaction-wrapped testcontainers Postgres
 * via buildApp({ prisma }), mirroring rate-limit-bypass.test.ts. A fresh app
 * is built per test because @fastify/rate-limit buckets are per-instance.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "./setupFileEach.js";

const BYPASS_SECRET = "test-only-e2e-bypass-secret";
// One past the global default (max: 100) so the bucket is provably exhausted
// for any endpoint still subject to it.
const EXHAUST_COUNT = 120;
const PROBE_EMAIL = "ratelimit-exemption-probe@example.com";

describe("Rate-limit route exemptions (D-17-05-02)", () => {
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

  it("Failure 1: GET /health is never rate-limited, even after the global bucket is exhausted (unconditional exemption)", async () => {
    // Default (development) app, no bypass secret — the plain global limiter.
    delete process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    delete process.env.E2E_COMPOSE_OVERLAY;
    const app = await buildApp({ prisma });

    try {
      const statuses: number[] = [];
      for (let i = 0; i < EXHAUST_COUNT; i += 1) {
        const res = await app.inject({ method: "GET", url: "/health" });
        statuses.push(res.statusCode);
      }
      // Pre-fix: /health falls under the global bucket, so request #101+ are
      // 429 (RED). Post-fix: `config: { rateLimit: false }` exempts it, so
      // every request is 200.
      expect(statuses.every((s) => s === 200)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("Failure 2: under the E2E compose overlay, header-less /api/auth/* requests (the OIDC callback's route class) are NOT globally rate-limited", async () => {
    // Mirror the real docker-compose.e2e.yml boot: NODE_ENV=production +
    // E2E_COMPOSE_OVERLAY marker + a bypass secret present. get-session is
    // served by the SAME `/api/auth/*` wildcard as the OIDC callback and has
    // no per-route override, so it is a faithful stand-in for the
    // header-less browser-navigation callback the suite cannot bypass.
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    process.env.E2E_COMPOSE_OVERLAY = "true";
    const app = await buildApp({ prisma, nodeEnv: "production" });

    try {
      const statuses: number[] = [];
      for (let i = 0; i < EXHAUST_COUNT; i += 1) {
        // Deliberately NO x-e2e-bypass header — exactly what a mock-IdP
        // browser redirect to the callback looks like.
        const res = await app.inject({ method: "GET", url: "/api/auth/get-session" });
        statuses.push(res.statusCode);
      }
      // Pre-fix: global:true means #101+ are 429 (RED). Post-fix: global:false
      // under the overlay means the blanket bucket is gone, so none 429.
      expect(statuses.some((s) => s === 429)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("Enforcement preserved: under the E2E overlay, the magic-link per-route limit STILL returns 429 on the 6th no-header request", async () => {
    // The `global: false` reconfiguration must not disable per-route
    // overrides — the enforcement specs depend on this exact 429.
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    process.env.E2E_COMPOSE_OVERLAY = "true";
    const app = await buildApp({ prisma, nodeEnv: "production" });

    try {
      let lastStatus = 0;
      for (let i = 0; i < 6; i += 1) {
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

  it("Enforcement preserved: under the E2E overlay, a correct x-e2e-bypass header still bypasses the magic-link per-route limit", async () => {
    process.env.E2E_RATE_LIMIT_BYPASS_SECRET = BYPASS_SECRET;
    process.env.E2E_COMPOSE_OVERLAY = "true";
    const app = await buildApp({ prisma, nodeEnv: "production" });

    try {
      for (let i = 0; i < 6; i += 1) {
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

  it("Production unchanged: without the E2E overlay marker, the global default bucket is still active (header-less /api/auth/* requests 429 after exhaustion)", async () => {
    // A real production boot: NODE_ENV=production and NO overlay marker. The
    // fix must be E2E-gated, so the global:true default bucket still applies.
    delete process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    delete process.env.E2E_COMPOSE_OVERLAY;
    const app = await buildApp({ prisma, nodeEnv: "production" });

    try {
      const statuses: number[] = [];
      for (let i = 0; i < EXHAUST_COUNT; i += 1) {
        const res = await app.inject({ method: "GET", url: "/api/auth/get-session" });
        statuses.push(res.statusCode);
      }
      expect(statuses.some((s) => s === 429)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
