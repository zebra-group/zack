import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";

/**
 * [BLOCKING] schema-push proof (06-02 Task 1).
 *
 * Mirrors `schema-push.test.ts`'s pattern (02-02): proves the committed
 * migration (`prisma/migrations/*_add_click_tracking`) actually applies to
 * a real Postgres instance (via `test/globalSetup.ts`'s testcontainers
 * harness running `prisma migrate deploy`) and that the new ClickEvent/
 * DailySalt model delegates are genuinely QUERYABLE, not just type-present
 * — and that a Link created with no tracking fields set reports the
 * correct column defaults (trackingEnabled: true, lifetimeClicks: 0).
 */
describe("Schema push: tracking data model (TRACK-01, T-06-SCHEMA)", () => {
  it("exposes clickEvent and dailySalt delegates", () => {
    expect(prisma.clickEvent).toBeDefined();
    expect(prisma.dailySalt).toBeDefined();
  });

  it("clickEvent and dailySalt are queryable against real Postgres", async () => {
    await expect(prisma.clickEvent.count()).resolves.toBe(0);
    await expect(prisma.dailySalt.count()).resolves.toBe(0);
  });

  it("a Link created with no tracking fields set defaults trackingEnabled:true and lifetimeClicks:0", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "tracking-schema-push.test.zack",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.zack.local",
      },
    });
    const link = await prisma.link.create({
      data: {
        domainId: domain.id,
        slug: "tracking-schema-push-slug",
        targetUrl: "https://example.com/tracking-schema-push",
      },
    });

    expect(link.trackingEnabled).toBe(true);
    expect(link.lifetimeClicks).toBe(0);
  });
});
