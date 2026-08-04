import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import {
  createE2eLink,
  CANARY_TARGET,
  assertNoLeak,
  BROWSER_UA,
  fetchWithFixtureRaceRetry,
} from "../../src/links.js";

/**
 * REDIRECT-E2E-03 (12-03-PLAN.md Task 2) — re-proves `routes/redirect.ts`'s
 * `state === "expired"` branch and `resolveLinkState`'s D-14 precedence (an
 * expired link is ALWAYS "expired", even if also password-protected) over
 * REAL HTTP against the built compose image. Mirrors
 * `apps/api/test/redirect.integration.test.ts`'s REDIR-03 case and its
 * "Precedence (D-14): expiry beats the password gate" case verbatim.
 *
 * Every request pins `Host: e2e.zack.local` (never localhost, CR-07) and an
 * explicit `BROWSER_UA` (Playwright's own default UA is bot-classified by the
 * installed isbot@5.2.0), so these requests exercise the real redirect
 * engine's human branch.
 */
test.describe("REDIRECT-E2E-03: expired link -> 410, distinct from 404, no leak", () => {
  test("an expired link returns 410 with no Location and no leak of its target", async ({ request }) => {
    const prisma = createE2ePrisma();
    try {
      // Wrapped in fetchWithFixtureRaceRetry (12-03-PLAN.md deviation, Rule
      // 1): db-isolation.spec.ts's concurrent Link-table truncates can wipe
      // this row between creation and the HTTP GET — retry with a fresh
      // fixture on an unexpected status.
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-expired-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: CANARY_TARGET,
            expiresAt: "2020-01-01",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 410,
      );

      expect(response.status()).toBe(410);
      expect(response.headers()["location"]).toBeUndefined();
      const body = await response.text();
      expect(body).toContain("Dieser Link ist abgelaufen");
      expect(body).toContain("HTTP 410 · Gone");
      expect(response.headers()["cache-control"]).toBe("no-store");
      assertNoLeak(body, response.headers(), CANARY_TARGET);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a guaranteed-missing slug returns a distinct 404, never the 410 expiry page", async ({ request }) => {
    const missingSlug = `redirect-missing-${randomUUID()}`;

    const response = await request.get(`/${missingSlug}`, {
      headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).toContain("Dieser Kurzlink existiert nicht");
  });

  test("an expired AND password-protected link returns 410, never the password page (D-14 precedence)", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      // Wrapped in fetchWithFixtureRaceRetry (12-03-PLAN.md deviation, Rule
      // 1): db-isolation.spec.ts's concurrent Link-table truncates can wipe
      // this row between creation and the HTTP GET — retry with a fresh
      // fixture on an unexpected status.
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-expired-protected-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: CANARY_TARGET,
            expiresAt: "2020-01-01",
            password: "correct-horse-battery",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 410,
      );

      expect(response.status()).toBe(410);
      const body = await response.text();
      expect(body).not.toContain("Dieser Link ist geschützt");
      assertNoLeak(body, response.headers(), CANARY_TARGET);
    } finally {
      await prisma.$disconnect();
    }
  });
});
