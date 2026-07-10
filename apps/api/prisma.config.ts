import { defineConfig, env } from "prisma/config";

// Prisma 7.8.0 removed `datasource.url` from schema.prisma (P1012) in favor
// of this config file. See apps/api/prisma/schema.prisma for the note on
// why this file exists — it supersedes the schema-only approach described
// in 01-RESEARCH.md's Pattern 4, which predates this point release.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
