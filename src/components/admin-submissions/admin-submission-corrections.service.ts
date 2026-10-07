import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorSource,
  Prisma,
  Role,
  SubmissionRevisionAction,
  SubmissionStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { CorrectAdminSubmissionInput } from '../../libs/dto/admin-submission/admin-submission-correction.input';
import type { AdminSubmissionCorrectionDto } from '../../libs/dto/admin-submission/admin-submission';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import {
  parseSubmissionActor,
  parseSubmissionSnapshot,
} from '../../libs/submissions/submission-snapshot';
import { AdminIssueReader } from '../admin-issues/admin-issue-reader';
import { recordAdminCorrectionIssues } from './admin-submission-correction-issues';
import {
  canonicalCorrectionAnswers,
  preserveMaintenanceRepairs,
  requestedAdminAnswers,
  retainedCorrectionPhotos,
} from './admin-submission-correction-model';
import {
  readAdminSubmissionCorrectionRecord,
  type AdminSubmissionCorrectionRecord,
} from './admin-submission-correction-record';

@Injectable()
export class AdminSubmissionCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: AdminIssueReader,
  ) {}

  public async correct(
    id: string,
    input: CorrectAdminSubmissionInput,
    actor: AuthenticatedUser,
  ): Promise<AdminSubmissionCorrectionDto> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await runSerializableTransaction(this.prisma, async (tx) => {
          const administrator = await this.requireAdmin(tx, actor.id);
          const current = await readAdminSubmissionCorrectionRecord(tx, id);
          const { submission, record } = current;
          const requested = requestedAdminAnswers(input, record.template);
          const reason = input.reason.trim();
          const requestHash = createHash('sha256')
            .update(
              JSON.stringify({
                actorId: administrator.id,
                expectedRevision: input.expectedRevision,
                items: requested.items,
                generalNote: requested.generalNote,
                reason,
              }),
            )
            .digest('hex');
          if (submission.currentRevision !== input.expectedRevision) {
            if (input.expectedRevision < submission.currentRevision)
              return await this.readRetry(
                tx,
                current,
                administrator.id,
                input.expectedRevision,
                requestHash,
              );
            throw this.changed();
          }
          if (submission.currentRevision >= 2_147_483_647) throw this.changed();
          const answers = preserveMaintenanceRepairs(
            requested,
            record.answers,
            submission.type,
          );
          if (
            JSON.stringify(answers) ===
            JSON.stringify(
              canonicalCorrectionAnswers(record.answers, record.template),
            )
          )
            return {
              id: submission.id,
              status: 'SUBMITTED',
              revision: submission.currentRevision,
              updatedAt: record.updatedAt,
              changed: false,
            };
          const photos = retainedCorrectionPhotos(
            current.photos,
            record.template,
            answers,
            submission.type,
          );
          const now = new Date(
            Math.max(Date.now(), submission.updatedAt.getTime() + 1),
          );
          const version = submission.currentRevision + 1;
          const revisionId = randomUUID();
          if (
            !isObject(current.revision.snapshot) ||
            !isObject(current.revision.snapshot.submission)
          )
            throw new InternalServerErrorException();
          // Preserve captured author/template/property/stay context verbatim. Only
          // current answers, their valid photo associations and revision metadata change.
          const snapshot = {
            ...current.revision.snapshot,
            adminCorrection: {
              schemaVersion: 1,
              expectedRevision: input.expectedRevision,
              requestHash,
            },
            submission: {
              ...current.revision.snapshot.submission,
              currentRevision: version,
              updatedAt: now.toISOString(),
            },
            answers,
            photos,
          } satisfies Prisma.InputJsonObject;
          parseSubmissionSnapshot(snapshot, {
            submissionId: submission.id,
            propertyId: submission.propertyId,
            type: submission.type,
            version,
            status: SubmissionStatus.SUBMITTED,
          });
          const updated = await tx.checklistSubmission.updateMany({
            where: {
              id: submission.id,
              status: SubmissionStatus.SUBMITTED,
              currentRevision: input.expectedRevision,
              updatedAt: submission.updatedAt,
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
              actorSource: ActorSource.ADMIN_SESSION,
              actorUserId: administrator.id,
              actorSnapshot: { schemaVersion: 1, ...administrator },
              reason,
              createdAt: now,
            },
          });
          if (photos.length)
            await tx.submissionRevisionAttachment.createMany({
              data: photos.map((photo) => ({
                ...photo,
                revisionId,
                submissionId: submission.id,
              })),
            });
          await recordAdminCorrectionIssues(tx, this.issues, {
            current,
            revisionId,
            answers,
            photos,
            correctedAt: now,
            reason,
            actor: administrator,
          });
          return {
            id: submission.id,
            status: 'SUBMITTED',
            revision: version,
            updatedAt: now,
            changed: true,
          };
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Re-run only a known rolled-back fallback-category creation race.
          if (
            attempt < 2 &&
            error.meta?.modelName === 'IssueCategory' &&
            Array.isArray(error.meta.target) &&
            error.meta.target.includes('name')
          )
            continue;
          throw this.changed();
        }
        throw error;
      }
    }
  }

  private async readRetry(
    tx: Prisma.TransactionClient,
    current: AdminSubmissionCorrectionRecord,
    actorId: string,
    expectedRevision: number,
    requestHash: string,
  ): Promise<AdminSubmissionCorrectionDto> {
    const { submission } = current;
    const revision = await tx.submissionRevision.findUnique({
      where: {
        submissionId_version: {
          submissionId: submission.id,
          version: expectedRevision + 1,
        },
      },
      select: {
        submissionId: true,
        version: true,
        action: true,
        status: true,
        actorSource: true,
        actorUserId: true,
        actorSnapshot: true,
        snapshot: true,
        createdAt: true,
      },
    });
    if (
      !revision ||
      revision.action !== SubmissionRevisionAction.CORRECTED ||
      revision.status !== SubmissionStatus.SUBMITTED ||
      revision.actorSource !== ActorSource.ADMIN_SESSION ||
      revision.actorUserId !== actorId ||
      !isObject(revision.snapshot)
    )
      throw this.changed();
    const correction = revision.snapshot.adminCorrection;
    if (
      !isObject(correction) ||
      correction.schemaVersion !== 1 ||
      correction.expectedRevision !== expectedRevision ||
      correction.requestHash !== requestHash
    )
      throw this.changed();
    const revisionActor = parseSubmissionActor(revision.actorSnapshot, actorId);
    if (revisionActor.role !== Role.ADMIN)
      throw new InternalServerErrorException();
    const { record } = parseSubmissionSnapshot(revision.snapshot, {
      submissionId: submission.id,
      propertyId: submission.propertyId,
      type: submission.type,
      version: expectedRevision + 1,
      status: SubmissionStatus.SUBMITTED,
    });
    if (
      revision.submissionId !== submission.id ||
      revision.version !== expectedRevision + 1 ||
      record.updatedAt.getTime() !== revision.createdAt.getTime()
    )
      throw new InternalServerErrorException();
    return {
      id: submission.id,
      status: 'SUBMITTED',
      revision: revision.version,
      updatedAt: record.updatedAt,
      changed: true,
    };
  }

  private async requireAdmin(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ id: string; name: string; role: typeof Role.ADMIN }> {
    const user = await tx.user.findFirst({
      where: { id, role: Role.ADMIN, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        loginId: true,
        passwordHash: true,
      },
    });
    if (!user?.loginId || !user.passwordHash || user.role !== Role.ADMIN)
      throw new UnauthorizedException({
        code: 'INVALID_ADMIN_ACCESS',
        message: '관리자 로그인 상태를 확인해 주세요.',
      });
    return { id: user.id, name: user.name, role: user.role };
  }
  private changed(): ConflictException {
    return new ConflictException({
      code: 'SUBMISSION_CHANGED',
      message:
        '제출 내역이 변경되었습니다. 최신 내용을 확인한 뒤 정정해 주세요.',
    });
  }
}
function isObject(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
