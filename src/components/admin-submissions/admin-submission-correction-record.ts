import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  ChecklistType,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import type { SubmissionRecord } from '../../libs/dto/submission-record/submission-record';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import {
  parseSubmissionActor,
  parseSubmissionSnapshot,
} from '../../libs/submissions/submission-snapshot';

const submissionSelect = {
  id: true,
  propertyId: true,
  type: true,
  status: true,
  currentRevision: true,
  stayId: true,
  stayLinkVersion: true,
  authorSource: true,
  authorUserId: true,
  templateId: true,
  templateVersion: true,
  templateSnapshot: true,
  authorSnapshot: true,
  draftAnswers: true,
  visitDate: true,
  submittedAt: true,
  startedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChecklistSubmissionSelect;

const revisionSelect = {
  id: true,
  submissionId: true,
  version: true,
  status: true,
  snapshot: true,
  actorSource: true,
  actorUserId: true,
  actorSnapshot: true,
  createdAt: true,
  photos: {
    orderBy: [{ sortOrder: 'asc' }, { attachmentId: 'asc' }],
    select: {
      revisionId: true,
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
          contentType: true,
          sizeBytes: true,
          width: true,
          height: true,
        },
      },
    },
  },
} satisfies Prisma.SubmissionRevisionSelect;

export interface AdminSubmissionCorrectionRecord {
  submission: Prisma.ChecklistSubmissionGetPayload<{
    select: typeof submissionSelect;
  }>;
  revision: Prisma.SubmissionRevisionGetPayload<{
    select: typeof revisionSelect;
  }>;
  record: SubmissionRecord;
  photos: PreparedSubmissionPhoto[];
}

export async function readAdminSubmissionCorrectionRecord(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<AdminSubmissionCorrectionRecord> {
  return readAdminSubmissionMutationRecord(tx, id);
}

// Cancellation/restoration opt into cancelled evidence. Existing correction
// callers retain their submitted-only eligibility rule through the wrapper.
export async function readAdminSubmissionMutationRecord(
  tx: Prisma.TransactionClient,
  id: string,
  options: { allowCancelled?: boolean } = {},
): Promise<AdminSubmissionCorrectionRecord> {
  const submission = await tx.checklistSubmission.findUnique({
    where: { id: id.toLowerCase() },
    select: submissionSelect,
  });
  if (!submission) {
    throw new NotFoundException({
      code: 'SUBMISSION_NOT_FOUND',
      message: '제출된 체크리스트를 찾을 수 없습니다.',
    });
  }
  if (
    (submission.status !== SubmissionStatus.SUBMITTED &&
      !(
        options.allowCancelled &&
        submission.status === SubmissionStatus.CANCELLED
      )) ||
    !Object.values(ChecklistType).includes(submission.type)
  ) {
    throw new ConflictException({
      code: 'INELIGIBLE_SUBMISSION',
      message: options.allowCancelled
        ? '제출 완료 또는 취소된 체크리스트만 변경할 수 있습니다.'
        : '제출 완료된 체크리스트만 정정할 수 있습니다.',
    });
  }
  if (
    !Number.isSafeInteger(submission.currentRevision) ||
    submission.currentRevision < 1 ||
    !submission.submittedAt ||
    (submission.status === SubmissionStatus.SUBMITTED
      ? submission.cancelledAt !== null
      : submission.cancelledAt === null)
  ) {
    throw invalidRecord();
  }
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
    revision.status !== submission.status
  ) {
    throw invalidRecord();
  }
  parseSubmissionActor(revision.actorSnapshot, revision.actorUserId);
  const { record, photos } = parseSubmissionSnapshot(revision.snapshot, {
    submissionId: submission.id,
    propertyId: submission.propertyId,
    type: submission.type,
    version: revision.version,
    status: revision.status,
  });
  if (
    record.visitDate !== submission.visitDate.toISOString().slice(0, 10) ||
    record.stayId !== submission.stayId ||
    record.authorSource !== submission.authorSource ||
    record.author.id !== submission.authorUserId ||
    record.template.id !== submission.templateId ||
    record.template.version !== submission.templateVersion ||
    record.startedAt?.getTime() !== submission.startedAt?.getTime() ||
    record.submittedAt.getTime() !== submission.submittedAt.getTime() ||
    record.cancelledAt?.getTime() !== submission.cancelledAt?.getTime() ||
    record.createdAt.getTime() !== submission.createdAt.getTime() ||
    record.updatedAt.getTime() !== submission.updatedAt.getTime() ||
    (revision.version === 1
      ? record.submittedAt
      : record.updatedAt
    ).getTime() !== revision.createdAt.getTime() ||
    photos.length !== revision.photos.length
  ) {
    throw invalidRecord();
  }
  const captured = revision.snapshot as Prisma.JsonObject;
  if (
    !isDeepStrictEqual(submission.templateSnapshot, captured.template) ||
    !isDeepStrictEqual(submission.authorSnapshot, captured.author) ||
    !isDeepStrictEqual(submission.draftAnswers, captured.answers)
  )
    throw invalidRecord();
  revision.photos.forEach((link, index) => {
    const captured = photos[index];
    const photo = link.attachment;
    if (
      link.revisionId !== revision.id ||
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
    ) {
      throw invalidRecord();
    }
  });
  return { submission, revision, record, photos };
}

function invalidRecord(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'INVALID_SUBMISSION_RECORD',
    message: '저장된 체크리스트 기록을 불러올 수 없습니다.',
  });
}
