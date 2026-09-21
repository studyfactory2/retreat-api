import type { ActorSource, IssueEventType, IssueStatus } from '@prisma/client';
import type { DraftPhotoDto } from '../attachment/attachment';
import type { ListDto } from '../common/list';
import type { IssueActor, IssueRecord } from '../issue-record/issue-record';

export type AdminIssueRecordDto = IssueRecord;
export type AdminIssueActorDto = IssueActor;

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
