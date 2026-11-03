import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CleaningTaskStatus, Prisma, Role, StayStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { CleaningTaskListDto } from '../../libs/dto/cleaning-task/cleaning-task';
import { QrFlow } from '../../libs/dto/qr/qr';
import type {
  GetStaffCleaningTasksInput,
  RevealTaskPasswordInput,
  StartCleaningTaskInput,
} from '../../libs/dto/staff-cleaning-task/staff-cleaning-task.input';
import type {
  TaskPasswordDto,
  RevealedTaskPasswordDto,
} from '../../libs/dto/staff-cleaning-task/staff-cleaning-task';
import type { StartDraftDto } from '../../libs/dto/submission-draft/submission-draft';
import {
  cleaningTaskSelect,
  listCleaningTasks,
  toCleaningTaskDto,
} from '../cleaning-tasks/cleaning-task-data';
import { syncPropertyCleaningTasks } from '../cleaning-tasks/cleaning-task-sync';
import { CleaningTaskAccessService } from '../cleaning-task-access/cleaning-task-access.service';
import { QrService } from '../qr/qr.service';
import { SubmissionDraftsService } from '../submission-drafts/submission-drafts.service';

@Injectable()
export class StaffCleaningTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrService,
    private readonly drafts: SubmissionDraftsService,
    private readonly access: CleaningTaskAccessService,
  ) {}

  public async list(
    authorization: string | undefined,
    input: GetStaffCleaningTasksInput,
  ): Promise<CleaningTaskListDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const { property } = await this.resolveStaff(tx, authorization);
        return await listCleaningTasks(tx, input, property.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async sync(
    authorization: string | undefined,
    input: GetStaffCleaningTasksInput,
  ): Promise<CleaningTaskListDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const { property } = await this.resolveStaff(tx, authorization);
      await syncPropertyCleaningTasks(tx, property.id);
      return await listCleaningTasks(tx, input, property.id);
    });
  }

  public async start(
    authorization: string | undefined,
    taskId: string,
    input: StartCleaningTaskInput,
  ): Promise<StartDraftDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const { property, staff, qrTokenHash } = await this.resolveStaff(
        tx,
        authorization,
      );
      const task = await tx.cleaningTask.findFirst({
        where: { id: taskId.toLowerCase(), propertyId: property.id },
        select: cleaningTaskSelect,
      });
      if (!task)
        throw new NotFoundException({
          code: 'CLEANING_TASK_NOT_FOUND',
          message: '작업을 찾을 수 없습니다.',
        });
      if (
        task.version !== input.expectedVersion ||
        staff.id !== input.confirmedStaffId.toLowerCase()
      )
        throw this.access.changed();
      if (!toCleaningTaskDto(task).canStart)
        throw new ConflictException({
          code: 'CLEANING_TASK_NOT_READY',
          message: '퇴실 및 작업 일시를 확인해 주세요.',
        });
      const occupied = await tx.stay.findFirst({
        where: {
          propertyId: property.id,
          status: StayStatus.ACTIVE,
          checkInAt: { lte: new Date() },
          checkOutAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (occupied)
        throw new ConflictException({
          code: 'CLEANING_TASK_OCCUPIED',
          message: '이용 중인 예약이 있습니다. 퇴실 후 작업을 시작해 주세요.',
        });
      const updated = await tx.cleaningTask.updateMany({
        where: {
          id: task.id,
          version: task.version,
          status: {
            in: [CleaningTaskStatus.PLANNED, CleaningTaskStatus.IN_PROGRESS],
          },
        },
        data: {
          status: CleaningTaskStatus.IN_PROGRESS,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw this.access.changed();
      const receipt = await this.drafts.startCleaningTaskDraft(tx, {
        taskId: task.id,
        propertyId: property.id,
        currentSubmissionId: task.currentSubmissionId,
        qrTokenHash,
        staff,
      });
      await tx.cleaningTask.update({
        where: { id: task.id },
        data: { currentSubmissionId: receipt.draft.id },
        select: { id: true },
      });
      return receipt;
    });
  }

  public async password(
    authorization: string | undefined,
  ): Promise<TaskPasswordDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const draft = await this.drafts.resolveDraft(tx, authorization);
      if (!draft.cleaningTaskId) throw this.invalidAccess();
      return (await this.access.context(tx, draft.cleaningTaskId, draft.id))
        .dto;
    });
  }

  public async revealPassword(
    authorization: string | undefined,
    input: RevealTaskPasswordInput,
  ): Promise<RevealedTaskPasswordDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const draft = await this.drafts.resolveDraft(tx, authorization);
      if (!draft.cleaningTaskId) throw this.invalidAccess();
      const context = await this.access.context(
        tx,
        draft.cleaningTaskId,
        draft.id,
      );
      if (context.dto.fingerprint !== input.fingerprint)
        throw this.access.changed();
      if (!context.dto.canComplete || !context.code)
        throw new ConflictException({
          code: 'TASK_PASSWORD_BLOCKED',
          message: context.dto.blockedReason ?? '변경할 비밀번호가 없습니다.',
        });
      return { code: context.code, fingerprint: context.dto.fingerprint };
    });
  }

  private async resolveStaff(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ) {
    const property = await this.qr.resolveProperty(
      tx,
      QrFlow.STAFF,
      authorization,
    );
    const staff = property.staffUserId
      ? await tx.user.findFirst({
          where: { id: property.staffUserId, role: Role.STAFF, isActive: true },
          select: { id: true, name: true },
        })
      : null;
    const current = await tx.property.findUnique({
      where: { id: property.id },
      select: { staffQrTokenHash: true },
    });
    if (!staff || !current?.staffQrTokenHash) throw this.invalidAccess();
    return { property, staff, qrTokenHash: current.staffQrTokenHash };
  }

  private invalidAccess(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_TASK_ACCESS',
      message: '현재 담당 직원 QR로 다시 열어 주세요.',
    });
  }
}
