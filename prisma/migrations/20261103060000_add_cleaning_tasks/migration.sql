-- CreateEnum
CREATE TYPE "CleaningTaskSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "CleaningTaskStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ChecklistSubmission" ADD COLUMN     "cleaningTaskId" TEXT,
ADD COLUMN     "taskQrTokenHash" TEXT;

-- CreateTable
CREATE TABLE "CleaningTask" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT,
    "requestHash" TEXT,
    "propertyId" TEXT NOT NULL,
    "departingStayId" TEXT,
    "source" "CleaningTaskSource" NOT NULL,
    "status" "CleaningTaskStatus" NOT NULL DEFAULT 'PLANNED',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "manualDueAt" BOOLEAN NOT NULL DEFAULT false,
    "sourceStayRevision" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "cancelledBySchedule" BOOLEAN NOT NULL DEFAULT false,
    "cancellationReason" TEXT,
    "currentSubmissionId" TEXT,
    "completion" JSONB,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CleaningTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_requestKey_key" ON "CleaningTask"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_departingStayId_key" ON "CleaningTask"("departingStayId");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_currentSubmissionId_key" ON "CleaningTask"("currentSubmissionId");

-- CreateIndex
CREATE INDEX "CleaningTask_propertyId_status_dueAt_id_idx" ON "CleaningTask"("propertyId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "CleaningTask_status_dueAt_id_idx" ON "CleaningTask"("status", "dueAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_id_propertyId_key" ON "CleaningTask"("id", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_currentSubmissionId_propertyId_key" ON "CleaningTask"("currentSubmissionId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_departingStayId_propertyId_key" ON "CleaningTask"("departingStayId", "propertyId");

-- CreateIndex
CREATE INDEX "ChecklistSubmission_cleaningTaskId_propertyId_idx" ON "ChecklistSubmission"("cleaningTaskId", "propertyId");

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_departingStayId_propertyId_fkey" FOREIGN KEY ("departingStayId", "propertyId") REFERENCES "Stay"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_currentSubmissionId_propertyId_fkey" FOREIGN KEY ("currentSubmissionId", "propertyId") REFERENCES "ChecklistSubmission"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChecklistSubmission" ADD CONSTRAINT "ChecklistSubmission_cleaningTaskId_propertyId_fkey" FOREIGN KEY ("cleaningTaskId", "propertyId") REFERENCES "CleaningTask"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

