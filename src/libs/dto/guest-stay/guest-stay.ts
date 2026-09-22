import type { QrChecklistDto } from '../qr/qr';

export interface GuestStayDto {
  stayId: string;
  guestName: string;
  checkInAt: Date;
  checkOutAt: Date;
  expiresAt: Date;
  property: {
    id: string;
    name: string;
    region: string | null;
    vehicleRegistrationEnabled: boolean;
  };
  checklists: QrChecklistDto[];
}
