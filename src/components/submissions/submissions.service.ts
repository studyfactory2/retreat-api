import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorSource,
  AttachmentKind,
  AttachmentStatus,
  ChecklistType,
  Prisma,
  StayStatus,
  SubmissionRevisionAction,
  SubmissionStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { SubmitChecklistInput } from '../../libs/dto/submission/submission.input';
import type {
  PreparedSubmissionPhoto,
  SubmissionReceiptDto,
} from '../../libs/dto/submission/submission';
import { parseSubmissionSnapshot } from '../../libs/submissions/submission-snapshot';
import { parseDraftAnswers } from '../submission-drafts/draft-answers';
import {
  SubmissionDraftsService,
  type DraftRecord,
} from '../submission-drafts/submission-drafts.service';
import { createSubmissionIssues } from './submission-issues';
import {
  readSubmissionReceipt,
  readSubmissionRequestHash,
} from './submission-receipt';
import {
  assertCompleteAnswers,
  prepareSubmissionPhotos,
} from './submission-validation';

type SubmissionStayMatch = {
  schemaVersion: 1;
  stayId: string;
  stayRevision: number;
  guestName: string;
  checkInAt: string;
  checkOutAt: string;
};

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drafts: SubmissionDraftsService,
  ) {}

  public async submitChecklist(
    authorization: string | undefined,
    input: SubmitChecklistInput,
  ): Promise<SubmissionReceiptDto> {
    // Only category-name contention is retried here; transaction conflicts use
    // the shared serializable helper. All work in either retry is database-only.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await runSerializableTransaction(this.prisma, async (tx) => {
          const draft = await this.drafts.resolvePrivateSubmission(
            tx,
            authorization,
          );
          // Submitted retries retain revision one's template and answers even
          // after a correction changes the submission's current answers.
          const originalRevision =
            draft.status === SubmissionStatus.SUBMITTED
              ? await this.firstRevision(tx, draft.id)
              : null;
          const originalRecord = originalRevision
            ? parseSubmissionSnapshot(originalRevision.snapshot, {
                submissionId: draft.id,
                propertyId: draft.propertyId,
                type: draft.type,
                version: 1,
                status: SubmissionStatus.SUBMITTED,
              }).record
            : null;
          const template =
            originalRecord?.template ?? this.drafts.readTemplate(draft);
          const author = this.drafts.readAuthor(draft);
          const answers =
            originalRecord?.answers ??
            parseDraftAnswers(
              draft.draftAnswers,
              template.definition,
              draft.type === ChecklistType.MAINTENANCE,
            );
          const photos = prepareSubmissionPhotos(
            input.photos,
            template.definition,
            answers,
            draft.type === ChecklistType.MAINTENANCE,
          );
          const requestHash = createHash('sha256')
            .update(
              JSON.stringify({
                expectedUpdatedAt: input.expectedUpdatedAt,
                photos,
              }),
            )
            .digest('hex');
          if (originalRevision) {
            if (
              readSubmissionRequestHash(originalRevision.snapshot) !==
              requestHash
            ) {
              throw new ConflictException({
                code: 'CHECKLIST_ALREADY_SUBMITTED',
                message:
                  '이미 제출된 체크리스트입니다. 제출 확인 화면을 확인해 주세요.',
              });
            }
            return readSubmissionReceipt(originalRevision.snapshot, draft);
          }
          if (draft.updatedAt.toISOString() !== input.expectedUpdatedAt) {
            throw new ConflictException({
              code: 'DRAFT_CHANGED',
              message:
                '작성 내용이 변경되었습니다. 다시 불러온 뒤 제출해 주세요.',
            });
          }
          assertCompleteAnswers(template.definition, answers);
          await this.checkPhotos(tx, draft, photos);
          const stayMatch = await this.readPrivateStayMatch(tx, draft);
          const submittedAt = new Date();
          const updatedAt = new Date(
            Math.max(submittedAt.getTime(), draft.updatedAt.getTime() + 1),
          );
          const result = await tx.checklistSubmission.updateMany({
            where: {
              id: draft.id,
              status: SubmissionStatus.DRAFT,
              currentRevision: 0,
              updatedAt: draft.updatedAt,
              privateTokenHash: draft.privateTokenHash,
              privateTokenExpiresAt: { gt: submittedAt },
            },
            data: {
              status: SubmissionStatus.SUBMITTED,
              currentRevision: 1,
              submittedAt,
              updatedAt,
            },
          });
          if (result.count !== 1) {
            throw new ConflictException({
              code: 'DRAFT_CHANGED',
              message: '작성 상태가 변경되었습니다. 다시 확인해 주세요.',
            });
          }
          const property = {
            id: draft.property.id,
            name: draft.property.name,
            region: draft.property.region,
          };
          const reportedIssueCount = answers.items.filter(
            (answer) => answer.value === 'ABNORMAL',
          ).length;
          const receipt = {
            id: draft.id,
            status: 'SUBMITTED' as const,
            type: draft.type,
            property,
            visitDate: draft.visitDate.toISOString().slice(0, 10),
            startedAt: draft.startedAt?.toISOString() ?? null,
            submittedAt: submittedAt.toISOString(),
            revision: 1,
            answeredItemCount: answers.items.length,
            photoCount: photos.length,
            reportedIssueCount,
          };
          const revisionId = randomUUID();
          const snapshot = {
            schemaVersion: 1,
            ...(stayMatch ? { stayMatch } : {}),
            requestHash,
            finalizedFromUpdatedAt: input.expectedUpdatedAt,
            submission: {
              id: draft.id,
              propertyId: draft.propertyId,
              type: draft.type,
              status: SubmissionStatus.SUBMITTED,
              templateId: draft.templateId,
              templateVersion: draft.templateVersion,
              stayId: draft.stayId,
              authorUserId: draft.authorUserId,
              authorSource: draft.authorSource,
              visitDate: receipt.visitDate,
              startedAt: receipt.startedAt,
              submittedAt: receipt.submittedAt,
              cancelledAt: null,
              currentRevision: 1,
              createdAt: draft.createdAt.toISOString(),
              updatedAt: updatedAt.toISOString(),
            },
            property,
            template,
            author,
            answers,
            photos,
            receipt,
          } satisfies Prisma.InputJsonObject;
          await tx.submissionRevision.create({
            data: {
              id: revisionId,
              submissionId: draft.id,
              version: 1,
              action: SubmissionRevisionAction.SUBMITTED,
              status: SubmissionStatus.SUBMITTED,
              snapshot,
              actorSource: draft.authorSource,
              actorUserId: draft.authorUserId,
              actorSnapshot: { ...author, id: draft.authorUserId },
              createdAt: submittedAt,
            },
          });
          if (photos.length) {
            await tx.submissionRevisionAttachment.createMany({
              data: photos.map((photo) => ({
                ...photo,
                revisionId,
                submissionId: draft.id,
              })),
            });
          }
          await createSubmissionIssues(tx, {
            submissionId: draft.id,
            revisionId,
            property,
            type: draft.type,
            authorUserId: draft.authorUserId,
            authorSource: draft.authorSource,
            author,
            template,
            answers,
            photos,
            submittedAt,
          });
          return readSubmissionReceipt(snapshot, {
            ...draft,
            status: SubmissionStatus.SUBMITTED,
            submittedAt,
            updatedAt,
            currentRevision: 1,
          });
        });
      } catch (error) {
        if (
          attempt < 2 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          error.meta?.modelName === 'IssueCategory' &&
          Array.isArray(error.meta.target) &&
          error.meta.target.includes('name')
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  public async getReceipt(
    authorization: string | undefined,
  ): Promise<SubmissionReceiptDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const submission = await this.drafts.resolvePrivateSubmission(
          tx,
          authorization,
        );
        if (submission.status !== SubmissionStatus.SUBMITTED) {
          throw new ConflictException({
            code: 'CHECKLIST_NOT_SUBMITTED',
            message: '아직 제출되지 않은 체크리스트입니다.',
          });
        }
        const revision = await this.firstRevision(tx, submission.id);
        return readSubmissionReceipt(revision.snapshot, submission);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async firstRevision(
    tx: Prisma.TransactionClient,
    submissionId: string,
  ) {
    const revision = await tx.submissionRevision.findUnique({
      where: { submissionId_version: { submissionId, version: 1 } },
      select: { snapshot: true },
    });
    if (!revision) throw new InternalServerErrorException();
    return revision;
  }

  private async readPrivateStayMatch(
    tx: Prisma.TransactionClient,
    draft: DraftRecord,
  ): Promise<SubmissionStayMatch | null> {
    if (draft.authorSource !== ActorSource.PRIVATE_LINK) return null;
    if (
      !draft.stayId ||
      !draft.stayLinkVersion ||
      (draft.type !== ChecklistType.CHECK_IN &&
        draft.type !== ChecklistType.CHECK_OUT)
    ) {
      throw this.invalidStayAccess();
    }
    // The parent invitation was authorized by resolvePrivateSubmission in this
    // transaction. Capture its reviewed stay without storing invitation secrets.
    const stay = await tx.stay.findUnique({
      where: { id: draft.stayId },
      select: {
        id: true,
        propertyId: true,
        guestName: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        currentRevision: true,
        guestLinkVersion: true,
        guestLinkStayRevision: true,
        guestLinkExpiresAt: true,
        property: { select: { isActive: true } },
      },
    });
    if (
      !stay ||
      stay.propertyId !== draft.propertyId ||
      stay.status !== StayStatus.ACTIVE ||
      !stay.property.isActive ||
      stay.guestLinkVersion !== draft.stayLinkVersion ||
      stay.currentRevision < 1 ||
      stay.guestLinkStayRevision !== stay.currentRevision ||
      !stay.guestLinkExpiresAt ||
      stay.guestLinkExpiresAt.getTime() <= Date.now()
    ) {
      throw this.invalidStayAccess();
    }
    return {
      schemaVersion: 1,
      stayId: stay.id,
      stayRevision: stay.currentRevision,
      guestName: stay.guestName,
      checkInAt: stay.checkInAt.toISOString(),
      checkOutAt: stay.checkOutAt.toISOString(),
    };
  }

  private invalidStayAccess(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_STAY_ACCESS',
      message:
        '이용 링크를 사용할 수 없습니다. 관리자에게 새 링크를 요청해 주세요.',
    });
  }

  private async checkPhotos(
    tx: Prisma.TransactionClient,
    draft: DraftRecord,
    photos: PreparedSubmissionPhoto[],
  ): Promise<void> {
    const attachments = await tx.attachment.findMany({
      where: {
        submissionId: draft.id,
        kind: AttachmentKind.PHOTO,
        status: { in: [AttachmentStatus.PENDING, AttachmentStatus.READY] },
      },
      select: { id: true, propertyId: true, status: true },
    });
    if (
      attachments.some((photo) => photo.status === AttachmentStatus.PENDING)
    ) {
      throw new ConflictException({
        code: 'PHOTO_UPLOAD_PENDING',
        message: '사진 업로드가 완료된 뒤 제출해 주세요.',
      });
    }
    const selected = new Set(photos.map((photo) => photo.attachmentId));
    if (
      attachments.length !== photos.length ||
      attachments.some(
        (photo) =>
          photo.propertyId !== draft.propertyId || !selected.has(photo.id),
      )
    ) {
      throw new ConflictException({
        code: 'SUBMISSION_PHOTOS_CHANGED',
        message:
          '사진 목록을 다시 확인해 주세요. 모든 사진의 용도를 지정하거나 불필요한 사진을 삭제해 주세요.',
      });
    }
  }
}
