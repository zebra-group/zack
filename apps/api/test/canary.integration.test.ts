/**
 * PersistenceCanary route integration tests (D-08, key_links) — the
 * walking skeleton's one real DB WRITE and READ against real Postgres,
 * exercised through the API (`fastify.inject`) rather than Prisma directly.
 *
 * Uses the SAME `prisma` client instance as `test/setupFileEach.ts`
 * (injected testcontainers `dbUrl`, pinned to `max: 1`), passed into
 * `buildApp({ prisma })` so the route's writes/reads run inside the exact
 * BEGIN/ROLLBACK transaction `setupFileEach.ts` wraps around this test —
 * this is what lets GET reflect rows written earlier in the SAME test
 * without leaking across tests/files (D-09).
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "./setupFileEach.js";

describe("POST /api/canary + GET /api/canary (real DB round-trip)", () => {
  it("POST /api/canary writes a PersistenceCanary row and returns { token, total }", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "POST", url: "/api/canary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.total).toBe(1);

    const stored = await prisma.persistenceCanary.findUnique({ where: { token: body.token } });
    expect(stored?.token).toBe(body.token);

    await app.close();
  });

  it("GET /api/canary reflects rows written earlier in the same test transaction", async () => {
    const app = await buildApp({ prisma });

    const postRes = await app.inject({ method: "POST", url: "/api/canary" });
    const postBody = postRes.json();

    const getRes = await app.inject({ method: "GET", url: "/api/canary" });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.total).toBe(1);
    expect(getBody.latest).toBe(postBody.token);

    await app.close();
  });

  it("two POSTs increment total by exactly 2", async () => {
    const app = await buildApp({ prisma });

    const before = (await app.inject({ method: "GET", url: "/api/canary" })).json();
    expect(before.total).toBe(0);

    await app.inject({ method: "POST", url: "/api/canary" });
    await app.inject({ method: "POST", url: "/api/canary" });

    const after = (await app.inject({ method: "GET", url: "/api/canary" })).json();
    expect(after.total - before.total).toBe(2);

    await app.close();
  });
});
