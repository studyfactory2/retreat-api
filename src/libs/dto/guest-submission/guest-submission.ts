import type { PhotoPurpose } from '@prisma/client';
import type { DraftPhotoDto } from '../attachment/attachment';
import type {
  DraftAnswers,
  DraftTemplateSnapshot,
} from '../submission-draft/submission-draft';

export interface GuestSubmissionPhotoDto extends DraftPhotoDto {
  purpose: PhotoPurpose;
  sectionId: string | null;
  itemId: string | null;
  areaLabel: string | null;
  sortOrder: number;
}

export interface GuestSubmissionDto {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  status: 'SUBMITTED';
  revision: number;
  property: { id: string; name: string; region: string | null };
  visitDate: string;
  guest: {
    name: string;
    company: string | null;
    department: string | null;
    phone: string | null;
  };
  template: DraftTemplateSnapshot;
  answers: DraftAnswers;
  submittedAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  photos: GuestSubmissionPhotoDto[];
}

export interface GuestSubmissionPhotoViewDto {
  url: string;
  expiresAt: Date;
}

export interface GuestSubmissionCorrectionDto {
  id: string;
  status: 'SUBMITTED';
  revision: number;
  updatedAt: Date;
  changed: boolean;
}
