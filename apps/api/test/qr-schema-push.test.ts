import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";

/**
 * [BLOCKING] schema-push proof (07-02 Task 2).
 *
 * Mirrors `schema-push.test.ts` (02-02) / `tracking-schema-push.test.ts`
 * (06-02): proves the committed migration
 * (`prisma/migrations/*_add_qr_codes`) actually applies to a real Postgres
 * instance (via `test/globalSetup.ts`'s testcontainers harness running
 * `prisma migrate deploy`) and that the new QrCode/QrRemapHistory model
 * delegates are genuinely QUERYABLE, not just type-present — covering both
 * the static (bound Link) and dynamic (own /q code + current target Link +
 * optional logo bytes) variants plus the remap-history audit row.
 */
describe("Schema push: QrCode + QrRemapHistory models (QR-02/03/04/07, T-07-SCHEMA)", () => {
  it("exposes qrCode and qrRemapHistory delegates", () => {
    expect(prisma.qrCode).toBeDefined();
    expect(prisma.qrRemapHistory).toBeDefined();
  });

  it("qrCode and qrRemapHistory are queryable against real Postgres", async () => {
    await expect(prisma.qrCode.count()).resolves.toBe(0);
    await expect(prisma.qrRemapHistory.count()).resolves.toBe(0);
  });

  it("creates a static QrCode bound to a Link", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "qr-schema-push-static.test.kurzly",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });
    const link = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "qr-schema-push-static-slug",
        targetUrl: "https://example.com/qr-schema-push-static",
      },
    });

    const qrCode = await prisma.qrCode.create({
      data: {
        variant: "static",
        linkId: link.id,
        name: "Static QR",
        color: "#000000",
      },
    });

    expect(qrCode.variant).toBe("static");
    expect(qrCode.code).toBeNull();
    expect(qrCode.linkId).toBe(link.id);
    expect(qrCode.roundedModules).toBe(false);
    expect(qrCode.logoEnabled).toBe(false);
    expect(qrCode.logoData).toBeNull();
    expect(qrCode.lifetimeScans).toBe(0);
  });

  it("creates a dynamic QrCode with its own /q code, current target Link, and logo bytes", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "qr-schema-push-dynamic.test.kurzly",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });
    const link = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "qr-schema-push-dynamic-slug",
        targetUrl: "https://example.com/qr-schema-push-dynamic",
      },
    });

    const logoData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes, arbitrary test payload

    const qrCode = await prisma.qrCode.create({
      data: {
        variant: "dynamic",
        linkId: link.id,
        code: "qr-schema-push-dyn-code",
        name: "Dynamic QR",
        color: "#d7ff01",
        roundedModules: true,
        logoEnabled: true,
        logoData,
        logoMimeType: "image/png",
      },
    });

    expect(qrCode.variant).toBe("dynamic");
    expect(qrCode.code).toBe("qr-schema-push-dyn-code");
    expect(qrCode.linkId).toBe(link.id);
    expect(qrCode.roundedModules).toBe(true);
    expect(qrCode.logoEnabled).toBe(true);
    // Prisma 7's driver-adapter path returns Bytes columns as Uint8Array
    // (not a Node Buffer), so compare by byte content rather than
    // constructor identity.
    expect(Buffer.from(qrCode.logoData ?? [])).toEqual(logoData);
    expect(qrCode.logoMimeType).toBe("image/png");

    const found = await prisma.qrCode.findUnique({ where: { code: "qr-schema-push-dyn-code" } });
    expect(found).not.toBeNull();
    expect(found?.id).toBe(qrCode.id);
  });

  it("creates a QrRemapHistory row and cascade-deletes it with its QrCode", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "qr-schema-push-remap.test.kurzly",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });
    const fromLink = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "qr-schema-push-remap-from",
        targetUrl: "https://example.com/from",
      },
    });
    const toLink = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "qr-schema-push-remap-to",
        targetUrl: "https://example.com/to",
      },
    });

    const qrCode = await prisma.qrCode.create({
      data: {
        variant: "dynamic",
        linkId: toLink.id,
        code: "qr-schema-push-remap-code",
        name: "Remapped QR",
        color: "#000000",
      },
    });

    const remap = await prisma.qrRemapHistory.create({
      data: {
        qrCodeId: qrCode.id,
        fromLinkId: fromLink.id,
        toLinkId: toLink.id,
      },
    });

    expect(remap.qrCodeId).toBe(qrCode.id);
    expect(remap.fromLinkId).toBe(fromLink.id);
    expect(remap.toLinkId).toBe(toLink.id);

    await prisma.qrCode.delete({ where: { id: qrCode.id } });

    const remainingRemap = await prisma.qrRemapHistory.findUnique({ where: { id: remap.id } });
    expect(remainingRemap).toBeNull();
  });
});

/**
 * DB-constraint proof (WR-09, 260724-d72-PLAN.md): the partial unique index
 * `QrCode_linkId_static_key` (migration
 * `20260724074120_enforce_one_static_qr_per_link`) is the AUTHORITATIVE
 * one-static-QR-per-link guarantee — exercised here via direct prisma calls
 * (no lib/qrCodes.ts, no HTTP), against the real Postgres schema globalSetup
 * applies via `prisma migrate deploy`.
 */
describe("DB constraint: QrCode_linkId_static_key (WR-09, T-d72-01)", () => {
  async function seedDomainAndLink(hostnameSuffix: string) {
    const domain = await prisma.domain.create({
      data: {
        hostname: `qr-static-unique-${hostnameSuffix}.test.kurzly`,
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });
    const link = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: `qr-static-unique-${hostnameSuffix}`,
        targetUrl: `https://example.com/qr-static-unique-${hostnameSuffix}`,
      },
    });
    return link;
  }

  it("rejects a second static QrCode for a Link that already has one (P2002)", async () => {
    const link = await seedDomainAndLink("dup");

    await prisma.qrCode.create({
      data: { variant: "static", linkId: link.id, name: "First static", color: "#000000" },
    });

    await expect(
      prisma.qrCode.create({
        data: { variant: "static", linkId: link.id, name: "Second static", color: "#000000" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("still allows a dynamic QrCode on the SAME linkId as an existing static QrCode", async () => {
    const link = await seedDomainAndLink("dyn-same-link");

    await prisma.qrCode.create({
      data: { variant: "static", linkId: link.id, name: "Static", color: "#000000" },
    });

    const dynamic = await prisma.qrCode.create({
      data: {
        variant: "dynamic",
        linkId: link.id,
        code: "qr-static-unique-dyn-code",
        name: "Dynamic on same link",
        color: "#000000",
      },
    });

    expect(dynamic.linkId).toBe(link.id);
    expect(dynamic.variant).toBe("dynamic");
  });

  it("still allows a static QrCode on a DIFFERENT linkId", async () => {
    const linkA = await seedDomainAndLink("diff-a");
    const linkB = await seedDomainAndLink("diff-b");

    await prisma.qrCode.create({
      data: { variant: "static", linkId: linkA.id, name: "Static A", color: "#000000" },
    });

    const staticB = await prisma.qrCode.create({
      data: { variant: "static", linkId: linkB.id, name: "Static B", color: "#000000" },
    });

    expect(staticB.linkId).toBe(linkB.id);
    expect(staticB.variant).toBe("static");
  });
});
