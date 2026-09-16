import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AttachmentKind, AttachmentStatus, Prisma } from '@prisma/client';
import type {} from 'multer';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  DraftPhotoDto,
  DraftPhotoListDto,
  DraftPhotoViewDto,
  RemovedDraftPhotoDto,
} from '../../libs/dto/attachment/attachment';
import { S3Service } from '../../storage/s3.service';
import { SubmissionDraftsService } from '../submission-drafts/submission-drafts.service';
import { PhotoImageService } from './photo-image.service';
import {
  MAX_DRAFT_PHOTOS,
  MAX_PHOTO_BYTES,
  PHOTO_UPLOAD_LEASE_MS,
  PHOTO_VIEW_TTL_SECONDS,
} from './photo-policy';

const photoSelect = {
  id: true,
  status: true,
  originalFilename: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  createdAt: true,
  storageBucket: true,
  storageKey: true,
} satisfies Prisma.AttachmentSelect;
type PhotoRecord = Prisma.AttachmentGetPayload<{ select: typeof photoSelect }>;

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly drafts: SubmissionDraftsService,
    private readonly storage: S3Service,
    private readonly images: PhotoImageService,
  ) {}

  public async uploadPhoto(
    authorization: string | undefined,
    file: Express.Multer.File | undefined,
  ): Promise<DraftPhotoDto> {
    // Also authorize service calls; the HTTP guard runs before multipart parsing.
    await this.drafts.getDraft(authorization);
    if (!file) {
      throw new BadRequestException({
        code: 'PHOTO_REQUIRED',
        message: '업로드할 사진을 선택해 주세요.',
      });
    }
    this.storage.assertConfigured();
    const image = await this.images.prepare(file);
    const id = randomUUID();
    const bucket = this.storage.getBucket();
    const pending = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const draft = await this.drafts.resolveDraft(tx, authorization);
        // Count reservations as well as completed uploads to prevent parallel overflow.
        const count = await tx.attachment.count({
          where: {
            submissionId: draft.id,
            kind: AttachmentKind.PHOTO,
            status: { in: [AttachmentStatus.PENDING, AttachmentStatus.READY] },
          },
        });
        if (count >= MAX_DRAFT_PHOTOS) {
          throw new ConflictException({
            code: 'PHOTO_LIMIT_REACHED',
            message: `사진은 작성 건당 최대 ${MAX_DRAFT_PHOTOS}장까지 등록할 수 있습니다.`,
          });
        }
        return await tx.attachment.create({
          data: {
            id,
            kind: AttachmentKind.PHOTO,
            status: AttachmentStatus.PENDING,
            storageBucket: bucket,
            storageKey: `photos/${draft.propertyId}/${draft.id}/${id}.jpg`,
            originalFilename: image.filename,
            contentType: image.contentType,
            sizeBytes: image.buffer.length,
            checksumSha256: image.checksumSha256,
            width: image.width,
            height: image.height,
            propertyId: draft.propertyId,
            submissionId: draft.id,
            uploadedByUserId: draft.authorUserId,
            uploadExpiresAt: new Date(Date.now() + PHOTO_UPLOAD_LEASE_MS),
          },
          select: photoSelect,
        });
      },
    );

    try {
      // Network work stays outside database transactions and their retry loop.
      await this.storage.putPhoto(
        pending.storageKey,
        image.buffer,
        image.contentType,
        image.checksumBase64,
      );
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const draft = await this.drafts.resolveDraft(tx, authorization);
        const result = await tx.attachment.updateMany({
          where: {
            id,
            submissionId: draft.id,
            propertyId: draft.propertyId,
            status: AttachmentStatus.PENDING,
            uploadExpiresAt: { gt: new Date() },
          },
          data: {
            status: AttachmentStatus.READY,
            readyAt: new Date(),
            uploadExpiresAt: null,
          },
        });
        if (result.count !== 1) {
          throw new ConflictException({
            code: 'PHOTO_UPLOAD_EXPIRED',
            message: '사진 업로드 시간이 만료되었습니다. 다시 시도해 주세요.',
          });
        }
        return this.toDto({ ...pending, status: AttachmentStatus.READY });
      });
    } catch (error) {
      await this.failUpload(pending);
      throw error;
    }
  }

  public async listPhotos(
    authorization: string | undefined,
  ): Promise<DraftPhotoListDto> {
    const items = await this.prisma.$transaction(
      async (tx) => {
        const draft = await this.drafts.resolveDraft(tx, authorization);
        return await tx.attachment.findMany({
          where: {
            submissionId: draft.id,
            propertyId: draft.propertyId,
            kind: AttachmentKind.PHOTO,
            status: AttachmentStatus.READY,
          },
          select: photoSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: items.map((item) => this.toDto(item)),
      limits: {
        maxBytes: MAX_PHOTO_BYTES,
        maxPhotos: MAX_DRAFT_PHOTOS,
        acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    };
  }

  public async getPhotoView(
    authorization: string | undefined,
    id: string,
  ): Promise<DraftPhotoViewDto> {
    const { photo, expiresAt } = await this.prisma.$transaction(async (tx) => {
      const draft = await this.drafts.resolveDraft(tx, authorization);
      const photo = await this.findPhoto(tx, draft.id, id);
      if (photo.status !== AttachmentStatus.READY) throw this.notFound();
      return { photo, expiresAt: draft.privateTokenExpiresAt };
    });
    const seconds = Math.min(
      PHOTO_VIEW_TTL_SECONDS,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    if (seconds < 1) {
      throw new UnauthorizedException({
        code: 'INVALID_DRAFT_ACCESS',
        message: '작성 링크의 사용 기간이 만료되었습니다.',
      });
    }
    const issuedAt = Date.now();
    const url = await this.storage.createViewUrl(
      photo.storageBucket,
      photo.storageKey,
      seconds,
      new Date(issuedAt),
    );
    // Signing can fetch credentials. Recheck access after that asynchronous work.
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.drafts.resolveDraft(tx, authorization);
      const current = await this.findPhoto(tx, draft.id, id);
      if (current.status !== AttachmentStatus.READY) throw this.notFound();
    });
    return { url, expiresAt: new Date(issuedAt + seconds * 1000) };
  }

  public async removePhoto(
    authorization: string | undefined,
    id: string,
  ): Promise<RemovedDraftPhotoDto> {
    this.storage.assertConfigured();
    const photo = await runSerializableTransaction(this.prisma, async (tx) => {
      const draft = await this.drafts.resolveDraft(tx, authorization);
      const photo = await this.findPhoto(tx, draft.id, id);
      if (photo.status === AttachmentStatus.PENDING) {
        throw new ConflictException({
          code: 'PHOTO_UPLOAD_PENDING',
          message: '사진 업로드가 진행 중입니다. 잠시 후 다시 시도해 주세요.',
        });
      }
      const result = await tx.attachment.updateMany({
        where: {
          id: photo.id,
          status: photo.status,
          submissionPhotos: { none: {} },
          issuePhotos: { none: {} },
          importBatch: { is: null },
        },
        data:
          photo.status === AttachmentStatus.DELETED
            ? { status: AttachmentStatus.DELETED }
            : { status: AttachmentStatus.DELETED, deletedAt: new Date() },
      });
      if (result.count !== 1) {
        throw new ConflictException({
          code: 'PHOTO_IN_USE',
          message: '기록에 사용 중인 사진은 삭제할 수 없습니다.',
        });
      }
      return photo;
    });
    // Mark inaccessible first. Repeating remove retries a failed S3 deletion.
    await this.storage.deletePhoto(photo.storageBucket, photo.storageKey);
    return { id: photo.id, status: 'DELETED' };
  }

  private async findPhoto(
    tx: Prisma.TransactionClient,
    submissionId: string,
    id: string,
  ): Promise<PhotoRecord> {
    const photo = await tx.attachment.findFirst({
      where: {
        id: id.toLowerCase(),
        submissionId,
        kind: AttachmentKind.PHOTO,
      },
      select: photoSelect,
    });
    if (!photo) throw this.notFound();
    return photo;
  }

  private async failUpload(photo: PhotoRecord): Promise<void> {
    try {
      const failed = await this.prisma.attachment.updateMany({
        where: { id: photo.id, status: AttachmentStatus.PENDING },
        data: { status: AttachmentStatus.FAILED },
      });
      // A lost response after a committed READY transition must never delete evidence.
      if (failed.count === 1) {
        await this.storage.deletePhoto(photo.storageBucket, photo.storageKey);
      }
    } catch {
      this.logger.warn('Photo upload cleanup requires retry.');
    }
  }

  private toDto(photo: PhotoRecord): DraftPhotoDto {
    if (
      !photo.width ||
      !photo.height ||
      photo.status !== AttachmentStatus.READY
    ) {
      throw new InternalServerErrorException();
    }
    return {
      id: photo.id,
      status: 'READY',
      filename: photo.originalFilename,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      width: photo.width,
      height: photo.height,
      createdAt: photo.createdAt,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'PHOTO_NOT_FOUND',
      message: '사진을 찾을 수 없습니다.',
    });
  }
}
