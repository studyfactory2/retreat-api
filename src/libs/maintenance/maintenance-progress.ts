import {
  ActorSource,
  ChecklistType,
  Prisma,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { parseChecklistDefinition } from '../../components/checklist-templates/checklist-definition';
import { parseDraftAnswers } from '../../components/submission-drafts/draft-answers';
import type {
  AdminMaintenanceItemDto,
  MaintenanceReviewReason,
  MaintenanceSummaryDto,
} from '../dto/admin-maintenance/admin-maintenance';
import { seoulDay } from '../dates/seoul-date';
import { parseSubmissionSnapshot } from '../submissions/submission-snapshot';

export const maintenanceProgressSelect = {
  id: true,
  propertyId: true,
  type: true,
  status: true,
  templateId: true,
  templateVersion: true,
  templateSnapshot: true,
  draftAnswers: true,
  stayId: true,
  stayLinkVersion: true,
  authorUserId: true,
  authorSource: true,
  authorSnapshot: true,
  visitDate: true,
  currentRevision: true,
  startedAt: true,
  submittedAt: true,
  cancelledAt: true,
  privateTokenHash: true,
  privateTokenExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  property: {
    select: {
      id: true,
      name: true,
      region: true,
      isActive: true,
      staffUserId: true,
    },
  },
  author: { select: { id: true, role: true, isActive: true } },
  revisions: {
    orderBy: { version: 'desc' },
    take: 1,
    select: { version: true, status: true, snapshot: true },
  },
} satisfies Prisma.ChecklistSubmissionSelect;

export type MaintenanceProgressRecord = Prisma.ChecklistSubmissionGetPayload<{
  select: typeof maintenanceProgressSelect;
}>;

export function classifyMaintenance(
  row: MaintenanceProgressRecord,
  asOf: Date,
): AdminMaintenanceItemDto {
  const item: AdminMaintenanceItemDto = {
    id: row.id,
    property: {
      id: row.property.id,
      name: row.property.name,
      region: row.property.region,
      isActive: row.property.isActive,
    },
    staff: { id: row.authorUserId, name: null },
    status: 'NEEDS_REVIEW',
    reviewReasons: ['INVALID_RECORD'],
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    submittedAt: row.submittedAt,
    expiresAt:
      row.status === SubmissionStatus.DRAFT ? row.privateTokenExpiresAt : null,
    currentRevision: row.currentRevision,
  };
  if (
    row.type !== ChecklistType.MAINTENANCE ||
    row.authorSource !== ActorSource.STAFF_QR ||
    !row.authorUserId ||
    row.stayId !== null ||
    row.stayLinkVersion !== null ||
    row.cancelledAt !== null ||
    !row.startedAt ||
    row.startedAt.getTime() > row.updatedAt.getTime() ||
    row.createdAt.getTime() > row.updatedAt.getTime() ||
    row.visitDate.toISOString().slice(0, 10) !== seoulDay(row.startedAt)
  )
    return item;

  if (row.status === SubmissionStatus.SUBMITTED) {
    const revision = row.revisions[0];
    if (
      !row.submittedAt ||
      row.submittedAt.getTime() < row.startedAt.getTime() ||
      row.submittedAt.getTime() > row.updatedAt.getTime() ||
      !Number.isSafeInteger(row.currentRevision) ||
      row.currentRevision < 1 ||
      !revision ||
      revision.version !== row.currentRevision ||
      revision.status !== SubmissionStatus.SUBMITTED
    )
      return item;
    try {
      const { record } = parseSubmissionSnapshot(revision.snapshot, {
        submissionId: row.id,
        propertyId: row.propertyId,
        type: ChecklistType.MAINTENANCE,
        version: row.currentRevision,
        status: SubmissionStatus.SUBMITTED,
      });
      if (
        record.stayId !== null ||
        record.authorSource !== row.authorSource ||
        record.author.id !== row.authorUserId ||
        record.author.role !== Role.STAFF ||
        record.visitDate !== row.visitDate.toISOString().slice(0, 10) ||
        record.template.id !== row.templateId ||
        record.template.version !== row.templateVersion ||
        record.startedAt?.getTime() !== row.startedAt.getTime() ||
        record.submittedAt.getTime() !== row.submittedAt.getTime() ||
        record.createdAt.getTime() !== row.createdAt.getTime() ||
        record.updatedAt.getTime() !== row.updatedAt.getTime()
      )
        return item;
      return {
        ...item,
        property: {
          ...record.property,
          isActive: row.property.isActive,
        },
        staff: { id: row.authorUserId, name: record.author.name },
        status: 'COMPLETED',
        reviewReasons: [],
      };
    } catch {
      return item;
    }
  }

  if (
    row.status !== SubmissionStatus.DRAFT ||
    row.currentRevision !== 0 ||
    row.submittedAt !== null ||
    row.revisions.length !== 0
  )
    return item;
  const name = draftStaffName(row.authorSnapshot);
  if (name === null || !validDraftContent(row)) return item;
  item.staff.name = name;
  if (
    row.privateTokenExpiresAt &&
    row.privateTokenExpiresAt.getTime() <= asOf.getTime()
  )
    return { ...item, status: 'EXPIRED', reviewReasons: ['TOKEN_EXPIRED'] };

  const reasons: MaintenanceReviewReason[] = [];
  if (!row.privateTokenHash || !row.privateTokenExpiresAt)
    reasons.push('TOKEN_UNAVAILABLE');
  if (!row.property.isActive) reasons.push('PROPERTY_INACTIVE');
  if (row.property.staffUserId !== row.authorUserId)
    reasons.push('STAFF_ASSIGNMENT_CHANGED');
  if (
    row.author?.id !== row.authorUserId ||
    row.author.role !== Role.STAFF ||
    !row.author.isActive
  )
    reasons.push('STAFF_INACTIVE');
  return {
    ...item,
    status: reasons.length ? 'ACCESS_BLOCKED' : 'UNFINISHED',
    reviewReasons: reasons,
  };
}

export async function readMaintenanceSummary(
  tx: Prisma.TransactionClient,
  propertyId: string | undefined,
  start: Date,
  end: Date,
  asOf: Date,
): Promise<MaintenanceSummaryDto> {
  const scope: Prisma.ChecklistSubmissionWhereInput = {
    propertyId,
    type: ChecklistType.MAINTENANCE,
    cancelledAt: null,
    status: { in: [SubmissionStatus.DRAFT, SubmissionStatus.SUBMITTED] },
  };
  const result: MaintenanceSummaryDto = {
    started: await tx.checklistSubmission.count({
      where: { ...scope, startedAt: { gte: start, lt: end } },
    }),
    completed: 0,
    completionNeedsReview: 0,
    unfinished: {
      total: 0,
      resumable: 0,
      expired: 0,
      accessBlocked: 0,
      needsReview: 0,
    },
  };
  let afterId: string | undefined;
  for (;;) {
    // Keep only one bounded batch of snapshots in memory, in the caller's transaction.
    const rows = await tx.checklistSubmission.findMany({
      where: {
        ...scope,
        ...(afterId ? { id: { gt: afterId } } : {}),
        OR: [
          { status: SubmissionStatus.DRAFT },
          {
            status: SubmissionStatus.SUBMITTED,
            submittedAt: { gte: start, lt: end },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: maintenanceProgressSelect,
    });
    for (const row of rows) {
      const item = classifyMaintenance(row, asOf);
      if (row.status === SubmissionStatus.SUBMITTED) {
        if (item.status === 'COMPLETED') result.completed += 1;
        else result.completionNeedsReview += 1;
      } else {
        result.unfinished.total += 1;
        if (item.status === 'UNFINISHED') result.unfinished.resumable += 1;
        else if (item.status === 'EXPIRED') result.unfinished.expired += 1;
        else if (item.status === 'ACCESS_BLOCKED')
          result.unfinished.accessBlocked += 1;
        else result.unfinished.needsReview += 1;
      }
    }
    if (rows.length < 100) return result;
    afterId = rows[rows.length - 1].id;
  }
}

function validDraftContent(row: MaintenanceProgressRecord): boolean {
  const value = row.templateSnapshot;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 6 ||
    value.schemaVersion !== 1 ||
    value.id !== row.templateId ||
    value.type !== row.type ||
    value.version !== row.templateVersion ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    [...value.title].length > 150 ||
    value.definition === undefined ||
    row.draftAnswers === null
  )
    return false;
  try {
    const definition = parseChecklistDefinition(value.definition);
    // Incomplete answers are valid here: this is a resumable draft, not a submission.
    parseDraftAnswers(row.draftAnswers, definition, true);
    return true;
  } catch {
    return false;
  }
}

function draftStaffName(value: Prisma.JsonValue): string | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 6 ||
    value.schemaVersion !== 1 ||
    value.role !== Role.STAFF ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    [...value.name].length > 100 ||
    !nullableText(value.company, 150) ||
    !nullableText(value.department, 150) ||
    !nullableText(value.phone, 50)
  )
    return null;
  return value.name;
}

function nullableText(
  value: Prisma.JsonValue | undefined,
  maximum: number,
): boolean {
  return (
    value === null ||
    (typeof value === 'string' && [...value].length <= maximum)
  );
}
