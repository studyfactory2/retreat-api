import type { ListDto } from '../common/list';

export type MaintenanceStatus =
  'UNFINISHED' | 'EXPIRED' | 'ACCESS_BLOCKED' | 'COMPLETED' | 'NEEDS_REVIEW';

export type MaintenanceReviewReason =
  | 'INVALID_RECORD'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_UNAVAILABLE'
  | 'PROPERTY_INACTIVE'
  | 'STAFF_ASSIGNMENT_CHANGED'
  | 'STAFF_INACTIVE';

export interface AdminMaintenanceItemDto {
  id: string;
  property: {
    id: string;
    name: string;
    region: string | null;
    isActive: boolean;
  };
  staff: {
    id: string | null;
    name: string | null;
  };
  status: MaintenanceStatus;
  reviewReasons: MaintenanceReviewReason[];
  startedAt: Date | null;
  updatedAt: Date;
  submittedAt: Date | null;
  expiresAt: Date | null;
  currentRevision: number;
}

export interface AdminMaintenanceDto extends ListDto<AdminMaintenanceItemDto> {
  asOf: Date;
  timezone: 'Asia/Seoul';
}

export interface MaintenanceSummaryDto {
  started: number;
  completed: number;
  completionNeedsReview: number;
  unfinished: {
    total: number;
    resumable: number;
    expired: number;
    accessBlocked: number;
    needsReview: number;
  };
}
