import type { ChecklistType, PhotoPurpose } from '@prisma/client';

export type PreparedSubmissionPhoto = {
  attachmentId: string;
  purpose: PhotoPurpose;
  sectionId: string | null;
  itemId: string | null;
  areaLabel: string | null;
  sortOrder: number;
};

export interface SubmissionReceiptDto {
  id: string;
  status: 'SUBMITTED';
  type: ChecklistType;
  property: { id: string; name: string; region: string | null };
  visitDate: string;
  startedAt: Date | null;
  submittedAt: Date;
  revision: number;
  answeredItemCount: number;
  photoCount: number;
  reportedIssueCount: number;
  expiresAt: Date;
}
