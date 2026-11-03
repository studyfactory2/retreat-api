-- CreateEnum
CREATE TYPE "PropertyRoomCodeMode" AS ENUM ('FIXED', 'ROTATING');

-- CreateTable
CREATE TABLE "PropertyAccessSettings" (
    "propertyId" TEXT NOT NULL,
    "roomMode" "PropertyRoomCodeMode" NOT NULL,
    "entranceCodeCiphertext" TEXT,
    "fixedRoomCodeCiphertext" TEXT,
    "vacancyCodeCiphertext" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PropertyAccessSettings_pkey" PRIMARY KEY ("propertyId")
);

-- CreateIndex
CREATE INDEX "PropertyAccessSettings_updatedByUserId_idx" ON "PropertyAccessSettings"("updatedByUserId");

-- AddForeignKey
ALTER TABLE "PropertyAccessSettings" ADD CONSTRAINT "PropertyAccessSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAccessSettings" ADD CONSTRAINT "PropertyAccessSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

