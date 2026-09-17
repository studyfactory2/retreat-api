import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AdminIssuePhotoViewDto } from '../../libs/dto/admin-issue/admin-issue';
import { S3Service } from '../../storage/s3.service';
import { PHOTO_VIEW_TTL_SECONDS } from '../attachments/photo-policy';
import { AuthService } from '../auth/auth.service';
import {
  AdminIssueReader,
  type AdminIssueEvidencePhoto,
} from './admin-issue-reader';

@Injectable()
export class AdminIssuePhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly auth: AuthService,
    private readonly reader: AdminIssueReader,
  ) {}

  public async getPhotoView(
    id: string,
    eventId: string,
    photoId: string,
    authorization: string | undefined,
  ): Promise<AdminIssuePhotoViewDto> {
    // Credential loading can await; check access both before and after signing.
    await this.auth.authenticateHeader(authorization);
    const photo = await this.findEventPhoto(id, eventId, photoId);
    const issuedAt = new Date();
    const url = await this.storage.createViewUrl(
      photo.storageBucket,
      photo.storageKey,
      PHOTO_VIEW_TTL_SECONDS,
      issuedAt,
    );

    await this.auth.authenticateHeader(authorization);
    const current = await this.findEventPhoto(id, eventId, photoId);
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

  private async findEventPhoto(
    id: string,
    eventId: string,
    photoId: string,
  ): Promise<AdminIssueEvidencePhoto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const issue = await this.reader.findIssue(tx, id);
        const event = await this.reader.readEvent(tx, issue, eventId);
        const photo = event.photos.find(
          (item) => item.id === photoId.toLowerCase(),
        );
        if (!photo) throw this.photoNotFound();
        return photo;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private photoNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'ISSUE_PHOTO_NOT_FOUND',
      message: '이상사항 이력에 첨부된 사진을 찾을 수 없습니다.',
    });
  }
}
