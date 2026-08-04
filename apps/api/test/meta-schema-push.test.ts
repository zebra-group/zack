import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";

/**
 * Schema-push proof (08-01 Task 1) — mirrors `tracking-schema-push.test.ts`'s
 * pattern (06-02): proves the committed migration
 * (`prisma/migrations/*_add_link_utm_and_og_metadata`) actually applies to a
 * real Postgres instance (via `test/globalSetup.ts`'s testcontainers harness
 * running `prisma migrate deploy`) and that the six new UTM/OG columns are
 * genuinely persisted/queryable, not just type-present.
 */
describe("Schema push: UTM + custom OG metadata (META-01/02, D-08-01..05)", () => {
  it("a Link created with no metadata has all six columns null", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "meta-schema-push-empty.test.zack",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.zack.local",
      },
    });
    const link = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "meta-schema-push-empty",
        targetUrl: "https://example.com/meta-schema-push-empty",
      },
    });

    expect(link.utmSource).toBeNull();
    expect(link.utmMedium).toBeNull();
    expect(link.utmCampaign).toBeNull();
    expect(link.ogTitle).toBeNull();
    expect(link.ogDescription).toBeNull();
    expect(link.ogImageUrl).toBeNull();
  });

  it("a Link created with all six values round-trips them unchanged through create + findUnique", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "meta-schema-push-full.test.zack",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.zack.local",
      },
    });
    const created = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "meta-schema-push-full",
        targetUrl: "https://example.com/meta-schema-push-full",
        utmSource: "newsletter",
        utmMedium: "email",
        utmCampaign: "sommer aktion",
        ogTitle: "Custom Title",
        ogDescription: "Custom Description",
        ogImageUrl: "https://cdn.example.com/card.png",
      },
    });

    const found = await prisma.link.findUniqueOrThrow({ where: { id: created.id } });

    expect(found.utmSource).toBe("newsletter");
    expect(found.utmMedium).toBe("email");
    expect(found.utmCampaign).toBe("sommer aktion");
    expect(found.ogTitle).toBe("Custom Title");
    expect(found.ogDescription).toBe("Custom Description");
    expect(found.ogImageUrl).toBe("https://cdn.example.com/card.png");
  });

  it("toLinkDto exposes all six fields verbatim (no encoding, no trimming)", async () => {
    const { toLinkDto } = await import("../src/lib/links.js");
    const domain = await prisma.domain.create({
      data: {
        hostname: "meta-schema-push-dto.test.zack",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.zack.local",
      },
    });
    const link = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "meta-schema-push-dto",
        targetUrl: "https://example.com/meta-schema-push-dto",
        utmSource: "news letter & friends",
        utmMedium: "email",
        utmCampaign: "sommer aktion",
        ogTitle: "Custom Title",
        ogDescription: "Custom Description",
        ogImageUrl: "https://cdn.example.com/card.png",
      },
    });

    const dto = toLinkDto(link);

    expect(dto.utmSource).toBe("news letter & friends");
    expect(dto.utmMedium).toBe("email");
    expect(dto.utmCampaign).toBe("sommer aktion");
    expect(dto.ogTitle).toBe("Custom Title");
    expect(dto.ogDescription).toBe("Custom Description");
    expect(dto.ogImageUrl).toBe("https://cdn.example.com/card.png");
  });
});
