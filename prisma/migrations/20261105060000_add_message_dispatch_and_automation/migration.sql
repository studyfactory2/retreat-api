-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('GUEST_CHECKIN', 'GUEST_CHECKOUT', 'GUEST_CHANGE', 'GUEST_CANCEL', 'STAFF_ASSIGNMENT', 'STAFF_CHANGE', 'STAFF_CANCEL');

-- CreateEnum
CREATE TYPE "MessageSubjectType" AS ENUM ('STAY', 'TASK');

-- CreateEnum
CREATE TYPE "MessageDispatchMode" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "MessageDispatchStatus" AS ENUM ('SENDING', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "MessageDispatch" (
    "id" TEXT NOT NULL,
    "subjectType" "MessageSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "mode" "MessageDispatchMode" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "deduplicationKey" TEXT,
    "contextHash" TEXT NOT NULL,
    "status" "MessageDispatchStatus" NOT NULL DEFAULT 'SENDING',
    "maskedRecipient" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "providerGroupId" TEXT,
    "actorUserId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCheckedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MessageDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAutomationState" (
    "id" TEXT NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,
    "fingerprintKeyId" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "lastScanAt" TIMESTAMPTZ(3),

    CONSTRAINT "MessageAutomationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAutomationTarget" (
    "id" TEXT NOT NULL,
    "subjectType" "MessageSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "observedStatus" TEXT NOT NULL,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageAutomationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAutomationJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subjectType" "MessageSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reasonCode" TEXT,
    "dispatchId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageAutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageDispatch_idempotencyKey_key" ON "MessageDispatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDispatch_deduplicationKey_key" ON "MessageDispatch"("deduplicationKey");

-- CreateIndex
CREATE INDEX "MessageDispatch_subjectType_subjectId_createdAt_idx" ON "MessageDispatch"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageDispatch_status_createdAt_idx" ON "MessageDispatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MessageAutomationTarget_subjectType_subjectId_idx" ON "MessageAutomationTarget"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAutomationJob_key_key" ON "MessageAutomationJob"("key");

-- CreateIndex
CREATE INDEX "MessageAutomationJob_status_dueAt_idx" ON "MessageAutomationJob"("status", "dueAt");

-- CreateIndex
CREATE INDEX "MessageAutomationJob_subjectType_subjectId_createdAt_idx" ON "MessageAutomationJob"("subjectType", "subjectId", "createdAt");

