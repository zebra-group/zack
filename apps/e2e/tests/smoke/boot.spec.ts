import { test, expect } from "@playwright/test";

/**
 * Boot smoke spec (INFRA-01 success criterion 1, phase 11 plan 03).
 *
 * Proves the E2E suite is provably hitting the built Docker image at
 * :3000 in production shape - never a split Vite/tsx dev server - which
 * is the only way to actually validate this project's Core Value (the
 * redirect handler behaving correctly *as deployed*). Two independent
 * pieces of evidence:
 *   1. `content-security-policy: default-src 'self'` - injected only by
 *      `@fastify/helmet` (apps/api/src/plugins/helmet.ts) on the real
 *      Fastify server; a bare Vite dev server on :5173 never emits this.
 *   2. The effective base URL resolves to a :3000 origin, not a :5173
 *      dev port.
 *
 * Deliberately auth-independent: uses only Playwright's `request` fixture
 * (APIRequestContext), no navigation, no storageState.
 */
test.describe("boot smoke", () => {
  test("hits the built Fastify image, not a dev server", async ({ request, baseURL }) => {
    const resolvedBaseURL = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
    expect(new URL(resolvedBaseURL).port).toBe("3000");

    const response = await request.get("/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });

    const csp = response.headers()["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });
});
