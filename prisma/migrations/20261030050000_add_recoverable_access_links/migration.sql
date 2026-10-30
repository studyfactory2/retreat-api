-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "guestQrTokenCiphertext" TEXT,
ADD COLUMN     "staffQrTokenCiphertext" TEXT;

-- AlterTable
ALTER TABLE "Stay" ADD COLUMN     "guestLinkTokenCiphertext" TEXT;
