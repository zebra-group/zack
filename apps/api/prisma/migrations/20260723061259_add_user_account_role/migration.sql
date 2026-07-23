-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('admin', 'member');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "accountRole" "AccountRole" NOT NULL DEFAULT 'member';
