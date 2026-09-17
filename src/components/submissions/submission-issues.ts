import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ChecklistType,
  IssueEventType,
  IssueStatus,
  PhotoPurpose,
} from '@prisma/client';
import type { ActorSource, Issue, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FALLBACK_ISSUE_CATEGORY_NAME } from '../../libs/constants/issue-category';
import type {
  DraftAnswers,
  DraftAuthorSnapshot,
  DraftTemplateSnapshot,
} from '../../libs/dto/submission-draft/submission-draft';

type SubmissionIssuePhoto = {
  attachmentId: string;
  purpose: PhotoPurpose;
  sectionId: string | null;
  itemId: string | null;
  areaLabel: string | null;
  sortOrder: number;
};

type SubmissionIssuesInput = {
  submissionId: string;
  revisionId: string;
  property: { id: string; name: string; region: string | null };
  type: ChecklistType;
  authorUserId: string | null;
  authorSource: ActorSource;
  author: DraftAuthorSnapshot;
  template: DraftTemplateSnapshot;
  answers: DraftAnswers;
  photos: SubmissionIssuePhoto[];
  submittedAt: Date;
};

export async function createSubmissionIssues(
  tx: Prisma.TransactionClient,
  input: SubmissionIssuesInput,
): Promise<number> {
  const abnormalAnswers = input.answers.items.filter(
    (answer) => answer.value === 'ABNORMAL',
  );
  if (abnormalAnswers.length === 0) return 0;

  const category = await tx.issueCategory.upsert({
    where: { name: FALLBACK_ISSUE_CATEGORY_NAME },
    create: { name: FALLBACK_ISSUE_CATEGORY_NAME },
    update: {},
    select: { id: true, name: true, isActive: true },
  });
  if (!category.isActive) {
    throw new ConflictException({
      code: 'ISSUE_CATEGORY_UNAVAILABLE',
      message: '이상사항 분류를 사용할 수 없습니다. 관리자에게 문의해 주세요.',
    });
  }

  const itemDetails = new Map<
    string,
    { label: string; sectionId: string; sectionTitle: string }
  >();
  for (const section of input.template.definition.sections) {
    for (const item of section.items) {
      itemDetails.set(item.id, {
        label: item.label,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
  }

  const actorSnapshot: Prisma.InputJsonObject = {
    schemaVersion: 1,
    id: input.authorUserId,
    name: input.author.name,
    role: input.author.role,
    company: input.author.company,
    department: input.author.department,
    phone: input.author.phone,
  };
  const issues: Issue[] = [];
  const events: Prisma.IssueEventCreateManyInput[] = [];
  const eventPhotos: Prisma.IssueEventAttachmentCreateManyInput[] = [];

  for (const answer of abnormalAnswers) {
    const item = itemDetails.get(answer.itemId);
    if (
      !item ||
      (answer.repairReported &&
        (input.type !== ChecklistType.MAINTENANCE ||
          input.author.role !== 'STAFF'))
    ) {
      throw new InternalServerErrorException();
    }

    const issue: Issue = {
      id: randomUUID(),
      requestKey: `checklist:${input.submissionId}:${answer.itemId}`,
      propertyId: input.property.id,
      categoryId: category.id,
      title: item.label,
      description: answer.description,
      areaLabel: item.sectionTitle,
      isUrgent: answer.isUrgent,
      status: IssueStatus.NEW,
      sourceSubmissionId: input.submissionId,
      sourceItemId: answer.itemId,
      sourceRevisionId: input.revisionId,
      recurrenceOfIssueId: null,
      currentVersion: answer.repairReported ? 2 : 1,
      reportedAt: input.submittedAt,
      resolvedAt: null,
      resolvedByUserId: null,
      cancelledAt: null,
      cancellationReason: null,
      updatedAt: input.submittedAt,
    };
    issues.push(issue);

    const reportEventId = randomUUID();
    events.push({
      id: reportEventId,
      issueId: issue.id,
      version: 1,
      type: IssueEventType.REPORTED,
      actorSource: input.authorSource,
      actorUserId: input.authorUserId,
      actorSnapshot,
      sourceRevisionId: input.revisionId,
      note: answer.description,
      fromStatus: null,
      toStatus: IssueStatus.NEW,
      snapshot: buildIssueSnapshot(issue, 1, input, category, item.sectionId),
      createdAt: input.submittedAt,
    });

    const repairEventId = answer.repairReported ? randomUUID() : null;
    if (repairEventId) {
      events.push({
        id: repairEventId,
        issueId: issue.id,
        version: 2,
        type: IssueEventType.REPAIR_REPORTED,
        actorSource: input.authorSource,
        actorUserId: input.authorUserId,
        actorSnapshot,
        sourceRevisionId: input.revisionId,
        note: answer.repairNote,
        fromStatus: IssueStatus.NEW,
        toStatus: IssueStatus.NEW,
        snapshot: buildIssueSnapshot(issue, 2, input, category, item.sectionId),
        createdAt: input.submittedAt,
      });
    }

    for (const photo of input.photos) {
      if (photo.itemId !== answer.itemId) continue;
      const eventId =
        photo.purpose === PhotoPurpose.DEFECT
          ? reportEventId
          : photo.purpose === PhotoPurpose.REPAIR
            ? repairEventId
            : null;
      if (eventId) {
        eventPhotos.push({
          eventId,
          attachmentId: photo.attachmentId,
          sortOrder: photo.sortOrder,
        });
      }
    }
  }

  await tx.issue.createMany({ data: issues });
  await tx.issueEvent.createMany({ data: events });
  if (eventPhotos.length > 0) {
    await tx.issueEventAttachment.createMany({ data: eventPhotos });
  }
  return issues.length;
}

function buildIssueSnapshot(
  issue: Issue,
  version: number,
  input: SubmissionIssuesInput,
  category: { id: string; name: string },
  sectionId: string,
): Prisma.InputJsonObject {
  return {
    schemaVersion: 1,
    id: issue.id,
    requestKey: issue.requestKey,
    propertyId: issue.propertyId,
    categoryId: issue.categoryId,
    title: issue.title,
    description: issue.description,
    areaLabel: issue.areaLabel,
    isUrgent: issue.isUrgent,
    status: issue.status,
    sourceSubmissionId: issue.sourceSubmissionId,
    sourceItemId: issue.sourceItemId,
    sourceRevisionId: issue.sourceRevisionId,
    recurrenceOfIssueId: issue.recurrenceOfIssueId,
    currentVersion: version,
    reportedAt: issue.reportedAt.toISOString(),
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: issue.resolvedByUserId,
    cancelledAt: issue.cancelledAt?.toISOString() ?? null,
    cancellationReason: issue.cancellationReason,
    updatedAt: issue.updatedAt.toISOString(),
    property: { ...input.property },
    category: { id: category.id, name: category.name },
    source: {
      checklistType: input.type,
      templateId: input.template.id,
      templateTitle: input.template.title,
      templateVersion: input.template.version,
      sectionId,
    },
  };
}
