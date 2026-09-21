import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AttachmentKind, AttachmentStatus, Prisma } from '@prisma/client';
import type {} from 'multer';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  DraftPhotoDto,
  DraftPhotoViewDto,
  RemovedDraftPhotoDto,
} from '../../libs/dto/attachment/attachment';
import type { GuestIssuePhotoUploadDto } from '../../libs/dto/guest-issue-photo/guest-issue-photo';
import { QrFlow } from '../../libs/dto/qr/qr';
import { S3Service } from '../../storage/s3.service';
import { PhotoImageService } from '../photo-processing/photo-image.service';
import {
  PHOTO_UPLOAD_LEASE_MS,
  PHOTO_VIEW_TTL_SECONDS,
} from '../photo-processing/photo-policy';
import { QrService } from '../qr/qr.service';
import {
  GUEST_ISSUE_PHOTO_LIFETIME_MS,
  hashGuestIssuePhotoToken,
} from './guest-issue-photo-policy';

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
  uploadExpiresAt: true,
} satisfies Prisma.AttachmentSelect;
type PhotoRecord = Prisma.AttachmentGetPayload<{ select: typeof photoSelect }>;

@Injectable()
export class GuestIssuePhotosService {
  private readonly logger = new Logger(GuestIssuePhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrService,
    private readonly storage: S3Service,
    private readonly images: PhotoImageService,
  ) {}

  public async authorize(authorization: string | undefined): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.qr.resolveProperty(tx, QrFlow.GUEST, authorization);
    });
  }

  public async uploadPhoto(
    authorization: string | undefined,
    file: Express.Multer.File | undefined,
  ): Promise<GuestIssuePhotoUploadDto> {
    // Check direct service callers too; the HTTP guard runs before multipart parsing.
    await this.authorize(authorization);
    if (!file) {
      throw new BadRequestException({
        code: 'PHOTO_REQUIRED',
        message: '업로드할 사진을 선택해 주세요.',
      });
    }
    this.storage.assertConfigured();
    const image = await this.images.prepare(file);
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const hash = hashGuestIssuePhotoToken(id, token);
    const bucket = this.storage.getBucket();
    const pending = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const property = await this.qr.resolveProperty(
          tx,
          QrFlow.GUEST,
          authorization,
        );
        return await tx.attachment.create({
          data: {
            id,
            kind: AttachmentKind.PHOTO,
            status: AttachmentStatus.PENDING,
            storageBucket: bucket,
            storageKey: `photos/${property.id}/issues/${id}.jpg`,
            originalFilename: image.filename,
            contentType: image.contentType,
            sizeBytes: image.buffer.length,
            checksumSha256: image.checksumSha256,
            width: image.width,
            height: image.height,
            propertyId: property.id,
            submissionId: null,
            uploadedByUserId: null,
            uploadTokenHash: hash,
            uploadExpiresAt: new Date(Date.now() + PHOTO_UPLOAD_LEASE_MS),
          },
          select: photoSelect,
        });
      },
    );

    try {
      await this.storage.putPhoto(
        pending.storageKey,
        image.buffer,
        image.contentType,
        image.checksumBase64,
      );
      const expiresAt = await runSerializableTransaction(
        this.prisma,
        async (tx) => {
          const property = await this.qr.resolveProperty(
            tx,
            QrFlow.GUEST,
            authorization,
          );
          const now = new Date();
          const expiresAt = new Date(
            now.getTime() + GUEST_ISSUE_PHOTO_LIFETIME_MS,
          );
          const result = await tx.attachment.updateMany({
            where: {
              ...this.unclaimedPhotoWhere(property.id, id, hash, now),
              status: AttachmentStatus.PENDING,
            },
            data: {
              status: AttachmentStatus.READY,
              readyAt: now,
              uploadExpiresAt: expiresAt,
            },
          });
          if (result.count !== 1) {
            throw new ConflictException({
              code: 'PHOTO_UPLOAD_EXPIRED',
              message: '사진 업로드 시간이 만료되었습니다. 다시 시도해 주세요.',
            });
          }
          return expiresAt;
        },
      );
      return {
        photo: this.toDto({ ...pending, status: AttachmentStatus.READY }),
        token,
        expiresAt,
      };
    } catch (error) {
      await this.failUpload(pending);
      throw error;
    }
  }

  public async getPhotoView(
    authorization: string | undefined,
    id: string,
    token: string | undefined,
  ): Promise<DraftPhotoViewDto> {
    const photo = await this.findAccessiblePhoto(authorization, id, token);
    if (photo.status !== AttachmentStatus.READY || !photo.uploadExpiresAt)
      throw this.notFound();
    const issuedAt = new Date();
    const seconds = Math.min(
      PHOTO_VIEW_TTL_SECONDS,
      Math.floor((photo.uploadExpiresAt.getTime() - issuedAt.getTime()) / 1000),
    );
    if (seconds < 1) throw this.notFound();
    const url = await this.storage.createViewUrl(
      photo.storageBucket,
      photo.storageKey,
      seconds,
      issuedAt,
    );
    // Signing may await credential loading. Recheck token, QR and unclaimed state.
    const current = await this.findAccessiblePhoto(authorization, id, token);
    if (
      current.status !== AttachmentStatus.READY ||
      current.storageBucket !== photo.storageBucket ||
      current.storageKey !== photo.storageKey
    )
      throw this.notFound();
    const expiresAt = new Date(issuedAt.getTime() + seconds * 1000);
    if (expiresAt.getTime() <= Date.now()) {
      throw new ServiceUnavailableException({
        code: 'PHOTO_VIEW_EXPIRED',
        message: '사진 링크를 다시 요청해 주세요.',
      });
    }
    return { url, expiresAt };
  }

  public async removePhoto(
    authorization: string | undefined,
    id: string,
    token: string | undefined,
  ): Promise<RemovedDraftPhotoDto> {
    const hash = hashGuestIssuePhotoToken(id, token);
    this.storage.assertConfigured();
    const photo = await runSerializableTransaction(this.prisma, async (tx) => {
      const property = await this.qr.resolveProperty(
        tx,
        QrFlow.GUEST,
        authorization,
      );
      const where = this.unclaimedPhotoWhere(property.id, id, hash, new Date());
      const photo = await tx.attachment.findFirst({
        where,
        select: photoSelect,
      });
      if (!photo) throw this.notFound();
      if (photo.status === AttachmentStatus.PENDING) {
        throw new ConflictException({
          code: 'PHOTO_UPLOAD_PENDING',
          message: '사진 업로드가 진행 중입니다. 잠시 후 다시 시도해 주세요.',
        });
      }
      const result = await tx.attachment.updateMany({
        where: { ...where, status: photo.status },
        data:
          photo.status === AttachmentStatus.DELETED
            ? { status: AttachmentStatus.DELETED }
            : { status: AttachmentStatus.DELETED, deletedAt: new Date() },
      });
      if (result.count !== 1) throw this.notFound();
      return photo;
    });
    // Inaccessibility commits first; a retry can finish an interrupted S3 deletion.
    await this.storage.deletePhoto(photo.storageBucket, photo.storageKey);
    return { id: photo.id, status: 'DELETED' };
  }

  private async findAccessiblePhoto(
    authorization: string | undefined,
    id: string,
    token: string | undefined,
  ): Promise<PhotoRecord> {
    const hash = hashGuestIssuePhotoToken(id, token);
    return await this.prisma.$transaction(async (tx) => {
      const property = await this.qr.resolveProperty(
        tx,
        QrFlow.GUEST,
        authorization,
      );
      const photo = await tx.attachment.findFirst({
        where: this.unclaimedPhotoWhere(property.id, id, hash, new Date()),
        select: photoSelect,
      });
      if (!photo) throw this.notFound();
      return photo;
    });
  }

  private unclaimedPhotoWhere(
    propertyId: string,
    id: string,
    hash: string,
    now: Date,
  ): Prisma.AttachmentWhereInput {
    return {
      id: id.toLowerCase(),
      propertyId,
      kind: AttachmentKind.PHOTO,
      submissionId: null,
      uploadedByUserId: null,
      uploadTokenHash: hash,
      uploadExpiresAt: { gt: now },
      issuePhotos: { none: {} },
      submissionPhotos: { none: {} },
      importBatch: { is: null },
    };
  }

  private async failUpload(photo: PhotoRecord): Promise<void> {
    try {
      const result = await this.prisma.attachment.updateMany({
        where: {
          id: photo.id,
          status: AttachmentStatus.PENDING,
          issuePhotos: { none: {} },
          submissionPhotos: { none: {} },
        },
        data: { status: AttachmentStatus.FAILED },
      });
      // Do not delete if READY committed but its database response was lost.
      if (result.count === 1)
        await this.storage.deletePhoto(photo.storageBucket, photo.storageKey);
    } catch {
      this.logger.warn('Guest issue photo upload cleanup requires retry.');
    }
  }

  private toDto(photo: PhotoRecord): DraftPhotoDto {
    if (
      photo.status !== AttachmentStatus.READY ||
      !photo.width ||
      !photo.height
    )
      throw new InternalServerErrorException();
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
      message:
        '사용할 수 있는 사진을 찾을 수 없습니다. 사진을 다시 등록해 주세요.',
    });
  }
}
