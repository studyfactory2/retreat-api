-- CreateEnum
CREATE TYPE "PropertyGuideType" AS ENUM ('TEXT', 'PDF');

-- AlterTable
ALTER TABLE "PropertyGuide" ADD COLUMN     "pdfBucket" TEXT,
ADD COLUMN     "pdfFilename" TEXT,
ADD COLUMN     "pdfKey" TEXT,
ADD COLUMN     "pdfSizeBytes" INTEGER,
ADD COLUMN     "type" "PropertyGuideType" NOT NULL DEFAULT 'TEXT';
