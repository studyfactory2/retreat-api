import type { ActorSource, ChecklistType, Role } from '@prisma/client';
import type {
  DraftAnswers,
  DraftTemplateSnapshot,
} from '../submission-draft/submission-draft';

export interface SubmissionAuthor {
  id: string | null;
  role: 'GUEST' | 'STAFF';
  name: string;
  company: string | null;
  department: string | null;
  phone: string | null;
}

export interface SubmissionActor {
  id: string | null;
  role: Role;
  name: string;
}

export interface SubmissionRecord {
  property: { id: string; name: string; region: string | null };
  type: ChecklistType;
  visitDate: string;
  stayId: string | null;
  authorSource: ActorSource;
  author: SubmissionAuthor;
  template: DraftTemplateSnapshot;
  answers: DraftAnswers;
  startedAt: Date | null;
  submittedAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
