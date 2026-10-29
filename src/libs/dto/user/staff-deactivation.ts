import type { StaffDto } from './staff';

export interface StaffHandoverAssignmentDto {
  propertyId: string;
  propertyName: string;
  propertyRegion: string | null;
  isActive: boolean;
  replacementStaffId: string | null;
  replacementStaffName: string | null;
}

export interface StaffDeactivationAuditDto {
  id: string;
  deactivatedAt: Date;
  actor: { id: string; name: string };
  assignments: StaffHandoverAssignmentDto[];
  revokedDraftCount: number;
  reassignedPropertyIds: string[];
  clearedPropertyIds: string[];
  staffQrReissuePropertyIds: string[];
}

export interface StaffDeactivationPreviewDto {
  staff: StaffDto;
  expectedStateToken: string;
  properties: {
    id: string;
    name: string;
    region: string | null;
    isActive: boolean;
    unfinishedDraftCount: number;
  }[];
  unfinishedDraftCount: number;
  latestDeactivation: StaffDeactivationAuditDto | null;
}

export interface StaffDeactivationResultDto extends StaffDeactivationAuditDto {
  staff: StaffDto;
}
