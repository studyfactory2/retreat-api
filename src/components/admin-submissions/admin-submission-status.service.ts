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
import type { ChangeAdminSubmissionStatusInput } from '../../libs/dto/admin-submission/admin-submission-status.input';
import type { AdminSubmissionStatusDto } from '../../libs/dto/admin-submission/admin-submission';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import {
  parseSubmissionActor,
  parseSubmissionSnapshot,
} from '../../libs/submissions/submission-snapshot';
import {
  readAdminSubmissionMutationRecord,
  type AdminSubmissionCorrectionRecord,
} from './admin-submission-correction-record';

type StatusAction =
  | typeof SubmissionRevisionAction.CANCELLED
  | typeof SubmissionRevisionAction.RESTORED;

@Injectable()
export class AdminSubmissionStatusService {
  constructor(private readonly prisma: PrismaService) {}

  public async cancel(
    id: string,
    input: ChangeAdminSubmissionStatusInput,
    actor: AuthenticatedUser,
  ): Promise<AdminSubmissionStatusDto> {
    return await this.changeStatus(
      id,
      input,
      actor,
      SubmissionRevisionAction.CANCELLED,
    );
  }

  public async restore(
    id: string,
    input: ChangeAdminSubmissionStatusInput,
    actor: AuthenticatedUser,
  ): Promise<AdminSubmissionStatusDto> {
    return await this.changeStatus(
      id,
      input,
      actor,
      SubmissionRevisionAction.RESTORED,
    );
  }

  private async changeStatus(
    id: string,
    input: ChangeAdminSubmissionStatusInput,
    actor: AuthenticatedUser,
    action: StatusAction,
  ): Promise<AdminSubmissionStatusDto> {
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const administrator = await this.requireAdmin(tx, actor.id);
        const current = await readAdminSubmissionMutationRecord(tx, id, {
          allowCancelled: true,
        });
        const { submission, revision } = current;
        const reason = input.reason.trim();
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              actorId: administrator.id,
              action,
              expectedRevision: input.expectedRevision,
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
              action,
              input.expectedRevision,
              requestHash,
            );
          throw this.changed();
        }
        const before =
          action === SubmissionRevisionAction.CANCELLED
            ? SubmissionStatus.SUBMITTED
            : SubmissionStatus.CANCELLED;
        const status =
          action === SubmissionRevisionAction.CANCELLED
            ? SubmissionStatus.CANCELLED
            : SubmissionStatus.SUBMITTED;
        if (submission.status !== before)
          throw new ConflictException({
            code: 'INVALID_SUBMISSION_TRANSITION',
            message:
              action === SubmissionRevisionAction.CANCELLED
                ? '제출 완료된 체크리스트만 취소할 수 있습니다.'
                : '취소된 체크리스트만 복원할 수 있습니다.',
          });
        if (submission.currentRevision >= 2_147_483_647) throw this.changed();
        if (!object(revision.snapshot) || !object(revision.snapshot.submission))
          throw new InternalServerErrorException();
        const now = new Date(
          Math.max(Date.now(), submission.updatedAt.getTime() + 1),
        );
        const cancelledAt = status === SubmissionStatus.CANCELLED ? now : null;
        const version = submission.currentRevision + 1;
        const revisionId = randomUUID();
        // Copy the exact current evidence. Restoration never looks backwards for
        // answers, removed repair information or associations lost to corrections.
        const snapshot = {
          ...revision.snapshot,
          adminStatusChange: {
            schemaVersion: 1,
            action,
            expectedRevision: input.expectedRevision,
            requestHash,
          },
          submission: {
            ...revision.snapshot.submission,
            status,
            cancelledAt: cancelledAt?.toISOString() ?? null,
            currentRevision: version,
            updatedAt: now.toISOString(),
          },
        } satisfies Prisma.InputJsonObject;
        parseSubmissionSnapshot(snapshot, {
          submissionId: submission.id,
          propertyId: submission.propertyId,
          type: submission.type,
          version,
          status,
        });
        const updated = await tx.checklistSubmission.updateMany({
          where: {
            id: submission.id,
            status: before,
            currentRevision: input.expectedRevision,
            updatedAt: submission.updatedAt,
          },
          data: {
            status,
            cancelledAt,
            currentRevision: version,
            updatedAt: now,
          },
        });
        if (updated.count !== 1) throw this.changed();
        await tx.submissionRevision.create({
          data: {
            id: revisionId,
            submissionId: submission.id,
            version,
            action,
            status,
            snapshot,
            actorSource: ActorSource.ADMIN_SESSION,
            actorUserId: administrator.id,
            actorSnapshot: { schemaVersion: 1, ...administrator },
            reason,
            createdAt: now,
          },
        });
        if (current.photos.length)
          await tx.submissionRevisionAttachment.createMany({
            data: current.photos.map((photo) => ({
              ...photo,
              revisionId,
              submissionId: submission.id,
            })),
          });
        // Linked issues, stays, private-token expiry and stored files are independent
        // of checklist validity and are intentionally never written here.
        return {
          id: submission.id,
          status,
          revision: version,
          updatedAt: now,
          cancelledAt,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.changed();
      throw error;
    }
  }

  private async readRetry(
    tx: Prisma.TransactionClient,
    current: AdminSubmissionCorrectionRecord,
    actorId: string,
    action: StatusAction,
    expectedRevision: number,
    requestHash: string,
  ): Promise<AdminSubmissionStatusDto> {
    const { submission } = current;
    const status =
      action === SubmissionRevisionAction.CANCELLED
        ? SubmissionStatus.CANCELLED
        : SubmissionStatus.SUBMITTED;
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
      revision.action !== action ||
      revision.status !== status ||
      revision.actorSource !== ActorSource.ADMIN_SESSION ||
      revision.actorUserId !== actorId ||
      !object(revision.snapshot)
    )
      throw this.changed();
    const change = revision.snapshot.adminStatusChange;
    if (
      !object(change) ||
      change.schemaVersion !== 1 ||
      change.action !== action ||
      change.expectedRevision !== expectedRevision ||
      change.requestHash !== requestHash
    )
      throw this.changed();
    if (
      parseSubmissionActor(revision.actorSnapshot, actorId).role !== Role.ADMIN
    )
      throw new InternalServerErrorException();
    const { record } = parseSubmissionSnapshot(revision.snapshot, {
      submissionId: submission.id,
      propertyId: submission.propertyId,
      type: submission.type,
      version: expectedRevision + 1,
      status,
    });
    if (
      revision.submissionId !== submission.id ||
      revision.version !== expectedRevision + 1 ||
      record.updatedAt.getTime() !== revision.createdAt.getTime() ||
      (status === SubmissionStatus.CANCELLED &&
        record.cancelledAt?.getTime() !== record.updatedAt.getTime())
    )
      throw new InternalServerErrorException();
    return {
      id: submission.id,
      status,
      revision: revision.version,
      updatedAt: record.updatedAt,
      cancelledAt: record.cancelledAt,
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
        '제출 내역이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.',
    });
  }
}
function object(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
