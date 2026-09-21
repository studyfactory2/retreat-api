import {
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  ActorSource,
  ChecklistType,
  IssueEventType,
  IssueStatus,
  Prisma,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { seoulDateRange } from '../../libs/dates/seoul-date';
import type { GetAdminReportInput } from '../../libs/dto/admin-report/admin-report.input';
import type {
  ReportData,
  ReportIssueRow,
  ReportSubmissionRow,
} from '../../libs/dto/admin-report/admin-report';
import { parseIssueActor } from '../../libs/issues/issue-snapshot';
import {
  classifyMaintenance,
  maintenanceProgressSelect,
  type MaintenanceProgressRecord,
} from '../../libs/maintenance/maintenance-progress';
import { parseSubmissionSnapshot } from '../../libs/submissions/submission-snapshot';
import {
  AdminIssueReader,
  adminIssueInclude,
} from '../admin-issues/admin-issue-reader';
import { MAX_REPORT_DAYS, MAX_REPORT_RECORDS } from './admin-report-policy';

const issueInclude = {
  ...adminIssueInclude,
  events: {
    orderBy: { version: 'desc' },
    take: 1,
    select: {
      issueId: true,
      version: true,
      type: true,
      actorSource: true,
      actorUserId: true,
      actorSnapshot: true,
      sourceRevisionId: true,
      note: true,
      fromStatus: true,
      toStatus: true,
      snapshot: true,
      createdAt: true,
      sourceRevision: {
        select: {
          submissionId: true,
          submission: { select: { propertyId: true } },
        },
      },
    },
  },
} satisfies Prisma.IssueInclude;
type ReportIssueRecord = Prisma.IssueGetPayload<{
  include: typeof issueInclude;
}>;

@Injectable()
export class AdminReportReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: AdminIssueReader,
  ) {}

  public async read(input: GetAdminReportInput): Promise<ReportData> {
    const { start, end } = seoulDateRange(
      input.from,
      input.to,
      MAX_REPORT_DAYS,
      'INVALID_REPORT_RANGE',
    );
    const propertyId = input.propertyId?.toLowerCase();
    const generatedAt = new Date();
    return await this.prisma.$transaction(
      async (tx) => {
        const property = propertyId
          ? await tx.property.findUnique({
              where: { id: propertyId },
              select: { id: true, name: true },
            })
          : null;
        if (propertyId && !property)
          throw new NotFoundException({
            code: 'PROPERTY_NOT_FOUND',
            message: '휴양소를 찾을 수 없습니다.',
          });
        const submissionsWhere: Prisma.ChecklistSubmissionWhereInput = {
          propertyId,
          type: {
            in: [
              ChecklistType.CHECK_IN,
              ChecklistType.CHECK_OUT,
              ChecklistType.MAINTENANCE,
            ],
          },
          status: SubmissionStatus.SUBMITTED,
          cancelledAt: null,
          submittedAt: { gte: start, lt: end },
        };
        const issuesWhere: Prisma.IssueWhereInput = {
          propertyId,
          cancelledAt: null,
          status: {
            in: [
              IssueStatus.NEW,
              IssueStatus.IN_PROGRESS,
              IssueStatus.RESOLVED,
            ],
          },
          reportedAt: { gte: start, lt: end },
        };
        const submissionCount = await tx.checklistSubmission.count({
          where: submissionsWhere,
        });
        const issueCount = await tx.issue.count({ where: issuesWhere });
        if (submissionCount + issueCount > MAX_REPORT_RECORDS)
          throw new PayloadTooLargeException({
            code: 'REPORT_TOO_LARGE',
            message:
              '보고서 대상은 전체 5,000건까지 가능합니다. 기간 또는 휴양소를 좁혀 주세요.',
          });
        const result: ReportData = {
          from: input.from,
          to: input.to,
          generatedAt,
          propertyId: propertyId ?? null,
          propertyLabel: property?.name ?? '전체 휴양소',
          guestSubmissions: [],
          maintenanceSubmissions: [],
          issues: [],
        };
        let afterSubmissionId: string | undefined;
        for (;;) {
          const rows = await tx.checklistSubmission.findMany({
            where: {
              ...submissionsWhere,
              ...(afterSubmissionId ? { id: { gt: afterSubmissionId } } : {}),
            },
            select: maintenanceProgressSelect,
            orderBy: { id: 'asc' },
            take: 100,
          });
          for (const row of rows) {
            const summary = this.submissionRow(row, generatedAt);
            if (row.type === ChecklistType.MAINTENANCE)
              result.maintenanceSubmissions.push(summary);
            else result.guestSubmissions.push(summary);
          }
          if (rows.length < 100) break;
          afterSubmissionId = rows[rows.length - 1].id;
        }
        let afterIssueId: string | undefined;
        for (;;) {
          const rows = await tx.issue.findMany({
            where: {
              ...issuesWhere,
              ...(afterIssueId ? { id: { gt: afterIssueId } } : {}),
            },
            include: issueInclude,
            orderBy: { id: 'asc' },
            take: 100,
          });
          for (const row of rows) result.issues.push(this.issueRow(row));
          if (rows.length < 100) break;
          afterIssueId = rows[rows.length - 1].id;
        }
        if (
          result.guestSubmissions.length +
            result.maintenanceSubmissions.length !==
            submissionCount ||
          result.issues.length !== issueCount
        )
          throw this.needsReview();
        const bySubmissionTime = (
          left: ReportSubmissionRow,
          right: ReportSubmissionRow,
        ): number =>
          left.submittedAt.getTime() - right.submittedAt.getTime() ||
          left.id.localeCompare(right.id);
        result.guestSubmissions.sort(bySubmissionTime);
        result.maintenanceSubmissions.sort(bySubmissionTime);
        result.issues.sort(
          (left, right) =>
            left.reportedAt.getTime() - right.reportedAt.getTime() ||
            left.id.localeCompare(right.id),
        );
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30_000,
      },
    );
  }

  private submissionRow(
    row: MaintenanceProgressRecord,
    generatedAt: Date,
  ): ReportSubmissionRow {
    try {
      const revision = row.revisions[0];
      const maintenance = row.type === ChecklistType.MAINTENANCE;
      if (
        row.status !== SubmissionStatus.SUBMITTED ||
        row.cancelledAt !== null ||
        !row.submittedAt ||
        !revision ||
        revision.version !== row.currentRevision ||
        revision.status !== SubmissionStatus.SUBMITTED ||
        (maintenance
          ? classifyMaintenance(row, generatedAt).status !== 'COMPLETED'
          : !(
              (row.type === ChecklistType.CHECK_IN ||
                row.type === ChecklistType.CHECK_OUT) &&
              ((row.authorSource === ActorSource.GUEST_QR &&
                row.stayLinkVersion === null) ||
                (row.authorSource === ActorSource.PRIVATE_LINK &&
                  row.stayId !== null &&
                  Number.isSafeInteger(row.stayLinkVersion) &&
                  (row.stayLinkVersion ?? 0) > 0))
            ))
      )
        throw this.needsReview();
      const { record, photos } = parseSubmissionSnapshot(revision.snapshot, {
        submissionId: row.id,
        propertyId: row.propertyId,
        type: row.type,
        version: row.currentRevision,
        status: SubmissionStatus.SUBMITTED,
      });
      if (
        record.stayId !== row.stayId ||
        record.authorSource !== row.authorSource ||
        record.author.id !== row.authorUserId ||
        record.author.role !== (maintenance ? Role.STAFF : Role.GUEST) ||
        record.visitDate !== row.visitDate.toISOString().slice(0, 10) ||
        record.template.id !== row.templateId ||
        record.template.version !== row.templateVersion ||
        record.startedAt?.getTime() !== row.startedAt?.getTime() ||
        record.submittedAt.getTime() !== row.submittedAt.getTime() ||
        record.createdAt.getTime() !== row.createdAt.getTime() ||
        record.updatedAt.getTime() !== row.updatedAt.getTime()
      )
        throw this.needsReview();
      return {
        id: row.id,
        revision: row.currentRevision,
        type: row.type,
        propertyName: record.property.name,
        region: record.property.region,
        authorName: record.author.name,
        visitDate: record.visitDate,
        startedAt: record.startedAt,
        submittedAt: record.submittedAt,
        answeredItemCount: record.answers.items.length,
        abnormalItemCount: record.answers.items.filter(
          (answer) => answer.value === 'ABNORMAL',
        ).length,
        photoCount: photos.length,
        stayId: record.stayId,
      };
    } catch {
      throw this.needsReview();
    }
  }

  private issueRow(issue: ReportIssueRecord): ReportIssueRow {
    try {
      const event = issue.events[0];
      if (!event || event.issueId !== issue.id || issue.cancelledAt !== null)
        throw this.needsReview();
      const record = this.issues.currentRecord(issue, event);
      const actor = parseIssueActor(event.actorSnapshot, event.actorUserId);
      const expectedRole =
        event.actorSource === ActorSource.ADMIN_SESSION
          ? Role.ADMIN
          : event.actorSource === ActorSource.STAFF_QR
            ? Role.STAFF
            : event.actorSource === ActorSource.GUEST_QR ||
                event.actorSource === ActorSource.PRIVATE_LINK
              ? Role.GUEST
              : null;
      if (
        actor.role !== expectedRole ||
        event.toStatus !== record.status ||
        event.createdAt.getTime() !== record.updatedAt.getTime() ||
        (event.note !== null && [...event.note].length > 2000) ||
        (event.version === 1 &&
          (event.type !== IssueEventType.REPORTED ||
            event.fromStatus !== null ||
            event.toStatus !== IssueStatus.NEW)) ||
        (event.version > 1 &&
          (event.type === IssueEventType.REPORTED ||
            event.fromStatus === null)) ||
        (record.sourceSubmissionId !== null &&
          (event.type === IssueEventType.REPORTED ||
            event.type === IssueEventType.REPAIR_REPORTED) &&
          (!event.sourceRevisionId ||
            (event.type === IssueEventType.REPORTED &&
              event.sourceRevisionId !== record.sourceRevisionId))) ||
        (event.sourceRevisionId !== null &&
          (!event.sourceRevision ||
            event.sourceRevision.submissionId !== record.sourceSubmissionId ||
            event.sourceRevision.submission.propertyId !== issue.propertyId))
      )
        throw this.needsReview();
      return {
        id: record.id,
        version: record.currentVersion,
        propertyName: record.property.name,
        region: record.property.region,
        categoryName: record.category.name,
        title: record.title,
        areaLabel: record.areaLabel,
        isUrgent: record.isUrgent,
        status: record.status,
        reportedAt: record.reportedAt,
        resolvedAt: record.resolvedAt,
      };
    } catch {
      throw this.needsReview();
    }
  }

  private needsReview(): ConflictException {
    return new ConflictException({
      code: 'REPORT_RECORD_NEEDS_REVIEW',
      message:
        '보고서 대상에 확인이 필요한 기록이 있습니다. 제출 내역과 이상사항 기록을 확인해 주세요.',
    });
  }
}
