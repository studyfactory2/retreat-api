-- CreateEnum
CREATE TYPE "StayAccessCodeMethod" AS ENUM ('AUTO', 'PHONE_LAST6', 'FIXED');

-- CreateEnum
CREATE TYPE "StayAccessCodeAction" AS ENUM ('PREPARED', 'REPLACED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "StayAccessCode" (
    "stayId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "method" "StayAccessCodeMethod" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "sourceStayRevision" INTEGER NOT NULL,
    "sourceSettingsVersion" INTEGER NOT NULL,
    "preparedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StayAccessCode_pkey" PRIMARY KEY ("stayId")
);

-- CreateTable
CREATE TABLE "StayAccessCodeEvent" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "codeVersion" INTEGER NOT NULL,
    "action" "StayAccessCodeAction" NOT NULL,
    "method" "StayAccessCodeMethod" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StayAccessCodeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StayAccessCodeEvent_actorUserId_idx" ON "StayAccessCodeEvent"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StayAccessCodeEvent_stayId_codeVersion_key" ON "StayAccessCodeEvent"("stayId", "codeVersion");

-- AddForeignKey
ALTER TABLE "StayAccessCode" ADD CONSTRAINT "StayAccessCode_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayAccessCodeEvent" ADD CONSTRAINT "StayAccessCodeEvent_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayAccessCodeEvent" ADD CONSTRAINT "StayAccessCodeEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
