/**
 * `recordClickHook` write-path integration suite (Phase 6, TRACK-02/03,
 * D-13/D-17) — the completion evidence that the redirect hot path records
 * exactly one privacy-safe `ClickEvent` per successful 302 on a
 * tracking-ON link, and LITERALLY NOTHING (a direct DB row-count of zero)
 * for a tracking-OFF link, a bot, an expired link, or a still-locked
 * protected link. Mirrors `redirect.integration.test.ts`'s harness shape
 * (`buildApp({ prisma })`, `seedDomainWithOwner`, real `createLink`/
 * `updateLink`, `BROWSER_UA`/`BOT_UA` constants) — reused verbatim per the
 * plan's `read_first`.
 *
 * These are RED tests (Task 1) — they fail against the current no-op
 * `recordClickHook` seam (zero writes ever, so the tracking-ON assertions
 * fail). Filling the hook's body turns them GREEN.
 */
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createLink, updateLink } from "../src/lib/links.js";
import { prisma } from "./setupFileEach.js";
import { getCountryForIp } from "../src/lib/geoip.js";

vi.mock("../src/lib/geoip.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/geoip.js")>();
  return { ...actual, getCountryForIp: vi.fn(actual.getCountryForIp) };
});

const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
/**
 * `light-my-request` defaults `user-agent` to `"lightMyRequest"` when a
 * test omits one, and `isbot("lightMyRequest")` is `true` — every "human
 * visitor" test below must set an explicit browser UA (mirrors
 * `redirect.integration.test.ts`'s own comment on this exact pitfall).
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

let userSeq = 0;

async function createTestUser(): Promise<string> {
  const id = `tracking-test-user-${userSeq++}`;
  await prisma.user.create({
    data: { id, name: id, email: `${id}@kurzly.test`, emailVerified: true },
  });
  return id;
}

async function seedOwnedDomain(userId: string, hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.kurzly.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

async function seedDomainWithOwner(hostname: string): Promise<{ userId: string; domainId: string }> {
  const userId = await createTestUser();
  const domainId = await seedOwnedDomain(userId, hostname);
  return { userId, domainId };
}

describe("recordClickHook write path (Phase 6, TRACK-02/03, D-13/D-17)", () => {
  describe("TRACK-02: tracking-OFF link writes literally zero rows", () => {
    it("returns 302 every time but leaves 0 ClickEvent rows and lifetimeClicks at 0 after N redirects", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-off.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "off",
        trackingEnabled: false,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      for (let i = 0; i < 3; i++) {
        const response = await app.inject({
          method: "GET",
          url: "/off",
          headers: { host: "tracking-off.example.com", "user-agent": BROWSER_UA },
        });
        expect(response.statusCode).toBe(302);
      }

      const count = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(count).toBe(0);
      const link = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(link.lifetimeClicks).toBe(0);
    });
  });

  describe("TRACK-03: tracking-ON link records one privacy-safe row per 302", () => {
    it("writes exactly 1 ClickEvent with source/visitorHash/referrerHost populated and increments lifetimeClicks", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-on.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "on",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await app.inject({
        method: "GET",
        url: "/on",
        headers: {
          host: "tracking-on.example.com",
          "user-agent": BROWSER_UA,
          referer: "https://ref.example.org/campaign",
        },
      });
      expect(response.statusCode).toBe(302);

      const events = await prisma.clickEvent.findMany({ where: { linkId: created.link.id } });
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe("link");
      expect(events[0].visitorHash).toBeTruthy();
      expect(events[0].referrerHost).toBe("ref.example.org");
      expect(typeof events[0].country === "string" || events[0].country === null).toBe(true);

      const link = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(link.lifetimeClicks).toBe(1);
    });

    it("records N rows and increments lifetimeClicks to N with no drift", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-on-n.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "onn",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const N = 4;
      for (let i = 0; i < N; i++) {
        const response = await app.inject({
          method: "GET",
          url: "/onn",
          headers: { host: "tracking-on-n.example.com", "user-agent": BROWSER_UA },
        });
        expect(response.statusCode).toBe(302);
      }

      const count = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(count).toBe(N);
      const link = await prisma.link.findUniqueOrThrow({ where: { id: created.link.id } });
      expect(link.lifetimeClicks).toBe(N);
    });
  });

  describe("D-11: toggling tracking off preserves prior events", () => {
    it("stops adding rows after trackingEnabled flips to false but keeps the ones already recorded", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-toggle.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "toggle",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await app.inject({
        method: "GET",
        url: "/toggle",
        headers: { host: "tracking-toggle.example.com", "user-agent": BROWSER_UA },
      });
      const countBeforeToggle = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(countBeforeToggle).toBe(1);

      await updateLink(prisma, created.link.id, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "toggle",
        trackingEnabled: false,
      });

      await app.inject({
        method: "GET",
        url: "/toggle",
        headers: { host: "tracking-toggle.example.com", "user-agent": BROWSER_UA },
      });

      const countAfterToggle = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(countAfterToggle).toBe(1);
    });
  });

  describe("Non-tracked branches never reach the write seam", () => {
    it("a bot UA on a tracked link writes zero ClickEvent rows", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-bot.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "bot",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await app.inject({
        method: "GET",
        url: "/bot",
        headers: { host: "tracking-bot.example.com", "user-agent": BOT_UA },
      });
      expect(response.statusCode).toBe(200);

      const count = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(count).toBe(0);
    });

    it("an expired link writes zero ClickEvent rows", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-expired.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "expired",
        expiresAt: "2020-01-01",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await app.inject({
        method: "GET",
        url: "/expired",
        headers: { host: "tracking-expired.example.com", "user-agent": BROWSER_UA },
      });
      expect(response.statusCode).toBe(410);

      const count = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(count).toBe(0);
    });

    it("a password-protected link with no unlock cookie writes zero ClickEvent rows", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-protected.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "protected",
        password: "correct-horse-battery",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { host: "tracking-protected.example.com", "user-agent": BROWSER_UA },
      });
      expect(response.statusCode).toBe(200);

      const count = await prisma.clickEvent.count({ where: { linkId: created.link.id } });
      expect(count).toBe(0);
    });
  });

  describe("Never-throw-into-hot-path (T-06-HOTPATH)", () => {
    it("still returns 302 when a downstream tracking helper throws", async () => {
      vi.mocked(getCountryForIp).mockRejectedValueOnce(new Error("simulated GeoIP failure"));

      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("tracking-fault.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "fault",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await app.inject({
        method: "GET",
        url: "/fault",
        headers: { host: "tracking-fault.example.com", "user-agent": BROWSER_UA },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://target.example.com/");
    });
  });
});
