/**
 * Dynamic-QR redirect handler integration suite (Phase 7, QR-02/03/07,
 * 07-06) — the completion evidence for `routes/qrRedirect.ts`'s `GET
 * /q/:code` + `POST /q/:code/verify`: resolves the QrCode's CURRENT target
 * Link fresh on every request, reuses `lib/redirectEngine.ts`'s precedence
 * engine (never a blind 302 bypass, T-07-GATE-BYPASS), records scans through
 * the SAME single `recordClickHook` seam `routes/redirect.ts` uses
 * (T-07-CLICK-DRIFT), and increments the QR-only `lifetimeScans` counter.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test) via `buildApp({ prisma
 * })`, mirroring `redirect.integration.test.ts`'s `app.inject` shape.
 * Fixtures are built through the REAL `createLink`/`createQrCode`/
 * `remapQrCode` services (D-01/07-04's single-write-path discipline) — never
 * a raw `prisma.link.create`/`prisma.qrCode.create`.
 *
 * These are RED tests (Task 2) — they fail against the pre-07-06 codebase
 * (no `routes/qrRedirect.ts`, `/q/:code` 404s via the SPA fallback). Task 2's
 * implementation turns the resolution/gate-reuse/scan-recording/redirect
 * blocks GREEN; Task 3 adds the password-unlock-flow blocks at the bottom.
 */
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createLink } from "../src/lib/links.js";
import { createQrCode, remapQrCode } from "../src/lib/qrCodes.js";
import { prisma } from "./setupFileEach.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

let userSeq = 0;

/** Creates a real `User` row — mirrors redirect.integration.test.ts's createTestUser. */
async function createTestUser(): Promise<string> {
  const id = `qr-redirect-test-user-${userSeq++}`;
  await prisma.user.create({
    data: { id, name: id, email: `${id}@kurzly.test`, emailVerified: true },
  });
  return id;
}

/** Creates an ACTIVE Domain + owner DomainMembership for `userId`. */
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

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value. */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

describe("Dynamic-QR redirect handler (Phase 7, QR-02/03/07, 07-06)", () => {
  describe("QR-02/07: resolves the current target and records a source='qr' scan", () => {
    it("GET /q/:code 302s to the target and records exactly one source='qr' ClickEvent + lifetimeScans+1", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("qr-scan.example.com");
      const link = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://destination.example.com/landing",
        slug: "go",
      });
      expect(link.ok).toBe(true);
      if (!link.ok) return;

      const qr = await createQrCode(prisma, {
        userId: seed.userId,
        variant: "dynamic",
        linkId: link.link.id,
        name: "Scan test QR",
      });
      expect(qr.ok).toBe(true);
      if (!qr.ok) return;
      expect(qr.qrCode.code).toBeTruthy();

      const response = await app.inject({
        method: "GET",
        url: `/q/${qr.qrCode.code}`,
        // Host-agnostic (Open-Question 1): a host with no Domain row at all
        // still resolves the QR — proves it is NOT routed through
        // resolveActiveDomainByHost.
        headers: { host: "any-host-not-a-registered-domain.example.net", "user-agent": BROWSER_UA },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://destination.example.com/landing");
      expect(response.headers["cache-control"]).toBe("no-store");

      const events = await prisma.clickEvent.findMany({ where: { linkId: link.link.id } });
      expect(events).toHaveLength(1);
      expect(events[0]!.source).toBe("qr");

      const refetchedQr = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
      expect(refetchedQr!.lifetimeScans).toBe(1);
    });
  });

  describe("QR-03: a remap changes the target, never the code (headline negative test)", () => {
    it("after remapping the QR to a new Link, GET /q/:code (SAME code) 302s to the NEW target", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("qr-remap.example.com");
      const linkA = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target-a.example.com/",
        slug: "link-a",
      });
      const linkB = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://target-b.example.com/",
        slug: "link-b",
      });
      expect(linkA.ok).toBe(true);
      expect(linkB.ok).toBe(true);
      if (!linkA.ok || !linkB.ok) return;

      const qr = await createQrCode(prisma, {
        userId: seed.userId,
        variant: "dynamic",
        linkId: linkA.link.id,
        name: "Remap test QR",
      });
      expect(qr.ok).toBe(true);
      if (!qr.ok) return;
      const originalCode = qr.qrCode.code;

      const beforeRemap = await app.inject({
        method: "GET",
        url: `/q/${originalCode}`,
        headers: { host: "qr-remap.example.com", "user-agent": BROWSER_UA },
      });
      expect(beforeRemap.headers.location).toBe("https://target-a.example.com/");

      const remapped = await remapQrCode(prisma, qr.qrCode.id, linkB.link.id, seed.userId);
      expect(remapped.ok).toBe(true);
      if (!remapped.ok) return;
      expect(remapped.qrCode.code).toBe(originalCode); // the printed code never changes.

      const afterRemap = await app.inject({
        method: "GET",
        url: `/q/${originalCode}`,
        headers: { host: "qr-remap.example.com", "user-agent": BROWSER_UA },
      });

      expect(afterRemap.statusCode).toBe(302);
      expect(afterRemap.headers.location).toBe("https://target-b.example.com/");
    });
  });

  describe("Gate reuse: expired target -> 410, never a redirect", () => {
    it("returns 410 with the branded expiry copy when the target Link is expired", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("qr-expired.example.com");
      const link = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://expired-target.example.com/",
        slug: "old",
        expiresAt: "2020-01-01",
      });
      expect(link.ok).toBe(true);
      if (!link.ok) return;

      const qr = await createQrCode(prisma, {
        userId: seed.userId,
        variant: "dynamic",
        linkId: link.link.id,
        name: "Expired test QR",
      });
      expect(qr.ok).toBe(true);
      if (!qr.ok) return;

      const response = await app.inject({
        method: "GET",
        url: `/q/${qr.qrCode.code}`,
        headers: { host: "qr-expired.example.com", "user-agent": BROWSER_UA },
      });

      expect(response.statusCode).toBe(410);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain("Dieser Link ist abgelaufen");

      const events = await prisma.clickEvent.count({ where: { linkId: link.link.id } });
      expect(events).toBe(0);
      const refetchedQr = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
      expect(refetchedQr!.lifetimeScans).toBe(0);
    });
  });

  describe("Gate reuse: protected target -> password page, no leak, no scan", () => {
    it("GET shows the password page with the target absent and records no scan", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("qr-protected.example.com");
      const link = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://secret-target.example.com/",
        slug: "secret",
        password: "correct-horse-battery",
      });
      expect(link.ok).toBe(true);
      if (!link.ok) return;

      const qr = await createQrCode(prisma, {
        userId: seed.userId,
        variant: "dynamic",
        linkId: link.link.id,
        name: "Protected test QR",
      });
      expect(qr.ok).toBe(true);
      if (!qr.ok) return;

      const response = await app.inject({
        method: "GET",
        url: `/q/${qr.qrCode.code}`,
        headers: { host: "qr-protected.example.com", "user-agent": BROWSER_UA },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Dieser Link ist geschützt");
      expect(response.body).not.toContain("https://secret-target.example.com/");
      expect(response.headers["cache-control"]).toBe("no-store");

      const events = await prisma.clickEvent.count({ where: { linkId: link.link.id } });
      expect(events).toBe(0);
    });
  });

  describe("T-07-ENUM: unknown code -> the same generic 404 as an unknown slug", () => {
    it("returns 404 for a code that never existed", async () => {
      const app = await buildApp({ prisma });

      const response = await app.inject({
        method: "GET",
        url: "/q/does-not-exist",
        headers: { host: "any-host.example.com", "user-agent": BROWSER_UA },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toContain("Dieser Kurzlink existiert nicht");
    });
  });

  /**
   * IN-07: `POST /q/:code/verify` interpolates the raw `:code` param into
   * `issueUnlockCookie`'s `Path` attribute, and `cookie.serialize` throws a
   * `TypeError` (-> 500) for characters outside ` -:=-~`. Today that line is
   * only reachable after an exact `findUnique` match against a
   * server-generated Base62 code, so it is not exploitable — but the safety
   * rests entirely on that ordering rather than on the param's own shape.
   * A guard at the top of both handlers makes it structural, mirroring
   * `customSlugSchema`'s discipline in lib/links.ts.
   */
  describe("IN-07: the :code param is shape-guarded before any lookup or cookie write", () => {
    it("404s a malformed code on GET without ever querying the database", async () => {
      const app = await buildApp({ prisma });
      const findUnique = vi.spyOn(prisma.qrCode, "findUnique");

      const response = await app.inject({
        method: "GET",
        url: "/q/abc%3B%20Path%3D%2F",
        headers: { host: "any-host.example.com", "user-agent": BROWSER_UA },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toContain("Dieser Kurzlink existiert nicht");
      expect(findUnique).not.toHaveBeenCalled();
      findUnique.mockRestore();
    });

    it("404s a malformed code on the verify path without ever querying the database", async () => {
      const app = await buildApp({ prisma });
      const findUnique = vi.spyOn(prisma.qrCode, "findUnique");

      const response = await app.inject({
        method: "POST",
        url: "/q/abc%3B%20Path%3D%2F/verify",
        headers: { host: "any-host.example.com", "user-agent": BROWSER_UA },
        payload: { password: "irrelevant" },
      });

      expect(response.statusCode).toBe(404);
      expect(findUnique).not.toHaveBeenCalled();
      findUnique.mockRestore();
    });
  });

  describe("QR-03: /q/:code password unlock flow (Task 3)", () => {
    it("POST /q/:code/verify with the wrong password re-renders the page with the error state, records nothing", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("qr-verify-wrong.example.com");
      const link = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://secret-target.example.com/",
        slug: "secret",
        password: "correct-horse-battery",
      });
      expect(link.ok).toBe(true);
      if (!link.ok) return;

      const qr = await createQrCode(prisma, {
        userId: seed.userId,
        variant: "dynamic",
        linkId: link.link.id,
        name: "Verify-wrong test QR",
      });
      expect(qr.ok).toBe(true);
      if (!qr.ok) return;

      const response = await app.inject({
        method: "POST",
        url: `/q/${qr.qrCode.code}/verify`,
        headers: { host: "qr-verify-wrong.example.com", "user-agent": BROWSER_UA },
        payload: { password: "wrong-guess" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("Falsches Passwort. Bitte erneut versuchen.");
      expect(response.body).not.toContain("https://secret-target.example.com/");

      const events = await prisma.clickEvent.count({ where: { linkId: link.link.id } });
      expect(events).toBe(0);
      const refetchedQr = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
      expect(refetchedQr!.lifetimeScans).toBe(0);
    });

    it("POST /q/:code/verify with the correct password unlocks; a subsequent GET /q/:code then records the scan + 302s", async () => {
      const app = await buildApp({ prisma });
      const seed = await seedDomainWithOwner("qr-verify-correct.example.com");
      const link = await createLink(prisma, {
        userId: seed.userId,
        domainId: seed.domainId,
        targetUrl: "https://unlocked-target.example.com/",
        slug: "secret",
        password: "correct-horse-battery",
      });
      expect(link.ok).toBe(true);
      if (!link.ok) return;

      const qr = await createQrCode(prisma, {
        userId: seed.userId,
        variant: "dynamic",
        linkId: link.link.id,
        name: "Verify-correct test QR",
      });
      expect(qr.ok).toBe(true);
      if (!qr.ok) return;

      const verifyResponse = await app.inject({
        method: "POST",
        url: `/q/${qr.qrCode.code}/verify`,
        headers: { host: "qr-verify-correct.example.com", "user-agent": BROWSER_UA },
        payload: { password: "correct-horse-battery" },
      });

      expect(verifyResponse.statusCode).toBe(302);
      expect(verifyResponse.headers.location).toBe("https://unlocked-target.example.com/");
      expect(verifyResponse.headers["set-cookie"]).toBeDefined();

      // No scan yet — the verify path itself never calls recordClickHook
      // (mirrors routes/redirect.ts's POST /:slug/verify).
      const eventsAfterVerify = await prisma.clickEvent.count({ where: { linkId: link.link.id } });
      expect(eventsAfterVerify).toBe(0);

      const cookieHeader = toCookieHeader(verifyResponse.headers["set-cookie"]);
      const secondGet = await app.inject({
        method: "GET",
        url: `/q/${qr.qrCode.code}`,
        headers: {
          host: "qr-verify-correct.example.com",
          cookie: cookieHeader,
          "user-agent": BROWSER_UA,
        },
      });

      expect(secondGet.statusCode).toBe(302);
      expect(secondGet.headers.location).toBe("https://unlocked-target.example.com/");

      const eventsAfterGet = await prisma.clickEvent.findMany({ where: { linkId: link.link.id } });
      expect(eventsAfterGet).toHaveLength(1);
      expect(eventsAfterGet[0]!.source).toBe("qr");

      const refetchedQr = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
      expect(refetchedQr!.lifetimeScans).toBe(1);
    });
  });
});

/**
 * Static-QR scan attribution (Phase 7, QR-07 / ROADMAP success criterion 4).
 *
 * A static QR encodes its Link's own short URL, so its scans arrive at
 * `routes/redirect.ts`'s `GET /:slug` — a handler that otherwise has no way
 * to know which QrCode (if any) a request came from, which is why static
 * codes previously displayed "0 Scans" forever. The encoded URL therefore
 * carries a `?qr={qrCodeId}` marker that the redirect handler attributes back
 * to that QrCode row.
 */
describe("Static-QR scan attribution on GET /:slug (QR-07)", () => {
  it("a scan carrying the ?qr marker increments that QR's lifetimeScans and records source='qr'", async () => {
    const app = await buildApp({ prisma });
    const seed = await seedDomainWithOwner("static-scan.example.com");
    const link = await createLink(prisma, {
      userId: seed.userId,
      domainId: seed.domainId,
      targetUrl: "https://destination.example.com/static",
      slug: "printed",
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;

    const qr = await createQrCode(prisma, {
      userId: seed.userId,
      variant: "static",
      linkId: link.link.id,
      name: "Printed flyer",
    });
    expect(qr.ok).toBe(true);
    if (!qr.ok) return;

    const response = await app.inject({
      method: "GET",
      url: `/printed?qr=${qr.qrCode.id}`,
      headers: { host: "static-scan.example.com", "user-agent": BROWSER_UA },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://destination.example.com/static");

    const refetched = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
    expect(refetched!.lifetimeScans).toBe(1);

    const events = await prisma.clickEvent.findMany({ where: { linkId: link.link.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("qr");
  });

  it("a plain visit without the marker leaves lifetimeScans at 0 and records source='link'", async () => {
    const app = await buildApp({ prisma });
    const seed = await seedDomainWithOwner("static-scan-plain.example.com");
    const link = await createLink(prisma, {
      userId: seed.userId,
      domainId: seed.domainId,
      targetUrl: "https://destination.example.com/plain",
      slug: "plain",
    });
    if (!link.ok) return;

    const qr = await createQrCode(prisma, {
      userId: seed.userId,
      variant: "static",
      linkId: link.link.id,
      name: "Unscanned",
    });
    if (!qr.ok) return;

    const response = await app.inject({
      method: "GET",
      url: "/plain",
      headers: { host: "static-scan-plain.example.com", "user-agent": BROWSER_UA },
    });

    expect(response.statusCode).toBe(302);

    const refetched = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
    expect(refetched!.lifetimeScans).toBe(0);

    const events = await prisma.clickEvent.findMany({ where: { linkId: link.link.id } });
    expect(events[0]!.source).toBe("link");
  });

  it("a marker naming a QR bound to a DIFFERENT link never inflates that QR's counter", async () => {
    const app = await buildApp({ prisma });
    const seed = await seedDomainWithOwner("static-scan-foreign.example.com");
    const linkA = await createLink(prisma, {
      userId: seed.userId,
      domainId: seed.domainId,
      targetUrl: "https://destination.example.com/a",
      slug: "a",
    });
    const linkB = await createLink(prisma, {
      userId: seed.userId,
      domainId: seed.domainId,
      targetUrl: "https://destination.example.com/b",
      slug: "b",
    });
    if (!linkA.ok || !linkB.ok) return;

    const qrForB = await createQrCode(prisma, {
      userId: seed.userId,
      variant: "static",
      linkId: linkB.link.id,
      name: "Belongs to B",
    });
    if (!qrForB.ok) return;

    // Scan link A while claiming to be B's QR code.
    const response = await app.inject({
      method: "GET",
      url: `/a?qr=${qrForB.qrCode.id}`,
      headers: { host: "static-scan-foreign.example.com", "user-agent": BROWSER_UA },
    });

    expect(response.statusCode).toBe(302);

    const refetched = await prisma.qrCode.findUnique({ where: { id: qrForB.qrCode.id } });
    expect(refetched!.lifetimeScans).toBe(0);
  });

  it("a gated (expired) link does not count the scan", async () => {
    const app = await buildApp({ prisma });
    const seed = await seedDomainWithOwner("static-scan-expired.example.com");
    const link = await createLink(prisma, {
      userId: seed.userId,
      domainId: seed.domainId,
      targetUrl: "https://destination.example.com/gone",
      slug: "gone",
      expiresAt: "2020-01-01",
    });
    if (!link.ok) return;

    const qr = await createQrCode(prisma, {
      userId: seed.userId,
      variant: "static",
      linkId: link.link.id,
      name: "Expired",
    });
    if (!qr.ok) return;

    const response = await app.inject({
      method: "GET",
      url: `/gone?qr=${qr.qrCode.id}`,
      headers: { host: "static-scan-expired.example.com", "user-agent": BROWSER_UA },
    });

    expect(response.statusCode).toBe(410);

    const refetched = await prisma.qrCode.findUnique({ where: { id: qr.qrCode.id } });
    expect(refetched!.lifetimeScans).toBe(0);
  });

  it("strips its own marker before forwarding the query to the target", async () => {
    const app = await buildApp({ prisma });
    const seed = await seedDomainWithOwner("static-scan-forward.example.com");
    const link = await createLink(prisma, {
      userId: seed.userId,
      domainId: seed.domainId,
      targetUrl: "https://campaign.example.com/lp",
      slug: "campaign",
      forwardQuery: true,
    });
    if (!link.ok) return;

    const qr = await createQrCode(prisma, {
      userId: seed.userId,
      variant: "static",
      linkId: link.link.id,
      name: "Campaign",
    });
    if (!qr.ok) return;

    const response = await app.inject({
      method: "GET",
      url: `/campaign?qr=${qr.qrCode.id}&utm_source=flyer`,
      headers: { host: "static-scan-forward.example.com", "user-agent": BROWSER_UA },
    });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.searchParams.get("utm_source")).toBe("flyer");
    expect(location.searchParams.get("qr")).toBeNull();
  });
});
