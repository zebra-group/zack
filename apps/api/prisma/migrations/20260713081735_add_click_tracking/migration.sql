-- CreateEnum
CREATE TYPE "ScanSource" AS ENUM ('link', 'qr');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "lifetimeClicks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trackingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "country" TEXT,
    "referrerHost" TEXT,
    "visitorHash" TEXT NOT NULL,
    "source" "ScanSource" NOT NULL DEFAULT 'link',

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySalt" (
    "date" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySalt_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "ClickEvent_linkId_idx" ON "ClickEvent"("linkId");

-- CreateIndex
CREATE INDEX "ClickEvent_createdAt_idx" ON "ClickEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ClickEvent_source_idx" ON "ClickEvent"("source");

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
