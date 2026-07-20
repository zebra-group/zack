/**
 * QrCode core integration suite (QR-02/03/04, single-write-path) — the
 * completion evidence for `apps/api/src/lib/qrCodes.ts`'s D-01-equivalent
 * discipline: one validation gate, one create site, one style-update site,
 * one remap-transaction site.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test). Follows
 * `authorization.test.ts`'s direct-seed convention (no HTTP/session layer
 * needed — this suite exercises the lib functions directly, not routes,
 * which land in a later plan), not `links.integration.test.ts`'s full
 * magic-link round trip.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createLink } from "../src/lib/links.js";
import {
  createQrCode,
  getQrRemapHistory,
  remapQrCode,
  toQrCodeDto,
  updateQrCode,
  type UpdateQrCodeParams,
} from "../src/lib/qrCodes.js";
import { prisma } from "./setupFileEach.js";

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

    it("static-remap rejected: remapQrCode on a static QR returns NOT_DYNAMIC and writes no history row", async () => {
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

    it("IDOR: remap is denied (UNAUTHORIZED_DOMAIN) both for an outsider caller and for an owner targeting a Link in a domain they cannot access", async () => {
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

    it("IDOR: getQrRemapHistory denies a caller with no access to the QR's domain", async () => {
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

    it("IDOR: updateQrCode denies a caller with no access to the QR's domain", async () => {
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
