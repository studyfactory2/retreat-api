import {
  AttachmentKind,
  AttachmentStatus,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';

export const UPLOAD_CLEANUP_GRACE_MS = 60 * 60 * 1000;
export const DEFAULT_CLEANUP_LIMIT = 100;
export const MAX_CLEANUP_LIMIT = 500;

// Submitted/cancelled owners are preserved even if their photo joins are damaged.
export const unreferencedPhotoWhere: Prisma.AttachmentWhereInput = {
  kind: AttachmentKind.PHOTO,
  submissionPhotos: { none: {} },
  issuePhotos: { none: {} },
  importBatch: { is: null },
  OR: [
    {
      submissionId: null,
      uploadedByUserId: null,
      uploadTokenHash: { not: null },
    },
    {
      submission: {
        is: {
          status: SubmissionStatus.DRAFT,
          currentRevision: 0,
          revisions: { none: {} },
        },
      },
    },
  ],
};

export function cleanupCandidateWhere(
  bucket: string,
  cutoff: Date,
): Prisma.AttachmentWhereInput {
  return {
    AND: [
      unreferencedPhotoWhere,
      {
        storageBucket: bucket,
        storageDeletedAt: null,
        OR: [
          {
            status: { in: [AttachmentStatus.PENDING, AttachmentStatus.FAILED] },
            uploadExpiresAt: { lte: cutoff },
          },
          {
            status: AttachmentStatus.READY,
            deletedAt: null,
            submissionId: null,
            uploadExpiresAt: { lte: cutoff },
          },
          {
            status: AttachmentStatus.READY,
            deletedAt: null,
            submission: { is: { privateTokenExpiresAt: { lte: cutoff } } },
          },
          {
            status: AttachmentStatus.DELETED,
            deletedAt: { not: null },
            OR: [
              { deletedAt: { lte: cutoff } },
              // Already claimed expired files can be retried immediately.
              { storageCleanupAttemptedAt: { not: null } },
            ],
          },
        ],
      },
    ],
  };
}

export function isManagedPhotoLocation(photo: {
  id: string;
  propertyId: string | null;
  submissionId: string | null;
  storageKey: string;
}): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(photo.id) || !photo.propertyId || !uuid.test(photo.propertyId))
    return false;
  if (photo.submissionId && !uuid.test(photo.submissionId)) return false;
  return (
    photo.storageKey ===
    `photos/${photo.propertyId}/${photo.submissionId ?? 'issues'}/${photo.id}.jpg`
  );
}
