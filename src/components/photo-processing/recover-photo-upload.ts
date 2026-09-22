import { AttachmentKind, AttachmentStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { S3Service } from '../../storage/s3.service';

interface PhotoUploadLocation {
  id: string;
  bucket: string;
  key: string;
}

export async function recoverPhotoUpload(
  prisma: PrismaService,
  storage: S3Service,
  photo: PhotoUploadLocation,
): Promise<void> {
  const where: Prisma.AttachmentWhereInput = {
    id: photo.id,
    kind: AttachmentKind.PHOTO,
    storageBucket: photo.bucket,
    storageKey: photo.key,
    status: {
      in: [
        AttachmentStatus.PENDING,
        AttachmentStatus.FAILED,
        AttachmentStatus.DELETED,
      ],
    },
    submissionPhotos: { none: {} },
    issuePhotos: { none: {} },
    importBatch: { is: null },
  };

  const canDelete = await runSerializableTransaction(prisma, async (tx) => {
    const current = await tx.attachment.findFirst({
      where,
      select: { status: true, storageCleanupAttemptedAt: true },
    });
    // READY may have committed even when the uploader lost its response.
    if (!current) return false;

    const attemptedAt = new Date(
      Math.max(
        Date.now(),
        (current.storageCleanupAttemptedAt?.getTime() ?? 0) + 1,
      ),
    );
    const result = await tx.attachment.updateMany({
      where: {
        ...where,
        status: current.status,
        storageCleanupAttemptedAt: current.storageCleanupAttemptedAt,
      },
      data: {
        status:
          current.status === AttachmentStatus.PENDING
            ? AttachmentStatus.FAILED
            : current.status,
        storageDeletedAt: null,
        storageCleanupAttemptedAt: attemptedAt,
      },
    });
    return result.count === 1;
  });

  // A late upload may recreate an object after cleanup already deleted it.
  // The new generation above invalidates any older cleanup acknowledgement.
  // Cleanup confirms storage deletion later; this recovery never marks success.
  if (canDelete) await storage.deletePhoto(photo.bucket, photo.key);
}
