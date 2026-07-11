/*
  CR-01 fix: `DomainMembership.role` was a plain TEXT column with no
  Postgres-level constraint, so a typo'd/unexpected value could be
  persisted and silently bypass `requireDomainAccess`'s rank check
  (apps/api/src/lib/authorization.ts). This migration converts it to a
  native Postgres enum, so only "member" | "admin" | "owner" can ever be
  stored — defense-in-depth alongside the code-level guard fixed in the
  same change. `USING "role"::"Role"` casts any existing values in place
  (no data-loss drop/recreate); it will fail loudly if a row somehow holds
  a value outside the three known roles, which is the desired behavior.
*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('member', 'admin', 'owner');

-- AlterTable
ALTER TABLE "DomainMembership"
  ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
