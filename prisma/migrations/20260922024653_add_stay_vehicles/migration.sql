-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "vehicleRegistrationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StayVehicle" (
    "stayId" TEXT NOT NULL,
    "plateNumber" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "stayRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StayVehicle_pkey" PRIMARY KEY ("stayId")
);

-- AddForeignKey
ALTER TABLE "StayVehicle" ADD CONSTRAINT "StayVehicle_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
