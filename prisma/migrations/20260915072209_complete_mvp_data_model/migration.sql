/*
  Warnings:

  - A unique constraint covering the columns `[guestQrTokenHash]` on the table `Property` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[staffQrTokenHash]` on the table `Property` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "StayStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaySource" AS ENUM ('MANUAL', 'EXCEL');

-- CreateEnum
CREATE TYPE "StayRevisionAction" AS ENUM ('CREATED', 'CORRECTED', 'CANCELLED', 'RESTORED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'CONFIRMED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'NEEDS_REVIEW', 'INVALID');

-- CreateEnum
CREATE TYPE "ChecklistType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionRevisionAction" AS ENUM ('SUBMITTED', 'CORRECTED', 'CANCELLED', 'RESTORED');

-- CreateEnum
CREATE TYPE "ActorSource" AS ENUM ('ADMIN_SESSION', 'GUEST_QR', 'STAFF_QR', 'PRIVATE_LINK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PHOTO', 'IMPORT_SOURCE');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "PhotoPurpose" AS ENUM ('DEFECT', 'MAINTENANCE_BEFORE', 'MAINTENANCE_AFTER', 'REPAIR');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IssueEventType" AS ENUM ('REPORTED', 'UPDATED', 'STATUS_CHANGED', 'REPAIR_REPORTED', 'RESOLVED', 'REOPENED', 'CANCELLED', 'RESTORED');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "guestQrRotatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "guestQrTokenHash" TEXT,
ADD COLUMN     "staffQrRotatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "staffQrTokenHash" TEXT;

-- CreateTable
CREATE TABLE "Stay" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestUserId" TEXT,
    "guestName" TEXT NOT NULL,
    "company" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "checkInAt" TIMESTAMPTZ(3) NOT NULL,
    "checkOutAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "StayStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "StaySource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Stay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StayRevision" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" "StayRevisionAction" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorSnapshot" JSONB NOT NULL,
    "reason" TEXT,
    "importRowId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StayRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "sourceAttachmentId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "parserVersion" TEXT NOT NULL DEFAULT 'retreat-roster-v1',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "validationStatus" "ImportRowStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "validationMessages" JSONB NOT NULL DEFAULT '[]',
    "action" "ImportRowAction" NOT NULL DEFAULT 'SKIP',
    "propertyId" TEXT,
    "stayId" TEXT,
    "expectedStayRevision" INTEGER,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "appliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "ChecklistType" NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistSubmission" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "ChecklistType" NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "templateSnapshot" JSONB NOT NULL,
    "stayId" TEXT,
    "authorUserId" TEXT,
    "authorSnapshot" JSONB NOT NULL,
    "authorSource" "ActorSource" NOT NULL,
    "visitDate" DATE NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "draftAnswers" JSONB,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "privateTokenHash" TEXT,
    "privateTokenExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChecklistSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionRevision" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" "SubmissionRevisionAction" NOT NULL,
    "status" "SubmissionStatus" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorSource" "ActorSource" NOT NULL,
    "actorUserId" TEXT,
    "actorSnapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "propertyId" TEXT,
    "submissionId" TEXT,
    "uploadedByUserId" TEXT,
    "uploadTokenHash" TEXT,
    "uploadExpiresAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionRevisionAttachment" (
    "revisionId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "purpose" "PhotoPurpose" NOT NULL,
    "sectionId" TEXT,
    "itemId" TEXT,
    "areaLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SubmissionRevisionAttachment_pkey" PRIMARY KEY ("revisionId","attachmentId")
);

-- CreateTable
CREATE TABLE "IssueCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IssueCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "areaLabel" TEXT,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "IssueStatus" NOT NULL DEFAULT 'NEW',
    "sourceSubmissionId" TEXT,
    "sourceItemId" TEXT,
    "sourceRevisionId" TEXT,
    "recurrenceOfIssueId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedByUserId" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "IssueEventType" NOT NULL,
    "actorSource" "ActorSource" NOT NULL,
    "actorUserId" TEXT,
    "actorSnapshot" JSONB NOT NULL,
    "sourceRevisionId" TEXT,
    "note" TEXT,
    "fromStatus" "IssueStatus",
    "toStatus" "IssueStatus",
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueEventAttachment" (
    "eventId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IssueEventAttachment_pkey" PRIMARY KEY ("eventId","attachmentId")
);

-- CreateIndex
CREATE INDEX "Stay_propertyId_status_checkInAt_idx" ON "Stay"("propertyId", "status", "checkInAt");

-- CreateIndex
CREATE INDEX "Stay_propertyId_status_checkOutAt_idx" ON "Stay"("propertyId", "status", "checkOutAt");

-- CreateIndex
CREATE INDEX "Stay_guestUserId_idx" ON "Stay"("guestUserId");

-- CreateIndex
CREATE INDEX "Stay_createdByUserId_idx" ON "Stay"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Stay_id_propertyId_key" ON "Stay"("id", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "StayRevision_importRowId_key" ON "StayRevision"("importRowId");

-- CreateIndex
CREATE INDEX "StayRevision_actorUserId_idx" ON "StayRevision"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StayRevision_stayId_version_key" ON "StayRevision"("stayId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_sourceAttachmentId_key" ON "ImportBatch"("sourceAttachmentId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_createdAt_idx" ON "ImportBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_uploadedByUserId_idx" ON "ImportBatch"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "ImportBatch_confirmedByUserId_idx" ON "ImportBatch"("confirmedByUserId");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_action_validationStatus_idx" ON "ImportRow"("batchId", "action", "validationStatus");

-- CreateIndex
CREATE INDEX "ImportRow_propertyId_idx" ON "ImportRow"("propertyId");

-- CreateIndex
CREATE INDEX "ImportRow_stayId_propertyId_idx" ON "ImportRow"("stayId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_sheetName_rowNumber_key" ON "ImportRow"("batchId", "sheetName", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_propertyId_type_key" ON "ChecklistTemplate"("propertyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_id_propertyId_key" ON "ChecklistTemplate"("id", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistSubmission_requestKey_key" ON "ChecklistSubmission"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistSubmission_privateTokenHash_key" ON "ChecklistSubmission"("privateTokenHash");

-- CreateIndex
CREATE INDEX "ChecklistSubmission_propertyId_type_status_visitDate_idx" ON "ChecklistSubmission"("propertyId", "type", "status", "visitDate");

-- CreateIndex
CREATE INDEX "ChecklistSubmission_propertyId_type_startedAt_idx" ON "ChecklistSubmission"("propertyId", "type", "startedAt");

-- CreateIndex
CREATE INDEX "ChecklistSubmission_stayId_type_status_idx" ON "ChecklistSubmission"("stayId", "type", "status");

-- CreateIndex
CREATE INDEX "ChecklistSubmission_templateId_propertyId_idx" ON "ChecklistSubmission"("templateId", "propertyId");

-- CreateIndex
CREATE INDEX "ChecklistSubmission_authorUserId_idx" ON "ChecklistSubmission"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistSubmission_id_propertyId_key" ON "ChecklistSubmission"("id", "propertyId");

-- CreateIndex
CREATE INDEX "SubmissionRevision_actorUserId_idx" ON "SubmissionRevision"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionRevision_submissionId_version_key" ON "SubmissionRevision"("submissionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionRevision_id_submissionId_key" ON "SubmissionRevision"("id", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_uploadTokenHash_key" ON "Attachment"("uploadTokenHash");

-- CreateIndex
CREATE INDEX "Attachment_submissionId_propertyId_idx" ON "Attachment"("submissionId", "propertyId");

-- CreateIndex
CREATE INDEX "Attachment_propertyId_createdAt_idx" ON "Attachment"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_status_uploadExpiresAt_idx" ON "Attachment"("status", "uploadExpiresAt");

-- CreateIndex
CREATE INDEX "Attachment_uploadedByUserId_idx" ON "Attachment"("uploadedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_id_submissionId_key" ON "Attachment"("id", "submissionId");

-- CreateIndex
CREATE INDEX "SubmissionRevisionAttachment_attachmentId_submissionId_idx" ON "SubmissionRevisionAttachment"("attachmentId", "submissionId");

-- CreateIndex
CREATE INDEX "SubmissionRevisionAttachment_revisionId_submissionId_idx" ON "SubmissionRevisionAttachment"("revisionId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueCategory_name_key" ON "IssueCategory"("name");

-- CreateIndex
CREATE INDEX "IssueCategory_isActive_sortOrder_idx" ON "IssueCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_requestKey_key" ON "Issue"("requestKey");

-- CreateIndex
CREATE INDEX "Issue_propertyId_status_cancelledAt_reportedAt_idx" ON "Issue"("propertyId", "status", "cancelledAt", "reportedAt");

-- CreateIndex
CREATE INDEX "Issue_propertyId_isUrgent_status_idx" ON "Issue"("propertyId", "isUrgent", "status");

-- CreateIndex
CREATE INDEX "Issue_categoryId_idx" ON "Issue"("categoryId");

-- CreateIndex
CREATE INDEX "Issue_sourceSubmissionId_propertyId_idx" ON "Issue"("sourceSubmissionId", "propertyId");

-- CreateIndex
CREATE INDEX "Issue_sourceRevisionId_sourceSubmissionId_idx" ON "Issue"("sourceRevisionId", "sourceSubmissionId");

-- CreateIndex
CREATE INDEX "Issue_recurrenceOfIssueId_propertyId_idx" ON "Issue"("recurrenceOfIssueId", "propertyId");

-- CreateIndex
CREATE INDEX "Issue_resolvedByUserId_idx" ON "Issue"("resolvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_id_propertyId_key" ON "Issue"("id", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_sourceSubmissionId_sourceItemId_key" ON "Issue"("sourceSubmissionId", "sourceItemId");

-- CreateIndex
CREATE INDEX "IssueEvent_actorUserId_idx" ON "IssueEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "IssueEvent_sourceRevisionId_idx" ON "IssueEvent"("sourceRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueEvent_issueId_version_key" ON "IssueEvent"("issueId", "version");

-- CreateIndex
CREATE INDEX "IssueEventAttachment_attachmentId_idx" ON "IssueEventAttachment"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_guestQrTokenHash_key" ON "Property"("guestQrTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Property_staffQrTokenHash_key" ON "Property"("staffQrTokenHash");

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_guestUserId_fkey" FOREIGN KEY ("guestUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayRevision" ADD CONSTRAINT "StayRevision_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayRevision" ADD CONSTRAINT "StayRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayRevision" ADD CONSTRAINT "StayRevision_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "ImportRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_sourceAttachmentId_fkey" FOREIGN KEY ("sourceAttachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_stayId_propertyId_fkey" FOREIGN KEY ("stayId", "propertyId") REFERENCES "Stay"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistSubmission" ADD CONSTRAINT "ChecklistSubmission_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistSubmission" ADD CONSTRAINT "ChecklistSubmission_templateId_propertyId_fkey" FOREIGN KEY ("templateId", "propertyId") REFERENCES "ChecklistTemplate"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChecklistSubmission" ADD CONSTRAINT "ChecklistSubmission_stayId_propertyId_fkey" FOREIGN KEY ("stayId", "propertyId") REFERENCES "Stay"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ChecklistSubmission" ADD CONSTRAINT "ChecklistSubmission_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionRevision" ADD CONSTRAINT "SubmissionRevision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ChecklistSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionRevision" ADD CONSTRAINT "SubmissionRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_submissionId_propertyId_fkey" FOREIGN KEY ("submissionId", "propertyId") REFERENCES "ChecklistSubmission"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionRevisionAttachment" ADD CONSTRAINT "SubmissionRevisionAttachment_revisionId_submissionId_fkey" FOREIGN KEY ("revisionId", "submissionId") REFERENCES "SubmissionRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SubmissionRevisionAttachment" ADD CONSTRAINT "SubmissionRevisionAttachment_attachmentId_submissionId_fkey" FOREIGN KEY ("attachmentId", "submissionId") REFERENCES "Attachment"("id", "submissionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IssueCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_sourceSubmissionId_propertyId_fkey" FOREIGN KEY ("sourceSubmissionId", "propertyId") REFERENCES "ChecklistSubmission"("id", "propertyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_sourceRevisionId_sourceSubmissionId_fkey" FOREIGN KEY ("sourceRevisionId", "sourceSubmissionId") REFERENCES "SubmissionRevision"("id", "submissionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_recurrenceOfIssueId_propertyId_fkey" FOREIGN KEY ("recurrenceOfIssueId", "propertyId") REFERENCES "Issue"("id", "propertyId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_sourceRevisionId_fkey" FOREIGN KEY ("sourceRevisionId") REFERENCES "SubmissionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEventAttachment" ADD CONSTRAINT "IssueEventAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IssueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEventAttachment" ADD CONSTRAINT "IssueEventAttachment_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
