import type { IssueStatus } from '@prisma/client';

export interface ReportSubmissionRow {
  id: string;
  revision: number;
  type: 'CHECK_IN' | 'CHECK_OUT' | 'MAINTENANCE';
  propertyName: string;
  region: string | null;
  authorName: string;
  visitDate: string;
  startedAt: Date | null;
  submittedAt: Date;
  answeredItemCount: number;
  abnormalItemCount: number;
  photoCount: number;
  stayId: string | null;
}

export interface ReportIssueRow {
  id: string;
  version: number;
  propertyName: string;
  region: string | null;
  categoryName: string;
  title: string;
  areaLabel: string | null;
  isUrgent: boolean;
  status: IssueStatus;
  reportedAt: Date;
  resolvedAt: Date | null;
}

export interface ReportData {
  from: string;
  to: string;
  generatedAt: Date;
  propertyId: string | null;
  propertyLabel: string;
  guestSubmissions: ReportSubmissionRow[];
  maintenanceSubmissions: ReportSubmissionRow[];
  issues: ReportIssueRow[];
}
