/*
  Warnings:

  - A unique constraint covering the columns `[guestLinkTokenHash]` on the table `Stay` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ChecklistSubmission" ADD COLUMN     "stayLinkVersion" INTEGER;

-- AlterTable
ALTER TABLE "Stay" ADD COLUMN     "guestLinkExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "guestLinkStayRevision" INTEGER,
ADD COLUMN     "guestLinkTokenHash" TEXT,
ADD COLUMN     "guestLinkUpdatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "guestLinkVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Stay_guestLinkTokenHash_key" ON "Stay"("guestLinkTokenHash");
