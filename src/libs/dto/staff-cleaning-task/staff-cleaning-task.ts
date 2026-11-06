import type { CleaningTaskSource } from '@prisma/client';
import type { ListDto } from '../common/list';

export interface StaffCompletedWorkDto {
  id: string;
  source: CleaningTaskSource | 'STANDALONE';
  completedAt: Date;
  requiresReview: boolean;
  schedule: {
    dueAt: Date;
    checkOutAt: Date | null;
    note: string | null;
  } | null;
}

export type StaffCompletedWorkListDto = ListDto<StaffCompletedWorkDto>;

export interface TaskPasswordDto {
  taskId: string;
  fingerprint: string;
  kind: 'NEXT_STAY' | 'VACANCY' | 'FIXED' | 'BLOCKED';
  canComplete: boolean;
  blockedReason: string | null;
  nextCheckInAt: Date | null;
  requiresChange: boolean;
}

export interface RevealedTaskPasswordDto {
  code: string;
  fingerprint: string;
}
