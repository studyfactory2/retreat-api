import type {
  ActorSource,
  ChecklistType,
  PhotoPurpose,
  SubmissionRevisionAction,
} from '@prisma/client';
import type { DraftPhotoDto } from '../attachment/attachment';
import type { ListDto } from '../common/list';
import type {
  SubmissionActor,
  SubmissionAuthor,
  SubmissionRecord,
} from '../submission-record/submission-record';

export type AdminSubmissionAuthorDto = SubmissionAuthor;
export type AdminSubmissionActorDto = SubmissionActor;
export type AdminSubmissionRecordDto = SubmissionRecord;

export interface AdminSubmissionPhotoDto extends DraftPhotoDto {
  purpose: PhotoPurpose;
  sectionId: string | null;
  itemId: string | null;
  areaLabel: string | null;
  sortOrder: number;
}

export interface AdminSubmissionRevisionDto {
  id: string;
  submissionId: string;
  version: number;
  action: SubmissionRevisionAction;
  status: 'SUBMITTED' | 'CANCELLED';
  createdAt: Date;
  reason: string | null;
  actorSource: ActorSource;
  actor: AdminSubmissionActorDto;
  record: AdminSubmissionRecordDto;
  photos: AdminSubmissionPhotoDto[];
}

export interface AdminSubmissionSummaryDto {
  id: string;
  type: ChecklistType;
  status: 'SUBMITTED' | 'CANCELLED';
  currentRevision: number;
  property: { id: string; name: string; region: string | null };
  visitDate: string;
  author: Pick<AdminSubmissionAuthorDto, 'id' | 'name' | 'role'>;
  startedAt: Date | null;
  submittedAt: Date;
  cancelledAt: Date | null;
  answeredItemCount: number;
  abnormalItemCount: number;
  photoCount: number;
}

export interface AdminSubmissionDetailDto {
  id: string;
  status: 'SUBMITTED' | 'CANCELLED';
  currentRevision: number;
  revision: AdminSubmissionRevisionDto;
}

export type AdminSubmissionListDto = ListDto<AdminSubmissionSummaryDto>;
export type AdminSubmissionHistoryDto = ListDto<AdminSubmissionRevisionDto>;

export interface AdminSubmissionPhotoViewDto {
  url: string;
  expiresAt: Date;
}
