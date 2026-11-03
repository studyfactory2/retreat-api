import type { PropertyRoomCodeMode } from '@prisma/client';

export enum PropertyAccessCodeKind {
  ENTRANCE = 'ENTRANCE',
  FIXED_ROOM = 'FIXED_ROOM',
  VACANCY = 'VACANCY',
}

export interface AdminPropertyAccessSettingsDto {
  property: {
    id: string;
    name: string;
    region: string | null;
    isActive: boolean;
  };
  settings: {
    version: number;
    roomMode: PropertyRoomCodeMode | null;
    hasEntranceCode: boolean;
    hasFixedRoomCode: boolean;
    hasVacancyCode: boolean;
    updatedAt: Date | null;
  };
}

export interface RevealedPropertyAccessCodeDto {
  kind: PropertyAccessCodeKind;
  code: string;
  version: number;
}
