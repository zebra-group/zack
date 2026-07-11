/**
 * TLS-check ask endpoint integration suite (D-01, DOMAIN-03 reformulated,
 * Pattern 3, T-03-04, T-03-05b) — proves `GET /api/tls-check` is the
 * operator-delegated status gate a reverse proxy (e.g. Caddy's
 * `on_demand_tls.ask`) queries before issuing a TLS certificate: 200 for an
 * active domain, 404 for anything else, empty body in both branches, no
 * session required, and a spoofed/substring host is rejected.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test, D-09) via
 * `buildApp({ prisma })`.
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "./setupFileEach.js";

describe("GET /api/tls-check (ask endpoint, D-01)", () => {
  it("returns 200 with an empty body for an active domain", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "active.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/tls-check?domain=active.example.com",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });

  it("returns 404 with an empty body for an unregistered domain", async () => {
    const app = await buildApp({ prisma });

    const response = await app.inject({
      method: "GET",
      url: "/api/tls-check?domain=unregistered.example.com",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
  });

  it("returns 404 for a pending domain (not yet verified)", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "pending.example.com",
        type: "subdomain",
        status: "pending",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/tls-check?domain=pending.example.com",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
  });

  it("returns 404 for a failed domain", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "failed.example.com",
        type: "subdomain",
        status: "failed",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/tls-check?domain=failed.example.com",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
  });

  it("returns 404 for a spoofed host that only contains a registered hostname as a substring", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "exact.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/tls-check?domain=exact.example.com.attacker.com",
    });

    expect(response.statusCode).toBe(404);
  });

  it("requires no session cookie (operator proxy calls this directly)", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "nosession.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/tls-check?domain=nosession.example.com",
      // Deliberately no `cookie` header at all.
    });

    expect(response.statusCode).toBe(200);
  });

  it("rate-limits rapid-fire requests (TLS_CHECK_RATE_LIMIT)", async () => {
    const app = await buildApp({ prisma });

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        app.inject({
          method: "GET",
          url: "/api/tls-check?domain=ratelimit.example.com",
        }),
      ),
    );

    const limited = results.filter((r) => r.statusCode === 429);
    expect(limited.length).toBeGreaterThan(0);
  });
});
