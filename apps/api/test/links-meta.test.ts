/**
 * UTM + custom OG metadata validation and three-state threading (08-01 Task
 * 2, D-08-01..06). Exercises `createLink`/`updateLink` (lib/links.ts)
 * directly against `setupFileEach.ts`'s per-file Postgres — mirrors
 * `authorization.test.ts`'s direct `prisma.user.create`/`prisma.domain.
 * create` seed shape (no Fastify app/session round-trip needed for a
 * lib-level core test).
 */
import { describe, expect, it } from "vitest";
import { createLink, updateLink } from "../src/lib/links.js";
import { prisma } from "./setupFileEach.js";

let userSeq = 0;
let domainSeq = 0;

async function seedUser() {
  userSeq += 1;
  return prisma.user.create({
    data: {
      id: `u_meta_${userSeq}`,
      name: `Meta Test User ${userSeq}`,
      email: `links-meta-${userSeq}@test.zack`,
    },
  });
}

/** Active domain with an owner membership for `userId` — required by D-01's `requireDomainAccess` + WR-03's `DOMAIN_NOT_ACTIVE` gate. */
async function seedOwnedDomain(userId: string) {
  domainSeq += 1;
  const domain = await prisma.domain.create({
    data: {
      hostname: `links-meta-${domainSeq}.test.zack`,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.zack.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

describe("UTM + custom OG metadata (META-01/02, D-08-01..06)", () => {
  describe("createLink", () => {
    it("persists utmSource RAW (no percent-encoding at write time)", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      const result = await createLink(prisma, {
        userId: user.id,
        domainId,
        targetUrl: "https://example.com/utm-raw",
        utmSource: "sommer aktion",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.link.utmSource).toBe("sommer aktion");
      }
    });

    it("rejects a 201-character utmMedium with UTM_VALUE_TOO_LONG", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      const result = await createLink(prisma, {
        userId: user.id,
        domainId,
        targetUrl: "https://example.com/utm-too-long",
        utmMedium: "a".repeat(201),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("UTM_VALUE_TOO_LONG");
    });

    it("rejects a 201-character ogTitle with OG_TITLE_TOO_LONG", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      const result = await createLink(prisma, {
        userId: user.id,
        domainId,
        targetUrl: "https://example.com/og-title-too-long",
        ogTitle: "a".repeat(201),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("OG_TITLE_TOO_LONG");
    });

    it("rejects a 501-character ogDescription with OG_DESCRIPTION_TOO_LONG", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      const result = await createLink(prisma, {
        userId: user.id,
        domainId,
        targetUrl: "https://example.com/og-description-too-long",
        ogDescription: "a".repeat(501),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("OG_DESCRIPTION_TOO_LONG");
    });

    it("rejects a 2049-character ogImageUrl with OG_IMAGE_URL_TOO_LONG", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      const overLong = `https://cdn.example.com/${"a".repeat(2049)}`;
      const result = await createLink(prisma, {
        userId: user.id,
        domainId,
        targetUrl: "https://example.com/og-image-too-long",
        ogImageUrl: overLong,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("OG_IMAGE_URL_TOO_LONG");
    });

    it.each(["javascript:alert(1)", "data:image/png;base64,AAA", "/relative.png"])(
      "rejects ogImageUrl %s with OG_IMAGE_URL_INVALID (D-08-04)",
      async (badImageUrl) => {
        const user = await seedUser();
        const domainId = await seedOwnedDomain(user.id);

        const result = await createLink(prisma, {
          userId: user.id,
          domainId,
          targetUrl: "https://example.com/og-image-invalid",
          ogImageUrl: badImageUrl,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("OG_IMAGE_URL_INVALID");
      },
    );

    it("accepts a valid https ogImageUrl", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      const result = await createLink(prisma, {
        userId: user.id,
        domainId,
        targetUrl: "https://example.com/og-image-valid",
        ogImageUrl: "https://cdn.example.com/card.png",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.link.ogImageUrl).toBe("https://cdn.example.com/card.png");
      }
    });

    it("every validation failure is returned as a typed code, never thrown", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);

      await expect(
        createLink(prisma, {
          userId: user.id,
          domainId,
          targetUrl: "https://example.com/never-throws",
          ogImageUrl: "javascript:alert(1)",
        }),
      ).resolves.toMatchObject({ ok: false, error: "OG_IMAGE_URL_INVALID" });
    });
  });

  describe("updateLink three-state contract (D-08-05)", () => {
    async function seedLinkWithMeta(userId: string, domainId: string) {
      const created = await createLink(prisma, {
        userId,
        domainId,
        targetUrl: "https://example.com/three-state",
        slug: `three-state-${userId}`,
        utmSource: "original-source",
        ogTitle: "Original Title",
      });
      if (!created.ok) throw new Error("setup failed");
      return created.link;
    }

    it("omitting a field keeps the stored value", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);
      const link = await seedLinkWithMeta(user.id, domainId);

      const result = await updateLink(prisma, link.id, {
        userId: user.id,
        domainId,
        targetUrl: link.targetUrl,
        slug: link.slug,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.link.utmSource).toBe("original-source");
        expect(result.link.ogTitle).toBe("Original Title");
      }
    });

    it("passing null clears the field to null", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);
      const link = await seedLinkWithMeta(user.id, domainId);

      const result = await updateLink(prisma, link.id, {
        userId: user.id,
        domainId,
        targetUrl: link.targetUrl,
        slug: link.slug,
        utmSource: null,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.link.utmSource).toBeNull();
        // Unrelated field untouched.
        expect(result.link.ogTitle).toBe("Original Title");
      }
    });

    it('passing "" also clears the field to null (deliberately unlike password)', async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);
      const link = await seedLinkWithMeta(user.id, domainId);

      const result = await updateLink(prisma, link.id, {
        userId: user.id,
        domainId,
        targetUrl: link.targetUrl,
        slug: link.slug,
        ogTitle: "",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.link.ogTitle).toBeNull();
      }
    });

    it("passing a value replaces the stored value", async () => {
      const user = await seedUser();
      const domainId = await seedOwnedDomain(user.id);
      const link = await seedLinkWithMeta(user.id, domainId);

      const result = await updateLink(prisma, link.id, {
        userId: user.id,
        domainId,
        targetUrl: link.targetUrl,
        slug: link.slug,
        utmSource: "replaced-source",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.link.utmSource).toBe("replaced-source");
      }
    });
  });
});
