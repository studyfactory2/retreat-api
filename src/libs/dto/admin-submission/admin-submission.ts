import type {
  ActorSource,
  ChecklistType,
  PhotoPurpose,
  Role,
  SubmissionRevisionAction,
} from '@prisma/client';
import type { DraftPhotoDto } from '../attachment/attachment';
import type { ListDto } from '../common/list';
import type {
  DraftAnswers,
  DraftTemplateSnapshot,
} from '../submission-draft/submission-draft';

export interface AdminSubmissionAuthorDto {
  id: string | null;
  role: 'GUEST' | 'STAFF';
  name: string;
  company: string | null;
  department: string | null;
  phone: string | null;
}

export interface AdminSubmissionActorDto {
  id: string | null;
  role: Role;
  name: string;
}

export interface AdminSubmissionRecordDto {
  property: { id: string; name: string; region: string | null };
  type: ChecklistType;
  visitDate: string;
  stayId: string | null;
  authorSource: ActorSource;
  author: AdminSubmissionAuthorDto;
  template: DraftTemplateSnapshot;
  answers: DraftAnswers;
  startedAt: Date | null;
  submittedAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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
