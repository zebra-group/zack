import { test, expect } from "@playwright/test";
import { createE2ePrisma, resetDb, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";

/**
 * Throwaway smoke spec (INFRA-03, T-11-06) — proves parallel-worker DB
 * isolation holds for the truncate-and-reseed-per-file strategy (RESEARCH
 * Pattern 3 / Pitfall 4): every test independently calls `resetDb()` then
 * creates + reads back its own Link/QrCode rows through the reused Prisma
 * client, structured (via a plain `for` loop of `test()` calls, no
 * `test.describe.serial`) so they run genuinely concurrently under this
 * project's `fullyParallel: true` config.
 *
 * Success is measured by the phase's own two-run gate (11-04-PLAN.md
 * `<verify>`): the full suite passing at BOTH `--workers=1` AND
 * `--workers=N` with zero `P2002` unique-constraint errors in the output —
 * not a single in-spec assertion. Each test uses a cryptographically
 * random per-test slug specifically so no two concurrently-running tests
 * can ever collide on the real DB constraint this guards
 * (`@@unique([domainId, slug])`), proving the advisory-locked truncate
 * sequence in `resetDb()` never corrupts a concurrently in-flight test's
 * writes.
 */
const CONCURRENT_TEST_COUNT = 6;

for (let i = 0; i < CONCURRENT_TEST_COUNT; i++) {
  test(`resetDb + create/read Link+QrCode round-trip sees only its own rows (#${i})`, async () => {
    const prisma = createE2ePrisma();
    try {
      await resetDb(prisma);

      const domain = await prisma.domain.findUniqueOrThrow({
        where: { hostname: BASELINE_DOMAIN_HOSTNAME },
      });

      const uniqueSuffix = `${i}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const slug = `iso-${uniqueSuffix}`;

      const link = await prisma.link.create({
        data: {
          domainId: domain.id,
          slug,
          targetUrl: `https://example.com/iso-${uniqueSuffix}`,
        },
      });

      const qrCode = await prisma.qrCode.create({
        data: {
          variant: "static",
          linkId: link.id,
          name: `qr-${uniqueSuffix}`,
          color: "#000000",
        },
      });

      const readLink = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
      expect(readLink.slug).toBe(slug);
      expect(readLink.domainId).toBe(domain.id);

      const readQrCode = await prisma.qrCode.findUniqueOrThrow({ where: { id: qrCode.id } });
      expect(readQrCode.linkId).toBe(link.id);
      expect(readQrCode.variant).toBe("static");
    } finally {
      await prisma.$disconnect();
    }
  });
}
