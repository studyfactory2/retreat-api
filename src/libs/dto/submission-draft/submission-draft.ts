import type { ChecklistType } from '@prisma/client';
import type { ChecklistDefinition } from '../checklist-template/checklist-template';

export type DraftAnswer = {
  itemId: string;
  value: 'NORMAL' | 'ABNORMAL';
  description: string | null;
  isUrgent: boolean;
  repairReported: boolean;
  repairNote: string | null;
};

export type DraftAnswers = {
  schemaVersion: 1;
  items: DraftAnswer[];
  generalNote: string | null;
};

export type DraftTemplateSnapshot = {
  schemaVersion: 1;
  id: string;
  type: ChecklistType;
  title: string;
  version: number;
  definition: ChecklistDefinition;
};

export type DraftAuthorSnapshot = {
  schemaVersion: 1;
  role: 'GUEST' | 'STAFF';
  name: string;
  company: string | null;
  department: string | null;
  phone: string | null;
};

export interface SubmissionDraftDto {
  id: string;
  property: { id: string; name: string; region: string | null };
  type: ChecklistType;
  status: 'DRAFT';
  visitDate: string;
  author: DraftAuthorSnapshot;
  template: DraftTemplateSnapshot;
  answers: DraftAnswers;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface StartDraftDto {
  draft: SubmissionDraftDto;
  accessToken: string;
  url: string;
  expiresAt: Date;
}
