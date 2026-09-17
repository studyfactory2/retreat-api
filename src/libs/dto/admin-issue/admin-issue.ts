import type {
  ActorSource,
  ChecklistType,
  IssueEventType,
  IssueStatus,
  Role,
} from '@prisma/client';
import type { DraftPhotoDto } from '../attachment/attachment';
import type { ListDto } from '../common/list';

export interface AdminIssueRecordDto {
  id: string;
  property: { id: string; name: string; region: string | null };
  category: { id: string; name: string };
  title: string;
  description: string | null;
  areaLabel: string | null;
  isUrgent: boolean;
  status: IssueStatus;
  sourceSubmissionId: string | null;
  sourceItemId: string | null;
  sourceRevisionId: string | null;
  recurrenceOfIssueId: string | null;
  currentVersion: number;
  reportedAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  updatedAt: Date;
  source: {
    checklistType: ChecklistType;
    templateId: string;
    templateTitle: string;
    templateVersion: number;
    sectionId: string;
  } | null;
}

export interface AdminIssueActorDto {
  id: string | null;
  role: Role;
  name: string;
}

export interface AdminIssuePhotoDto extends DraftPhotoDto {
  sortOrder: number;
}

export interface AdminIssueEventDto {
  id: string;
  issueId: string;
  version: number;
  type: IssueEventType;
  actorSource: ActorSource;
  actor: AdminIssueActorDto;
  sourceRevisionId: string | null;
  note: string | null;
  fromStatus: IssueStatus | null;
  toStatus: IssueStatus | null;
  createdAt: Date;
  record: AdminIssueRecordDto;
  photos: AdminIssuePhotoDto[];
}

export interface AdminIssueDetailDto {
  issue: AdminIssueRecordDto;
  report: AdminIssueEventDto;
  latestEvent: AdminIssueEventDto;
}

export type AdminIssueSummaryDto = Pick<
  AdminIssueRecordDto,
  | 'id'
  | 'property'
  | 'category'
  | 'title'
  | 'areaLabel'
  | 'isUrgent'
  | 'status'
  | 'currentVersion'
  | 'reportedAt'
  | 'resolvedAt'
  | 'updatedAt'
>;

export type AdminIssueListDto = ListDto<AdminIssueSummaryDto>;
export type AdminIssueHistoryDto = ListDto<AdminIssueEventDto>;

export interface AdminIssuePhotoViewDto {
  url: string;
  expiresAt: Date;
}
