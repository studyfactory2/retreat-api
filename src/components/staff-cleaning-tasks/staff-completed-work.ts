import { Prisma } from '@prisma/client';
import type { PaginationInput } from '../../libs/dto/common/list.input';
import type {
  StaffCompletedWorkDto,
  StaffCompletedWorkListDto,
} from '../../libs/dto/staff-cleaning-task/staff-cleaning-task';
import {
  cleaningTaskRequiresReview,
  cleaningTaskSelect,
  toCleaningTaskDto,
} from '../cleaning-tasks/cleaning-task-data';

export async function listCompletedStaffWork(
  tx: Prisma.TransactionClient,
  propertyId: string,
  { page, limit }: PaginationInput,
): Promise<StaffCompletedWorkListDto> {
  const where: Prisma.ChecklistSubmissionWhereInput = {
    propertyId,
    type: 'MAINTENANCE',
    authorSource: 'STAFF_QR',
    submittedAt: { not: null },
    OR: [
      { cleaningTaskId: null, status: 'SUBMITTED' },
      // A correction or cancellation can flag an already completed task for review.
      { currentForCleaningTask: { is: { status: 'COMPLETED' } } },
    ],
  };
  const [records, total] = await Promise.all([
    tx.checklistSubmission.findMany({
      where,
      select: {
        id: true,
        submittedAt: true,
        currentForCleaningTask: { select: cleaningTaskSelect },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    tx.checklistSubmission.count({ where }),
  ]);

  const items: StaffCompletedWorkDto[] = [];
  for (const record of records) {
    const task = record.currentForCleaningTask;
    if (!task) {
      items.push({
        id: record.id,
        source: 'STANDALONE',
        completedAt: record.submittedAt,
        requiresReview: false,
        schedule: null,
      });
      continue;
    }

    const summary = toCleaningTaskDto(
      task,
      await cleaningTaskRequiresReview(tx, task),
    );
    items.push({
      id: record.id,
      source: summary.source,
      completedAt: record.submittedAt,
      requiresReview: summary.requiresReview,
      schedule: {
        dueAt: summary.dueAt,
        checkOutAt: summary.departingStay?.checkOutAt ?? null,
        note: summary.note,
      },
    });
  }

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}
