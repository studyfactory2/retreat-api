import type { PropertyRoomCodeMode } from '@prisma/client';

export type GuestAccessCodeKind = 'ENTRANCE' | 'ROOM';

export interface GuestStayAccessCodesDto {
  stayId: string;
  propertyId: string;
  state: 'SCHEDULED' | 'AVAILABLE' | 'ENDED' | 'UNAVAILABLE';
  opensAt: Date;
  closesAt: Date;
  serverTime: Date;
  entranceAvailable: boolean;
  roomAvailable: boolean;
  roomMode: PropertyRoomCodeMode | null;
  fingerprint: string | null;
}

export interface RevealedGuestStayAccessCodeDto {
  stayId: string;
  propertyId: string;
  kind: GuestAccessCodeKind;
  code: string;
  fingerprint: string;
  serverTime: Date;
  visibleUntil: Date;
}
