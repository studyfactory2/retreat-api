import {
  CleaningTaskSource,
  CleaningTaskStatus,
  Prisma,
  Role,
  StayStatus,
} from '@prisma/client';
import type {
  CleaningTaskDto,
  CleaningTaskListDto,
} from '../../libs/dto/cleaning-task/cleaning-task';
import type { GetCleaningTasksInput } from '../../libs/dto/cleaning-task/cleaning-task.input';

export const cleaningTaskSelect = {
  id: true,
  requestKey: true,
  propertyId: true,
  departingStayId: true,
  source: true,
  status: true,
  dueAt: true,
  manualDueAt: true,
  sourceStayRevision: true,
  version: true,
  note: true,
  cancelledBySchedule: true,
  cancellationReason: true,
  currentSubmissionId: true,
  currentSubmission: { select: { status: true, currentRevision: true } },
  completion: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  property: {
    select: {
      id: true,
      name: true,
      region: true,
      isActive: true,
      staffUserId: true,
      staffQrTokenHash: true,
      staff: { select: { id: true, name: true, role: true, isActive: true } },
      accessSettings: { select: { version: true } },
    },
  },
  departingStay: {
    select: {
      id: true,
      checkInAt: true,
      checkOutAt: true,
      currentRevision: true,
      status: true,
    },
  },
} satisfies Prisma.CleaningTaskSelect;
export type CleaningTaskRecord = Prisma.CleaningTaskGetPayload<{
  select: typeof cleaningTaskSelect;
}>;

export function toCleaningTaskDto(
  task: CleaningTaskRecord,
  requiresReview = false,
): CleaningTaskDto {
  const editable =
    task.status === CleaningTaskStatus.PLANNED ||
    task.status === CleaningTaskStatus.IN_PROGRESS;
  return {
    id: task.id,
    property: {
      id: task.propertyId,
      name: task.property.name,
      staffUserId: task.property.staffUserId,
      staffName: task.property.staff?.name ?? null,
    },
    departingStay: task.departingStay
      ? {
          id: task.departingStay.id,
          checkOutAt: task.departingStay.checkOutAt,
          currentRevision: task.departingStay.currentRevision,
          status: task.departingStay.status,
        }
      : null,
    source: task.source,
    status: task.status,
    dueAt: task.dueAt,
    version: task.version,
    currentSubmissionId: task.currentSubmissionId,
    completedAt: task.completedAt,
    note: task.note,
    canStart: Boolean(
      editable &&
      task.dueAt.getTime() <= Date.now() &&
      task.property.isActive &&
      task.property.staff?.isActive &&
      task.property.staff.role === Role.STAFF &&
      (!task.departingStay ||
        (task.departingStay.status === StayStatus.ACTIVE &&
          task.departingStay.checkOutAt.getTime() <= Date.now())),
    ),
    requiresReview:
      requiresReview ||
      Boolean(task.departingStay && task.dueAt < task.departingStay.checkOutAt),
  };
}

/** A follow-up signal only: original completion evidence is never rewritten. */
export async function cleaningTaskRequiresReview(
  tx: Prisma.TransactionClient,
  task: CleaningTaskRecord,
): Promise<boolean> {
  if (task.status !== CleaningTaskStatus.COMPLETED) return false;
  if (
    task.currentSubmission?.status !== 'SUBMITTED' ||
    task.currentSubmission.currentRevision !== 1
  )
    return true;
  const evidence = task.completion;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    return true;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.settingsVersion !== task.property.accessSettings?.version
  )
    return true;
  if (
    task.departingStay &&
    (task.departingStay.status !== StayStatus.ACTIVE ||
      evidence.departingStayRevision !== task.departingStay.currentRevision)
  )
    return true;
  if (
    evidence.targetKind !== 'FIXED' &&
    evidence.targetKind !== 'NEXT_STAY' &&
    evidence.targetKind !== 'VACANCY'
  )
    return true;
  const reference =
    task.source === CleaningTaskSource.AUTO
      ? task.departingStay?.checkOutAt
      : task.dueAt;
  if (!reference) return true;
  const next = await tx.stay.findFirst({
    where: {
      propertyId: task.propertyId,
      status: StayStatus.ACTIVE,
      id: task.departingStayId ? { not: task.departingStayId } : undefined,
      checkInAt: { gte: reference },
    },
    orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      currentRevision: true,
      accessCode: { select: { version: true } },
    },
  });
  if (
    evidence.targetKind === 'VACANCY' ||
    (evidence.targetKind === 'FIXED' && evidence.targetStayId === null)
  )
    return next !== null;
  return (
    !next ||
    evidence.targetStayId !== next.id ||
    evidence.targetStayRevision !== next.currentRevision ||
    (evidence.targetKind !== 'FIXED' &&
      evidence.targetCodeVersion !== next.accessCode?.version)
  );
}

export async function listCleaningTasks(
  tx: Prisma.TransactionClient,
  input: GetCleaningTasksInput,
  propertyIdOverride?: string,
): Promise<CleaningTaskListDto> {
  const where: Prisma.CleaningTaskWhereInput = {
    propertyId: (propertyIdOverride ?? input.propertyId)?.toLowerCase(),
    status: input.status ?? {
      in: [CleaningTaskStatus.PLANNED, CleaningTaskStatus.IN_PROGRESS],
    },
  };
  const [records, total] = await Promise.all([
    tx.cleaningTask.findMany({
      where,
      select: cleaningTaskSelect,
      orderBy: [
        {
          dueAt: input.status === CleaningTaskStatus.COMPLETED ? 'desc' : 'asc',
        },
        { id: 'asc' },
      ],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    tx.cleaningTask.count({ where }),
  ]);
  const items: CleaningTaskDto[] = [];
  for (const record of records)
    items.push(
      toCleaningTaskDto(record, await cleaningTaskRequiresReview(tx, record)),
    );
  return {
    items,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.ceil(total / input.limit),
  };
}
