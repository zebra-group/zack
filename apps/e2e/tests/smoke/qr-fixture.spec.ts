import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { createE2ePrisma, withResetDbLock } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";
import { createE2eQrCode, decodeQrImage } from "../../src/qr.js";

/**
 * RED->GREEN contract spec for `apps/e2e/src/qr.ts` (15-01-PLAN.md Task
 * 1/2) — the SINGLE shared fixture-insert shape and decode recipe every
 * feature spec in this phase (15-02/15-03/15-04) consumes. Until
 * `apps/e2e/src/qr.ts` exists, the import above fails to resolve and every
 * test in this file fails at module-load time — this is the intended RED
 * state (Task 1), exactly mirroring `links-fixture.spec.ts`'s own
 * module-load-failure RED precedent for `apps/e2e/src/links.ts`.
 *
 * Task 2 implements the module to turn this GREEN, with zero application
 * code touched under `apps/api/src`/`apps/web/src`.
 */

test.describe("createE2eQrCode", () => {
  test("a dynamic QrCode read back has a non-null 16-char lowercase-hex code, the seeded Link's id, and variant dynamic", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-qr-dyn-${randomUUID()}`;
        const link = await createE2eLink(tx, { slug, targetUrl: `https://example.com/${slug}` });

        const created = await createE2eQrCode(tx, { variant: "dynamic", linkId: link.id, name: "Dynamic Fixture QR" });

        const readBack = await tx.qrCode.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.variant).toBe("dynamic");
        expect(readBack.linkId).toBe(link.id);
        expect(readBack.code).not.toBeNull();
        expect(readBack.code).toMatch(/^[0-9a-f]{16}$/);
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a static QrCode read back has code: null and variant static", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-qr-stat-${randomUUID()}`;
        const link = await createE2eLink(tx, { slug, targetUrl: `https://example.com/${slug}` });

        const created = await createE2eQrCode(tx, { variant: "static", linkId: link.id, name: "Static Fixture QR" });

        const readBack = await tx.qrCode.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.variant).toBe("static");
        expect(readBack.code).toBeNull();
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("stores the color option when supplied, and defaults roundedModules to false when omitted", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-qr-color-${randomUUID()}`;
        const link = await createE2eLink(tx, { slug, targetUrl: `https://example.com/${slug}` });

        const created = await createE2eQrCode(tx, {
          variant: "static",
          linkId: link.id,
          name: "Color Fixture QR",
          color: "#123456",
        });

        const readBack = await tx.qrCode.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.color).toBe("#123456");
        expect(readBack.roundedModules).toBe(false);
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("defaults color to #000000 when omitted", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-qr-defcolor-${randomUUID()}`;
        const link = await createE2eLink(tx, { slug, targetUrl: `https://example.com/${slug}` });

        const created = await createE2eQrCode(tx, { variant: "static", linkId: link.id, name: "Default Color QR" });

        const readBack = await tx.qrCode.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.color).toBe("#000000");
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});

test.describe("decodeQrImage", () => {
  test("resolves to null for a non-QR solid-color PNG, without throwing", async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 58, b: 95, alpha: 1 } },
    })
      .png()
      .toBuffer();

    await expect(decodeQrImage(png)).resolves.toBeNull();
  });
});
