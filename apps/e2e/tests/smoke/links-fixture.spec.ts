import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { createE2ePrisma, withResetDbLock, BASELINE_DOMAIN_HOSTNAME, ADMIN_EMAIL } from "../../src/db.js";
import { createE2eLink, derivePasswordHash, deriveExpiresAt } from "../../src/links.js";

/**
 * RED->GREEN contract spec for `apps/e2e/src/links.ts` (12-02-PLAN.md Task
 * 1/2) — the ONE shared fixture helper every feature spec in this phase
 * (12-03/12-04/12-05) consumes. Because `@kurzly/api`'s `exports` map
 * exposes only `.` and `./prisma-client` (12-RESEARCH.md Q2, RESOLVED —
 * `lib/links.ts`'s `createLink`/`updateLink` are unreachable from
 * `apps/e2e`), the helper must reproduce two invariants a raw
 * `prisma.link.create` would otherwise silently violate (12-RESEARCH.md
 * Pitfall 4): a REAL bcrypt `passwordHash` (never plaintext) and a UTC
 * end-of-day `expiresAt`.
 *
 * Until `apps/e2e/src/links.ts` exists, the import above fails to resolve
 * and every test in this file fails at module-load time — this is the
 * intended RED state (Task 1). Task 2 implements the module to turn this
 * GREEN, with zero application code touched under `apps/api/src`.
 */

test.describe("derivePasswordHash", () => {
  test("returns a real bcrypt hash bcrypt.compare accepts, never the plaintext", async () => {
    const hash = await derivePasswordHash("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    await expect(bcrypt.compare("correct-horse-battery", hash)).resolves.toBe(true);
  });
});

test.describe("deriveExpiresAt", () => {
  test("returns the exact UTC end-of-day instant for a YYYY-MM-DD date", () => {
    const expiresAt = deriveExpiresAt("2020-01-01");
    expect(expiresAt.toISOString()).toBe("2020-01-01T23:59:59.999Z");
  });
});

test.describe("createE2eLink", () => {
  test("stores a real bcrypt passwordHash bcrypt.compare accepts, and the seeded admin as createdBy", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-pw-${randomUUID()}`;
        const admin = await tx.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });

        const created = await createE2eLink(tx, {
          slug,
          targetUrl: `https://example.com/${slug}`,
          password: "pw",
        });

        const readBack = await tx.link.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.passwordHash).not.toBeNull();
        expect(readBack.passwordHash).not.toBe("pw");
        await expect(bcrypt.compare("pw", readBack.passwordHash as string)).resolves.toBe(true);
        expect(readBack.createdBy).toBe(admin.id);
        expect(readBack.domainId).toBe(
          (await tx.domain.findUniqueOrThrow({ where: { hostname: BASELINE_DOMAIN_HOSTNAME } })).id,
        );
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("stores the exact UTC end-of-day expiresAt instant for a YYYY-MM-DD expiresAt option", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-exp-${randomUUID()}`;

        const created = await createE2eLink(tx, {
          slug,
          targetUrl: `https://example.com/${slug}`,
          expiresAt: "2020-01-01",
        });

        const readBack = await tx.link.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.expiresAt?.toISOString()).toBe("2020-01-01T23:59:59.999Z");
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("stores passwordHash: null and expiresAt: null when neither option is supplied", async () => {
    const prisma = createE2ePrisma();
    try {
      await withResetDbLock(prisma, async (tx) => {
        const slug = `fixture-plain-${randomUUID()}`;

        const created = await createE2eLink(tx, {
          slug,
          targetUrl: `https://example.com/${slug}`,
        });

        const readBack = await tx.link.findUniqueOrThrow({ where: { id: created.id } });
        expect(readBack.passwordHash).toBeNull();
        expect(readBack.expiresAt).toBeNull();
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
