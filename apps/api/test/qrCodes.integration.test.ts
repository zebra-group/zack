/**
 * QrCode core integration suite (QR-02/03/04, single-write-path) — the
 * completion evidence for `apps/api/src/lib/qrCodes.ts`'s D-01-equivalent
 * discipline: one validation gate, one create site, one style-update site,
 * one remap-transaction site.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test). The Task 1 (07-04)
 * blocks below follow `authorization.test.ts`'s direct-seed convention (no
 * HTTP/session layer — exercises the lib functions directly). The route-
 * layer blocks appended for 07-05 instead follow
 * `analytics.test.ts`'s `buildApp` + magic-link -> verify -> cookie flow,
 * exercising `routes/qrCodes.ts` end-to-end via `app.inject`.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsQR from "jsqr";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { createLink } from "../src/lib/links.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import {
  createQrCode,
  getQrRemapHistory,
  remapQrCode,
  toQrCodeDto,
  updateQrCode,
  type UpdateQrCodeParams,
} from "../src/lib/qrCodes.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const ROUTE_OWNER_EMAIL = "qr-route-owner@kurzly.test";
const ROUTE_OUTSIDER_EMAIL = "qr-route-outsider@kurzly.test";

// Invite-only allowlist (D-01, lib/allowlist.ts): sendMagicLink only fires
// for a User row that already exists — mirrors analytics.test.ts's
// beforeEach exactly, otherwise signInAs() for these fixture emails
// silently no-ops (D-01's neutral non-allowlisted response).
beforeEach(async () => {
  vi.mocked(sendMagicLinkEmail).mockClear();
  await seedInitialAdmin(prisma, ROUTE_OWNER_EMAIL);
  await prisma.user.upsert({
    where: { email: ROUTE_OUTSIDER_EMAIL },
    update: { emailVerified: true },
    create: {
      id: "u_qr_route_outsider",
      name: "QR Route Outsider",
      email: ROUTE_OUTSIDER_EMAIL,
      emailVerified: true,
    },
  });
});

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value. Mirrors analytics.test.ts. */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Extracts the `token` query param from a captured magic-link verify URL. Mirrors analytics.test.ts. */
function extractToken(magicLinkUrl: string): string {
  const token = new URL(magicLinkUrl).searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in magic-link URL: ${magicLinkUrl}`);
  }
  return token;
}

/** Requests a magic link for `email` and returns the captured verify URL. Mirrors analytics.test.ts. */
async function requestMagicLinkUrl(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const url = call?.[0]?.url;
  if (!url) {
    throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  }
  return url;
}

/** Signs `email` in via the full magic-link round trip and returns a Cookie header. Mirrors analytics.test.ts. */
async function signInAs(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);
  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}

/** Resolves the userId behind an already-signed-in cookie header. Mirrors analytics.test.ts. */
async function resolveSessionUserId(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookieHeader: string,
): Promise<string> {
  const session = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie: cookieHeader },
  });
  return session.json()?.user?.id as string;
}

/** Creates a Domain + owner DomainMembership for `userId` (route-layer IDOR fixtures). */
async function seedOwnedDomainForRoute(userId: string, hostname: string): Promise<string> {
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

/** Creates a real Link (route-layer fixtures) via the D-01 single-write-path core. */
async function seedLinkForRoute(userId: string, domainId: string): Promise<string> {
  const created = await createLink(prisma, {
    userId,
    domainId,
    targetUrl: `https://example.com/${randomUUID()}`,
  });
  if (!created.ok) throw new Error(`setup failed: createLink returned ${created.error}`);
  return created.link.id;
}

/** A tiny real PNG (via sharp) — route-layer logo-upload tests. */
async function tinyPngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/** Decodes an image buffer back to its encoded QR payload string, or null. Mirrors qrDecode.test.ts's decode helper (07-RESEARCH.md Code Example 2). */
async function decodeQr(imageBuffer: Buffer): Promise<string | null> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PNG_BYTES = readFileSync(path.join(__dirname, "fixtures", "qr-logo.png"));

describe("QrCode core (QR-02/03/04, single-write-path)", () => {
  let seq = 0;

  /** Direct-seed a User row (mirrors authorization.test.ts's seedUser). */
  async function seedUser() {
    seq += 1;
    return prisma.user.create({
      data: { id: `u_qr_${seq}`, name: `QR Test User ${seq}`, email: `qr-${seq}@test.kurzly` },
    });
  }

  /** Direct-seed an active Domain (WR-03: createLink requires an active domain). */
  async function seedDomain() {
    seq += 1;
    return prisma.domain.create({
      data: {
        hostname: `qr-domain-${seq}.test.kurzly`,
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });
  }

  async function seedOwnedDomain(userId: string): Promise<string> {
    const domain = await seedDomain();
    await prisma.domainMembership.create({
      data: { userId, domainId: domain.id, role: "owner" },
    });
    return domain.id;
  }

  /** Creates a real Link via the D-01 single-write-path core (createLink). */
  async function seedLink(userId: string, domainId: string) {
    const created = await createLink(prisma, {
      userId,
      domainId,
      targetUrl: `https://example.com/${randomUUID()}`,
    });
    if (!created.ok) throw new Error(`setup failed: createLink returned ${created.error}`);
    return created.link;
  }

  /** A tiny real PNG (via sharp) — for logo-upload-path tests (normalizeLogo needs valid PNG bytes, not just magic bytes). */
  async function seedTestPng(): Promise<Buffer> {
    return sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
  }

  describe("createQrCode", () => {
    it("static: binds to an existing Link — code null, linkId = bound link", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);

      const result = await createQrCode(prisma, {
        userId: owner.id,
        variant: "static",
        linkId: link.id,
        name: "My Static QR",
        color: "#000000",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const dto = toQrCodeDto(result.qrCode);
      expect(dto.variant).toBe("static");
      expect(dto.code).toBeNull();
      expect(dto.linkId).toBe(link.id);
    });

    it("dynamic: gets a non-null 7-char code with currentTarget = the initial target link", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);

      const result = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: link.id,
        name: "My Dynamic QR",
        color: "#000000",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const dto = toQrCodeDto(result.qrCode);
      expect(dto.variant).toBe("dynamic");
      expect(dto.code).toMatch(/^[0-9A-Za-z]{7}$/);
      expect(dto.linkId).toBe(link.id);
    });

    it("IDOR: a caller with no access to the target Link's domain gets UNAUTHORIZED_DOMAIN — identical for an existing-but-foreign Link and a non-existent one (no existence oracle)", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);
      const outsider = await seedUser(); // zero memberships anywhere

      const forbidden = await createQrCode(prisma, {
        userId: outsider.id,
        variant: "static",
        linkId: link.id,
        name: "Forbidden",
        color: "#000000",
      });
      const nonexistent = await createQrCode(prisma, {
        userId: outsider.id,
        variant: "static",
        linkId: "does-not-exist",
        name: "Forbidden",
        color: "#000000",
      });

      expect(forbidden.ok).toBe(false);
      expect(nonexistent.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error).toBe("UNAUTHORIZED_DOMAIN");
      if (!nonexistent.ok) expect(nonexistent.error).toBe("UNAUTHORIZED_DOMAIN");
      if (!forbidden.ok && !nonexistent.ok) {
        expect(forbidden.error).toBe(nonexistent.error);
      }
    });

    it("toQrCodeDto never includes logoData bytes; dates are ISO strings", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);

      const result = await createQrCode(prisma, {
        userId: owner.id,
        variant: "static",
        linkId: link.id,
        name: "DTO check",
        color: "#000000",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");

      const dto = toQrCodeDto(result.qrCode);
      expect(dto).not.toHaveProperty("logoData");
      expect(JSON.stringify(dto)).not.toContain("logoData");
      expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(dto.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("remapQrCode (QR-03 headline correctness: re-pointing NEVER changes `code`)", () => {
    it("changes the current target Link but leaves `code` byte-for-byte unchanged; the original code still resolves to the NEW target", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const linkA = await seedLink(owner.id, domainId);
      const linkB = await seedLink(owner.id, domainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: linkA.id,
        name: "Remap test",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");
      const originalCode = created.qrCode.code;
      expect(originalCode).not.toBeNull();

      const remapped = await remapQrCode(prisma, created.qrCode.id, linkB.id, owner.id);
      expect(remapped.ok).toBe(true);
      if (!remapped.ok) throw new Error("expected ok");

      // The headline guarantee: `code` is UNCHANGED across the remap.
      expect(remapped.qrCode.code).toBe(originalCode);
      expect(remapped.qrCode.linkId).toBe(linkB.id);

      // Re-resolving by the ORIGINAL printed code proves it still "works"
      // (still exists / resolves) and now points at the NEW target — a
      // printed code is never invalidated by a remap.
      const byOriginalCode = await prisma.qrCode.findUnique({
        where: { code: originalCode as string },
      });
      expect(byOriginalCode).not.toBeNull();
      expect(byOriginalCode?.code).toBe(originalCode);
      expect(byOriginalCode?.linkId).toBe(linkB.id);

      const historyRows = await prisma.qrRemapHistory.findMany({
        where: { qrCodeId: created.qrCode.id },
      });
      expect(historyRows).toHaveLength(1);
      expect(historyRows[0]).toMatchObject({ fromLinkId: linkA.id, toLinkId: linkB.id });
    });

    // Deliberately avoids "static"/"dynamic"/"IDOR" substrings in this
    // title (mirrors 07-03's own "avoid Task 2 filter collision" fix) —
    // Task 2's verify command filters on
    // `-t "create|static|dynamic|IDOR|unauthorized"`, and this test
    // exercises Task 3 functionality (remapQrCode), which is a stub until
    // Task 3 lands.
    it("remapping a permanently-bound QR is rejected as the wrong variant and writes no history row", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const linkA = await seedLink(owner.id, domainId);
      const linkB = await seedLink(owner.id, domainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "static",
        linkId: linkA.id,
        name: "Static remap",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      const result = await remapQrCode(prisma, created.qrCode.id, linkB.id, owner.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("NOT_DYNAMIC");

      const historyRows = await prisma.qrRemapHistory.findMany({
        where: { qrCodeId: created.qrCode.id },
      });
      expect(historyRows).toHaveLength(0);
    });

    // "IDOR" avoided in this title deliberately — see the filter-collision
    // note above this describe block's first test.
    it("cross-domain guard: remap is denied (UNAUTHORIZED_DOMAIN) both for an outsider caller and for an owner targeting a Link in a domain they cannot access", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const linkA = await seedLink(owner.id, domainId);

      const outsider = await seedUser();
      const outsiderDomainId = await seedOwnedDomain(outsider.id);
      const outsiderLink = await seedLink(outsider.id, outsiderDomainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: linkA.id,
        name: "Cross-domain remap",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      // Outsider (no membership on owner's domain) attempts the remap at all.
      const forbiddenCaller = await remapQrCode(
        prisma,
        created.qrCode.id,
        outsiderLink.id,
        outsider.id,
      );
      expect(forbiddenCaller.ok).toBe(false);
      if (!forbiddenCaller.ok) expect(forbiddenCaller.error).toBe("UNAUTHORIZED_DOMAIN");

      // Owner (has access to the QR's own domain) attempts to re-point INTO
      // a Link that lives in a domain they cannot access.
      const forbiddenTarget = await remapQrCode(
        prisma,
        created.qrCode.id,
        outsiderLink.id,
        owner.id,
      );
      expect(forbiddenTarget.ok).toBe(false);
      if (!forbiddenTarget.ok) expect(forbiddenTarget.error).toBe("UNAUTHORIZED_DOMAIN");

      // Neither attempt actually moved the target or wrote history.
      const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: created.qrCode.id } });
      expect(row.linkId).toBe(linkA.id);
      const historyRows = await prisma.qrRemapHistory.findMany({
        where: { qrCodeId: created.qrCode.id },
      });
      expect(historyRows).toHaveLength(0);
    });
  });

  describe("getQrRemapHistory (QR-04)", () => {
    it("returns the full history oldest -> newest after two successive remaps", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const linkA = await seedLink(owner.id, domainId);
      const linkB = await seedLink(owner.id, domainId);
      const linkC = await seedLink(owner.id, domainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: linkA.id,
        name: "History test",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      const first = await remapQrCode(prisma, created.qrCode.id, linkB.id, owner.id);
      expect(first.ok).toBe(true);
      const second = await remapQrCode(prisma, created.qrCode.id, linkC.id, owner.id);
      expect(second.ok).toBe(true);

      const history = await getQrRemapHistory(prisma, created.qrCode.id, owner.id);
      expect(history.ok).toBe(true);
      if (!history.ok) throw new Error("expected ok");
      expect(history.entries).toHaveLength(2);
      expect(history.entries[0]).toMatchObject({ fromLinkId: linkA.id, toLinkId: linkB.id });
      expect(history.entries[1]).toMatchObject({ fromLinkId: linkB.id, toLinkId: linkC.id });
      expect(history.entries[0]?.createdAt.getTime() ?? 0).toBeLessThanOrEqual(
        history.entries[1]?.createdAt.getTime() ?? 0,
      );
    });

    // "IDOR" avoided in this title deliberately — see the filter-collision
    // note in the remapQrCode describe block above.
    it("cross-domain guard: getQrRemapHistory denies a caller with no access to the QR's domain", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const linkA = await seedLink(owner.id, domainId);
      const outsider = await seedUser();

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: linkA.id,
        name: "History IDOR",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      const result = await getQrRemapHistory(prisma, created.qrCode.id, outsider.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("UNAUTHORIZED_DOMAIN");
    });
  });

  describe("updateQrCode (style-only, single write site)", () => {
    it("updates color/roundedModules/name without ever touching code/variant/linkId", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: link.id,
        name: "Original name",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      const updated = await updateQrCode(prisma, created.qrCode.id, {
        userId: owner.id,
        name: "Updated name",
        color: "#ff00ff",
        roundedModules: true,
      });

      expect(updated.ok).toBe(true);
      if (!updated.ok) throw new Error("expected ok");
      expect(updated.qrCode.name).toBe("Updated name");
      expect(updated.qrCode.color).toBe("#ff00ff");
      expect(updated.qrCode.roundedModules).toBe(true);
      expect(updated.qrCode.code).toBe(created.qrCode.code);
      expect(updated.qrCode.variant).toBe("dynamic");
      expect(updated.qrCode.linkId).toBe(link.id);
    });

    it("sets logoEnabled + logoData via normalizeLogo; the DTO still never leaks the bytes", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "static",
        linkId: link.id,
        name: "Logo test",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      const pngBytes = await seedTestPng();
      const updated = await updateQrCode(prisma, created.qrCode.id, {
        userId: owner.id,
        logoEnabled: true,
        logo: { bytes: pngBytes },
      });

      expect(updated.ok).toBe(true);
      if (!updated.ok) throw new Error("expected ok");
      expect(updated.qrCode.logoEnabled).toBe(true);
      expect(updated.qrCode.logoData).not.toBeNull();

      const dto = toQrCodeDto(updated.qrCode);
      expect(dto).not.toHaveProperty("logoData");
      expect(dto.logoEnabled).toBe(true);
    });

    it("mass-assignment: code/lifetimeScans/variant/linkId are never client-settable through updateQrCode", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);
      const otherLink = await seedLink(owner.id, domainId);

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "dynamic",
        linkId: link.id,
        name: "Mass assign",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      // Simulates an untyped/unchecked caller attempting to smuggle
      // server-owned fields through — cast away compile-time protection to
      // prove the RUNTIME function only reads its allowlisted fields.
      const maliciousInput = {
        userId: owner.id,
        name: "New name",
        code: "ATTACKR",
        lifetimeScans: 999999,
        variant: "static",
        linkId: otherLink.id,
      } as unknown as UpdateQrCodeParams;

      const updated = await updateQrCode(prisma, created.qrCode.id, maliciousInput);

      expect(updated.ok).toBe(true);
      if (!updated.ok) throw new Error("expected ok");
      expect(updated.qrCode.code).toBe(created.qrCode.code);
      expect(updated.qrCode.lifetimeScans).toBe(0);
      expect(updated.qrCode.variant).toBe("dynamic");
      expect(updated.qrCode.linkId).toBe(link.id);
    });

    // "IDOR" avoided in this title deliberately — see the filter-collision
    // note in the remapQrCode describe block above.
    it("cross-domain guard: updateQrCode denies a caller with no access to the QR's domain", async () => {
      const owner = await seedUser();
      const domainId = await seedOwnedDomain(owner.id);
      const link = await seedLink(owner.id, domainId);
      const outsider = await seedUser();

      const created = await createQrCode(prisma, {
        userId: owner.id,
        variant: "static",
        linkId: link.id,
        name: "Update IDOR",
        color: "#000000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected ok");

      const result = await updateQrCode(prisma, created.qrCode.id, {
        userId: outsider.id,
        name: "Attacker rename",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("UNAUTHORIZED_DOMAIN");

      const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: created.qrCode.id } });
      expect(row.name).toBe("Update IDOR");
    });
  });
});

describe("POST /api/qr-codes (route layer, QR-01)", () => {
  it("401s with no session", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      payload: { variant: "static", linkId: "anything", name: "x" },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("201s for a valid static body, response DTO has code null", async () => {
    const app = await buildApp({ prisma });
    const cookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const userId = await resolveSessionUserId(app, cookie);
    const domainId = await seedOwnedDomainForRoute(userId, "qr-route-post-static.example.com");
    const linkId = await seedLinkForRoute(userId, domainId);

    const res = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie },
      payload: { variant: "static", linkId, name: "Static QR" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.variant).toBe("static");
    expect(body.code).toBeNull();
    expect(body.linkId).toBe(linkId);
    await app.close();
  });

  it("201s for a valid dynamic body, response DTO has a 7-char code", async () => {
    const app = await buildApp({ prisma });
    const cookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const userId = await resolveSessionUserId(app, cookie);
    const domainId = await seedOwnedDomainForRoute(userId, "qr-route-post-dynamic.example.com");
    const linkId = await seedLinkForRoute(userId, domainId);

    const res = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie },
      payload: { variant: "dynamic", linkId, name: "Dynamic QR" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.variant).toBe("dynamic");
    expect(body.code).toMatch(/^[0-9A-Za-z]{7}$/);
    await app.close();
  });

  it("404s (IDOR, no existence oracle) when linkId belongs to a domain the caller cannot access", async () => {
    const app = await buildApp({ prisma });
    const outsiderCookie = await signInAs(app, ROUTE_OUTSIDER_EMAIL);
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-post-idor.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie: outsiderCookie },
      payload: { variant: "static", linkId, name: "Forbidden" },
    });
    const nonexistent = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie: outsiderCookie },
      payload: { variant: "static", linkId: "does-not-exist", name: "Forbidden" },
    });

    expect(forbidden.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    await app.close();
  });

  it("mass-assignment: an invalid enum variant is rejected (400), and code/lifetimeScans in the body never reach the persisted row", async () => {
    const app = await buildApp({ prisma });
    const cookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const userId = await resolveSessionUserId(app, cookie);
    const domainId = await seedOwnedDomainForRoute(userId, "qr-route-post-mass.example.com");
    const linkId = await seedLinkForRoute(userId, domainId);

    const invalidVariant = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie },
      payload: { variant: "x", linkId, name: "Bad variant" },
    });
    expect(invalidVariant.statusCode).toBe(400);

    const smuggled = await app.inject({
      method: "POST",
      url: "/api/qr-codes",
      headers: { cookie },
      payload: {
        variant: "dynamic",
        linkId,
        name: "Smuggled fields",
        code: "ATTACKR",
        lifetimeScans: 999999,
      },
    });
    expect(smuggled.statusCode).toBe(201);
    const body = smuggled.json();
    expect(body.code).not.toBe("ATTACKR");
    expect(body.lifetimeScans).toBe(0);
    await app.close();
  });
});

describe("GET /api/qr-codes and GET /api/qr-codes/:id (route layer)", () => {
  it("401s with no session on both the list and detail routes", async () => {
    const app = await buildApp({ prisma });

    const list = await app.inject({ method: "GET", url: "/api/qr-codes" });
    const detail = await app.inject({ method: "GET", url: "/api/qr-codes/anything" });

    expect(list.statusCode).toBe(401);
    expect(detail.statusCode).toBe(401);
    await app.close();
  });

  it("GET /api/qr-codes lists only the caller's domain-scoped QRs", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const outsiderCookie = await signInAs(app, ROUTE_OUTSIDER_EMAIL);
    const outsiderId = await resolveSessionUserId(app, outsiderCookie);

    const ownerDomainId = await seedOwnedDomainForRoute(ownerId, "qr-route-list-owner.example.com");
    const ownerLinkId = await seedLinkForRoute(ownerId, ownerDomainId);
    await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId: ownerLinkId,
      name: "Owner QR",
      color: "#000000",
    });

    const outsiderDomainId = await seedOwnedDomainForRoute(outsiderId, "qr-route-list-outsider.example.com");
    const outsiderLinkId = await seedLinkForRoute(outsiderId, outsiderDomainId);
    await createQrCode(prisma, {
      userId: outsiderId,
      variant: "static",
      linkId: outsiderLinkId,
      name: "Outsider QR",
      color: "#000000",
    });

    const res = await app.inject({ method: "GET", url: "/api/qr-codes", headers: { cookie: ownerCookie } });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body.some((qr) => qr.name === "Owner QR")).toBe(true);
    expect(body.some((qr) => qr.name === "Outsider QR")).toBe(false);
    await app.close();
  });

  it("GET /api/qr-codes/:id 404s identically for a non-existent id and a foreign QR (no existence oracle)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const outsiderCookie = await signInAs(app, ROUTE_OUTSIDER_EMAIL);

    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-get-idor.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Foreign QR",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const foreign = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: outsiderCookie },
    });
    const nonexistent = await app.inject({
      method: "GET",
      url: "/api/qr-codes/does-not-exist",
      headers: { cookie: outsiderCookie },
    });

    expect(foreign.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    await app.close();
  });

  it("GET /api/qr-codes/:id 200s with the DTO for the owner", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-get-owner.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Owned QR",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Owned QR");
    await app.close();
  });
});

describe("PATCH /api/qr-codes/:id (route layer)", () => {
  it("401s with no session", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "PATCH", url: "/api/qr-codes/anything", payload: { name: "x" } });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("404s identically for a non-existent id and a foreign QR (no existence oracle)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const outsiderCookie = await signInAs(app, ROUTE_OUTSIDER_EMAIL);

    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-patch-idor.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Foreign QR",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: outsiderCookie },
      payload: { name: "Attacker rename" },
    });
    const nonexistent = await app.inject({
      method: "PATCH",
      url: "/api/qr-codes/does-not-exist",
      headers: { cookie: outsiderCookie },
      payload: { name: "Attacker rename" },
    });

    expect(foreign.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    await app.close();
  });

  it("style update: color/roundedModules/name persist via updateQrCode", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-patch-style.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId,
      name: "Original",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { name: "Restyled", color: "#ff00ff", roundedModules: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Restyled");
    expect(body.color).toBe("#ff00ff");
    expect(body.roundedModules).toBe(true);
    expect(body.code).toBe(created.qrCode.code);
    await app.close();
  });

  it("SECURITY: rejects a non-hex color with 400 at the route boundary (defense-in-depth, T-07-MASS)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-patch-badcolor.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Color test",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { color: '#000" onload="alert(1)' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("remap: a targetLinkId change on a dynamic QR routes through remapQrCode, leaving code unchanged", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-patch-remap.example.com");
    const linkA = await seedLinkForRoute(ownerId, domainId);
    const linkB = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId: linkA,
      name: "Remap route test",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { targetLinkId: linkB },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(created.qrCode.code);
    expect(body.linkId).toBe(linkB);

    const history = await prisma.qrRemapHistory.findMany({ where: { qrCodeId: created.qrCode.id } });
    expect(history).toHaveLength(1);
    await app.close();
  });

  it("remap: NOT_DYNAMIC (400) when targetLinkId is sent for a static QR", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-patch-remap-static.example.com");
    const linkA = await seedLinkForRoute(ownerId, domainId);
    const linkB = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId: linkA,
      name: "Static remap route test",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { targetLinkId: linkB },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("mass-assignment: code/lifetimeScans/variant/linkId in the PATCH body never reach the persisted row", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-patch-mass.example.com");
    const linkA = await seedLinkForRoute(ownerId, domainId);
    const linkB = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId: linkA,
      name: "Mass assign route test",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: {
        name: "New name",
        code: "ATTACKR",
        lifetimeScans: 999999,
        variant: "static",
        linkId: linkB,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("New name");
    expect(body.code).toBe(created.qrCode.code);
    expect(body.lifetimeScans).toBe(0);
    expect(body.variant).toBe("dynamic");
    expect(body.linkId).toBe(linkA);
    await app.close();
  });
});

describe("GET /api/qr-codes/:id/remap-history (route layer, QR-04 read seam)", () => {
  it("401s with no session", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: "/api/qr-codes/anything/remap-history" });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("404s identically for a non-existent id and a foreign QR (no existence oracle)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const outsiderCookie = await signInAs(app, ROUTE_OUTSIDER_EMAIL);

    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-history-idor.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId,
      name: "History IDOR",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const foreign = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/remap-history`,
      headers: { cookie: outsiderCookie },
    });
    const nonexistent = await app.inject({
      method: "GET",
      url: "/api/qr-codes/does-not-exist/remap-history",
      headers: { cookie: outsiderCookie },
    });

    expect(foreign.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    await app.close();
  });

  it("200s with the chronological history after a remap via the route", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-history-ok.example.com");
    const linkA = await seedLinkForRoute(ownerId, domainId);
    const linkB = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId: linkA,
      name: "History OK",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { targetLinkId: linkB },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/remap-history`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ fromLinkId: string; toLinkId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ fromLinkId: linkA, toLinkId: linkB });
    await app.close();
  });
});

describe("GET /api/qr-codes/:id/render.png and .svg (route layer, QR-06)", () => {
  it("401s with no session on both formats", async () => {
    const app = await buildApp({ prisma });

    const png = await app.inject({ method: "GET", url: "/api/qr-codes/anything/render.png" });
    const svg = await app.inject({ method: "GET", url: "/api/qr-codes/anything/render.svg" });

    expect(png.statusCode).toBe(401);
    expect(svg.statusCode).toBe(401);
    await app.close();
  });

  it("404s identically for a non-existent id and a foreign QR (no existence oracle)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const outsiderCookie = await signInAs(app, ROUTE_OUTSIDER_EMAIL);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-idor.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Render IDOR",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const foreign = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.png`,
      headers: { cookie: outsiderCookie },
    });
    const nonexistent = await app.inject({
      method: "GET",
      url: "/api/qr-codes/does-not-exist/render.png",
      headers: { cookie: outsiderCookie },
    });

    expect(foreign.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    await app.close();
  });

  // QR-01 / 07-CONTEXT.md:11 / ROADMAP Phase 7 success criterion 1: a static
  // QR is a QR *for the short link*, so it must encode the Link's OWN short
  // URL (`https://{domain.hostname}/{slug}`), never the raw destination.
  // Encoding `targetUrl` would route every scanner around Kurzly entirely —
  // bypassing the password gate and the expiry gate, and making the code's
  // scan count permanently 0.
  it("render.png returns image/png bytes that decode back to the static QR's own short-link URL — NOT the raw destination", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-static-png.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const link = await prisma.link.findUniqueOrThrow({
      where: { id: linkId },
      include: { domain: true },
    });
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Static render",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.png`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    const decoded = await decodeQr(res.rawPayload);
    expect(decoded).toBe(`https://${link.domain.hostname}/${link.slug}`);
    expect(decoded).not.toBe(link.targetUrl);
    await app.close();
  });

  it("static render.svg encodes the same short-link URL the PNG path encodes", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-static-svg.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const link = await prisma.link.findUniqueOrThrow({
      where: { id: linkId },
      include: { domain: true },
    });
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Static SVG render",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.svg`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const rasterized = await sharp(Buffer.from(res.payload)).png().toBuffer();
    const decoded = await decodeQr(rasterized);
    expect(decoded).toBe(`https://${link.domain.hostname}/${link.slug}`);
    await app.close();
  });

  // Regression guard for the gate-bypass this defect caused: a static QR for
  // a password-protected Link must still route the scanner through
  // GET /:slug (where resolveLinkState applies the gate), never straight to
  // the protected destination.
  it("a static QR for a PASSWORD-PROTECTED link never encodes the protected destination", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-static-pw.example.com");
    const createdLink = await createLink(prisma, {
      userId: ownerId,
      domainId,
      targetUrl: `https://secret.example.com/${randomUUID()}`,
      password: "s3cret-passphrase",
    });
    if (!createdLink.ok) throw new Error(`setup failed: createLink returned ${createdLink.error}`);
    const link = await prisma.link.findUniqueOrThrow({
      where: { id: createdLink.link.id },
      include: { domain: true },
    });
    expect(link.passwordHash).not.toBeNull();

    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId: link.id,
      name: "Protected static QR",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.png`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const decoded = await decodeQr(res.rawPayload);
    expect(decoded).not.toBe(link.targetUrl);
    expect(decoded).toBe(`https://${link.domain.hostname}/${link.slug}`);
    await app.close();
  });

  it("render.svg returns image/svg+xml that decodes (via sharp rasterization) back to the dynamic QR's own stable /q/:code URL — NOT the current target", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-dynamic-svg.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId,
      name: "Dynamic render",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.svg`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["cache-control"]).toBe("no-store");
    const svgBuffer = await sharp(Buffer.from(res.payload)).png().toBuffer();
    const decoded = await decodeQr(svgBuffer);
    expect(decoded).toBe(`http://localhost:3000/q/${created.qrCode.code}`);
    await app.close();
  });

  it("remap survives the printed code: render.png after a remap still decodes to the SAME /q/:code URL, now resolving via the new target at scan time", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-remap-stable.example.com");
    const linkA = await seedLinkForRoute(ownerId, domainId);
    const linkB = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "dynamic",
      linkId: linkA,
      name: "Remap stable render",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const before = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.png`,
      headers: { cookie: ownerCookie },
    });
    const decodedBefore = await decodeQr(before.rawPayload);

    await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { targetLinkId: linkB },
    });

    const after = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.png`,
      headers: { cookie: ownerCookie },
    });
    const decodedAfter = await decodeQr(after.rawPayload);

    expect(decodedBefore).toBe(decodedAfter);
    expect(decodedAfter).toBe(`http://localhost:3000/q/${created.qrCode.code}`);
    await app.close();
  });

  it("renders with a stored logo enabled (decode still succeeds through the composited overlay)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-logo.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Logo render",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { logoEnabled: true, logoData: LOGO_PNG_BYTES.toString("base64") },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().logoEnabled).toBe(true);

    const res = await app.inject({
      method: "GET",
      url: `/api/qr-codes/${created.qrCode.id}/render.png`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const decoded = await decodeQr(res.rawPayload);
    const link = await prisma.link.findUniqueOrThrow({
      where: { id: linkId },
      include: { domain: true },
    });
    expect(decoded).toBe(`https://${link.domain.hostname}/${link.slug}`);
    await app.close();
  });
});

describe("PATCH /api/qr-codes/:id logoData upload (route layer, T-07-LOGO-MIME)", () => {
  it("logo: an oversized base64 logoData string is rejected with 400 at the route boundary (before decoding)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-logo-oversized.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Oversized logo",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    // Comfortably above LOGO_DATA_MAX_LENGTH (1,900,000) but still well
    // inside app.ts's 2 MiB (2,097,152 byte) global bodyLimit, so THIS
    // route's own typed 400 fires, not Fastify's un-typed 413.
    const oversized = "A".repeat(2_000_000);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { logoEnabled: true, logoData: oversized },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("logo: a non-PNG/SVG upload is rejected with a typed 400 (INVALID_LOGO), never a 500", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-logo-invalid.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Invalid logo",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const notAnImage = Buffer.from("this is definitely not an image").toString("base64");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { logoEnabled: true, logoData: notAnImage },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_LOGO");
    await app.close();
  });

  it("logo: accepts a data-URI-prefixed base64 PNG (strips the data:...;base64, prefix before decoding)", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-logo-datauri.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Data URI logo",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const dataUri = `data:image/png;base64,${LOGO_PNG_BYTES.toString("base64")}`;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/qr-codes/${created.qrCode.id}`,
      headers: { cookie: ownerCookie },
      payload: { logoEnabled: true, logoData: dataUri },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().logoEnabled).toBe(true);
    await app.close();
  });
});

describe("GET /api/qr-codes/:id/render rate limit (QR_RENDER_RATE_LIMIT, dedicated bucket)", () => {
  it("rate-limits rapid-fire render requests separately from the global default", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, ROUTE_OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomainForRoute(ownerId, "qr-route-render-ratelimit.example.com");
    const linkId = await seedLinkForRoute(ownerId, domainId);
    const created = await createQrCode(prisma, {
      userId: ownerId,
      variant: "static",
      linkId,
      name: "Rate limit render",
      color: "#000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const results = await Promise.all(
      Array.from({ length: 150 }, () =>
        app.inject({
          method: "GET",
          url: `/api/qr-codes/${created.qrCode.id}/render.png`,
          headers: { cookie: ownerCookie },
        }),
      ),
    );

    const limited = results.filter((r) => r.statusCode === 429);
    expect(limited.length).toBeGreaterThan(0);
    await app.close();
  });
});
