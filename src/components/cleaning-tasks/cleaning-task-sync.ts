import { ConflictException } from '@nestjs/common';
import {
  CleaningTaskSource,
  CleaningTaskStatus,
  Prisma,
  StayStatus,
} from '@prisma/client';
import type { CleaningTaskSyncDto } from '../../libs/dto/cleaning-task/cleaning-task';

interface SyncStay {
  id: string;
  propertyId: string;
  currentRevision: number;
  checkOutAt: Date;
  status: StayStatus;
}

export function cleaningTaskCutoff(now = new Date()): Date {
  const day = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return new Date(`${day}T00:00:00+09:00`);
}

/** Called inside the reservation's existing serializable write transaction. */
export async function syncCleaningTaskForStay(
  tx: Prisma.TransactionClient,
  stay: SyncStay,
): Promise<CleaningTaskSyncDto> {
  const task = await tx.cleaningTask.findUnique({
    where: { departingStayId: stay.id },
  });
  if (!task) {
    if (
      stay.status !== StayStatus.ACTIVE ||
      stay.checkOutAt < cleaningTaskCutoff()
    )
      return { created: 0, updated: 0 };
    await tx.cleaningTask.create({
      data: {
        propertyId: stay.propertyId,
        departingStayId: stay.id,
        source: CleaningTaskSource.AUTO,
        dueAt: stay.checkOutAt,
        sourceStayRevision: stay.currentRevision,
      },
      select: { id: true },
    });
    return { created: 1, updated: 0 };
  }
  // Completed evidence and deliberate administrator cancellations are immutable.
  if (
    task.status === CleaningTaskStatus.COMPLETED ||
    (task.status === CleaningTaskStatus.CANCELLED && !task.cancelledBySchedule)
  )
    return { created: 0, updated: 0 };
  const cancelled = stay.status === StayStatus.CANCELLED;
  const status = cancelled
    ? CleaningTaskStatus.CANCELLED
    : task.cancelledBySchedule
      ? task.currentSubmissionId
        ? CleaningTaskStatus.IN_PROGRESS
        : CleaningTaskStatus.PLANNED
      : task.status;
  const dueAt = task.manualDueAt ? task.dueAt : stay.checkOutAt;
  if (
    task.sourceStayRevision === stay.currentRevision &&
    task.status === status &&
    task.dueAt.getTime() === dueAt.getTime()
  )
    return { created: 0, updated: 0 };
  await tx.cleaningTask.update({
    where: { id: task.id },
    data: {
      sourceStayRevision: stay.currentRevision,
      dueAt,
      status,
      cancelledBySchedule: cancelled,
      cancellationReason: cancelled ? '이용 일정 취소' : null,
      version: { increment: 1 },
    },
    select: { id: true },
  });
  return { created: 0, updated: 1 };
}

/** Explicit POST reconciliation also initializes existing current/future bookings. */
export async function syncPropertyCleaningTasks(
  tx: Prisma.TransactionClient,
  propertyId?: string,
): Promise<CleaningTaskSyncDto> {
  const stays = await tx.stay.findMany({
    where: {
      propertyId,
      OR: [
        {
          status: StayStatus.ACTIVE,
          checkOutAt: { gte: cleaningTaskCutoff() },
          property: { isActive: true },
        },
        {
          departureCleaningTask: {
            is: { status: { not: CleaningTaskStatus.COMPLETED } },
          },
        },
      ],
    },
    select: {
      id: true,
      propertyId: true,
      currentRevision: true,
      checkOutAt: true,
      status: true,
    },
    orderBy: [{ checkOutAt: 'asc' }, { id: 'asc' }],
    take: 201,
  });
  if (stays.length > 200)
    throw new ConflictException({
      code: 'CLEANING_SYNC_LIMIT',
      message: '동기화할 일정이 많습니다. 휴양소를 선택해 다시 시도해 주세요.',
    });
  const total = { created: 0, updated: 0 };
  for (const stay of stays) {
    const result = await syncCleaningTaskForStay(tx, stay);
    total.created += result.created;
    total.updated += result.updated;
  }
  return total;
}
