/**
 * Redirect-precedence-engine integration suite (Phase 5, D-14, REDIR-01..05,
 * UI-04/UI-05) — the completion evidence for `routes/redirect.ts`'s
 * `GET /:slug` + `POST /:slug/verify` engine: host-scoped resolution ->
 * expiry (410) -> password-gate -> bot/OG branch -> 302 redirect, with a
 * no-leak canary proving a protected/expired target NEVER appears in any
 * pre-unlock response body or header.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test, D-09) via
 * `buildApp({ prisma })`, mirroring `tlsCheck.integration.test.ts`'s
 * `app.inject({ headers: { host } })` shape. Fixtures are built through the
 * REAL `createLink`/`updateLink` service (D-01) — never a raw
 * `prisma.link.create` — plus `prisma.domain.create`/`prisma.user.create`/
 * `prisma.domainMembership.create` for the owning fixtures those functions
 * require.
 *
 * These are RED tests (Task 1) — they fail against the Phase 1 stub (a bare
 * JSON 404 with no host/slug resolution, no password gate, no expiry
 * check). Task 2 implements `routes/redirect.ts` to turn them GREEN.
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createLink, updateLink } from "../src/lib/links.js";
import { prisma } from "./setupFileEach.js";

/**
 * A distinctive target-URL constant used as (part of) a protected/expired
 * link's `targetUrl` in every no-leak assertion below — if this string EVER
 * appears in a pre-unlock response's body or ANY header value, the no-leak
 * guarantee (D-14, T-05-NOLEAK) has been violated.
 */
const CANARY_TARGET = "https://canary-leak-marker.example.net/super-secret-target-xyz123";

const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let userSeq = 0;

/** Creates a real `User` row (DomainMembership's FK target) — not a full auth session, redirect tests don't need one. */
async function createTestUser(): Promise<string> {
  const id = `redirect-test-user-${userSeq++}`;
  await prisma.user.create({
    data: { id, name: id, email: `${id}@kurzly.test`, emailVerified: true },
  });
  return id;
}

/** Creates an ACTIVE Domain + owner DomainMembership for `userId` (mirrors links.integration.test.ts's seedOwnedDomain). */
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

/** Builds a fresh owner + active domain, ready for createLink calls. */
async function seedDomainWithOwner(hostname: string): Promise<{ userId: string; domainId: string }> {
  const userId = await createTestUser();
  const domainId = await seedOwnedDomain(userId, hostname);
  return { userId, domainId };
}

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value (mirrors links.integration.test.ts). */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/**
 * Asserts `canary` appears in NEITHER the response body NOR any header
 * value — the phase's single highest-value security check (D-14, T-05-NOLEAK).
 */
function assertNoLeak(
  response: { body: string; headers: Record<string, unknown> },
  canary: string,
): void {
  expect(response.body).not.toContain(canary);
  for (const value of Object.values(response.headers)) {
    const stringValue = Array.isArray(value) ? value.join(";") : String(value ?? "");
    expect(stringValue).not.toContain(canary);
  }
}

describe("Redirect precedence engine (Phase 5, REDIR-01..05, D-14)", () => {
  describe("REDIR-01: valid link -> 302 to the exact stored target", () => {
    it("returns 302 with the exact target and Cache-Control: no-store", async () => {
      const app = await buildApp({ prisma });
      const { userId, domainId } = await seedDomainWithOwner("valid-link.example.com");
      const result = await createLink(prisma, {
        userId,
        domainId,
        targetUrl: "https://destination.example.com/landing",
        slug: "go",
      });
      expect(result.ok).toBe(true);

      const response = await app.inject({
        method: "GET",
        url: "/go",
        headers: { host: "valid-link.example.com" },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://destination.example.com/landing");
      expect(response.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("REDIR-02: host-scoped resolution", () => {
    it("resolves the same slug independently on two different domains", async () => {
      const app = await buildApp({ prisma });
      const seedA = await seedDomainWithOwner("promo-a.example.com");
      const seedB = await seedDomainWithOwner("promo-b.example.com");
      await createLink(prisma, {
        userId: seedA.userId,
        domainId: seedA.domainId,
        targetUrl: "https://target-a.example.com/",
        slug: "promo",
      });
      await createLink(prisma, {
        userId: seedB.userId,
        domainId: seedB.domainId,
        targetUrl: "https://target-b.example.com/",
        slug: "promo",
      });

      const responseA = await app.inject({
        method: "GET",
        url: "/promo",
        headers: { host: "promo-a.example.com" },
      });
      const responseB = await app.inject({
        method: "GET",
        url: "/promo",
        headers: { host: "promo-b.example.com" },
      });

      expect(responseA.headers.location).toBe("https://target-a.example.com/");
      expect(responseB.headers.location).toBe("https://target-b.example.com/");
    });

    it("returns the generic 404 page for an unregistered/inactive host, never a cross-domain match", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("registered-only.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "promo",
      });

      const response = await app.inject({
        method: "GET",
        url: "/promo",
        headers: { host: "unregistered-host.example.com" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toContain("Dieser Kurzlink existiert nicht");
    });
  });

  describe("REDIR-03: expired link -> 410, no Location, no leak", () => {
    it("returns 410 with the branded expiry copy, no Location header, and the canary absent", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("expired-link.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: CANARY_TARGET,
        slug: "old",
        expiresAt: "2020-01-01",
      });

      const response = await app.inject({
        method: "GET",
        url: "/old",
        headers: { host: "expired-link.example.com" },
      });

      expect(response.statusCode).toBe(410);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain("Dieser Link ist abgelaufen");
      expect(response.body).toContain("HTTP 410 · Gone");
      expect(response.headers["cache-control"]).toBe("no-store");
      assertNoLeak(response, CANARY_TARGET);
    });
  });

  describe("REDIR-04: password-protected link", () => {
    it("GET shows the password page with the target absent (no leak)", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("protected-link.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: CANARY_TARGET,
        slug: "secret",
        password: "correct-horse-battery",
      });

      const response = await app.inject({
        method: "GET",
        url: "/secret",
        headers: { host: "protected-link.example.com" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Dieser Link ist geschützt");
      expect(response.headers["cache-control"]).toBe("no-store");
      assertNoLeak(response, CANARY_TARGET);
    });

    it("POST with the wrong password re-shows the page with the LOCKED inline error, still no leak", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("protected-wrong.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: CANARY_TARGET,
        slug: "secret",
        password: "correct-horse-battery",
      });

      const response = await app.inject({
        method: "POST",
        url: "/secret/verify",
        headers: { host: "protected-wrong.example.com" },
        payload: { password: "wrong-guess" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Falsches Passwort. Bitte erneut versuchen.");
      assertNoLeak(response, CANARY_TARGET);
    });

    it("POST with the correct password sets an unlock cookie and 302s; a subsequent GET with that cookie does not re-prompt; the cookie stops working after the password changes", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("protected-correct.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://unlocked-target.example.com/",
        slug: "secret",
        password: "correct-horse-battery",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/secret/verify",
        headers: { host: "protected-correct.example.com" },
        payload: { password: "correct-horse-battery" },
      });

      expect(verifyResponse.statusCode).toBe(302);
      expect(verifyResponse.headers.location).toBe("https://unlocked-target.example.com/");
      expect(verifyResponse.headers["set-cookie"]).toBeDefined();

      const cookieHeader = toCookieHeader(verifyResponse.headers["set-cookie"]);

      const secondGet = await app.inject({
        method: "GET",
        url: "/secret",
        headers: { host: "protected-correct.example.com", cookie: cookieHeader },
      });
      expect(secondGet.statusCode).toBe(302);
      expect(secondGet.headers.location).toBe("https://unlocked-target.example.com/");

      // Password rotated -> the previously-issued cookie must stop unlocking
      // (self-invalidating unlock cookie, D-07/D-08).
      await updateLink(prisma, created.link.id, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://unlocked-target.example.com/",
        slug: "secret",
        password: "new-password-after-rotation",
      });

      const staleCookieGet = await app.inject({
        method: "GET",
        url: "/secret",
        headers: { host: "protected-correct.example.com", cookie: cookieHeader },
      });
      expect(staleCookieGet.statusCode).toBe(200);
      expect(staleCookieGet.body).toContain("Dieser Link ist geschützt");
    });
  });

  describe("Precedence (D-14): expiry beats the password gate", () => {
    it("an expired AND password-protected link returns 410, never the password page", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("expired-protected.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: CANARY_TARGET,
        slug: "both",
        password: "correct-horse-battery",
        expiresAt: "2020-01-01",
      });

      const response = await app.inject({
        method: "GET",
        url: "/both",
        headers: { host: "expired-protected.example.com" },
      });

      expect(response.statusCode).toBe(410);
      expect(response.body).not.toContain("Dieser Link ist geschützt");
      assertNoLeak(response, CANARY_TARGET);
    });
  });

  describe("REDIR-05: bot/crawler branch (D-05/D-06)", () => {
    it("a bot UA on a normal link gets a 200 generic-OG page, never a 302", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("bot-normal.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://real-target.example.com/",
        slug: "botlink",
      });

      const response = await app.inject({
        method: "GET",
        url: "/botlink",
        headers: { host: "bot-normal.example.com", "user-agent": BOT_UA },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain("og:title");
      assertNoLeak(response, "https://real-target.example.com/");
    });

    it("a bot UA on a protected AND an expired link both get generic OG, never the target, never a redirect", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("bot-protected-expired.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: CANARY_TARGET,
        slug: "botprotected",
        password: "correct-horse-battery",
      });
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: CANARY_TARGET,
        slug: "botexpired",
        expiresAt: "2020-01-01",
      });

      const protectedResponse = await app.inject({
        method: "GET",
        url: "/botprotected",
        headers: { host: "bot-protected-expired.example.com", "user-agent": BOT_UA },
      });
      const expiredResponse = await app.inject({
        method: "GET",
        url: "/botexpired",
        headers: { host: "bot-protected-expired.example.com", "user-agent": BOT_UA },
      });

      for (const response of [protectedResponse, expiredResponse]) {
        expect(response.statusCode).toBe(200);
        expect(response.headers.location).toBeUndefined();
        assertNoLeak(response, CANARY_TARGET);
      }
    });
  });

  describe("D-11: unknown/deleted slug -> identical generic 404", () => {
    it("an unknown slug and a deleted link's old slug render the identical generic 404 body", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("d11.example.com");
      const created = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://real-target.example.com/",
        slug: "temporary",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await prisma.link.delete({ where: { id: created.link.id } });

      const neverExistedResponse = await app.inject({
        method: "GET",
        url: "/never-existed",
        headers: { host: "d11.example.com" },
      });
      const deletedResponse = await app.inject({
        method: "GET",
        url: "/temporary",
        headers: { host: "d11.example.com" },
      });

      expect(neverExistedResponse.statusCode).toBe(404);
      expect(deletedResponse.statusCode).toBe(404);
      expect(neverExistedResponse.body).toContain("Dieser Kurzlink existiert nicht");
      expect(deletedResponse.body).toContain("Dieser Kurzlink existiert nicht");
    });
  });

  describe("Reflected-XSS guard (Pitfall 1, T-05-XSS-SLUG)", () => {
    it("a script-injection slug on an active host renders an entity-escaped 404 body", async () => {
      const app = await buildApp({ prisma });
      await seedDomainWithOwner("xss-guard.example.com");

      const payload = "<script>alert(1)</script>";
      const response = await app.inject({
        method: "GET",
        url: `/${encodeURIComponent(payload)}`,
        headers: { host: "xss-guard.example.com" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("<script>alert(1)</script>");
      expect(response.body).toContain("&lt;script&gt;");
    });
  });

  describe("forwardQuery (D-12/D-13): target wins on conflict", () => {
    it("merges incoming query params onto the target, keeping the target's own value on conflict", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("forward-query.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://campaign.example.com/lp?utm_source=a",
        slug: "campaign",
        forwardQuery: true,
      });

      const response = await app.inject({
        method: "GET",
        url: "/campaign?ref=x&utm_source=b",
        headers: { host: "forward-query.example.com" },
      });

      expect(response.statusCode).toBe(302);
      const location = new URL(response.headers.location as string);
      expect(location.searchParams.get("utm_source")).toBe("a");
      expect(location.searchParams.get("ref")).toBe("x");
    });

    it("leaves the target exactly as stored when forwardQuery is off (default)", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("no-forward-query.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://campaign.example.com/lp?utm_source=a",
        slug: "campaign",
      });

      const response = await app.inject({
        method: "GET",
        url: "/campaign?ref=x",
        headers: { host: "no-forward-query.example.com" },
      });

      expect(response.headers.location).toBe("https://campaign.example.com/lp?utm_source=a");
    });
  });

  describe("Rate limit (D-15): POST /:slug/verify is keyed per (IP, host, slug)", () => {
    it("throttles rapid-fire wrong-password attempts against a single link", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("rate-limit-a.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "promo",
        password: "correct-horse-battery",
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          app.inject({
            method: "POST",
            url: "/promo/verify",
            headers: { host: "rate-limit-a.example.com" },
            payload: { password: "wrong-guess" },
          }),
        ),
      );

      expect(results.filter((r) => r.statusCode === 429).length).toBeGreaterThan(0);
    });

    it("does not collapse the rate-limit bucket across two domains sharing the same slug", async () => {
      const app = await buildApp({ prisma });
      const seedA = await seedDomainWithOwner("rate-limit-cross-a.example.com");
      const seedB = await seedDomainWithOwner("rate-limit-cross-b.example.com");
      await createLink(prisma, {
        userId: seedA.userId,
        domainId: seedA.domainId,
        targetUrl: "https://target-a.example.com/",
        slug: "promo",
        password: "correct-horse-battery",
      });
      await createLink(prisma, {
        userId: seedB.userId,
        domainId: seedB.domainId,
        targetUrl: "https://target-b.example.com/",
        slug: "promo",
        password: "correct-horse-battery",
      });

      // Flood domain A's /promo/verify past its limit.
      await Promise.all(
        Array.from({ length: 20 }, () =>
          app.inject({
            method: "POST",
            url: "/promo/verify",
            headers: { host: "rate-limit-cross-a.example.com" },
            payload: { password: "wrong-guess" },
          }),
        ),
      );

      // Domain B's identically-named slug must still be served normally.
      const domainBResponse = await app.inject({
        method: "POST",
        url: "/promo/verify",
        headers: { host: "rate-limit-cross-b.example.com" },
        payload: { password: "wrong-guess" },
      });

      expect(domainBResponse.statusCode).toBe(200);
      expect(domainBResponse.body).toContain("Falsches Passwort. Bitte erneut versuchen.");
    });
  });

  describe("Cache-Control: no-store on every branch (D-18)", () => {
    it("is present on the 302, 410, password-200, and 404 responses", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("cache-control.example.com");
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "redirect",
      });
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "expired",
        expiresAt: "2020-01-01",
      });
      await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target.example.com/",
        slug: "protected",
        password: "correct-horse-battery",
      });

      const redirectResponse = await app.inject({
        method: "GET",
        url: "/redirect",
        headers: { host: "cache-control.example.com" },
      });
      const expiredResponse = await app.inject({
        method: "GET",
        url: "/expired",
        headers: { host: "cache-control.example.com" },
      });
      const passwordResponse = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { host: "cache-control.example.com" },
      });
      const notFoundResponse = await app.inject({
        method: "GET",
        url: "/nonexistent",
        headers: { host: "cache-control.example.com" },
      });

      for (const response of [
        redirectResponse,
        expiredResponse,
        passwordResponse,
        notFoundResponse,
      ]) {
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    });
  });
});
