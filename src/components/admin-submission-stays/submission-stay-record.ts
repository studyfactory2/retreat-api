import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorSource,
  AttachmentKind,
  AttachmentStatus,
  ChecklistType,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import type { SubmissionRecord } from '../../libs/dto/submission-record/submission-record';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import { parseSubmissionSnapshot } from '../../libs/submissions/submission-snapshot';

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
  visitDate: true,
  submittedAt: true,
  startedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { isActive: true } },
} satisfies Prisma.ChecklistSubmissionSelect;

const revisionSelect = {
  id: true,
  submissionId: true,
  version: true,
  status: true,
  snapshot: true,
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

export interface SubmissionStayRecord {
  submission: Prisma.ChecklistSubmissionGetPayload<{
    select: typeof submissionSelect;
  }>;
  revision: Prisma.SubmissionRevisionGetPayload<{
    select: typeof revisionSelect;
  }>;
  record: SubmissionRecord;
  photos: PreparedSubmissionPhoto[];
}

export async function readSubmissionStayRecord(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<SubmissionStayRecord> {
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
    submission.status !== SubmissionStatus.SUBMITTED ||
    submission.authorSource !== ActorSource.GUEST_QR ||
    (submission.type !== ChecklistType.CHECK_IN &&
      submission.type !== ChecklistType.CHECK_OUT) ||
    submission.stayLinkVersion !== null
  ) {
    throw new ConflictException({
      code: 'INELIGIBLE_SUBMISSION',
      message: '현장 QR로 제출한 이용객 입실·퇴실 기록만 연결할 수 있습니다.',
    });
  }
  if (
    !Number.isSafeInteger(submission.currentRevision) ||
    submission.currentRevision < 1 ||
    !submission.submittedAt ||
    submission.cancelledAt !== null
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
    revision.status !== SubmissionStatus.SUBMITTED
  ) {
    throw invalidRecord();
  }
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
    photos.length !== revision.photos.length
  ) {
    throw invalidRecord();
  }
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
