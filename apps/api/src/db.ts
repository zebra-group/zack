/**
 * Prisma client singleton.
 *
 * Imported from the explicit Prisma 7 generator output path
 * (`./generated/prisma/client`), NOT from the bare `@prisma/client`
 * package — this is the exact path Phase 2's better-auth Prisma adapter
 * must also import from, so both share one generated client instance
 * (see .claude/CLAUDE.md's Prisma 7 breaking-change note and
 * 01-RESEARCH.md Pattern 4).
 *
 * NOTE: Prisma 7.8.0's `PrismaClientOptions` requires either a driver
 * `adapter` or an `accelerateUrl` — plain `new PrismaClient()` (which
 * read `DATABASE_URL` from the schema's `datasource` block, as older
 * Prisma majors did) no longer type-checks. This supersedes
 * 01-RESEARCH.md's Pattern 4 code sample, which predates this
 * point-release breaking change. `@prisma/adapter-pg` is Prisma's own
 * first-party driver adapter for node-postgres (same `prisma/prisma`
 * GitHub org/repo as `prisma`/`@prisma/client`, already vetted in
 * 01-RESEARCH.md's Package Legitimacy Audit).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set — db.ts must only be imported after env validation.",
  );
}
const adapter = new PrismaPg(databaseUrl);

export const prisma = new PrismaClient({ adapter });
