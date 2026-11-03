import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CleaningTaskSource, CleaningTaskStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  CleaningTaskDto,
  CleaningTaskListDto,
  CleaningTaskSyncDto,
} from '../../libs/dto/cleaning-task/cleaning-task';
import type {
  CancelCleaningTaskInput,
  CreateCleaningTaskInput,
  GetCleaningTasksInput,
  SyncCleaningTasksInput,
  UpdateCleaningTaskInput,
} from '../../libs/dto/cleaning-task/cleaning-task.input';
import {
  cleaningTaskRequiresReview,
  cleaningTaskSelect,
  listCleaningTasks,
  toCleaningTaskDto,
  type CleaningTaskRecord,
} from './cleaning-task-data';
import { syncPropertyCleaningTasks } from './cleaning-task-sync';

@Injectable()
export class CleaningTasksService {
  constructor(private readonly prisma: PrismaService) {}

  public async list(
    input: GetCleaningTasksInput,
  ): Promise<CleaningTaskListDto> {
    return await this.prisma.$transaction(
      (tx) => listCleaningTasks(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  public async get(id: string): Promise<CleaningTaskDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const task = await this.find(tx, id);
        return toCleaningTaskDto(
          task,
          await cleaningTaskRequiresReview(tx, task),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  public async sync(
    input: SyncCleaningTasksInput,
  ): Promise<CleaningTaskSyncDto> {
    return await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        if (input.propertyId)
          await this.requireProperty(tx, input.propertyId, false);
        return await syncPropertyCleaningTasks(
          tx,
          input.propertyId?.toLowerCase(),
        );
      },
      { timeout: 30000 },
    );
  }
  public async create(
    input: CreateCleaningTaskInput,
  ): Promise<CleaningTaskDto> {
    const dueAt = this.parseDate(input.dueAt);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          propertyId: input.propertyId.toLowerCase(),
          dueAt: dueAt.toISOString(),
          note: input.note ?? null,
        }),
      )
      .digest('hex');
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const existing = await tx.cleaningTask.findUnique({
          where: { requestKey: input.requestKey.toLowerCase() },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) throw this.changed();
          const current = await this.find(tx, existing.id);
          return toCleaningTaskDto(
            current,
            await cleaningTaskRequiresReview(tx, current),
          );
        }
        await this.requireProperty(tx, input.propertyId, true);
        const task = await tx.cleaningTask.create({
          data: {
            requestKey: input.requestKey.toLowerCase(),
            requestHash,
            propertyId: input.propertyId.toLowerCase(),
            source: CleaningTaskSource.MANUAL,
            dueAt,
            manualDueAt: true,
            note: input.note ?? null,
          },
          select: cleaningTaskSelect,
        });
        return toCleaningTaskDto(task);
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
  public async update(
    id: string,
    input: UpdateCleaningTaskInput,
  ): Promise<CleaningTaskDto> {
    const dueAt = this.parseDate(input.dueAt);
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const task = await this.find(tx, id);
      this.requireEditable(task, input.expectedVersion);
      if (task.departingStay && dueAt < task.departingStay.checkOutAt)
        throw new BadRequestException({
          code: 'CLEANING_BEFORE_CHECKOUT',
          message: '작업 일시는 퇴실 예정 이후로 지정해 주세요.',
        });
      const result = await tx.cleaningTask.updateMany({
        where: { id: task.id, version: input.expectedVersion },
        data: {
          dueAt,
          manualDueAt: true,
          ...(input.note !== undefined ? { note: input.note } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw this.changed();
      return toCleaningTaskDto(await this.find(tx, task.id));
    });
  }
  public async cancel(
    id: string,
    input: CancelCleaningTaskInput,
  ): Promise<CleaningTaskDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const task = await this.find(tx, id);
      if (
        task.status === CleaningTaskStatus.CANCELLED &&
        !task.cancelledBySchedule &&
        task.version === input.expectedVersion + 1 &&
        task.cancellationReason === input.reason
      )
        return toCleaningTaskDto(task);
      this.requireEditable(task, input.expectedVersion);
      const result = await tx.cleaningTask.updateMany({
        where: { id: task.id, version: input.expectedVersion },
        data: {
          status: CleaningTaskStatus.CANCELLED,
          cancelledBySchedule: false,
          cancellationReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw this.changed();
      return toCleaningTaskDto(await this.find(tx, task.id));
    });
  }
  private async find(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<CleaningTaskRecord> {
    const task = await tx.cleaningTask.findUnique({
      where: { id: id.toLowerCase() },
      select: cleaningTaskSelect,
    });
    if (!task)
      throw new NotFoundException({
        code: 'CLEANING_TASK_NOT_FOUND',
        message: '작업을 찾을 수 없습니다.',
      });
    return task;
  }
  private async requireProperty(
    tx: Prisma.TransactionClient,
    id: string,
    active: boolean,
  ): Promise<void> {
    const property = await tx.property.findUnique({
      where: { id: id.toLowerCase() },
      select: { isActive: true },
    });
    if (!property)
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: '휴양소를 찾을 수 없습니다.',
      });
    if (active && !property.isActive)
      throw new ConflictException({
        code: 'PROPERTY_INACTIVE',
        message: '운영 중인 휴양소에 작업을 등록해 주세요.',
      });
  }
  private requireEditable(
    task: CleaningTaskRecord,
    expectedVersion: number,
  ): void {
    if (
      task.version !== expectedVersion ||
      (task.status !== CleaningTaskStatus.PLANNED &&
        task.status !== CleaningTaskStatus.IN_PROGRESS)
    )
      throw this.changed();
  }
  private parseDate(value: string): Date {
    const date = new Date(value);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() < 1900 ||
      date.getUTCFullYear() > 2100
    )
      throw new BadRequestException({
        code: 'INVALID_CLEANING_DATE',
        message: '작업 일시를 확인해 주세요.',
      });
    return date;
  }
  private changed(): ConflictException {
    return new ConflictException({
      code: 'CLEANING_TASK_CHANGED',
      message: '작업 상태가 변경되었습니다. 최신 내용을 확인해 주세요.',
    });
  }
}
