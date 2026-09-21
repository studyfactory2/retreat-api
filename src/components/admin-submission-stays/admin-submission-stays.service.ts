import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorSource,
  ChecklistType,
  Prisma,
  Role,
  StayStatus,
  SubmissionRevisionAction,
  SubmissionStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  GetSubmissionStayCandidatesInput,
  LinkSubmissionStayInput,
} from '../../libs/dto/admin-submission-stay/admin-submission-stay.input';
import type {
  SubmissionStayCandidatesDto,
  SubmissionStayLinkDto,
} from '../../libs/dto/admin-submission-stay/admin-submission-stay';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { parseSubmissionSnapshot } from '../../libs/submissions/submission-snapshot';
import { readSubmissionStayRecord } from './submission-stay-record';

const staySelect = {
  id: true,
  propertyId: true,
  guestName: true,
  company: true,
  department: true,
  phone: true,
  checkInAt: true,
  checkOutAt: true,
  currentRevision: true,
} satisfies Prisma.StaySelect;

function object(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function seoulDate(at: Date): string {
  return new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

@Injectable()
export class AdminSubmissionStaysService {
  constructor(private readonly prisma: PrismaService) {}

  public async getCandidates(
    id: string,
    input: GetSubmissionStayCandidatesInput,
  ): Promise<SubmissionStayCandidatesDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const { submission, record } = await readSubmissionStayRecord(tx, id);
        const start = new Date(`${record.visitDate}T00:00:00+09:00`);
        const end = new Date(start.getTime() + 86400_000);
        const where: Prisma.StayWhereInput = {
          propertyId: submission.propertyId,
          property: { isActive: true },
          status: StayStatus.ACTIVE,
          [submission.type === ChecklistType.CHECK_IN
            ? 'checkInAt'
            : 'checkOutAt']: { gte: start, lt: end },
        };
        const stays = await tx.stay.findMany({
          where,
          select: staySelect,
          orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.stay.count({ where });
        const linked = await tx.checklistSubmission.findMany({
          where: {
            stayId: { in: stays.map((stay) => stay.id) },
            id: { not: submission.id },
            type: submission.type,
            status: SubmissionStatus.SUBMITTED,
          },
          select: { stayId: true },
          distinct: ['stayId'],
        });
        const occupied = new Set(linked.map((row) => row.stayId));
        return {
          submissionId: submission.id,
          currentRevision: submission.currentRevision,
          currentStayId: submission.stayId,
          type: submission.type,
          visitDate: record.visitDate,
          items: stays.map((stay) => ({
            ...stay,
            alreadyLinked: occupied.has(stay.id),
          })),
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async linkStay(
    id: string,
    input: LinkSubmissionStayInput,
    actor: AuthenticatedUser,
  ): Promise<SubmissionStayLinkDto> {
    const stayId = input.stayId?.toLowerCase() ?? null;
    const reason = input.reason.trim();
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          expectedRevision: input.expectedRevision,
          stayId,
          expectedStayRevision: input.expectedStayRevision ?? null,
          reason,
          actorUserId: actor.id,
        }),
      )
      .digest('hex');
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const administrator = await this.requireAdmin(tx, actor.id);
      const { submission, revision, record, photos } =
        await readSubmissionStayRecord(tx, id);
      if (submission.currentRevision !== input.expectedRevision) {
        if (input.expectedRevision < submission.currentRevision)
          return await this.readRetry(
            tx,
            submission,
            input.expectedRevision,
            requestHash,
            actor.id,
          );
        throw this.changed();
      }
      if (submission.currentRevision >= 2147483647) throw this.changed();
      const previousSnapshot = revision.snapshot;
      if (!object(previousSnapshot)) throw new InternalServerErrorException();
      let match: Prisma.InputJsonObject | null = null;
      if (stayId !== null) {
        const stay = await tx.stay.findUnique({
          where: { id: stayId },
          select: {
            ...staySelect,
            status: true,
            property: { select: { isActive: true } },
          },
        });
        if (!stay)
          throw new NotFoundException({
            code: 'STAY_NOT_FOUND',
            message: '이용 일정을 찾을 수 없습니다.',
          });
        if (stay.currentRevision !== input.expectedStayRevision)
          throw new ConflictException({
            code: 'STALE_STAY_REVISION',
            message: '이용 일정이 변경되었습니다. 최신 내용을 확인해 주세요.',
          });
        const visitAt =
          submission.type === ChecklistType.CHECK_IN
            ? stay.checkInAt
            : stay.checkOutAt;
        if (
          stay.propertyId !== submission.propertyId ||
          !stay.property.isActive ||
          stay.status !== StayStatus.ACTIVE ||
          seoulDate(visitAt) !== record.visitDate
        )
          throw new ConflictException({
            code: 'STAY_NOT_ELIGIBLE',
            message:
              '휴양소, 입퇴실 날짜와 이용 일정의 활성 상태를 확인해 주세요.',
          });
        const duplicate = await tx.checklistSubmission.findFirst({
          where: {
            stayId,
            propertyId: stay.propertyId,
            type: submission.type,
            status: SubmissionStatus.SUBMITTED,
            id: { not: submission.id },
          },
          select: { id: true },
        });
        if (duplicate)
          throw new ConflictException({
            code: 'STAY_CHECKLIST_ALREADY_LINKED',
            message:
              '이 일정에 같은 유형의 제출 내역이 이미 연결되어 있습니다. 중복 여부를 확인해 주세요.',
          });
        const existingMatch = previousSnapshot.stayMatch;
        if (
          submission.stayId === stay.id &&
          object(existingMatch) &&
          existingMatch.stayId === stay.id &&
          existingMatch.stayRevision === stay.currentRevision
        )
          return {
            id: submission.id,
            stayId,
            revision: submission.currentRevision,
            updatedAt: submission.updatedAt,
            changed: false,
          };
        match = {
          schemaVersion: 1,
          stayId: stay.id,
          stayRevision: stay.currentRevision,
          guestName: stay.guestName,
          checkInAt: stay.checkInAt.toISOString(),
          checkOutAt: stay.checkOutAt.toISOString(),
        };
      } else if (submission.stayId === null) {
        return {
          id: submission.id,
          stayId: null,
          revision: submission.currentRevision,
          updatedAt: submission.updatedAt,
          changed: false,
        };
      }
      const now = new Date(
        Math.max(Date.now(), submission.updatedAt.getTime() + 1),
      );
      const version = submission.currentRevision + 1;
      const revisionId = randomUUID();
      const result: SubmissionStayLinkDto = {
        id: submission.id,
        stayId,
        revision: version,
        updatedAt: now,
        changed: true,
      };
      const snapshot = {
        schemaVersion: 1,
        stayMatch: match,
        stayLinkChange: {
          schemaVersion: 1,
          expectedRevision: input.expectedRevision,
          requestHash,
          previousStayId: submission.stayId,
          stayId,
          expectedStayRevision: input.expectedStayRevision ?? null,
        },
        submission: {
          id: submission.id,
          propertyId: submission.propertyId,
          type: submission.type,
          status: SubmissionStatus.SUBMITTED,
          templateId: submission.templateId,
          templateVersion: submission.templateVersion,
          stayId,
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
        author: {
          schemaVersion: 1,
          role: record.author.role,
          name: record.author.name,
          company: record.author.company,
          department: record.author.department,
          phone: record.author.phone,
        },
        answers: record.answers,
        photos,
      } satisfies Prisma.InputJsonObject;
      const updated = await tx.checklistSubmission.updateMany({
        where: {
          id: submission.id,
          propertyId: submission.propertyId,
          status: SubmissionStatus.SUBMITTED,
          currentRevision: input.expectedRevision,
          updatedAt: submission.updatedAt,
          stayId: submission.stayId,
          authorSource: ActorSource.GUEST_QR,
          stayLinkVersion: null,
        },
        data: { stayId, currentRevision: version, updatedAt: now },
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
          actorSnapshot: {
            schemaVersion: 1,
            id: administrator.id,
            name: administrator.name,
            role: administrator.role,
          },
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
      return result;
    });
  }

  private async readRetry(
    tx: Prisma.TransactionClient,
    submission: { id: string; propertyId: string; type: ChecklistType },
    expectedRevision: number,
    requestHash: string,
    actorId: string,
  ): Promise<SubmissionStayLinkDto> {
    const revision = await tx.submissionRevision.findUnique({
      where: {
        submissionId_version: {
          submissionId: submission.id,
          version: expectedRevision + 1,
        },
      },
      select: {
        action: true,
        status: true,
        actorSource: true,
        actorUserId: true,
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
      !object(revision.snapshot)
    )
      throw this.changed();
    const change = revision.snapshot.stayLinkChange;
    if (
      !object(change) ||
      change.schemaVersion !== 1 ||
      change.expectedRevision !== expectedRevision ||
      change.requestHash !== requestHash
    )
      throw this.changed();
    const { record } = parseSubmissionSnapshot(revision.snapshot, {
      submissionId: submission.id,
      propertyId: submission.propertyId,
      type: submission.type,
      version: expectedRevision + 1,
      status: SubmissionStatus.SUBMITTED,
    });
    if (
      record.stayId !== change.stayId ||
      record.updatedAt.getTime() !== revision.createdAt.getTime()
    )
      throw new InternalServerErrorException();
    return {
      id: submission.id,
      stayId: record.stayId,
      revision: expectedRevision + 1,
      updatedAt: record.updatedAt,
      changed: true,
    };
  }

  private async requireAdmin(tx: Prisma.TransactionClient, id: string) {
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
    if (!user?.loginId || !user.passwordHash)
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
