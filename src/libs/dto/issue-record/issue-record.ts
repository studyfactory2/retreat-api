import type { ChecklistType, IssueStatus, Role } from '@prisma/client';

export interface IssueRecord {
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

export interface IssueActor {
  id: string | null;
  role: Role;
  name: string;
}
