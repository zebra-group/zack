import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import { createE2eLink, BROWSER_UA, fetchWithFixtureRaceRetry } from "../../src/links.js";

/**
 * REDIRECT-E2E-05 (12-04-PLAN.md Task 2) — re-proves `routes/redirect.ts`'s
 * composition order (`applyUtmParams(link.targetUrl, link)` FIRST, then
 * `mergeQuery(utmTarget, forwarded)` only when `link.forwardQuery` is true)
 * over REAL HTTP against the built compose image, including the exact
 * canonical UTM ordering (`utm_source`, `utm_medium`, `utm_campaign`) proven
 * by `apps/api/test/redirect.integration.test.ts`'s own assertion string.
 *
 * Every request pins `Host: e2e.kurzly.local` (never localhost, per CR-07 —
 * 12-RESEARCH.md Pitfall 2) and the shared `BROWSER_UA` constant — a bot UA
 * would divert to the OG branch and never produce a `Location` header at
 * all (12-RESEARCH.md Pitfall 1).
 */
test.describe("REDIRECT-E2E-05: UTM + request-time query merge (exact ordering)", () => {
  test("owner UTM + visitor query merge correctly, in canonical order, on the final Location", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      // Wrapped in fetchWithFixtureRaceRetry (12-03-PLAN.md pattern, reused
      // per this plan's <important_note>): db-isolation.spec.ts's concurrent
      // Link-table truncates can wipe this row between creation and the
      // HTTP GET — retry with a fresh fixture on an unexpected status.
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-utm-merge-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: "https://campaign.example.com/landing",
            utmSource: "flyer",
            utmMedium: "print",
            utmCampaign: "sommer",
            forwardQuery: true,
          });
          return request.get(`/${slug}?extra=1`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 302,
      );

      expect(response.status()).toBe(302);
      const rawLocation = response.headers()["location"] as string;
      const location = new URL(rawLocation);

      expect(location.searchParams.get("utm_source")).toBe("flyer");
      expect(location.searchParams.get("utm_medium")).toBe("print");
      expect(location.searchParams.get("utm_campaign")).toBe("sommer");
      expect(location.searchParams.get("extra")).toBe("1");

      // Canonical ordering: utm_source before utm_medium before utm_campaign,
      // with the visitor's non-conflicting `extra` appended after — mirrors
      // applyUtmParams' delete-then-set append order.
      const search = location.search;
      const sourceIdx = search.indexOf("utm_source");
      const mediumIdx = search.indexOf("utm_medium");
      const campaignIdx = search.indexOf("utm_campaign");
      const extraIdx = search.indexOf("extra");
      expect(sourceIdx).toBeGreaterThanOrEqual(0);
      expect(mediumIdx).toBeGreaterThan(sourceIdx);
      expect(campaignIdx).toBeGreaterThan(mediumIdx);
      expect(extraIdx).toBeGreaterThan(campaignIdx);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("owner's UTM parameter overrides a stale same-named key already on the stored target (D-08-02)", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-utm-override-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: "https://campaign.example.com/landing?utm_source=stale",
            utmSource: "flyer",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 302,
      );

      expect(response.status()).toBe(302);
      const location = new URL(response.headers()["location"] as string);
      expect(location.searchParams.get("utm_source")).toBe("flyer");
    } finally {
      await prisma.$disconnect();
    }
  });

  test("forwardQuery off: a visitor's request-time query param is NOT forwarded to the target", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-utm-noforward-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: "https://campaign.example.com/lp?ref=static",
          });
          return request.get(`/${slug}?extra=1`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 302,
      );

      expect(response.status()).toBe(302);
      expect(response.headers()["location"]).toBe("https://campaign.example.com/lp?ref=static");
    } finally {
      await prisma.$disconnect();
    }
  });
});
