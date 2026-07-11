-- CreateEnum
CREATE TYPE "DomainType" AS ENUM ('subdomain', 'apex');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('pending', 'active', 'failed');

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "hostname" TEXT NOT NULL,
ADD COLUMN     "lastCheckError" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "status" "DomainStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "type" "DomainType" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verificationTarget" TEXT NOT NULL,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");

-- CreateIndex
CREATE INDEX "Domain_status_idx" ON "Domain"("status");
