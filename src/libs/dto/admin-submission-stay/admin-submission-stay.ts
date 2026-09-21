import type { ChecklistType } from '@prisma/client';
import type { ListDto } from '../common/list';

export interface SubmissionStayCandidateDto {
  id: string;
  propertyId: string;
  guestName: string;
  company: string | null;
  department: string | null;
  phone: string | null;
  checkInAt: Date;
  checkOutAt: Date;
  currentRevision: number;
  alreadyLinked: boolean;
}

export interface SubmissionStayCandidatesDto extends ListDto<SubmissionStayCandidateDto> {
  submissionId: string;
  currentRevision: number;
  currentStayId: string | null;
  visitDate: string;
  type: ChecklistType;
}

export interface SubmissionStayLinkDto {
  id: string;
  stayId: string | null;
  revision: number;
  updatedAt: Date;
  changed: boolean;
}
