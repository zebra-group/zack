-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "forwardQuery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT;
