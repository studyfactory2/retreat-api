import { Injectable } from '@nestjs/common';
import { AttachmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import { S3Service } from '../../storage/s3.service';
import {
  cleanupCandidateWhere,
  DEFAULT_CLEANUP_LIMIT,
  isManagedPhotoLocation,
  MAX_CLEANUP_LIMIT,
  unreferencedPhotoWhere,
  UPLOAD_CLEANUP_GRACE_MS,
} from './upload-cleanup-policy';

const candidateSelect = {
  id: true,
  status: true,
  propertyId: true,
  submissionId: true,
  storageBucket: true,
  storageKey: true,
  deletedAt: true,
  storageCleanupAttemptedAt: true,
} satisfies Prisma.AttachmentSelect;
type Candidate = Prisma.AttachmentGetPayload<{
  select: typeof candidateSelect;
}>;

type CleanupReason =
  'EXPIRED_UPLOAD' | 'EXPIRED_DRAFT' | 'EXPIRED_ISSUE_PHOTO' | 'DELETION_RETRY';
type CleanupOutcome =
  'PREVIEW' | 'DELETED' | 'CHANGED' | 'UNSAFE_LOCATION' | 'FAILED';

export interface UploadCleanupResult {
  mode: 'preview' | 'execute';
  cutoff: Date;
  limit: number;
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
  items: { id: string; reason: CleanupReason; outcome: CleanupOutcome }[];
}

@Injectable()
export class UploadCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
  ) {}

  public async run(
    options: { execute?: boolean; limit?: number } = {},
  ): Promise<UploadCleanupResult> {
    const { execute = false, limit = DEFAULT_CLEANUP_LIMIT } = options;
    if (
      typeof execute !== 'boolean' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_CLEANUP_LIMIT
    ) {
      throw new Error('Invalid cleanup options.');
    }
    // Configuration validation only: preview never creates an S3 client.
    const bucket = this.storage.getBucket();
    const cutoff = new Date(Date.now() - UPLOAD_CLEANUP_GRACE_MS);
    const where = cleanupCandidateWhere(bucket, cutoff);
    const candidates = await this.prisma.attachment.findMany({
      where,
      select: candidateSelect,
      orderBy: [
        { storageCleanupAttemptedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: limit + 1,
    });
    const result: UploadCleanupResult = {
      mode: execute ? 'execute' : 'preview',
      cutoff,
      limit,
      scanned: Math.min(candidates.length, limit),
      deleted: 0,
      skipped: 0,
      failed: 0,
      hasMore: candidates.length > limit,
      items: [],
    };
    for (const candidate of candidates.slice(0, limit)) {
      let outcome: CleanupOutcome = 'PREVIEW';
      if (!isManagedPhotoLocation(candidate)) {
        outcome = 'UNSAFE_LOCATION';
        result.failed += 1;
        if (execute) {
          try {
            // Record inspection only, so malformed keys cannot starve later batches.
            await this.prisma.attachment.updateMany({
              where: {
                AND: [
                  where,
                  {
                    id: candidate.id,
                    storageKey: candidate.storageKey,
                    storageCleanupAttemptedAt:
                      candidate.storageCleanupAttemptedAt,
                  },
                ],
              },
              data: {
                storageCleanupAttemptedAt: new Date(
                  Math.max(
                    Date.now(),
                    (candidate.storageCleanupAttemptedAt?.getTime() ?? 0) + 1,
                  ),
                ),
              },
            });
          } catch {
            outcome = 'FAILED';
          }
        }
      } else if (execute) {
        try {
          const claim = await this.claim(candidate, where);
          if (!claim) {
            outcome = 'CHANGED';
            result.skipped += 1;
          } else {
            // Never hold a database transaction across the S3 request.
            await this.storage.deletePhoto(
              claim.storageBucket,
              claim.storageKey,
            );
            const acknowledged = await this.prisma.attachment.updateMany({
              where: {
                AND: [
                  unreferencedPhotoWhere,
                  {
                    id: claim.id,
                    status: AttachmentStatus.DELETED,
                    storageBucket: claim.storageBucket,
                    storageKey: claim.storageKey,
                    storageDeletedAt: null,
                    storageCleanupAttemptedAt: claim.storageCleanupAttemptedAt,
                  },
                ],
              },
              data: { storageDeletedAt: new Date() },
            });
            // A late uploader or another runner may have advanced the generation.
            outcome = acknowledged.count === 1 ? 'DELETED' : 'CHANGED';
            if (acknowledged.count === 1) result.deleted += 1;
            else result.skipped += 1;
          }
        } catch {
          outcome = 'FAILED';
          result.failed += 1;
        }
      }
      result.items.push({
        id: candidate.id,
        reason: this.reason(candidate),
        outcome,
      });
    }
    return result;
  }

  private async claim(
    candidate: Candidate,
    eligible: Prisma.AttachmentWhereInput,
  ): Promise<Candidate | null> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const where: Prisma.AttachmentWhereInput = {
        AND: [
          eligible,
          {
            id: candidate.id,
            storageBucket: candidate.storageBucket,
            storageKey: candidate.storageKey,
          },
        ],
      };
      const current = await tx.attachment.findFirst({
        where,
        select: candidateSelect,
      });
      if (!current || !isManagedPhotoLocation(current)) return null;
      const attemptedAt = new Date(
        Math.max(
          Date.now(),
          (current.storageCleanupAttemptedAt?.getTime() ?? 0) + 1,
        ),
      );
      const changed = await tx.attachment.updateMany({
        where,
        data: {
          status: AttachmentStatus.DELETED,
          deletedAt: current.deletedAt ?? new Date(),
          storageCleanupAttemptedAt: attemptedAt,
        },
      });
      return changed.count === 1
        ? { ...current, storageCleanupAttemptedAt: attemptedAt }
        : null;
    });
  }

  private reason(candidate: Candidate): CleanupReason {
    if (candidate.status === AttachmentStatus.DELETED) return 'DELETION_RETRY';
    if (candidate.status !== AttachmentStatus.READY) return 'EXPIRED_UPLOAD';
    return candidate.submissionId ? 'EXPIRED_DRAFT' : 'EXPIRED_ISSUE_PHOTO';
  }
}
