import type { ChecklistType } from '@prisma/client';
import type { ChecklistDefinition } from '../checklist-template/checklist-template';

export enum QrFlow {
  GUEST = 'GUEST',
  STAFF = 'STAFF',
}

export interface QrStateDto {
  issued: boolean;
  enabled: boolean;
  rotatedAt: Date | null;
}

export interface PropertyQrStatusDto {
  propertyId: string;
  propertyIsActive: boolean;
  guest: QrStateDto;
  staff: QrStateDto;
}

export interface QrIssueDto {
  propertyId: string;
  flow: QrFlow;
  url: string;
  rotatedAt: Date;
}

export interface PublicQrPropertyDto {
  id: string;
  name: string;
  region: string | null;
}

export interface QrChecklistDto {
  id: string;
  type: ChecklistType;
  title: string;
  version: number;
  definition: ChecklistDefinition;
}

export interface GuestQrContextDto {
  flow: QrFlow.GUEST;
  property: PublicQrPropertyDto;
  checklists: QrChecklistDto[];
}

export interface StaffQrContextDto {
  flow: QrFlow.STAFF;
  property: PublicQrPropertyDto;
  assignedStaff: { id: string; name: string } | null;
  checklists: QrChecklistDto[];
}
