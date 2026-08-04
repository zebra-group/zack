import { describe, expect, it } from "vitest";
import { isAccountAdmin } from "../src/lib/accountRole.js";
import { prisma } from "./setupFileEach.js";

/**
 * [BLOCKING] schema-push proof (09-01 Task 1).
 *
 * Mirrors `tracking-schema-push.test.ts` (06-02) / `qr-schema-push.test.ts`
 * (07-02): proves the committed migration
 * (`prisma/migrations/*_add_user_account_role`) actually applies to a real
 * Postgres instance (via `test/globalSetup.ts`'s testcontainers harness
 * running `prisma migrate deploy`) and that the new global `AccountRole`
 * enum + `User.accountRole` column genuinely persist/round-trip against
 * real Postgres — not just type-present — plus `isAccountAdmin`'s three
 * cases (D-09-01).
 */
describe("Schema push: User.accountRole (D-09-01, T-09-MIGR-BACKFILL)", () => {
  it("defaults a newly created User's accountRole to member", async () => {
    const user = await prisma.user.create({
      data: {
        id: "account-role-schema-push-default",
        name: "Default Member",
        email: "account-role-schema-push-default@zack.test",
      },
    });

    expect(user.accountRole).toBe("member");
  });

  it("round-trips an explicit admin accountRole through create + findUnique", async () => {
    const created = await prisma.user.create({
      data: {
        id: "account-role-schema-push-admin",
        name: "Explicit Admin",
        email: "account-role-schema-push-admin@zack.test",
        accountRole: "admin",
      },
    });
    expect(created.accountRole).toBe("admin");

    const found = await prisma.user.findUnique({
      where: { id: "account-role-schema-push-admin" },
    });
    expect(found?.accountRole).toBe("admin");
  });

  it("isAccountAdmin returns true only for an accountRole=admin user", async () => {
    await prisma.user.create({
      data: {
        id: "account-role-schema-push-isadmin-admin",
        name: "Is Admin",
        email: "account-role-schema-push-isadmin-admin@zack.test",
        accountRole: "admin",
      },
    });
    await prisma.user.create({
      data: {
        id: "account-role-schema-push-isadmin-member",
        name: "Is Member",
        email: "account-role-schema-push-isadmin-member@zack.test",
        accountRole: "member",
      },
    });

    await expect(isAccountAdmin(prisma, "account-role-schema-push-isadmin-admin")).resolves.toBe(
      true,
    );
    await expect(isAccountAdmin(prisma, "account-role-schema-push-isadmin-member")).resolves.toBe(
      false,
    );
  });

  it("isAccountAdmin returns false for an unknown userId", async () => {
    await expect(isAccountAdmin(prisma, "account-role-schema-push-unknown-user")).resolves.toBe(
      false,
    );
  });
});
