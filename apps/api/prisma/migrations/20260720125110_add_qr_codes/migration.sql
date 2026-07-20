-- CreateEnum
CREATE TYPE "QrCodeVariant" AS ENUM ('static', 'dynamic');

-- CreateTable
CREATE TABLE "QrCode" (
    "id" TEXT NOT NULL,
    "variant" "QrCodeVariant" NOT NULL,
    "linkId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "roundedModules" BOOLEAN NOT NULL DEFAULT false,
    "logoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "logoData" BYTEA,
    "logoMimeType" TEXT,
    "lifetimeScans" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrRemapHistory" (
    "id" TEXT NOT NULL,
    "qrCodeId" TEXT NOT NULL,
    "fromLinkId" TEXT NOT NULL,
    "toLinkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrRemapHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_code_key" ON "QrCode"("code");

-- CreateIndex
CREATE INDEX "QrCode_linkId_idx" ON "QrCode"("linkId");

-- CreateIndex
CREATE INDEX "QrCode_code_idx" ON "QrCode"("code");

-- CreateIndex
CREATE INDEX "QrRemapHistory_qrCodeId_idx" ON "QrRemapHistory"("qrCodeId");

-- CreateIndex
CREATE INDEX "QrRemapHistory_createdAt_idx" ON "QrRemapHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrRemapHistory" ADD CONSTRAINT "QrRemapHistory_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "QrCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
