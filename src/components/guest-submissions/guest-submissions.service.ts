import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorSource,
  AttachmentKind,
  AttachmentStatus,
  ChecklistType,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { GetGuestSubmissionInput } from '../../libs/dto/guest-submission/guest-submission.input';
import type {
  GuestSubmissionDto,
  GuestSubmissionPhotoDto,
  GuestSubmissionPhotoViewDto,
} from '../../libs/dto/guest-submission/guest-submission';
import { parseSubmissionSnapshot } from '../../libs/submissions/submission-snapshot';
import { S3Service } from '../../storage/s3.service';
import { PHOTO_VIEW_TTL_SECONDS } from '../photo-processing/photo-policy';
import { SubmissionDraftsService } from '../submission-drafts/submission-drafts.service';

const revisionSelect = {
  id: true,
  submissionId: true,
  version: true,
  status: true,
  snapshot: true,
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

@Injectable()
export class GuestSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drafts: SubmissionDraftsService,
    private readonly storage: S3Service,
  ) {}

  public async authorize(authorization: string | undefined): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.resolveGuestSubmission(tx, authorization);
    });
  }

  public async getCurrent(
    authorization: string | undefined,
    input: GetGuestSubmissionInput,
  ): Promise<GuestSubmissionDto> {
    void input;
    return await this.prisma.$transaction(
      async (tx) => (await this.readCurrent(tx, authorization)).dto,
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getPhotoView(
    authorization: string | undefined,
    id: string,
    input: GetGuestSubmissionInput,
  ): Promise<GuestSubmissionPhotoViewDto> {
    void input;
    const photo = await this.findPhoto(authorization, id);
    const issuedAt = new Date();
    const lifetime = Math.min(
      PHOTO_VIEW_TTL_SECONDS,
      Math.floor((photo.accessExpiresAt.getTime() - issuedAt.getTime()) / 1000),
    );
    if (lifetime < 1) throw this.invalidAccess();
    const expiresAt = new Date(issuedAt.getTime() + lifetime * 1000);
    const url = await this.storage.createViewUrl(
      photo.storageBucket,
      photo.storageKey,
      lifetime,
      issuedAt,
    );

    const current = await this.findPhoto(authorization, id);
    if (
      current.revisionId !== photo.revisionId ||
      current.storageBucket !== photo.storageBucket ||
      current.storageKey !== photo.storageKey
    )
      throw this.photoNotFound();
    if (expiresAt.getTime() <= Date.now()) {
      throw new ServiceUnavailableException({
        code: 'PHOTO_VIEW_EXPIRED',
        message: '사진 링크를 다시 요청해 주세요.',
      });
    }
    return { url, expiresAt };
  }

  private async findPhoto(authorization: string | undefined, id: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const current = await this.readCurrent(tx, authorization);
        const photo = current.revision.photos.find(
          (link) => link.attachmentId === id.toLowerCase(),
        );
        if (!photo) throw this.photoNotFound();
        return {
          revisionId: current.revision.id,
          storageBucket: photo.attachment.storageBucket,
          storageKey: photo.attachment.storageKey,
          accessExpiresAt: current.dto.expiresAt,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async resolveGuestSubmission(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ) {
    const submission = await this.drafts.resolvePrivateSubmission(
      tx,
      authorization,
    );
    if (
      submission.status !== SubmissionStatus.SUBMITTED ||
      (submission.type !== ChecklistType.CHECK_IN &&
        submission.type !== ChecklistType.CHECK_OUT) ||
      (submission.authorSource !== ActorSource.GUEST_QR &&
        submission.authorSource !== ActorSource.PRIVATE_LINK)
    )
      throw this.invalidAccess();
    return submission;
  }

  private async readCurrent(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ) {
    const submission = await this.resolveGuestSubmission(tx, authorization);
    if (
      !Number.isSafeInteger(submission.currentRevision) ||
      submission.currentRevision < 1 ||
      !submission.submittedAt ||
      !submission.privateTokenExpiresAt
    )
      throw this.invalidRecord();
    const revision = await tx.submissionRevision.findUnique({
      where: {
        submissionId_version: {
          submissionId: submission.id,
          version: submission.currentRevision,
        },
      },
      select: revisionSelect,
    });
    if (
      !revision ||
      revision.submissionId !== submission.id ||
      revision.version !== submission.currentRevision ||
      revision.status !== SubmissionStatus.SUBMITTED
    )
      throw this.invalidRecord();
    const { record, photos: capturedPhotos } = parseSubmissionSnapshot(
      revision.snapshot,
      {
        submissionId: submission.id,
        propertyId: submission.propertyId,
        type: submission.type,
        version: revision.version,
        status: revision.status,
      },
    );
    if (
      record.visitDate !== submission.visitDate.toISOString().slice(0, 10) ||
      record.stayId !== submission.stayId ||
      record.authorSource !== submission.authorSource ||
      record.author.id !== submission.authorUserId ||
      record.template.id !== submission.templateId ||
      record.template.version !== submission.templateVersion ||
      record.submittedAt.getTime() !== submission.submittedAt.getTime() ||
      capturedPhotos.length !== revision.photos.length
    )
      throw this.invalidRecord();
    const photos: GuestSubmissionPhotoDto[] = revision.photos.map(
      (link, index) => {
        const captured = capturedPhotos[index];
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
          !Number.isSafeInteger(photo.width) ||
          !Number.isSafeInteger(photo.height) ||
          !photo.width ||
          !photo.height ||
          photo.width < 1 ||
          photo.height < 1 ||
          !Number.isSafeInteger(photo.sizeBytes) ||
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
    const dto: GuestSubmissionDto = {
      id: submission.id,
      type: submission.type as 'CHECK_IN' | 'CHECK_OUT',
      status: 'SUBMITTED',
      revision: revision.version,
      property: record.property,
      visitDate: record.visitDate,
      guest: {
        name: record.author.name,
        company: record.author.company,
        department: record.author.department,
        phone: record.author.phone,
      },
      template: record.template,
      answers: record.answers,
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
      expiresAt: submission.privateTokenExpiresAt,
      photos,
    };
    return { dto, revision };
  }

  private invalidAccess(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_GUEST_SUBMISSION_ACCESS',
      message: '이용객의 제출 내역 링크를 확인해 주세요.',
    });
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
