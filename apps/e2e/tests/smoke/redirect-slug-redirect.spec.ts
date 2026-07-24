import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import { createE2eLink, BROWSER_UA, fetchWithFixtureRaceRetry } from "../../src/links.js";

/**
 * REDIRECT-E2E-01 (12-03-PLAN.md Task 1) — re-proves `routes/redirect.ts`'s
 * `GET /:slug` happy-path redirect over REAL HTTP against the built compose
 * image, the one thing `fastify.inject` structurally cannot prove (real TCP,
 * real Host resolution). Mirrors `apps/api/test/redirect.integration.test.ts`'s
 * REDIR-01 case and its Reflected-XSS-guard case verbatim, adapted to
 * Playwright's `APIRequestContext`.
 *
 * Every request pins `Host: e2e.kurzly.local` (never localhost, per CR-07 —
 * 12-RESEARCH.md Pitfall 2) and an explicit `BROWSER_UA` (Playwright's own
 * default UA is itself bot-classified by the installed isbot@5.2.0 — Pitfall
 * 1), so these requests exercise the real redirect engine's human branch, not
 * the SPA fallback or the bot/OG branch.
 */
test.describe("REDIRECT-E2E-01: slug -> target happy-path redirect", () => {
  test("returns 302 with the exact stored target and Cache-Control: no-store", async ({ request }) => {
    const prisma = createE2ePrisma();
    try {
      // Wrapped in fetchWithFixtureRaceRetry (12-03-PLAN.md deviation, Rule
      // 1): db-isolation.spec.ts's concurrent Link-table truncates can wipe
      // this row between creation and the HTTP GET — retry with a fresh
      // fixture on an unexpected status.
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-happy-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: "https://destination.example.com/landing",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 302,
      );

      expect(response.status()).toBe(302);
      expect(response.headers()["location"]).toBe("https://destination.example.com/landing");
      expect(response.headers()["cache-control"]).toBe("no-store");
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a script-injection slug renders an entity-escaped branded 404 body (Reflected-XSS guard, V5)", async ({
    request,
  }) => {
    const payload = "<script>alert(1)</script>";

    const response = await request.get(`/${encodeURIComponent(payload)}`, {
      headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });
});
