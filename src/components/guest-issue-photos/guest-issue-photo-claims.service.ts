import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  ActorSource,
  AttachmentKind,
  AttachmentStatus,
  IssueEventType,
  IssueStatus,
  Prisma,
} from '@prisma/client';
import { isUUID } from 'class-validator';
import type { GuestIssuePhotoClaimInput } from '../../libs/dto/guest-issue-photo/guest-issue-photo.input';
import {
  hashGuestIssuePhotoToken,
  MAX_GUEST_ISSUE_PHOTOS,
} from './guest-issue-photo-policy';

type PhotoClaim = { id: string; tokenHash: string };

@Injectable()
export class GuestIssuePhotoClaimsService {
  public async attachToReport(
    tx: Prisma.TransactionClient,
    propertyId: string,
    eventId: string,
    claims: GuestIssuePhotoClaimInput[],
  ): Promise<void> {
    const photos = this.normalizeClaims(claims);
    const event = await tx.issueEvent.findFirst({
      where: {
        ...this.reportEventWhere(propertyId, eventId),
        photos: { none: {} },
      },
      select: { id: true },
    });
    if (!event) throw this.unavailable();

    for (const photo of photos) {
      // Recheck all ownership and readiness predicates while claiming the row.
      // Keeping the digest permits receipt retries; clearing expiry consumes it.
      const result = await tx.attachment.updateMany({
        where: {
          ...this.photoWhere(propertyId, photo),
          uploadExpiresAt: { gt: new Date() },
          issuePhotos: { none: {} },
        },
        data: { uploadExpiresAt: null },
      });
      if (result.count !== 1) throw this.unavailable();
    }

    if (photos.length > 0) {
      await tx.issueEventAttachment.createMany({
        data: photos.map((photo, index) => ({
          eventId,
          attachmentId: photo.id,
          sortOrder: index,
        })),
      });
    }
  }

  public async assertReportedPhotos(
    tx: Prisma.TransactionClient,
    propertyId: string,
    eventId: string,
    claims: GuestIssuePhotoClaimInput[],
  ): Promise<void> {
    const photos = this.normalizeClaims(claims);
    const event = await tx.issueEvent.findFirst({
      where: this.reportEventWhere(propertyId, eventId),
      select: { id: true },
    });
    if (!event) throw this.unavailable();

    const links = await tx.issueEventAttachment.findMany({
      where: { eventId },
      select: { attachmentId: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { attachmentId: 'asc' }],
    });
    if (
      links.length !== photos.length ||
      links.some(
        (link, index) =>
          link.attachmentId !== photos[index].id || link.sortOrder !== index,
      )
    ) {
      throw new ConflictException({
        code: 'ISSUE_REQUEST_CHANGED',
        message: '이미 접수된 신고와 사진이 다릅니다. 새로 신고해 주세요.',
      });
    }

    for (const photo of photos) {
      const attachment = await tx.attachment.findFirst({
        where: {
          ...this.photoWhere(propertyId, photo),
          uploadExpiresAt: null,
          issuePhotos: {
            some: { eventId },
            every: { eventId },
          },
        },
        select: { id: true },
      });
      if (!attachment) throw this.unavailable();
    }
  }

  private normalizeClaims(claims: GuestIssuePhotoClaimInput[]): PhotoClaim[] {
    if (!Array.isArray(claims) || claims.length > MAX_GUEST_ISSUE_PHOTOS) {
      throw this.invalidClaims();
    }
    const seen = new Set<string>();
    const photos: PhotoClaim[] = [];
    for (const claim of claims) {
      if (!claim || typeof claim.id !== 'string' || !isUUID(claim.id, '4')) {
        throw this.invalidClaims();
      }
      const id = claim.id.toLowerCase();
      if (seen.has(id)) throw this.invalidClaims();
      seen.add(id);
      try {
        photos.push({
          id,
          tokenHash: hashGuestIssuePhotoToken(id, claim.token),
        });
      } catch {
        throw this.unavailable();
      }
    }
    return photos;
  }

  private reportEventWhere(
    propertyId: string,
    eventId: string,
  ): Prisma.IssueEventWhereInput {
    return {
      id: eventId,
      version: 1,
      type: IssueEventType.REPORTED,
      actorSource: ActorSource.GUEST_QR,
      actorUserId: null,
      sourceRevisionId: null,
      fromStatus: null,
      toStatus: IssueStatus.NEW,
      issue: {
        propertyId,
        sourceSubmissionId: null,
        sourceRevisionId: null,
      },
    };
  }

  private photoWhere(
    propertyId: string,
    photo: PhotoClaim,
  ): Prisma.AttachmentWhereInput {
    return {
      id: photo.id,
      propertyId,
      kind: AttachmentKind.PHOTO,
      status: AttachmentStatus.READY,
      submissionId: null,
      uploadedByUserId: null,
      uploadTokenHash: photo.tokenHash,
      contentType: 'image/jpeg',
      sizeBytes: { gt: 0 },
      width: { gt: 0 },
      height: { gt: 0 },
      readyAt: { not: null },
      deletedAt: null,
      importBatch: { is: null },
      submissionPhotos: { none: {} },
    };
  }

  private invalidClaims(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_ISSUE_PHOTOS',
      message: `중복 없이 최대 ${MAX_GUEST_ISSUE_PHOTOS}장의 사진을 선택해 주세요.`,
    });
  }

  private unavailable(): ConflictException {
    return new ConflictException({
      code: 'ISSUE_PHOTO_UNAVAILABLE',
      message: '사용할 수 없는 사진입니다. 사진을 다시 업로드해 주세요.',
    });
  }
}
