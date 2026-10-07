import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ActorSource, IssueEventType, Prisma, Role } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { ChangeAdminIssueCancellationInput } from '../../libs/dto/admin-issue/admin-issue.input';
import type { AdminIssueCancellationDto } from '../../libs/dto/admin-issue/admin-issue';
import { buildIssueSnapshot } from '../../libs/issues/issue-snapshot';
import {
  adminIssueEventSelect,
  AdminIssueReader,
  type AdminIssueRow,
} from './admin-issue-reader';

type CancellationAction =
  typeof IssueEventType.CANCELLED | typeof IssueEventType.RESTORED;

@Injectable()
export class AdminIssueCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminIssueReader,
  ) {}

  public async cancel(
    id: string,
    input: ChangeAdminIssueCancellationInput,
    adminId: string,
  ): Promise<AdminIssueCancellationDto> {
    return await this.recordAction(
      id,
      input,
      adminId,
      IssueEventType.CANCELLED,
    );
  }

  public async restore(
    id: string,
    input: ChangeAdminIssueCancellationInput,
    adminId: string,
  ): Promise<AdminIssueCancellationDto> {
    return await this.recordAction(id, input, adminId, IssueEventType.RESTORED);
  }

  private async recordAction(
    id: string,
    input: ChangeAdminIssueCancellationInput,
    adminId: string,
    action: CancellationAction,
  ): Promise<AdminIssueCancellationDto> {
    const reason = this.reason(input.reason);
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const actor = await this.requireAdministrator(tx, adminId);
        const issue = await this.reader.findIssue(tx, id);
        const current = await this.reader.readDetail(tx, issue);
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify({
              actorId: actor.id,
              action,
              expectedVersion: input.expectedVersion,
              reason,
            }),
          )
          .digest('hex');
        if (issue.currentVersion !== input.expectedVersion) {
          if (input.expectedVersion < issue.currentVersion)
            return await this.readRetry(
              tx,
              issue,
              actor.id,
              action,
              input.expectedVersion,
              reason,
              requestHash,
            );
          throw this.changed();
        }
        if (issue.currentVersion >= 2_147_483_647) throw this.changed();
        const cancelling = action === IssueEventType.CANCELLED;
        if (
          cancelling ? issue.cancelledAt !== null : issue.cancelledAt === null
        )
          throw new ConflictException({
            code: 'INVALID_ISSUE_CANCELLATION_TRANSITION',
            message: cancelling
              ? '이미 취소된 신고입니다. 최신 내용을 확인해 주세요.'
              : '취소된 신고만 복원할 수 있습니다.',
          });
        const now = new Date(
          Math.max(Date.now(), issue.updatedAt.getTime() + 1),
        );
        const data = {
          currentVersion: issue.currentVersion + 1,
          updatedAt: now,
          cancelledAt: cancelling ? now : null,
          cancellationReason: cancelling ? reason : null,
        };
        const record = { ...current.issue, ...data };
        const snapshot = {
          ...buildIssueSnapshot(record, issue.requestKey),
          adminCancellationChange: {
            schemaVersion: 1,
            action,
            expectedVersion: input.expectedVersion,
            requestHash,
          },
        } satisfies Prisma.InputJsonObject;
        const updated = await tx.issue.updateMany({
          where: {
            id: issue.id,
            currentVersion: input.expectedVersion,
            updatedAt: issue.updatedAt,
            cancelledAt: issue.cancelledAt,
          },
          data,
        });
        if (updated.count !== 1) throw this.changed();
        const eventId = randomUUID();
        await tx.issueEvent.create({
          data: {
            id: eventId,
            issueId: issue.id,
            version: data.currentVersion,
            type: action,
            actorSource: ActorSource.ADMIN_SESSION,
            actorUserId: actor.id,
            actorSnapshot: {
              schemaVersion: 1,
              id: actor.id,
              name: actor.name,
              role: actor.role,
            },
            sourceRevisionId: null,
            note: reason,
            fromStatus: issue.status,
            toStatus: issue.status,
            snapshot,
            createdAt: now,
          },
        });
        // Evidence stays on original events. Cancellation never changes processing
        // state, sources, recurrence targets, photos, submissions or stays.
        return {
          id: issue.id,
          eventId,
          version: data.currentVersion,
          status: issue.status,
          updatedAt: now,
          cancelledAt: data.cancelledAt,
          cancellationReason: data.cancellationReason,
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
    issue: AdminIssueRow,
    actorId: string,
    action: CancellationAction,
    expectedVersion: number,
    reason: string,
    requestHash: string,
  ): Promise<AdminIssueCancellationDto> {
    const event = await tx.issueEvent.findUnique({
      where: {
        issueId_version: { issueId: issue.id, version: expectedVersion + 1 },
      },
      select: adminIssueEventSelect,
    });
    if (
      !event ||
      event.type !== action ||
      event.actorSource !== ActorSource.ADMIN_SESSION ||
      event.actorUserId !== actorId ||
      !object(event.snapshot)
    )
      throw this.changed();
    const change = event.snapshot.adminCancellationChange;
    if (
      !object(change) ||
      change.schemaVersion !== 1 ||
      change.action !== action ||
      change.expectedVersion !== expectedVersion ||
      change.requestHash !== requestHash
    )
      throw this.changed();
    const { dto } = await this.reader.mapEvent(tx, issue, event);
    const record = dto.record;
    if (
      dto.version !== expectedVersion + 1 ||
      dto.actor.role !== Role.ADMIN ||
      dto.note !== reason ||
      dto.fromStatus !== dto.toStatus ||
      dto.sourceRevisionId !== null ||
      dto.photos.length !== 0 ||
      (action === IssueEventType.CANCELLED
        ? record.cancelledAt?.getTime() !== record.updatedAt.getTime() ||
          record.cancellationReason !== reason
        : record.cancelledAt !== null || record.cancellationReason !== null)
    )
      throw new InternalServerErrorException();
    return {
      id: issue.id,
      eventId: dto.id,
      version: dto.version,
      status: record.status,
      updatedAt: record.updatedAt,
      cancelledAt: record.cancelledAt,
      cancellationReason: record.cancellationReason,
    };
  }

  private async requireAdministrator(
    tx: Prisma.TransactionClient,
    adminId: string,
  ) {
    const actor = await tx.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        loginId: true,
        passwordHash: true,
      },
    });
    if (
      !actor?.isActive ||
      actor.role !== Role.ADMIN ||
      !actor.loginId ||
      !actor.passwordHash
    )
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '로그인이 필요합니다. 다시 로그인해 주세요.',
      });
    return actor;
  }

  private reason(value: string): string {
    const reason = typeof value === 'string' ? value.trim() : '';
    if (!reason || [...reason].length > 1000)
      throw new BadRequestException({
        code: 'ISSUE_CANCELLATION_REASON_REQUIRED',
        message: '변경 사유를 1자 이상 1000자 이하로 입력해 주세요.',
      });
    return reason;
  }
  private changed(): ConflictException {
    return new ConflictException({
      code: 'ISSUE_CHANGED',
      message: '이상사항이 변경되었습니다. 다시 불러온 뒤 시도해 주세요.',
    });
  }
}
function object(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
