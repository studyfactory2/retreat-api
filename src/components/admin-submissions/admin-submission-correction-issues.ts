import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ActorSource, IssueEventType, Prisma, Role } from '@prisma/client';
import type {
  DraftAnswer,
  DraftAnswers,
} from '../../libs/dto/submission-draft/submission-draft';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import { buildIssueSnapshot } from '../../libs/issues/issue-snapshot';
import {
  AdminIssueReader,
  adminIssueInclude,
} from '../admin-issues/admin-issue-reader';
import { createSubmissionIssues } from '../submissions/submission-issues';
import type { AdminSubmissionCorrectionRecord } from './admin-submission-correction-record';

export async function recordAdminCorrectionIssues(
  tx: Prisma.TransactionClient,
  reader: AdminIssueReader,
  input: {
    current: AdminSubmissionCorrectionRecord;
    revisionId: string;
    answers: DraftAnswers;
    photos: PreparedSubmissionPhoto[];
    correctedAt: Date;
    reason: string;
    actor: { id: string; name: string; role: typeof Role.ADMIN };
  },
): Promise<void> {
  const { submission, record } = input.current;
  const before = new Map(
    record.answers.items.map((answer) => [answer.itemId, answer]),
  );
  const after = new Map(
    input.answers.items.map((answer) => [answer.itemId, answer]),
  );
  const changedIds = [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => !sameAnswer(before.get(id), after.get(id)),
  );
  if (!changedIds.length) return;
  const sections = new Map(
    record.template.definition.sections.flatMap((section) =>
      section.items.map((item) => [item.id, section.id] as const),
    ),
  );
  const issues = await tx.issue.findMany({
    where: {
      sourceSubmissionId: submission.id,
      sourceItemId: { in: changedIds },
    },
    include: adminIssueInclude,
  });
  const byItem = new Map(issues.map((issue) => [issue.sourceItemId, issue]));
  if (byItem.size !== issues.length) throw invalidRecord();
  const actorSnapshot = {
    schemaVersion: 1 as const,
    ...input.actor,
  } satisfies Prisma.InputJsonObject;
  const newAnswers: DraftAnswer[] = [];
  try {
    for (const itemId of changedIds) {
      const previous = before.get(itemId);
      const answer = after.get(itemId);
      const issue = byItem.get(itemId);
      if (!issue) {
        if (previous?.value === 'ABNORMAL') throw invalidRecord();
        if (answer?.value === 'ABNORMAL') newAnswers.push(answer);
        continue;
      }
      if (
        issue.propertyId !== submission.propertyId ||
        issue.sourceSubmissionId !== submission.id ||
        issue.sourceItemId !== itemId
      )
        throw invalidRecord();
      const { issue: current } = await reader.readDetail(tx, issue);
      if (
        !current.source ||
        current.source.checklistType !== submission.type ||
        current.source.templateId !== record.template.id ||
        current.source.templateVersion !== record.template.version ||
        current.source.templateTitle !== record.template.title ||
        current.source.sectionId !== sections.get(itemId)
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
          ? { description: answer.description }
          : {}),
      };

      const snapshot = buildIssueSnapshot(
        { ...current, ...data },
        issue.requestKey,
      );
      const updated = await tx.issue.updateMany({
        where: {
          id: issue.id,
          currentVersion: issue.currentVersion,
          updatedAt: issue.updatedAt,
        },
        data,
      });
      if (updated.count !== 1) throw changed();
      await tx.issueEvent.create({
        data: {
          issueId: issue.id,
          version: data.currentVersion,
          type: IssueEventType.UPDATED,
          actorSource: ActorSource.ADMIN_SESSION,
          actorUserId: input.actor.id,
          actorSnapshot,
          sourceRevisionId: input.revisionId,
          note: correctionNote(answer, input.reason),
          fromStatus: issue.status,
          toStatus: issue.status,
          snapshot,
          createdAt: updatedAt,
        },
      });
    }
    if (newAnswers.length) {
      await createSubmissionIssues(tx, {
        submissionId: submission.id,
        revisionId: input.revisionId,
        property: record.property,
        type: submission.type,
        authorUserId: record.author.id,
        authorSource: record.authorSource,
        author: { schemaVersion: 1, ...record.author },
        template: record.template,
        answers: { ...input.answers, items: newAnswers },
        photos: input.photos,
        submittedAt: input.correctedAt,
        correctionActor: {
          source: ActorSource.ADMIN_SESSION,
          userId: input.actor.id,
          snapshot: actorSnapshot,
        },
      });
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
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

function sameAnswer(
  before: DraftAnswer | undefined,
  after: DraftAnswer | undefined,
): boolean {
  if (!before || !after) return before === after;
  return (
    before.value === after.value &&
    before.description === after.description &&
    before.isUrgent === after.isUrgent &&
    before.repairReported === after.repairReported &&
    before.repairNote === after.repairNote
  );
}

function correctionNote(
  answer: DraftAnswer | undefined,
  reason: string,
): string {
  const change =
    answer?.value === 'ABNORMAL'
      ? '이상(ABNORMAL)'
      : answer?.value === 'NORMAL'
        ? '정상(NORMAL)'
        : '미응답';
  return `관리자가 이 항목의 답변을 ${change}으로 정정했습니다. 기존 이상사항의 긴급 여부와 처리 상태는 유지됩니다.\n정정 사유: ${reason}`;
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
