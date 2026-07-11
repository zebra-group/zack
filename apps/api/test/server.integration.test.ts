/**
 * Server behavior integration tests (Pattern 6, T-01-10) — proves the
 * route-order correctness of `buildApp()`: API + health routes resolve
 * before the static SPA fallback, unknown `/api/*` paths return JSON-404
 * (never the SPA shell), and unknown non-API paths fall through to the SPA
 * shell (`index.html`, Vue Router history-mode fallback).
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("Fastify app route ordering (health, SPA fallback, 404, redirect stub)", () => {
  it("GET /health returns 200 { status: 'ok' }", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });

    await app.close();
  });

  it("GET /api/does-not-exist returns 404 with a JSON body (never the SPA shell)", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({ error: "Not Found" });

    await app.close();
  });

  it("GET /some/spa/route (non-API, unknown) serves index.html (SPA fallback)", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/some/spa/route" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<html");

    await app.close();
  });

  it("GET /:slug (redirect stub) returns its documented placeholder status, not a real redirect", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/some-slug" });

    expect(res.statusCode).toBe(404);
    expect(res.headers.location).toBeUndefined();
    const body = res.json();
    expect(body.message).toMatch(/Phase 5/);

    await app.close();
  });

  it("GET /api/auth/get-session reaches the better-auth handler (JSON response), never the SPA shell (Pitfall 5)", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/auth/get-session" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).not.toContain("<html");

    await app.close();
  });

  it("WR-02: trustProxy:true derives request.ip from X-Forwarded-For (reverse-proxy topology)", async () => {
    const app = await buildApp({ trustProxy: true });
    let observedIp: string | undefined;
    app.addHook("onRequest", async (request) => {
      observedIp = request.ip;
    });

    await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });

    expect(observedIp).toBe("203.0.113.7");

    await app.close();
  });

  it("WR-02: trustProxy left unset (default false) ignores X-Forwarded-For — no shared rate-limit bucket by default", async () => {
    const app = await buildApp();
    let observedIp: string | undefined;
    app.addHook("onRequest", async (request) => {
      observedIp = request.ip;
    });

    await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });

    expect(observedIp).not.toBe("203.0.113.7");

    await app.close();
  });
});
