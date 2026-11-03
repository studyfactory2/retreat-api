import type {
  CleaningTaskSource,
  CleaningTaskStatus,
  StayStatus,
} from '@prisma/client';
import type { ListDto } from '../common/list';

export interface CleaningTaskDto {
  id: string;
  property: {
    id: string;
    name: string;
    staffUserId: string | null;
    staffName: string | null;
  };
  departingStay: {
    id: string;
    checkOutAt: Date;
    currentRevision: number;
    status: StayStatus;
  } | null;
  source: CleaningTaskSource;
  status: CleaningTaskStatus;
  dueAt: Date;
  version: number;
  currentSubmissionId: string | null;
  completedAt: Date | null;
  note: string | null;
  canStart: boolean;
  requiresReview: boolean;
}
export type CleaningTaskListDto = ListDto<CleaningTaskDto>;
export interface CleaningTaskSyncDto {
  created: number;
  updated: number;
}
