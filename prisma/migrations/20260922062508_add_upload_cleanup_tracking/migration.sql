-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "storageCleanupAttemptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "storageDeletedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "Attachment_kind_storageDeletedAt_storageCleanupAttemptedAt_idx" ON "Attachment"("kind", "storageDeletedAt", "storageCleanupAttemptedAt");
