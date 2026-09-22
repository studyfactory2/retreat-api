export interface GuestStayVehicleDto {
  stayId: string;
  property: { id: string; name: string; region: string | null };
  enabled: boolean;
  version: number;
  plateNumber: string | null;
  needsConfirmation: boolean;
  updatedAt: Date | null;
}
