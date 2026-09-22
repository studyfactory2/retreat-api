import type { StayStatus } from '@prisma/client';

export interface AdminStayVehicleDto {
  stay: {
    id: string;
    guestName: string;
    checkInAt: Date;
    checkOutAt: Date;
    status: StayStatus;
    currentRevision: number;
    property: {
      id: string;
      name: string;
      region: string | null;
      isActive: boolean;
      vehicleRegistrationEnabled: boolean;
    };
  };
  vehicle: {
    plateNumber: string | null;
    version: number;
    stayRevision: number;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  needsReview: boolean;
}
