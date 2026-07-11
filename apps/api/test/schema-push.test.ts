import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";

/**
 * [BLOCKING] schema-push proof (02-02 Task 3).
 *
 * `prisma-generate.test.ts` (Phase 1) only proves the generated TypeScript
 * client MODULE resolves — that's a false positive for "the schema is
 * applied," since `tsc --noEmit` passes purely from generated types with
 * no live DB involved. This test proves the opposite: the committed
 * migration (`prisma/migrations/*_add_auth_and_domain_models`) actually
 * applies to a real Postgres instance (via `test/globalSetup.ts`'s
 * testcontainers harness running `prisma migrate deploy`) and the new
 * model delegates are genuinely QUERYABLE against it, not just
 * type-present.
 */
describe("Schema push: better-auth + Domain/DomainMembership models (D-02b)", () => {
  it("exposes user, session, verification, domain, and domainMembership delegates", () => {
    expect(prisma.user).toBeDefined();
    expect(prisma.session).toBeDefined();
    expect(prisma.account).toBeDefined();
    expect(prisma.verification).toBeDefined();
    expect(prisma.domain).toBeDefined();
    expect(prisma.domainMembership).toBeDefined();
  });

  it("user, session, verification, domain, and domainMembership are queryable against real Postgres", async () => {
    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.session.count()).resolves.toBe(0);
    await expect(prisma.account.count()).resolves.toBe(0);
    await expect(prisma.verification.count()).resolves.toBe(0);
    await expect(prisma.domain.count()).resolves.toBe(0);
    await expect(prisma.domainMembership.count()).resolves.toBe(0);
  });

  it("creates a User, a Domain, and a DomainMembership row and reads them back", async () => {
    const user = await prisma.user.create({
      data: { id: "u_schema_push", name: "Schema Push", email: "schema-push@test.kurzly" },
    });
    const domain = await prisma.domain.create({ data: {} });
    const membership = await prisma.domainMembership.create({
      data: { userId: user.id, domainId: domain.id, role: "owner" },
    });

    expect(membership.userId).toBe(user.id);
    expect(membership.domainId).toBe(domain.id);
    expect(membership.role).toBe("owner");

    const found = await prisma.domainMembership.findUnique({
      where: { userId_domainId: { userId: user.id, domainId: domain.id } },
    });
    expect(found).not.toBeNull();
    expect(found?.role).toBe("owner");
  });
});
