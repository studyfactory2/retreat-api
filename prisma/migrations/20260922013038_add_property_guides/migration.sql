-- CreateTable
CREATE TABLE "PropertyGuide" (
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PropertyGuide_pkey" PRIMARY KEY ("propertyId")
);

-- CreateIndex
CREATE INDEX "PropertyGuide_updatedByUserId_idx" ON "PropertyGuide"("updatedByUserId");

-- AddForeignKey
ALTER TABLE "PropertyGuide" ADD CONSTRAINT "PropertyGuide_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyGuide" ADD CONSTRAINT "PropertyGuide_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
