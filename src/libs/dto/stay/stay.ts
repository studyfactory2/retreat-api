import type {
  Prisma,
  Role,
  StayRevisionAction,
  StaySource,
  StayStatus,
} from '@prisma/client';
import type { ListDto } from '../common/list';

export interface StayPropertyDto {
  id: string;
  name: string;
  region: string | null;
  isActive: boolean;
}

export interface StayCreatorDto {
  id: string;
  name: string;
}

export interface StayDto {
  id: string;
  propertyId: string;
  guestUserId: string | null;
  guestName: string;
  company: string | null;
  department: string | null;
  phone: string | null;
  checkInAt: Date;
  checkOutAt: Date;
  status: StayStatus;
  source: StaySource;
  notes: string | null;
  createdByUserId: string;
  currentRevision: number;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  property: StayPropertyDto;
  createdBy: StayCreatorDto;
}

export type StayListDto = ListDto<StayDto>;

export interface StaySnapshot {
  schemaVersion: 1;
  id: string;
  propertyId: string;
  guestUserId: string | null;
  guestName: string;
  company: string | null;
  department: string | null;
  phone: string | null;
  checkInAt: string;
  checkOutAt: string;
  status: StayStatus;
  source: StaySource;
  notes: string | null;
  createdByUserId: string;
  currentRevision: number;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  property: StayPropertyDto;
}

export interface StayActorSnapshot {
  schemaVersion: 1;
  id: string;
  name: string;
  role: Role;
}

export interface StayRevisionDto {
  id: string;
  stayId: string;
  version: number;
  action: StayRevisionAction;
  snapshot: Prisma.JsonValue;
  actorUserId: string;
  actorSnapshot: Prisma.JsonValue;
  reason: string | null;
  importRowId: string | null;
  createdAt: Date;
}

export type StayRevisionListDto = ListDto<StayRevisionDto>;
