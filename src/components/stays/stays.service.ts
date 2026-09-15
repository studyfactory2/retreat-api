import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StayRevisionAction,
  StaySource,
  StayStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import type {
  CancelStayInput,
  CreateStayInput,
  GetStayHistoryInput,
  GetStaysInput,
  RestoreStayInput,
  UpdateStayInput,
} from '../../libs/dto/stay/stay.input';
import type {
  StayDto,
  StayListDto,
  StayRevisionListDto,
} from '../../libs/dto/stay/stay';
import { buildStayActorSnapshot, buildStaySnapshot } from './stay-snapshot';

const staySelect = {
  id: true,
  propertyId: true,
  guestUserId: true,
  guestName: true,
  company: true,
  department: true,
  phone: true,
  checkInAt: true,
  checkOutAt: true,
  status: true,
  source: true,
  notes: true,
  createdByUserId: true,
  currentRevision: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { id: true, name: true, region: true, isActive: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.StaySelect;

const revisionSelect = {
  id: true,
  stayId: true,
  version: true,
  action: true,
  snapshot: true,
  actorUserId: true,
  actorSnapshot: true,
  reason: true,
  importRowId: true,
  createdAt: true,
} satisfies Prisma.StayRevisionSelect;

@Injectable()
export class StaysService {
  constructor(private readonly prisma: PrismaService) {}

  public async createStay(
    input: CreateStayInput,
    actor: AuthenticatedUser,
  ): Promise<StayDto> {
    const checkInAt = this.parseTimestamp(input.checkInAt);
    const checkOutAt = this.parseTimestamp(input.checkOutAt);
    this.validateRange(checkInAt, checkOutAt);

    return await runSerializableTransaction(this.prisma, async (tx) => {
      await this.requireActiveProperty(tx, input.propertyId);
      await this.assertAvailable(tx, input.propertyId, checkInAt, checkOutAt);
      const stay = await tx.stay.create({
        data: {
          propertyId: input.propertyId,
          guestName: input.guestName,
          company: input.company,
          department: input.department,
          phone: input.phone,
          notes: input.notes,
          checkInAt,
          checkOutAt,
          source: StaySource.MANUAL,
          status: StayStatus.ACTIVE,
          createdByUserId: actor.id,
          currentRevision: 1,
        },
        select: staySelect,
      });
      await this.recordRevision(
        tx,
        stay,
        StayRevisionAction.CREATED,
        actor,
        null,
      );
      return stay;
    });
  }

  public async getStays(input: GetStaysInput): Promise<StayListDto> {
    const from =
      input.from === undefined ? undefined : this.parseTimestamp(input.from);
    const to =
      input.to === undefined ? undefined : this.parseTimestamp(input.to);
    if (from && to) this.validateRange(from, to);

    const where: Prisma.StayWhereInput = {
      propertyId: input.propertyId,
      status: input.status,
      ...(from ? { checkOutAt: { gt: from } } : {}),
      ...(to ? { checkInAt: { lt: to } } : {}),
      ...(input.search
        ? {
            OR: [
              { guestName: { contains: input.search, mode: 'insensitive' } },
              { company: { contains: input.search, mode: 'insensitive' } },
              { department: { contains: input.search, mode: 'insensitive' } },
              { phone: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.stay.findMany({
          where,
          select: staySelect,
          orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        this.prisma.stay.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items,
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  public async getStay(id: string): Promise<StayDto> {
    return await this.findStay(this.prisma, id);
  }

  public async updateStay(
    id: string,
    input: UpdateStayInput,
    actor: AuthenticatedUser,
  ): Promise<StayDto> {
    const fields = [
      input.guestName,
      input.company,
      input.department,
      input.phone,
      input.notes,
      input.checkInAt,
      input.checkOutAt,
    ];
    if (fields.every((value) => value === undefined)) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: '변경할 이용 정보를 입력해 주세요.',
      });
    }

    return await runSerializableTransaction(this.prisma, async (tx) => {
      const current = await this.findStay(tx, id);
      this.requireRevision(current, input.expectedRevision);
      this.requireStatus(current, StayStatus.ACTIVE);
      const checkInAt =
        input.checkInAt === undefined
          ? current.checkInAt
          : this.parseTimestamp(input.checkInAt);
      const checkOutAt =
        input.checkOutAt === undefined
          ? current.checkOutAt
          : this.parseTimestamp(input.checkOutAt);
      this.validateRange(checkInAt, checkOutAt);

      const datesChanged =
        checkInAt.getTime() !== current.checkInAt.getTime() ||
        checkOutAt.getTime() !== current.checkOutAt.getTime();
      if (datesChanged) {
        await this.requireActiveProperty(tx, current.propertyId);
        await this.assertAvailable(
          tx,
          current.propertyId,
          checkInAt,
          checkOutAt,
          id,
        );
      }

      const updated = await this.writeCurrent(tx, current, {
        guestName: input.guestName,
        company: input.company,
        department: input.department,
        phone: input.phone,
        notes: input.notes,
        checkInAt,
        checkOutAt,
      });
      await this.recordRevision(
        tx,
        updated,
        StayRevisionAction.CORRECTED,
        actor,
        input.reason ?? null,
      );
      return updated;
    });
  }

  public async cancelStay(
    id: string,
    input: CancelStayInput,
    actor: AuthenticatedUser,
  ): Promise<StayDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const current = await this.findStay(tx, id);
      this.requireRevision(current, input.expectedRevision);
      this.requireStatus(current, StayStatus.ACTIVE);
      const cancelled = await this.writeCurrent(tx, current, {
        status: StayStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: input.reason,
      });
      await this.recordRevision(
        tx,
        cancelled,
        StayRevisionAction.CANCELLED,
        actor,
        input.reason,
      );
      return cancelled;
    });
  }

  public async restoreStay(
    id: string,
    input: RestoreStayInput,
    actor: AuthenticatedUser,
  ): Promise<StayDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const current = await this.findStay(tx, id);
      this.requireRevision(current, input.expectedRevision);
      this.requireStatus(current, StayStatus.CANCELLED);
      this.validateRange(current.checkInAt, current.checkOutAt);
      await this.requireActiveProperty(tx, current.propertyId);
      await this.assertAvailable(
        tx,
        current.propertyId,
        current.checkInAt,
        current.checkOutAt,
        id,
      );
      const restored = await this.writeCurrent(tx, current, {
        status: StayStatus.ACTIVE,
        cancelledAt: null,
        cancellationReason: null,
      });
      await this.recordRevision(
        tx,
        restored,
        StayRevisionAction.RESTORED,
        actor,
        input.reason,
      );
      return restored;
    });
  }

  public async getStayHistory(
    id: string,
    input: GetStayHistoryInput,
  ): Promise<StayRevisionListDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        await this.findStay(tx, id);
        const where = { stayId: id };
        const items = await tx.stayRevision.findMany({
          where,
          select: revisionSelect,
          orderBy: { version: 'desc' },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.stayRevision.count({ where });
        return {
          items,
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async findStay(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<StayDto> {
    const stay = await tx.stay.findUnique({
      where: { id },
      select: staySelect,
    });
    if (!stay) {
      throw new NotFoundException({
        code: 'STAY_NOT_FOUND',
        message: '이용 일정을 찾을 수 없습니다.',
      });
    }
    return stay;
  }

  private async requireActiveProperty(
    tx: Prisma.TransactionClient,
    propertyId: string,
  ): Promise<void> {
    const property = await tx.property.findUnique({
      where: { id: propertyId },
      select: { isActive: true },
    });
    if (!property) {
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: '휴양소를 찾을 수 없습니다.',
      });
    }
    if (!property.isActive) {
      throw new ConflictException({
        code: 'PROPERTY_INACTIVE',
        message: '비활성 휴양소에는 이용 일정을 등록하거나 변경할 수 없습니다.',
      });
    }
  }

  private async assertAvailable(
    tx: Prisma.TransactionClient,
    propertyId: string,
    checkInAt: Date,
    checkOutAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await tx.stay.findFirst({
      where: {
        propertyId,
        status: StayStatus.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        checkInAt: { lt: checkOutAt },
        checkOutAt: { gt: checkInAt },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException({
        code: 'STAY_OVERLAP',
        message: '해당 휴양소에 이용 기간이 겹치는 일정이 있습니다.',
      });
    }
  }

  private requireRevision(stay: StayDto, expectedRevision: number): void {
    if (stay.currentRevision !== expectedRevision) {
      throw this.revisionConflict();
    }
  }

  private requireStatus(stay: StayDto, expected: StayStatus): void {
    if (stay.status !== expected) {
      throw new ConflictException({
        code: 'INVALID_STAY_STATE',
        message:
          expected === StayStatus.ACTIVE
            ? '취소된 이용 일정은 먼저 복원해 주세요.'
            : '취소된 이용 일정만 복원할 수 있습니다.',
      });
    }
  }

  private async writeCurrent(
    tx: Prisma.TransactionClient,
    current: StayDto,
    data: Prisma.StayUpdateManyMutationInput,
  ): Promise<StayDto> {
    const result = await tx.stay.updateMany({
      where: { id: current.id, currentRevision: current.currentRevision },
      data: { ...data, currentRevision: { increment: 1 } },
    });
    if (result.count !== 1) throw this.revisionConflict();
    return await this.findStay(tx, current.id);
  }

  private async recordRevision(
    tx: Prisma.TransactionClient,
    stay: StayDto,
    action: StayRevisionAction,
    actor: AuthenticatedUser,
    reason: string | null,
  ): Promise<void> {
    await tx.stayRevision.create({
      data: {
        stayId: stay.id,
        version: stay.currentRevision,
        action,
        snapshot: buildStaySnapshot(stay),
        actorUserId: actor.id,
        actorSnapshot: buildStayActorSnapshot(actor),
        reason,
      },
    });
  }

  private parseTimestamp(value: string): Date {
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_STAY_DATE',
        message: '올바른 이용 날짜와 시간을 입력해 주세요.',
      });
    }
    return result;
  }

  private validateRange(start: Date, end: Date): void {
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: '종료 일시는 시작 일시보다 늦어야 합니다.',
      });
    }
  }

  private revisionConflict(): ConflictException {
    return new ConflictException({
      code: 'STALE_STAY_REVISION',
      message:
        '이용 일정이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.',
    });
  }
}
