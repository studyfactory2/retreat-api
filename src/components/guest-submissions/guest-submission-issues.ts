import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ActorSource,
  ChecklistType,
  IssueEventType,
  Prisma,
} from '@prisma/client';
import type { Issue } from '@prisma/client';
import type { IssueRecord } from '../../libs/dto/issue-record/issue-record';
import type {
  DraftAnswer,
  DraftAnswers,
  DraftAuthorSnapshot,
  DraftTemplateSnapshot,
} from '../../libs/dto/submission-draft/submission-draft';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import {
  buildIssueSnapshot,
  parseIssueActor,
  parseIssueSnapshot,
} from '../../libs/issues/issue-snapshot';
import { createSubmissionIssues } from '../submissions/submission-issues';

export type GuestCorrectionIssuesInput = {
  submissionId: string;
  revisionId: string;
  property: { id: string; name: string; region: string | null };
  type: ChecklistType;
  authorUserId: string | null;
  authorSource: ActorSource;
  author: DraftAuthorSnapshot;
  template: DraftTemplateSnapshot;
  previousAnswers: DraftAnswers;
  answers: DraftAnswers;
  photos: PreparedSubmissionPhoto[];
  correctedAt: Date;
  reason: string | null;
};

const latestEventSelect = {
  version: true,
  type: true,
  snapshot: true,
  actorSnapshot: true,
  actorUserId: true,
  createdAt: true,
  fromStatus: true,
  toStatus: true,
} satisfies Prisma.IssueEventSelect;
type LatestEvent = Prisma.IssueEventGetPayload<{
  select: typeof latestEventSelect;
}>;

// The caller owns the serializable correction/revision transaction.
export async function recordGuestCorrectionIssues(
  tx: Prisma.TransactionClient,
  input: GuestCorrectionIssuesInput,
): Promise<void> {
  if (
    input.author.role !== 'GUEST' ||
    input.authorSource !== ActorSource.PRIVATE_LINK ||
    (input.type !== ChecklistType.CHECK_IN &&
      input.type !== ChecklistType.CHECK_OUT) ||
    !Number.isFinite(input.correctedAt.getTime()) ||
    (input.reason !== null && [...input.reason].length > 1000)
  )
    throw invalidRecord();

  const previous = new Map(
    input.previousAnswers.items.map((answer) => [answer.itemId, answer]),
  );
  const current = new Map(
    input.answers.items.map((answer) => [answer.itemId, answer]),
  );
  const changedIds = [
    ...new Set([...previous.keys(), ...current.keys()]),
  ].filter((id) => !sameAnswer(previous.get(id), current.get(id)));
  if (changedIds.length === 0) return;

  const sections = new Map(
    input.template.definition.sections.flatMap((section) =>
      section.items.map((item) => [item.id, section.id] as const),
    ),
  );
  if (changedIds.some((id) => !sections.has(id))) throw invalidRecord();

  const issues = await tx.issue.findMany({
    where: {
      sourceSubmissionId: input.submissionId,
      sourceItemId: { in: changedIds },
    },
    include: {
      events: {
        orderBy: { version: 'desc' },
        take: 1,
        select: latestEventSelect,
      },
    },
  });
  const byItem = new Map(issues.map((issue) => [issue.sourceItemId, issue]));
  const newAbnormalAnswers: DraftAnswer[] = [];

  const actorSnapshot = {
    schemaVersion: 1,
    id: input.authorUserId,
    name: input.author.name,
    role: input.author.role,
    company: input.author.company,
    department: input.author.department,
    phone: input.author.phone,
  } satisfies Prisma.InputJsonObject;
  parseIssueActor(actorSnapshot, input.authorUserId);

  try {
    for (const itemId of changedIds) {
      const before = previous.get(itemId);
      const answer = current.get(itemId);
      const issue = byItem.get(itemId);
      if (!issue) {
        // An earlier abnormal answer must already have its original issue.
        if (before?.value === 'ABNORMAL') throw invalidRecord();
        if (answer?.value === 'ABNORMAL') newAbnormalAnswers.push(answer);
        continue;
      }
      if (
        issue.propertyId !== input.property.id ||
        issue.sourceSubmissionId !== input.submissionId ||
        issue.sourceItemId !== itemId
      )
        throw invalidRecord();
      const record = currentRecord(issue, issue.events[0]);
      if (
        !record.source ||
        record.source.checklistType !== input.type ||
        record.source.templateId !== input.template.id ||
        record.source.templateVersion !== input.template.version ||
        record.source.templateTitle !== input.template.title ||
        record.source.sectionId !== sections.get(itemId)
      )
        throw invalidRecord();
      if (issue.currentVersion >= 2_147_483_647) throw changed();

      const updatedAt = new Date(
        Math.max(input.correctedAt.getTime(), issue.updatedAt.getTime() + 1),
      );
      const data = {
        currentVersion: issue.currentVersion + 1,
        updatedAt,
        ...(answer?.value === 'ABNORMAL'
          ? { description: answer.description, isUrgent: answer.isUrgent }
          : {}),
      };
      const next: IssueRecord = { ...record, ...data };
      const snapshot = buildIssueSnapshot(next, issue.requestKey);
      const result = await tx.issue.updateMany({
        where: {
          id: issue.id,
          currentVersion: issue.currentVersion,
          updatedAt: issue.updatedAt,
        },
        data,
      });
      if (result.count !== 1) throw changed();
      await tx.issueEvent.create({
        data: {
          issueId: issue.id,
          version: data.currentVersion,
          type: IssueEventType.UPDATED,
          actorSource: input.authorSource,
          actorUserId: input.authorUserId,
          actorSnapshot,
          sourceRevisionId: input.revisionId,
          note: correctionNote(answer, input.reason),
          fromStatus: issue.status,
          toStatus: issue.status,
          snapshot,
          createdAt: updatedAt,
        },
      });
      // Existing issue evidence stays on its original events. Retained photos
      // belong to the new submission revision; UPDATED has no photo joins.
    }

    if (newAbnormalAnswers.length > 0) {
      await createSubmissionIssues(tx, {
        submissionId: input.submissionId,
        revisionId: input.revisionId,
        property: input.property,
        type: input.type,
        authorUserId: input.authorUserId,
        authorSource: input.authorSource,
        author: input.author,
        template: input.template,
        answers: { ...input.answers, items: newAbnormalAnswers },
        photos: input.photos,
        submittedAt: input.correctedAt,
      });
    }
  } catch (error) {
    // A concurrent first report or event must roll back the whole correction.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // Let the caller retry a concurrent creation of the fallback category.
      if (
        error.meta?.modelName === 'IssueCategory' &&
        Array.isArray(error.meta.target) &&
        error.meta.target.includes('name')
      )
        throw error;
      throw changed();
    }
    throw error;
  }
}

function currentRecord(
  issue: Issue,
  event: LatestEvent | undefined,
): IssueRecord {
  if (!event || event.version !== issue.currentVersion) throw invalidRecord();
  const record = parseIssueSnapshot(event.snapshot, {
    issueId: issue.id,
    propertyId: issue.propertyId,
    version: event.version,
  });
  parseIssueActor(event.actorSnapshot, event.actorUserId);
  if (
    (event.snapshot as Prisma.JsonObject).requestKey !== issue.requestKey ||
    event.toStatus !== record.status ||
    event.createdAt.getTime() !== record.updatedAt.getTime() ||
    (event.version === 1 &&
      (event.type !== IssueEventType.REPORTED || event.fromStatus !== null))
  )
    throw invalidRecord();
  const snapshot = buildIssueSnapshot(record, issue.requestKey);
  const fields = [
    'categoryId',
    'title',
    'description',
    'areaLabel',
    'isUrgent',
    'status',
    'sourceSubmissionId',
    'sourceItemId',
    'sourceRevisionId',
    'recurrenceOfIssueId',
    'currentVersion',
    'reportedAt',
    'resolvedAt',
    'resolvedByUserId',
    'cancelledAt',
    'cancellationReason',
    'updatedAt',
  ] as const;
  for (const key of fields) {
    const value = issue[key];
    if (snapshot[key] !== (value instanceof Date ? value.toISOString() : value))
      throw invalidRecord();
  }
  return record;
}

function sameAnswer(
  previous: DraftAnswer | undefined,
  current: DraftAnswer | undefined,
): boolean {
  if (!previous || !current) return previous === current;
  return (
    previous.value === current.value &&
    previous.description === current.description &&
    previous.isUrgent === current.isUrgent &&
    previous.repairReported === current.repairReported &&
    previous.repairNote === current.repairNote
  );
}

function correctionNote(
  answer: DraftAnswer | undefined,
  reason: string | null,
): string {
  const change =
    answer?.value === 'ABNORMAL'
      ? '이용객이 이 항목의 이상(ABNORMAL) 답변을 정정했습니다.'
      : answer?.value === 'NORMAL'
        ? '이용객이 이 항목의 답변을 정상(NORMAL)으로 정정했습니다.'
        : '이용객이 이 항목의 답변을 삭제하여 미응답으로 정정했습니다.';
  return `${change} 기존 이상사항의 처리 상태는 유지됩니다.${
    reason === null ? '' : `\n정정 사유: ${reason}`
  }`;
}

function invalidRecord(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'INVALID_ISSUE_RECORD',
    message: '저장된 이상사항 기록을 불러올 수 없습니다.',
  });
}

function changed(): ConflictException {
  return new ConflictException({
    code: 'ISSUE_CHANGED',
    message: '이상사항이 변경되었습니다. 다시 불러온 뒤 시도해 주세요.',
  });
}
