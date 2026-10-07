import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminIssueRow } from './admin-issue-reader';

// Bound defensive traversal of legacy/corrupt chains inside the transaction.
// This is a safety limit, not a claim that a longer chain contains a cycle.
const MAX_RECURRENCE_DEPTH = 100;

export function recurrenceCandidatesWhere(
  issue: AdminIssueRow,
): Prisma.IssueWhereInput {
  return {
    propertyId: issue.propertyId,
    id: {
      notIn: [
        issue.id,
        ...(issue.recurrenceOfIssueId ? [issue.recurrenceOfIssueId] : []),
      ],
    },
    reportedAt: { lt: issue.reportedAt },
    cancelledAt: null,
    currentVersion: { gte: 1 },
  };
}

export async function assertRecurrenceTarget(
  tx: Prisma.TransactionClient,
  issue: AdminIssueRow,
  targetId: string,
): Promise<void> {
  const visited = new Set<string>([issue.id]);
  let nextId: string | null = targetId;
  let newerReportedAt = issue.reportedAt;
  for (let depth = 0; nextId !== null; depth += 1) {
    if (visited.has(nextId)) {
      throw new ConflictException({
        code: 'ISSUE_RECURRENCE_CYCLE',
        message: '순환하는 이상사항 연결은 저장할 수 없습니다.',
      });
    }
    if (depth >= MAX_RECURRENCE_DEPTH) {
      throw new ConflictException({
        code: 'ISSUE_RECURRENCE_REVIEW_REQUIRED',
        message:
          '연결 이력이 너무 길어 확인이 필요합니다. 다른 기록을 선택해 주세요.',
      });
    }
    visited.add(nextId);
    const target = await tx.issue.findUnique({
      where: { id: nextId },
      select: {
        id: true,
        propertyId: true,
        reportedAt: true,
        cancelledAt: true,
        currentVersion: true,
        recurrenceOfIssueId: true,
      },
    });
    if (
      !target ||
      target.propertyId !== issue.propertyId ||
      target.currentVersion < 1 ||
      target.reportedAt >= newerReportedAt ||
      (depth === 0 && target.cancelledAt !== null)
    ) {
      throw new ConflictException({
        code: 'INVALID_ISSUE_RECURRENCE',
        message:
          '같은 휴양소에서 더 먼저 신고된 취소되지 않은 이상사항을 선택해 주세요.',
      });
    }
    newerReportedAt = target.reportedAt;
    nextId = target.recurrenceOfIssueId;
  }
}
