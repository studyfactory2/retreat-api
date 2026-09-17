import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  IssueEventType,
  PhotoPurpose,
  Prisma,
} from '@prisma/client';
import type {
  AdminIssueDetailDto,
  AdminIssueEventDto,
  AdminIssueRecordDto,
} from '../../libs/dto/admin-issue/admin-issue';
import {
  buildAdminIssueSnapshot,
  parseAdminIssueActor,
  parseAdminIssueSnapshot,
} from './admin-issue-snapshot';

export const adminIssueInclude = {
  property: { select: { id: true, name: true, region: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.IssueInclude;

export type AdminIssueRow = Prisma.IssueGetPayload<{
  include: typeof adminIssueInclude;
}>;

const evidenceSelect = {
  id: true,
  kind: true,
  status: true,
  propertyId: true,
  submissionId: true,
  originalFilename: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  createdAt: true,
  storageBucket: true,
  storageKey: true,
} satisfies Prisma.AttachmentSelect;

export type AdminIssueEvidencePhoto = Prisma.AttachmentGetPayload<{
  select: typeof evidenceSelect;
}>;

export const adminIssueEventSelect = {
  id: true,
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
  photos: {
    orderBy: [{ sortOrder: 'asc' }, { attachmentId: 'asc' }],
    select: {
      attachmentId: true,
      sortOrder: true,
      attachment: { select: evidenceSelect },
    },
  },
} satisfies Prisma.IssueEventSelect;

type EventRow = Prisma.IssueEventGetPayload<{
  select: typeof adminIssueEventSelect;
}>;

@Injectable()
export class AdminIssueReader {
  public async findIssue(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<AdminIssueRow> {
    const issue = await tx.issue.findFirst({
      where: { id: id.toLowerCase(), currentVersion: { gte: 1 } },
      include: adminIssueInclude,
    });
    if (!issue) {
      throw new NotFoundException({
        code: 'ISSUE_NOT_FOUND',
        message: '이상사항을 찾을 수 없습니다.',
      });
    }
    return issue;
  }

  public currentRecord(
    issue: AdminIssueRow,
    event: { version: number; snapshot: Prisma.JsonValue },
  ): AdminIssueRecordDto {
    if (event.version !== issue.currentVersion) throw this.invalidRecord();
    const record = parseAdminIssueSnapshot(event.snapshot, {
      issueId: issue.id,
      propertyId: issue.propertyId,
      version: event.version,
    });
    const snapshot = buildAdminIssueSnapshot(record, issue.requestKey);
    const fields = [
      'categoryId',
      'title',
      'description',
      'areaLabel',
      'isUrgent',
      'status',
      'sourceSubmissionId',
      'sourceItemId',
      'sourceRevisionId',
      'recurrenceOfIssueId',
      'currentVersion',
      'reportedAt',
      'resolvedAt',
      'resolvedByUserId',
      'cancelledAt',
      'cancellationReason',
      'updatedAt',
    ] as const;
    for (const key of fields) {
      const value = issue[key];
      if (
        snapshot[key] !== (value instanceof Date ? value.toISOString() : value)
      ) {
        throw this.invalidRecord();
      }
    }
    return record;
  }

  public async readDetail(
    tx: Prisma.TransactionClient,
    issue: AdminIssueRow,
  ): Promise<AdminIssueDetailDto> {
    const latest = await this.eventByVersion(tx, issue, issue.currentVersion);
    const record = this.currentRecord(issue, latest);
    const latestEvent = (await this.mapEvent(tx, issue, latest)).dto;
    const report =
      issue.currentVersion === 1
        ? latestEvent
        : (
            await this.mapEvent(
              tx,
              issue,
              await this.eventByVersion(tx, issue, 1),
            )
          ).dto;
    if (report.type !== IssueEventType.REPORTED) throw this.invalidRecord();
    return { issue: record, report, latestEvent };
  }

  public async readEvent(
    tx: Prisma.TransactionClient,
    issue: AdminIssueRow,
    eventId: string,
  ): Promise<{ dto: AdminIssueEventDto; photos: AdminIssueEvidencePhoto[] }> {
    const event = await tx.issueEvent.findFirst({
      where: {
        id: eventId.toLowerCase(),
        issueId: issue.id,
        version: { lte: issue.currentVersion },
      },
      select: adminIssueEventSelect,
    });
    if (!event) {
      throw new NotFoundException({
        code: 'ISSUE_EVENT_NOT_FOUND',
        message: '이상사항 이력을 찾을 수 없습니다.',
      });
    }
    return await this.mapEvent(tx, issue, event);
  }

  public async mapEvent(
    tx: Prisma.TransactionClient,
    issue: AdminIssueRow,
    event: EventRow,
  ): Promise<{ dto: AdminIssueEventDto; photos: AdminIssueEvidencePhoto[] }> {
    if (
      event.issueId !== issue.id ||
      event.version < 1 ||
      event.version > issue.currentVersion
    )
      throw this.invalidRecord();
    const record = parseAdminIssueSnapshot(event.snapshot, {
      issueId: issue.id,
      propertyId: issue.propertyId,
      version: event.version,
    });
    if (
      record.sourceSubmissionId !== issue.sourceSubmissionId ||
      record.sourceItemId !== issue.sourceItemId ||
      record.sourceRevisionId !== issue.sourceRevisionId
    )
      throw this.invalidRecord();
    const fromSubmission = record.sourceSubmissionId !== null;
    if (
      fromSubmission &&
      (event.type === IssueEventType.REPORTED ||
        event.type === IssueEventType.REPAIR_REPORTED) &&
      (!event.sourceRevisionId ||
        (event.type === IssueEventType.REPORTED &&
          event.sourceRevisionId !== record.sourceRevisionId))
    )
      throw this.invalidRecord();
    if (
      event.toStatus !== record.status ||
      (event.version === 1 &&
        (event.type !== IssueEventType.REPORTED ||
          event.fromStatus !== null)) ||
      event.createdAt.getTime() !== record.updatedAt.getTime() ||
      (event.note !== null && [...event.note].length > 2000)
    )
      throw this.invalidRecord();
    if (
      event.sourceRevisionId &&
      (!event.sourceRevision ||
        event.sourceRevision.submissionId !== record.sourceSubmissionId ||
        event.sourceRevision.submission.propertyId !== issue.propertyId)
    )
      throw this.invalidRecord();

    const links =
      event.photos.length && record.sourceSubmissionId && event.sourceRevisionId
        ? await tx.submissionRevisionAttachment.findMany({
            where: {
              revisionId: event.sourceRevisionId,
              submissionId: record.sourceSubmissionId,
              attachmentId: {
                in: event.photos.map((photo) => photo.attachmentId),
              },
            },
            select: {
              attachmentId: true,
              itemId: true,
              purpose: true,
              sortOrder: true,
            },
          })
        : [];
    const byAttachment = new Map(
      links.map((link) => [link.attachmentId, link]),
    );
    const orders = new Set<number>();
    const photos = event.photos.map((link) => {
      const photo = link.attachment;
      if (
        photo.id !== link.attachmentId ||
        photo.kind !== AttachmentKind.PHOTO ||
        photo.status !== AttachmentStatus.READY ||
        photo.propertyId !== issue.propertyId ||
        photo.submissionId !== record.sourceSubmissionId ||
        photo.contentType !== 'image/jpeg' ||
        !photo.width ||
        !photo.height ||
        photo.sizeBytes < 1 ||
        !Number.isSafeInteger(link.sortOrder) ||
        link.sortOrder < 0 ||
        orders.has(link.sortOrder)
      )
        throw this.invalidRecord();
      orders.add(link.sortOrder);
      if (record.sourceSubmissionId) {
        const source = byAttachment.get(photo.id);
        const purpose =
          event.type === IssueEventType.REPORTED
            ? PhotoPurpose.DEFECT
            : event.type === IssueEventType.REPAIR_REPORTED
              ? PhotoPurpose.REPAIR
              : null;
        if (
          !source ||
          !purpose ||
          source.itemId !== record.sourceItemId ||
          source.purpose !== purpose ||
          source.sortOrder !== link.sortOrder
        )
          throw this.invalidRecord();
      }
      return photo;
    });
    return {
      dto: {
        id: event.id,
        issueId: issue.id,
        version: event.version,
        type: event.type,
        actorSource: event.actorSource,
        actor: parseAdminIssueActor(event.actorSnapshot, event.actorUserId),
        sourceRevisionId: event.sourceRevisionId,
        note: event.note,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        createdAt: event.createdAt,
        record,
        photos: photos.map((photo, index) => ({
          id: photo.id,
          status: 'READY',
          filename: photo.originalFilename,
          contentType: photo.contentType,
          sizeBytes: photo.sizeBytes,
          width: photo.width,
          height: photo.height,
          createdAt: photo.createdAt,
          sortOrder: event.photos[index].sortOrder,
        })),
      },
      photos,
    };
  }

  private async eventByVersion(
    tx: Prisma.TransactionClient,
    issue: AdminIssueRow,
    version: number,
  ): Promise<EventRow> {
    const event = await tx.issueEvent.findUnique({
      where: { issueId_version: { issueId: issue.id, version } },
      select: adminIssueEventSelect,
    });
    if (!event) throw this.invalidRecord();
    return event;
  }

  private invalidRecord(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'INVALID_ISSUE_RECORD',
      message: '저장된 이상사항 기록을 불러올 수 없습니다.',
    });
  }
}
