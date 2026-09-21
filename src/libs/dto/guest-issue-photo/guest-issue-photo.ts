import type {
  DraftPhotoDto,
  DraftPhotoViewDto,
  RemovedDraftPhotoDto,
} from '../attachment/attachment';

export interface GuestIssuePhotoUploadDto {
  photo: DraftPhotoDto;
  token: string;
  expiresAt: Date;
}

export type GuestIssuePhotoViewDto = DraftPhotoViewDto;

export type RemovedGuestIssuePhotoDto = RemovedDraftPhotoDto;
