import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import {
  createE2eLink,
  CANARY_TARGET,
  assertNoLeak,
  BOT_UA,
  BROWSER_UA,
  fetchWithFixtureRaceRetry,
} from "../../src/links.js";

/**
 * REDIRECT-E2E-04 (12-04-PLAN.md Task 1) — re-proves `routes/redirect.ts`'s
 * `if (bot)` branch (D-06: ALWAYS 200 `renderBotOgPage`, regardless of
 * expiry/password state, NEVER the target) over REAL HTTP against the built
 * compose image. Mirrors `apps/api/test/redirect.integration.test.ts`'s
 * REDIR-05 describe block (bot normal, bot+protected, bot+expired,
 * custom-OG, partial-OG, bot+protected-custom-OG) verbatim, adapted to
 * Playwright's `APIRequestContext`.
 *
 * Every request pins `Host: e2e.kurzly.local` (never localhost, per CR-07 —
 * 12-RESEARCH.md Pitfall 2) and an EXPLICIT `user-agent` — either the real
 * `BOT_UA` or `BROWSER_UA` — on every single request, bot and human alike.
 * Playwright's own default UA is itself bot-classified by the installed
 * isbot@5.2.0 (Pitfall 1), so omitting the header on the "human" half of the
 * bot-vs-human test would silently exercise the bot branch instead.
 */
test.describe("REDIRECT-E2E-04: bot/OG branching, gate-respect, no-leak", () => {
  test("bot UA gets 200 custom OG (never Location, never target); browser UA gets a real 302 to the exact target", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      // Wrapped in fetchWithFixtureRaceRetry (12-03-PLAN.md pattern, reused
      // per this plan's <important_note>): db-isolation.spec.ts's concurrent
      // Link-table truncates can wipe this row between creation and the
      // first HTTP request — retry with a fresh fixture on an unexpected
      // status.
      let slug = "";
      const botResponse = await fetchWithFixtureRaceRetry(
        async () => {
          slug = `redirect-bot-og-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: "https://real-target.example.com/",
            ogTitle: "Sommeraktion",
            ogDescription: "Bis zu 50% sparen",
            ogImageUrl: "https://cdn.example.com/og/sommer.png",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BOT_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 200,
      );

      expect(botResponse.status()).toBe(200);
      expect(botResponse.headers()["location"]).toBeUndefined();
      const botBody = await botResponse.text();
      expect(botBody).toContain('og:title" content="Sommeraktion"');
      expect(botBody).toContain('og:description" content="Bis zu 50% sparen"');
      expect(botBody).toContain('og:image" content="https://cdn.example.com/og/sommer.png"');
      assertNoLeak(botBody, botResponse.headers(), "https://real-target.example.com/");

      // Same slug, browser UA -> the real human 302 branch.
      const browserResponse = await request.get(`/${slug}`, {
        headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
        maxRedirects: 0,
      });
      expect(browserResponse.status()).toBe(302);
      expect(browserResponse.headers()["location"]).toBe("https://real-target.example.com/");
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a bot hit on a PASSWORD-PROTECTED link with custom OG still gets 200 with those values, never the password page, never the target", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-bot-og-protected-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: CANARY_TARGET,
            password: "correct-horse-battery",
            ogTitle: "Geheime Aktion",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BOT_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 200,
      );

      expect(response.status()).toBe(200);
      expect(response.headers()["location"]).toBeUndefined();
      const body = await response.text();
      expect(body).not.toContain("Dieser Link ist geschützt");
      expect(body).toContain('og:title" content="Geheime Aktion"');
      assertNoLeak(body, response.headers(), CANARY_TARGET);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a bot hit on an EXPIRED link with custom OG still gets 200 with those values, never the expiry page, never the target", async ({
    request,
  }) => {
    const prisma = createE2ePrisma();
    try {
      const response = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `redirect-bot-og-expired-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: CANARY_TARGET,
            expiresAt: "2020-01-01",
            ogTitle: "Abgelaufene Aktion",
          });
          return request.get(`/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BOT_UA },
            maxRedirects: 0,
          });
        },
        (r) => r.status() === 200,
      );

      expect(response.status()).toBe(200);
      expect(response.headers()["location"]).toBeUndefined();
      const body = await response.text();
      expect(body).not.toContain("Dieser Link ist abgelaufen");
      expect(body).toContain('og:title" content="Abgelaufene Aktion"');
      assertNoLeak(body, response.headers(), CANARY_TARGET);
    } finally {
      await prisma.$disconnect();
    }
  });
});
