import {
  ActorSource,
  ChecklistType,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import type {
  CalendarChecklistDto,
  CalendarReviewReason,
} from '../dto/admin-calendar/admin-calendar';
import { parseSubmissionSnapshot } from '../submissions/submission-snapshot';
import type { SubmissionRecord } from '../dto/submission-record/submission-record';
import { seoulDay } from '../dates/seoul-date';

export const calendarSubmissionSelect = {
  id: true,
  stayId: true,
  propertyId: true,
  type: true,
  status: true,
  authorSource: true,
  authorUserId: true,
  stayLinkVersion: true,
  currentRevision: true,
  templateId: true,
  templateVersion: true,
  visitDate: true,
  startedAt: true,
  submittedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  revisions: {
    orderBy: { version: 'desc' },
    take: 1,
    select: { version: true, status: true, snapshot: true },
  },
} satisfies Prisma.ChecklistSubmissionSelect;

export type CalendarSubmission = Prisma.ChecklistSubmissionGetPayload<{
  select: typeof calendarSubmissionSelect;
}>;

export interface CalendarStayContext {
  id: string;
  propertyId: string;
  guestName: string;
  currentRevision: number;
  checkInAt: Date;
  checkOutAt: Date;
}

export async function readStayChecklists(
  tx: Prisma.TransactionClient,
  stays: CalendarStayContext[],
  today: string,
): Promise<
  Map<string, { checkIn: CalendarChecklistDto; checkOut: CalendarChecklistDto }>
> {
  if (!stays.length) return new Map();
  const groups = await tx.checklistSubmission.groupBy({
    by: ['stayId', 'type'],
    where: {
      stayId: { in: stays.map((stay) => stay.id) },
      status: SubmissionStatus.SUBMITTED,
      type: { in: [ChecklistType.CHECK_IN, ChecklistType.CHECK_OUT] },
    },
    _count: { _all: true },
  });
  const singletons = groups.filter((group) => group._count._all === 1);
  const submissions = singletons.length
    ? await tx.checklistSubmission.findMany({
        where: {
          status: SubmissionStatus.SUBMITTED,
          OR: singletons.map((group) => ({
            stayId: group.stayId,
            type: group.type,
          })),
        },
        select: calendarSubmissionSelect,
      })
    : [];
  const counts = new Map(
    groups.map((group) => [`${group.stayId}:${group.type}`, group._count._all]),
  );
  const records = new Map(
    submissions.map((record) => [`${record.stayId}:${record.type}`, record]),
  );
  return new Map(
    stays.map((stay) => [
      stay.id,
      {
        checkIn: calendarChecklist(
          stay,
          'CHECK_IN',
          counts.get(`${stay.id}:CHECK_IN`) ?? 0,
          records.get(`${stay.id}:CHECK_IN`),
          today,
        ),
        checkOut: calendarChecklist(
          stay,
          'CHECK_OUT',
          counts.get(`${stay.id}:CHECK_OUT`) ?? 0,
          records.get(`${stay.id}:CHECK_OUT`),
          today,
        ),
      },
    ]),
  );
}

export function calendarChecklist(
  stay: CalendarStayContext,
  type: 'CHECK_IN' | 'CHECK_OUT',
  submissionCount: number,
  submission: CalendarSubmission | undefined,
  today: string,
): CalendarChecklistDto {
  const expectedDate = seoulDay(
    type === ChecklistType.CHECK_IN ? stay.checkInAt : stay.checkOutAt,
  );
  const base = {
    type,
    expectedDate,
    submissionCount,
    submissionId: submissionCount === 1 ? (submission?.id ?? null) : null,
  };
  if (submissionCount === 0) {
    return {
      ...base,
      status: expectedDate > today ? 'SCHEDULED' : 'NOT_SUBMITTED',
      reviewReasons: [],
    };
  }
  if (submissionCount > 1) {
    return {
      ...base,
      status: 'NEEDS_REVIEW',
      reviewReasons: ['DUPLICATE_SUBMISSIONS'],
    };
  }
  const reviewReasons = reviewSubmission(stay, type, expectedDate, submission);
  return {
    ...base,
    status: reviewReasons.length ? 'NEEDS_REVIEW' : 'SUBMITTED',
    reviewReasons,
  };
}

function reviewSubmission(
  stay: CalendarStayContext,
  type: 'CHECK_IN' | 'CHECK_OUT',
  expectedDate: string,
  submission: CalendarSubmission | undefined,
): CalendarReviewReason[] {
  const invalid: CalendarReviewReason[] = ['INVALID_SUBMISSION_RECORD'];
  if (!submission) return invalid;
  const revision = submission.revisions[0];
  if (
    submission.stayId !== stay.id ||
    submission.propertyId !== stay.propertyId ||
    submission.type !== type ||
    submission.status !== SubmissionStatus.SUBMITTED ||
    !submission.submittedAt ||
    submission.cancelledAt !== null ||
    !revision ||
    revision.version !== submission.currentRevision ||
    revision.status !== SubmissionStatus.SUBMITTED ||
    !(
      (submission.authorSource === ActorSource.GUEST_QR &&
        submission.stayLinkVersion === null) ||
      (submission.authorSource === ActorSource.PRIVATE_LINK &&
        Number.isSafeInteger(submission.stayLinkVersion) &&
        (submission.stayLinkVersion ?? 0) > 0)
    )
  )
    return invalid;

  // Parse stored evidence only; calendar reads must not depend on a guest token's lifetime.
  let record: SubmissionRecord;
  try {
    record = parseSubmissionSnapshot(revision.snapshot, {
      submissionId: submission.id,
      propertyId: stay.propertyId,
      type,
      version: submission.currentRevision,
      status: SubmissionStatus.SUBMITTED,
    }).record;
  } catch {
    return invalid;
  }
  if (
    record.stayId !== stay.id ||
    record.authorSource !== submission.authorSource ||
    record.author.id !== submission.authorUserId ||
    record.author.role !== 'GUEST' ||
    record.visitDate !== submission.visitDate.toISOString().slice(0, 10) ||
    record.template.id !== submission.templateId ||
    record.template.version !== submission.templateVersion ||
    record.startedAt?.getTime() !== submission.startedAt?.getTime() ||
    record.submittedAt.getTime() !== submission.submittedAt.getTime() ||
    record.createdAt.getTime() !== submission.createdAt.getTime() ||
    record.updatedAt.getTime() !== submission.updatedAt.getTime()
  )
    return invalid;

  const reasons: CalendarReviewReason[] = [];
  if (record.visitDate !== expectedDate) reasons.push('VISIT_DATE_MISMATCH');
  if (!object(revision.snapshot)) return invalid;
  const match = revision.snapshot.stayMatch;
  if (match === undefined || match === null) {
    return [...reasons, 'MISSING_MATCH_CONTEXT'];
  }
  if (
    !object(match) ||
    match.schemaVersion !== 1 ||
    match.stayId !== stay.id ||
    typeof match.stayRevision !== 'number' ||
    !Number.isSafeInteger(match.stayRevision) ||
    match.stayRevision < 1 ||
    typeof match.guestName !== 'string' ||
    !match.guestName.trim() ||
    [...match.guestName].length > 100 ||
    !isoTimestamp(match.checkInAt) ||
    !isoTimestamp(match.checkOutAt) ||
    new Date(match.checkInAt).getTime() >=
      new Date(match.checkOutAt).getTime() ||
    (submission.authorSource === ActorSource.PRIVATE_LINK &&
      record.author.name !== match.guestName)
  )
    return invalid;
  if (
    match.stayRevision !== stay.currentRevision ||
    match.guestName !== stay.guestName ||
    match.checkInAt !== stay.checkInAt.toISOString() ||
    match.checkOutAt !== stay.checkOutAt.toISOString()
  )
    reasons.push('STAY_CHANGED');
  return reasons;
}

function object(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isoTimestamp(value: Prisma.JsonValue | undefined): value is string {
  if (typeof value !== 'string') return false;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) && at.toISOString() === value;
}
