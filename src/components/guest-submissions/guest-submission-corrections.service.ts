import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ActorSource,
  ChecklistType,
  Prisma,
  SubmissionRevisionAction,
  SubmissionStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { CorrectGuestSubmissionInput } from '../../libs/dto/guest-submission/guest-submission.input';
import type { GuestSubmissionCorrectionDto } from '../../libs/dto/guest-submission/guest-submission';
import type {
  DraftAnswers,
  DraftAuthorSnapshot,
  DraftTemplateSnapshot,
} from '../../libs/dto/submission-draft/submission-draft';
import { parseSubmissionSnapshot } from '../../libs/submissions/submission-snapshot';
import { buildDraftAnswers } from '../submission-drafts/draft-answers';
import {
  assertCompleteAnswers,
  prepareSubmissionPhotos,
} from '../submissions/submission-validation';
import { recordGuestCorrectionIssues } from './guest-submission-issues';
import { GuestSubmissionsService } from './guest-submissions.service';

@Injectable()
export class GuestSubmissionCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: GuestSubmissionsService,
  ) {}

  public async correct(
    authorization: string | undefined,
    input: CorrectGuestSubmissionInput,
  ): Promise<GuestSubmissionCorrectionDto> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await runSerializableTransaction(this.prisma, async (tx) => {
          const current = await this.reader.readCurrent(tx, authorization);
          const { submission, record } = current;
          const requested = this.canonicalAnswers(
            buildDraftAnswers(
              input.items,
              input.generalNote,
              record.template.definition,
              false,
            ),
            record.template,
          );
          assertCompleteAnswers(record.template.definition, requested);
          const reason = input.reason?.trim() || null;
          const requestHash = createHash('sha256')
            .update(
              JSON.stringify({
                expectedRevision: input.expectedRevision,
                items: requested.items,
                preserveGeneralNote: input.generalNote === undefined,
                generalNote: requested.generalNote,
                reason,
              }),
            )
            .digest('hex');
          if (submission.currentRevision !== input.expectedRevision) {
            if (input.expectedRevision < submission.currentRevision) {
              return await this.readRetry(tx, {
                submissionId: submission.id,
                propertyId: submission.propertyId,
                type: submission.type,
                expectedRevision: input.expectedRevision,
                requestHash,
              });
            }
            throw this.changed();
          }
          if (submission.currentRevision >= 2_147_483_647) throw this.changed();
          const answers: DraftAnswers = {
            ...requested,
            generalNote:
              input.generalNote === undefined
                ? record.answers.generalNote
                : requested.generalNote,
          };
          if (
            JSON.stringify(answers) ===
            JSON.stringify(
              this.canonicalAnswers(record.answers, record.template),
            )
          ) {
            return {
              id: submission.id,
              status: 'SUBMITTED',
              revision: submission.currentRevision,
              updatedAt: record.updatedAt,
              changed: false,
            };
          }
          const abnormalIds = new Set(
            answers.items
              .filter((answer) => answer.value === 'ABNORMAL')
              .map((answer) => answer.itemId),
          );
          // Removed defect associations stay preserved in previous revisions.
          const photos = prepareSubmissionPhotos(
            current.capturedPhotos.filter(
              (photo) => photo.itemId !== null && abnormalIds.has(photo.itemId),
            ),
            record.template.definition,
            answers,
            false,
          );
          const now = new Date(
            Math.max(Date.now(), submission.updatedAt.getTime() + 1),
          );
          const version = submission.currentRevision + 1;
          const revisionId = randomUUID();
          const result: GuestSubmissionCorrectionDto = {
            id: submission.id,
            status: 'SUBMITTED',
            revision: version,
            updatedAt: now,
            changed: true,
          };
          const author: DraftAuthorSnapshot = {
            schemaVersion: 1,
            role: 'GUEST',
            name: record.author.name,
            company: record.author.company,
            department: record.author.department,
            phone: record.author.phone,
          };
          const snapshot = {
            schemaVersion: 1,
            correction: {
              schemaVersion: 1,
              expectedRevision: input.expectedRevision,
              requestHash,
            },
            submission: {
              id: submission.id,
              propertyId: submission.propertyId,
              type: submission.type,
              status: SubmissionStatus.SUBMITTED,
              templateId: submission.templateId,
              templateVersion: submission.templateVersion,
              stayId: submission.stayId,
              authorUserId: submission.authorUserId,
              authorSource: submission.authorSource,
              visitDate: record.visitDate,
              startedAt: record.startedAt?.toISOString() ?? null,
              submittedAt: record.submittedAt.toISOString(),
              cancelledAt: null,
              currentRevision: version,
              createdAt: record.createdAt.toISOString(),
              updatedAt: now.toISOString(),
            },
            property: { ...record.property },
            template: record.template,
            author,
            answers,
            photos,
          } satisfies Prisma.InputJsonObject;
          const updated = await tx.checklistSubmission.updateMany({
            where: {
              id: submission.id,
              status: SubmissionStatus.SUBMITTED,
              currentRevision: input.expectedRevision,
              updatedAt: submission.updatedAt,
              privateTokenHash: submission.privateTokenHash,
              privateTokenExpiresAt: { gt: new Date() },
            },
            data: {
              currentRevision: version,
              draftAnswers: answers,
              updatedAt: now,
            },
          });
          if (updated.count !== 1) throw this.changed();
          await tx.submissionRevision.create({
            data: {
              id: revisionId,
              submissionId: submission.id,
              version,
              action: SubmissionRevisionAction.CORRECTED,
              status: SubmissionStatus.SUBMITTED,
              snapshot,
              actorSource: ActorSource.PRIVATE_LINK,
              actorUserId: submission.authorUserId,
              actorSnapshot: { ...author, id: submission.authorUserId },
              reason,
              createdAt: now,
            },
          });
          if (photos.length) {
            await tx.submissionRevisionAttachment.createMany({
              data: photos.map((photo) => ({
                ...photo,
                revisionId,
                submissionId: submission.id,
              })),
            });
          }
          await recordGuestCorrectionIssues(tx, {
            submissionId: submission.id,
            revisionId,
            property: record.property,
            type: submission.type,
            authorUserId: submission.authorUserId,
            authorSource: ActorSource.PRIVATE_LINK,
            author,
            template: record.template,
            previousAnswers: record.answers,
            answers,
            photos,
            correctedAt: now,
            reason,
          });
          return result;
        });
      } catch (error) {
        if (
          attempt < 2 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          error.meta?.modelName === 'IssueCategory' &&
          Array.isArray(error.meta.target) &&
          error.meta.target.includes('name')
        )
          continue;
        throw error;
      }
    }
  }

  private canonicalAnswers(
    answers: DraftAnswers,
    template: DraftTemplateSnapshot,
  ): DraftAnswers {
    const order = new Map(
      template.definition.sections
        .flatMap((section) => section.items)
        .map((item, index) => [item.id, index]),
    );
    return {
      ...answers,
      items: [...answers.items].sort(
        (left, right) => order.get(left.itemId) - order.get(right.itemId),
      ),
    };
  }

  private async readRetry(
    tx: Prisma.TransactionClient,
    input: {
      submissionId: string;
      propertyId: string;
      type: ChecklistType;
      expectedRevision: number;
      requestHash: string;
    },
  ): Promise<GuestSubmissionCorrectionDto> {
    const revision = await tx.submissionRevision.findUnique({
      where: {
        submissionId_version: {
          submissionId: input.submissionId,
          version: input.expectedRevision + 1,
        },
      },
      select: {
        submissionId: true,
        version: true,
        action: true,
        status: true,
        actorSource: true,
        snapshot: true,
        createdAt: true,
      },
    });
    if (
      !revision ||
      revision.action !== SubmissionRevisionAction.CORRECTED ||
      revision.status !== SubmissionStatus.SUBMITTED ||
      revision.actorSource !== ActorSource.PRIVATE_LINK
    )
      throw this.changed();
    const snapshot = revision.snapshot;
    const correction = this.isObject(snapshot)
      ? snapshot.correction
      : undefined;
    if (
      !this.isObject(correction) ||
      correction.schemaVersion !== 1 ||
      correction.expectedRevision !== input.expectedRevision ||
      typeof correction.requestHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(correction.requestHash)
    )
      throw new InternalServerErrorException();
    if (correction.requestHash !== input.requestHash) throw this.changed();
    const { record } = parseSubmissionSnapshot(snapshot, {
      submissionId: input.submissionId,
      propertyId: input.propertyId,
      type: input.type,
      version: input.expectedRevision + 1,
      status: SubmissionStatus.SUBMITTED,
    });
    if (
      revision.submissionId !== input.submissionId ||
      revision.version !== input.expectedRevision + 1 ||
      record.updatedAt.getTime() !== revision.createdAt.getTime()
    )
      throw new InternalServerErrorException();
    return {
      id: input.submissionId,
      status: 'SUBMITTED',
      revision: revision.version,
      updatedAt: record.updatedAt,
      changed: true,
    };
  }

  private isObject(
    value: Prisma.JsonValue | undefined,
  ): value is Prisma.JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'SUBMISSION_CHANGED',
      message:
        '제출 내역이 변경되었습니다. 최신 내용을 확인한 뒤 수정해 주세요.',
    });
  }
}
