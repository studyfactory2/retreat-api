import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { seoulDateRange } from '../../libs/dates/seoul-date';
import type { GetAdminReportInput } from '../../libs/dto/admin-report/admin-report.input';
import type {
  ArchiveFields,
  ArchiveSheetName,
  PreservationReport,
} from '../../libs/dto/admin-report/preservation-report';
import {
  parseSubmissionActor,
  parseSubmissionSnapshot,
} from '../../libs/submissions/submission-snapshot';
import {
  parseIssueActor,
  parseIssueSnapshot,
} from '../../libs/issues/issue-snapshot';
import {
  AdminIssueReader,
  adminIssueInclude,
} from '../admin-issues/admin-issue-reader';
import { MAX_REPORT_DAYS, MAX_REPORT_RECORDS } from './admin-report-policy';
import {
  answerFields,
  answerHistory,
  issueFields,
  stayFields,
  submissionFields,
} from './preservation-records';
import {
  ArchiveTables,
  archiveHeaders,
  archiveLabel,
  archiveNeedsReview,
  archiveTooLarge,
  MAX_ARCHIVE_ROWS,
  MAX_ARCHIVE_VERSIONS,
} from './preservation-report-model';

import {
  MAX_ARCHIVE_PHOTOS,
  archivePhotosTooLarge,
  type PreservationArchivePhoto,
} from './preservation-zip-policy';

const attachmentSelect = {
  id: true,
  kind: true,
  propertyId: true,
  submissionId: true,
  status: true,
  originalFilename: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  deletedAt: true,
  storageDeletedAt: true,
  storageBucket: true,
  storageKey: true,
  checksumSha256: true,
} satisfies Prisma.AttachmentSelect;
type ArchiveAttachment = Prisma.AttachmentGetPayload<{
  select: typeof attachmentSelect;
}>;
const revisionPhotos = {
  orderBy: [{ sortOrder: 'asc' }, { attachmentId: 'asc' }],
  include: { attachment: { select: attachmentSelect } },
} satisfies Prisma.SubmissionRevision$photosArgs;
const eventPhotos = {
  orderBy: [{ sortOrder: 'asc' }, { attachmentId: 'asc' }],
  include: { attachment: { select: attachmentSelect } },
} satisfies Prisma.IssueEvent$photosArgs;

@Injectable()
export class PreservationReportReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: AdminIssueReader,
  ) {}

  async read(
    input: GetAdminReportInput,
    photoPlan?: Map<string, PreservationArchivePhoto>,
  ): Promise<PreservationReport> {
    const { start, end } = seoulDateRange(
      input.from,
      input.to,
      MAX_REPORT_DAYS,
      'INVALID_REPORT_RANGE',
    );
    const propertyId = input.propertyId?.toLowerCase();
    return this.prisma.$transaction(
      async (tx) => {
        const property = propertyId
          ? await tx.property.findUnique({
              where: { id: propertyId },
              select: { name: true },
            })
          : null;
        if (propertyId && !property)
          throw new NotFoundException({
            code: 'PROPERTY_NOT_FOUND',
            message: '휴양소를 찾을 수 없습니다.',
          });
        // All queries share this database snapshot; historical events are not filtered by the chosen period.
        const generatedAt = new Date();
        const staysWhere: Prisma.StayWhereInput = {
          propertyId,
          checkInAt: { lt: end },
          checkOutAt: { gt: start },
        };
        const submissionsWhere: Prisma.ChecklistSubmissionWhereInput = {
          propertyId,
          status: { in: ['SUBMITTED', 'CANCELLED'] },
          submittedAt: { gte: start, lt: end },
        };
        const issuesWhere: Prisma.IssueWhereInput = {
          propertyId,
          reportedAt: { gte: start, lt: end },
        };
        const stayCount = await tx.stay.count({ where: staysWhere });
        const submissionCount = await tx.checklistSubmission.count({
          where: submissionsWhere,
        });
        const issueCount = await tx.issue.count({ where: issuesWhere });
        if (stayCount + submissionCount + issueCount > MAX_REPORT_RECORDS)
          archiveTooLarge();
        const stayHistory = await tx.stayRevision.count({
          where: { stay: staysWhere },
        });
        const submissionHistory = await tx.submissionRevision.count({
          where: { submission: submissionsWhere },
        });
        const issueHistory = await tx.issueEvent.count({
          where: { issue: issuesWhere },
        });
        if (
          stayHistory + submissionHistory + issueHistory >
          MAX_ARCHIVE_VERSIONS
        )
          archiveTooLarge();
        const submissionPhotos = await tx.submissionRevisionAttachment.count({
          where: { revision: { submission: submissionsWhere } },
        });
        const issuePhotos = await tx.issueEventAttachment.count({
          where: { event: { issue: issuesWhere } },
        });
        if (submissionPhotos + issuePhotos > MAX_ARCHIVE_ROWS)
          archiveTooLarge();
        const output = new ArchiveTables();
        let readStays = 0,
          readSubmissions = 0,
          readIssues = 0,
          readVersions = 0;
        let cursor: string | undefined;
        for (;;) {
          const rows = await tx.stay.findMany({
            where: { ...staysWhere, ...(cursor ? { id: { gt: cursor } } : {}) },
            select: {
              id: true,
              propertyId: true,
              currentRevision: true,
              status: true,
              checkInAt: true,
              checkOutAt: true,
              cancelledAt: true,
            },
            orderBy: { id: 'asc' },
            take: 25,
          });
          for (const row of rows) {
            let version = 0;
            let before: ArchiveFields = {};
            for await (const revision of versionPages((after) =>
              tx.stayRevision.findMany({
                where: { stayId: row.id, version: { gt: after } },
                orderBy: { version: 'asc' },
                take: 10,
              }),
            )) {
              if (
                revision.version !== ++version ||
                version > row.currentRevision
              )
                archiveNeedsReview();
              const fields = stayFields(revision.snapshot, {
                id: row.id,
                propertyId: row.propertyId,
                version: revision.version,
              });
              output.history(
                {
                  kind: '이용 일정',
                  id: row.id,
                  version: revision.version,
                  action: revision.action,
                  at: revision.createdAt,
                  actor: parseSubmissionActor(
                    revision.actorSnapshot,
                    revision.actorUserId,
                  ),
                  source: 'ADMIN_SESSION',
                  reason: revision.reason,
                  eventId: revision.id,
                },
                before,
                fields,
              );
              before = fields;
              if (revision.version === row.currentRevision) {
                if (
                  fields['상태'] !== archiveLabel(row.status) ||
                  this.milliseconds(fields['입실 예정 (서울)']) !==
                    row.checkInAt.getTime() ||
                  this.milliseconds(fields['퇴실 예정 (서울)']) !==
                    row.checkOutAt.getTime() ||
                  this.milliseconds(fields['취소 시각 (서울)']) !==
                    (row.cancelledAt?.getTime() ?? null)
                )
                  archiveNeedsReview();
                this.row(output, '이용 일정', {
                  ...fields,
                  버전: revision.version,
                });
              }
            }
            if (version < 1 || version !== row.currentRevision)
              archiveNeedsReview();
            readStays++;
            readVersions += version;
          }
          if (rows.length < 25) break;
          cursor = rows[rows.length - 1].id;
        }
        cursor = undefined;
        for (;;) {
          const rows = await tx.checklistSubmission.findMany({
            where: {
              ...submissionsWhere,
              ...(cursor ? { id: { gt: cursor } } : {}),
            },
            select: {
              id: true,
              propertyId: true,
              type: true,
              currentRevision: true,
              status: true,
              stayId: true,
              submittedAt: true,
              cancelledAt: true,
            },
            orderBy: { id: 'asc' },
            take: 25,
          });
          for (const row of rows) {
            let version = 0;
            let before: ArchiveFields = {};
            for await (const revision of versionPages((after) =>
              tx.submissionRevision.findMany({
                where: { submissionId: row.id, version: { gt: after } },
                orderBy: { version: 'asc' },
                take: 10,
                include: { photos: revisionPhotos },
              }),
            )) {
              if (
                revision.version !== ++version ||
                version > row.currentRevision
              )
                archiveNeedsReview();
              const { record, photos } = parseSubmissionSnapshot(
                revision.snapshot,
                {
                  submissionId: row.id,
                  propertyId: row.propertyId,
                  type: row.type,
                  version: revision.version,
                  status: revision.status,
                },
              );
              if (photos.length !== revision.photos.length)
                archiveNeedsReview();
              revision.photos.forEach((link, index) => {
                const captured = photos[index];
                if (
                  link.submissionId !== row.id ||
                  captured.attachmentId !== link.attachmentId ||
                  captured.purpose !== link.purpose ||
                  captured.sectionId !== link.sectionId ||
                  captured.itemId !== link.itemId ||
                  captured.areaLabel !== link.areaLabel ||
                  captured.sortOrder !== link.sortOrder ||
                  link.attachment.id !== link.attachmentId ||
                  link.attachment.submissionId !== row.id
                )
                  archiveNeedsReview();
                this.photo(
                  output,
                  {
                    kind: '점검 기록',
                    id: row.id,
                    version: revision.version,
                    current: row.currentRevision,
                    eventId: revision.id,
                    propertyId: row.propertyId,
                    propertyName: record.property.name,
                  },
                  link.attachment,
                  link.purpose,
                  link.sectionId,
                  link.itemId,
                  link.areaLabel,
                  link.sortOrder,
                  photoPlan,
                );
              });
              const fields = submissionFields(
                record,
                revision.status,
                photos.length,
              );
              const answers = answerFields(record);
              const all = {
                ...fields,
                ...answerHistory(answers),
                '사진 ID 목록': photos
                  .map((photo) => photo.attachmentId)
                  .join('\n'),
              };
              output.history(
                {
                  kind: '점검 기록',
                  id: row.id,
                  version: revision.version,
                  action: revision.action,
                  at: revision.createdAt,
                  actor: parseSubmissionActor(
                    revision.actorSnapshot,
                    revision.actorUserId,
                  ),
                  source: revision.actorSource,
                  reason: revision.reason,
                  eventId: revision.id,
                },
                before,
                all,
              );
              before = all;
              if (revision.version === row.currentRevision) {
                if (
                  revision.status !== row.status ||
                  record.stayId !== row.stayId ||
                  record.submittedAt.getTime() !== row.submittedAt?.getTime() ||
                  record.cancelledAt?.getTime() !== row.cancelledAt?.getTime()
                )
                  archiveNeedsReview();
                this.row(output, '점검 기록', {
                  ...fields,
                  '제출 ID': row.id,
                  버전: revision.version,
                });
                for (const answer of answers)
                  this.row(output, '점검 답변', {
                    ...answer,
                    '제출 ID': row.id,
                    버전: revision.version,
                  });
              }
            }
            if (version < 1 || version !== row.currentRevision)
              archiveNeedsReview();
            readSubmissions++;
            readVersions += version;
          }
          if (rows.length < 25) break;
          cursor = rows[rows.length - 1].id;
        }
        cursor = undefined;
        for (;;) {
          const rows = await tx.issue.findMany({
            where: {
              ...issuesWhere,
              ...(cursor ? { id: { gt: cursor } } : {}),
            },
            include: adminIssueInclude,
            orderBy: { id: 'asc' },
            take: 25,
          });
          for (const row of rows) {
            let version = 0;
            let before: ArchiveFields = {};
            for await (const event of versionPages((after) =>
              tx.issueEvent.findMany({
                where: { issueId: row.id, version: { gt: after } },
                orderBy: { version: 'asc' },
                take: 10,
                include: {
                  photos: eventPhotos,
                  sourceRevision: {
                    select: {
                      submissionId: true,
                      submission: { select: { propertyId: true } },
                      photos: {
                        select: {
                          attachmentId: true,
                          itemId: true,
                          purpose: true,
                          sortOrder: true,
                        },
                      },
                    },
                  },
                },
              }),
            )) {
              if (event.version !== ++version || version > row.currentVersion)
                archiveNeedsReview();
              const record =
                event.version === row.currentVersion
                  ? this.issues.currentRecord(row, event)
                  : parseIssueSnapshot(event.snapshot, {
                      issueId: row.id,
                      propertyId: row.propertyId,
                      version: event.version,
                    });
              if (
                event.sourceRevisionId &&
                (!event.sourceRevision ||
                  event.sourceRevision.submissionId !==
                    record.sourceSubmissionId ||
                  event.sourceRevision.submission.propertyId !== row.propertyId)
              )
                archiveNeedsReview();
              const orders = new Set<number>();
              for (const link of event.photos) {
                if (
                  link.attachment.id !== link.attachmentId ||
                  link.attachment.submissionId !== record.sourceSubmissionId ||
                  !Number.isSafeInteger(link.sortOrder) ||
                  link.sortOrder < 0 ||
                  orders.has(link.sortOrder)
                )
                  archiveNeedsReview();
                orders.add(link.sortOrder);
                const purpose =
                  event.type === 'REPORTED'
                    ? 'DEFECT'
                    : event.type === 'REPAIR_REPORTED'
                      ? 'REPAIR'
                      : null;
                if (record.sourceSubmissionId) {
                  const source = event.sourceRevision?.photos.find(
                    (photo) => photo.attachmentId === link.attachmentId,
                  );
                  if (
                    !source ||
                    !purpose ||
                    source.itemId !== record.sourceItemId ||
                    source.purpose !== purpose ||
                    source.sortOrder !== link.sortOrder
                  )
                    archiveNeedsReview();
                }
                this.photo(
                  output,
                  {
                    kind: '이상사항',
                    id: row.id,
                    version: event.version,
                    current: row.currentVersion,
                    eventId: event.id,
                    propertyId: row.propertyId,
                    propertyName: record.property.name,
                  },
                  link.attachment,
                  purpose ?? '이벤트 첨부',
                  record.source?.sectionId ?? null,
                  record.sourceItemId,
                  record.areaLabel,
                  link.sortOrder,
                  photoPlan,
                );
              }
              const fields = issueFields(record);
              output.history(
                {
                  kind: '이상사항',
                  id: row.id,
                  version: event.version,
                  action: event.type,
                  at: event.createdAt,
                  actor: parseIssueActor(
                    event.actorSnapshot,
                    event.actorUserId,
                  ),
                  source: event.actorSource,
                  reason: event.note,
                  eventId: event.id,
                },
                before,
                fields,
              );
              before = fields;
              if (event.version === row.currentVersion)
                this.row(output, '이상사항', {
                  ...fields,
                  버전: event.version,
                });
            }
            if (version < 1 || version !== row.currentVersion)
              archiveNeedsReview();
            readIssues++;
            readVersions += version;
          }
          if (rows.length < 25) break;
          cursor = rows[rows.length - 1].id;
        }
        if (
          readStays !== stayCount ||
          readSubmissions !== submissionCount ||
          readIssues !== issueCount ||
          readVersions !== stayHistory + submissionHistory + issueHistory ||
          output.tables.find((table) => table.name === '사진 목록').rows
            .length !==
            submissionPhotos + issuePhotos
        )
          archiveNeedsReview();
        return {
          from: input.from,
          to: input.to,
          generatedAt,
          propertyLabel: property?.name ?? '전체 휴양소',
          tables: output.tables,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30_000,
      },
    );
  }

  private milliseconds(value: unknown): number | null {
    return value instanceof Date ? value.getTime() : null;
  }

  private row(
    output: ArchiveTables,
    name: ArchiveSheetName,
    fields: ArchiveFields,
  ): void {
    output.add(
      name,
      archiveHeaders[name].map((header) => fields[header] ?? null),
    );
  }

  private photo(
    output: ArchiveTables,
    meta: {
      kind: string;
      id: string;
      propertyId: string;
      propertyName: string;
      version: number;
      current: number;
      eventId: string;
    },
    photo: ArchiveAttachment,
    purpose: string,
    sectionId: string | null,
    itemId: string | null,
    area: string | null,
    order: number,
    photoPlan?: Map<string, PreservationArchivePhoto>,
  ): void {
    if (photo.kind !== 'PHOTO' || photo.propertyId !== meta.propertyId)
      archiveNeedsReview();
    if (photoPlan && !photoPlan.has(photo.id)) {
      if (photoPlan.size >= MAX_ARCHIVE_PHOTOS) archivePhotosTooLarge();
      photoPlan.set(photo.id, {
        id: photo.id,
        propertyId: meta.propertyId,
        propertyName: meta.propertyName,
        originalFilename: photo.originalFilename,
        status: photo.status,
        deleted: Boolean(photo.deletedAt || photo.storageDeletedAt),
        contentType: photo.contentType,
        sizeBytes: photo.sizeBytes,
        checksumSha256: photo.checksumSha256,
        storageBucket: photo.storageBucket,
        storageKey: photo.storageKey,
      });
    }
    // This describes database availability only; no S3 request or signed URL is created.
    const availability =
      photo.status === 'DELETED' || photo.deletedAt || photo.storageDeletedAt
        ? '삭제됨'
        : photo.status === 'READY'
          ? '등록됨 · 파일 확인 전'
          : '사용 불가';
    output.add('사진 목록', [
      meta.kind,
      meta.id,
      meta.version,
      meta.version === meta.current ? '예' : '아니요',
      photo.id,
      photo.originalFilename,
      archiveLabel(purpose),
      sectionId,
      itemId,
      area,
      order + 1,
      availability,
      photo.contentType,
      photo.sizeBytes,
      photo.createdAt,
      meta.eventId,
    ]);
  }
}

/** Bound snapshot/photo object graphs before applying the expanded-row budget. */
async function* versionPages<T extends { version: number }>(
  load: (after: number) => Promise<T[]>,
): AsyncGenerator<T> {
  let after = 0;
  for (;;) {
    const rows = await load(after);
    for (const row of rows) yield row;
    if (rows.length < 10) break;
    const next = rows[rows.length - 1].version;
    if (next <= after) archiveNeedsReview();
    after = next;
  }
}
