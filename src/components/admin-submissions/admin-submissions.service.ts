import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type {
  GetAdminSubmissionsInput,
  GetAdminSubmissionHistoryInput,
} from '../../libs/dto/admin-submission/admin-submission.input';
import type {
  AdminSubmissionDetailDto,
  AdminSubmissionHistoryDto,
  AdminSubmissionListDto,
  AdminSubmissionPhotoDto,
  AdminSubmissionPhotoViewDto,
  AdminSubmissionRevisionDto,
  AdminSubmissionSummaryDto,
} from '../../libs/dto/admin-submission/admin-submission';
import { S3Service } from '../../storage/s3.service';
import { AuthService } from '../auth/auth.service';
import { PHOTO_VIEW_TTL_SECONDS } from '../attachments/photo-policy';
import {
  parseAdminSubmissionActor,
  parseAdminSubmissionSnapshot,
} from './admin-submission-snapshot';

const completedStatuses = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CANCELLED,
];
const submissionSelect = {
  id: true,
  propertyId: true,
  type: true,
  status: true,
  currentRevision: true,
  visitDate: true,
} satisfies Prisma.ChecklistSubmissionSelect;
type SubmissionRow = Prisma.ChecklistSubmissionGetPayload<{
  select: typeof submissionSelect;
}>;

const revisionSelect = {
  id: true,
  submissionId: true,
  version: true,
  action: true,
  status: true,
  snapshot: true,
  actorUserId: true,
  actorSource: true,
  actorSnapshot: true,
  reason: true,
  createdAt: true,
  photos: {
    orderBy: [{ sortOrder: 'asc' }, { attachmentId: 'asc' }],
    select: {
      attachmentId: true,
      submissionId: true,
      purpose: true,
      sectionId: true,
      itemId: true,
      areaLabel: true,
      sortOrder: true,
      attachment: {
        select: {
          id: true,
          kind: true,
          status: true,
          submissionId: true,
          propertyId: true,
          originalFilename: true,
          contentType: true,
          sizeBytes: true,
          width: true,
          height: true,
          createdAt: true,
          storageBucket: true,
          storageKey: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionRevisionSelect;
type RevisionRow = Prisma.SubmissionRevisionGetPayload<{
  select: typeof revisionSelect;
}>;

@Injectable()
export class AdminSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly auth: AuthService,
  ) {}

  public async getSubmissions(
    input: GetAdminSubmissionsInput,
  ): Promise<AdminSubmissionListDto> {
    const from =
      input.from === undefined ? undefined : this.parseDate(input.from);
    const to = input.to === undefined ? undefined : this.parseDate(input.to);
    if (from && to && from > to) {
      throw new BadRequestException({
        code: 'INVALID_SUBMISSION_DATE_RANGE',
        message: '조회 종료일은 시작일보다 빠를 수 없습니다.',
      });
    }
    const where: Prisma.ChecklistSubmissionWhereInput = {
      currentRevision: { gte: 1 },
      submittedAt: { not: null },
      status: input.status ?? { in: completedStatuses },
      propertyId: input.propertyId?.toLowerCase(),
      type: input.type,
      ...(from || to ? { visitDate: { gte: from, lte: to } } : {}),
    };
    return await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.checklistSubmission.findMany({
          where,
          select: {
            ...submissionSelect,
            revisions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { id: true, version: true, status: true, snapshot: true },
            },
          },
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.checklistSubmission.count({ where });
        const items: AdminSubmissionSummaryDto[] = rows.map((row) => {
          const revision = row.revisions[0];
          if (
            !revision ||
            revision.version !== row.currentRevision ||
            revision.status !== row.status
          ) {
            throw this.invalidRecord();
          }
          const { record, photos } = parseAdminSubmissionSnapshot(
            revision.snapshot,
            {
              submissionId: row.id,
              propertyId: row.propertyId,
              type: row.type,
              version: revision.version,
              status: revision.status,
            },
          );
          if (record.visitDate !== row.visitDate.toISOString().slice(0, 10))
            throw this.invalidRecord();
          return {
            id: row.id,
            type: row.type,
            status: this.completedStatus(row.status),
            currentRevision: row.currentRevision,
            property: record.property,
            visitDate: record.visitDate,
            author: {
              id: record.author.id,
              name: record.author.name,
              role: record.author.role,
            },
            startedAt: record.startedAt,
            submittedAt: record.submittedAt,
            cancelledAt: record.cancelledAt,
            answeredItemCount: record.answers.items.length,
            abnormalItemCount: record.answers.items.filter(
              (item) => item.value === 'ABNORMAL',
            ).length,
            photoCount: photos.length,
          };
        });
        return {
          items,
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getSubmission(id: string): Promise<AdminSubmissionDetailDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const submission = await this.findSubmission(tx, id);
        const revision = await tx.submissionRevision.findUnique({
          where: {
            submissionId_version: {
              submissionId: submission.id,
              version: submission.currentRevision,
            },
          },
          select: revisionSelect,
        });
        if (!revision || revision.status !== submission.status)
          throw this.invalidRecord();
        const dto = this.toRevision(submission, revision);
        if (
          dto.record.visitDate !==
          submission.visitDate.toISOString().slice(0, 10)
        )
          throw this.invalidRecord();
        return {
          id: submission.id,
          status: this.completedStatus(submission.status),
          currentRevision: submission.currentRevision,
          revision: dto,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getHistory(
    id: string,
    input: GetAdminSubmissionHistoryInput,
  ): Promise<AdminSubmissionHistoryDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const submission = await this.findSubmission(tx, id);
        const where = {
          submissionId: submission.id,
          version: { lte: submission.currentRevision },
        };
        const revisions = await tx.submissionRevision.findMany({
          where,
          select: revisionSelect,
          orderBy: { version: 'desc' },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.submissionRevision.count({ where });
        return {
          items: revisions.map((revision) =>
            this.toRevision(submission, revision),
          ),
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getPhotoView(
    id: string,
    revisionId: string,
    photoId: string,
    authorization: string | undefined,
  ): Promise<AdminSubmissionPhotoViewDto> {
    // HTTP handlers are guarded; reauthenticate here as signing may await credentials.
    await this.auth.authenticateHeader(authorization);
    const photo = await this.findRevisionPhoto(id, revisionId, photoId);
    const issuedAt = new Date();
    const url = await this.storage.createViewUrl(
      photo.storageBucket,
      photo.storageKey,
      PHOTO_VIEW_TTL_SECONDS,
      issuedAt,
    );
    await this.auth.authenticateHeader(authorization);
    const current = await this.findRevisionPhoto(id, revisionId, photoId);
    if (
      current.storageBucket !== photo.storageBucket ||
      current.storageKey !== photo.storageKey
    )
      throw this.photoNotFound();
    const expiresAt = new Date(
      issuedAt.getTime() + PHOTO_VIEW_TTL_SECONDS * 1000,
    );
    if (expiresAt.getTime() <= Date.now()) {
      throw new ServiceUnavailableException({
        code: 'PHOTO_VIEW_EXPIRED',
        message: '사진 링크를 다시 요청해 주세요.',
      });
    }
    return { url, expiresAt };
  }

  private async findRevisionPhoto(
    id: string,
    revisionId: string,
    photoId: string,
  ) {
    return await this.prisma.$transaction(
      async (tx) => {
        const submission = await this.findSubmission(tx, id);
        const revision = await tx.submissionRevision.findFirst({
          where: {
            id: revisionId.toLowerCase(),
            submissionId: submission.id,
            version: { lte: submission.currentRevision },
          },
          select: revisionSelect,
        });
        if (!revision) throw this.photoNotFound();
        const link = revision.photos.find(
          (photo) => photo.attachmentId === photoId.toLowerCase(),
        );
        if (!link || link.attachment.status !== AttachmentStatus.READY)
          throw this.photoNotFound();
        // Verify the historical association and owner before signing any object key.
        this.toRevision(submission, revision);
        return link.attachment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async findSubmission(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<SubmissionRow> {
    const submission = await tx.checklistSubmission.findFirst({
      where: {
        id: id.toLowerCase(),
        status: { in: completedStatuses },
        currentRevision: { gte: 1 },
        submittedAt: { not: null },
      },
      select: submissionSelect,
    });
    if (!submission) {
      throw new NotFoundException({
        code: 'SUBMISSION_NOT_FOUND',
        message: '제출된 체크리스트를 찾을 수 없습니다.',
      });
    }
    return submission;
  }

  private toRevision(
    submission: SubmissionRow,
    revision: RevisionRow,
  ): AdminSubmissionRevisionDto {
    if (
      revision.submissionId !== submission.id ||
      revision.version < 1 ||
      revision.version > submission.currentRevision
    )
      throw this.invalidRecord();
    const parsed = parseAdminSubmissionSnapshot(revision.snapshot, {
      submissionId: submission.id,
      propertyId: submission.propertyId,
      type: submission.type,
      version: revision.version,
      status: revision.status,
    });
    if (parsed.photos.length !== revision.photos.length)
      throw this.invalidRecord();
    const photos: AdminSubmissionPhotoDto[] = revision.photos.map(
      (link, index) => {
        const captured = parsed.photos[index];
        const photo = link.attachment;
        if (
          link.submissionId !== submission.id ||
          captured.attachmentId !== link.attachmentId ||
          captured.purpose !== link.purpose ||
          captured.sectionId !== link.sectionId ||
          captured.itemId !== link.itemId ||
          captured.areaLabel !== link.areaLabel ||
          captured.sortOrder !== link.sortOrder ||
          photo.id !== link.attachmentId ||
          photo.kind !== AttachmentKind.PHOTO ||
          photo.status !== AttachmentStatus.READY ||
          photo.submissionId !== submission.id ||
          photo.propertyId !== submission.propertyId ||
          photo.contentType !== 'image/jpeg' ||
          !photo.width ||
          !photo.height ||
          photo.sizeBytes < 1
        )
          throw this.invalidRecord();
        return {
          id: photo.id,
          status: 'READY',
          filename: photo.originalFilename,
          contentType: photo.contentType,
          sizeBytes: photo.sizeBytes,
          width: photo.width,
          height: photo.height,
          createdAt: photo.createdAt,
          purpose: link.purpose,
          sectionId: link.sectionId,
          itemId: link.itemId,
          areaLabel: link.areaLabel,
          sortOrder: link.sortOrder,
        };
      },
    );
    return {
      id: revision.id,
      submissionId: submission.id,
      version: revision.version,
      action: revision.action,
      status: this.completedStatus(revision.status),
      createdAt: revision.createdAt,
      reason: revision.reason,
      actorSource: revision.actorSource,
      actor: parseAdminSubmissionActor(
        revision.actorSnapshot,
        revision.actorUserId,
      ),
      record: parsed.record,
      photos,
    };
  }

  private parseDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException({
        code: 'INVALID_SUBMISSION_DATE',
        message: '조회 날짜는 올바른 YYYY-MM-DD 형식이어야 합니다.',
      });
    }
    return date;
  }

  private completedStatus(status: SubmissionStatus): 'SUBMITTED' | 'CANCELLED' {
    if (
      status !== SubmissionStatus.SUBMITTED &&
      status !== SubmissionStatus.CANCELLED
    )
      throw this.invalidRecord();
    return status;
  }

  private invalidRecord(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'INVALID_SUBMISSION_RECORD',
      message: '저장된 체크리스트 기록을 불러올 수 없습니다.',
    });
  }

  private photoNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SUBMISSION_PHOTO_NOT_FOUND',
      message: '이 제출 기록의 사진을 찾을 수 없습니다.',
    });
  }
}
