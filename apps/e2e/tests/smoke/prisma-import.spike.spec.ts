import { expect, test } from "@playwright/test";
import { PrismaClient } from "@zack/api/prisma-client";

/**
 * RESEARCH Open Question 1 / Assumption A1 spike.
 *
 * Proves ONLY that the raw-`.ts` `./prisma-client` subpath export
 * (apps/api/package.json -> apps/api/src/generated/prisma/client.ts)
 * resolves and typechecks under Playwright's own TypeScript transform —
 * NOT that it can connect to a database. Downstream plans in this phase
 * prove DB connectivity once the compose stack publishes port 5433.
 *
 * Deliberately does NOT instantiate the client (no `new PrismaClient(...)`)
 * and does NOT open a connection.
 */
test("the @zack/api/prisma-client subpath resolves to a constructor", () => {
  expect(typeof PrismaClient).toBe("function");
});
