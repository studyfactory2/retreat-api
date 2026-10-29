-- CreateEnum
CREATE TYPE "ChecklistTemplateVersionSource" AS ENUM ('BASELINE', 'PUBLISHED');

-- CreateTable
CREATE TABLE "ChecklistTemplateVersion" (
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "source" "ChecklistTemplateVersionSource" NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChecklistTemplateVersion_pkey" PRIMARY KEY ("templateId","version")
);

-- CreateIndex
CREATE INDEX "ChecklistTemplateVersion_actorUserId_idx" ON "ChecklistTemplateVersion"("actorUserId");

-- AddForeignKey
ALTER TABLE "ChecklistTemplateVersion" ADD CONSTRAINT "ChecklistTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplateVersion" ADD CONSTRAINT "ChecklistTemplateVersion_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
