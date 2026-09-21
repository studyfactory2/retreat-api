import { InternalServerErrorException } from '@nestjs/common';
import { ChecklistType, IssueStatus, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { IssueActor, IssueRecord } from '../dto/issue-record/issue-record';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DATABASE_INT = 2_147_483_647;

export function parseIssueSnapshot(
  value: Prisma.JsonValue,
  expected: { issueId: string; propertyId: string; version: number },
): IssueRecord {
  try {
    const root = object(value);
    const property = object(root.property);
    const category = object(root.category);
    const id = uuid(root.id);
    const propertyId = uuid(root.propertyId);
    const categoryId = uuid(root.categoryId);
    const currentVersion = version(root.currentVersion);
    if (
      root.schemaVersion !== 1 ||
      id !== expected.issueId ||
      propertyId !== expected.propertyId ||
      uuid(property.id) !== propertyId ||
      uuid(category.id) !== categoryId ||
      currentVersion !== expected.version ||
      typeof root.isUrgent !== 'boolean'
    ) {
      return invalidSnapshot();
    }

    const status = enumValue(root.status, Object.values(IssueStatus));
    const resolvedAt = nullableTimestamp(root.resolvedAt);
    const resolvedByUserId = nullableUuid(root.resolvedByUserId);
    const cancelledAt = nullableTimestamp(root.cancelledAt);
    const cancellationReason = nullableText(root.cancellationReason, 2000);
    const sourceSubmissionId = nullableUuid(root.sourceSubmissionId);
    const sourceItemId = nullableUuid(root.sourceItemId);
    const sourceRevisionId = nullableUuid(root.sourceRevisionId);
    const recurrenceOfIssueId = nullableUuid(root.recurrenceOfIssueId);
    const sourceCount = [
      sourceSubmissionId,
      sourceItemId,
      sourceRevisionId,
    ].filter((id) => id !== null).length;
    if (
      (status === IssueStatus.RESOLVED &&
        (resolvedAt === null || resolvedByUserId === null)) ||
      (status !== IssueStatus.RESOLVED &&
        (resolvedAt !== null || resolvedByUserId !== null)) ||
      (cancelledAt === null && cancellationReason !== null) ||
      (sourceCount !== 0 && sourceCount !== 3) ||
      recurrenceOfIssueId === id
    ) {
      return invalidSnapshot();
    }

    return {
      id,
      property: {
        id: propertyId,
        name: text(property.name, 100),
        region: nullableText(property.region, 100),
      },
      category: { id: categoryId, name: text(category.name, 100) },
      title: text(root.title, 300),
      description: nullableText(root.description, 2000),
      areaLabel: nullableText(root.areaLabel, 150),
      isUrgent: root.isUrgent,
      status,
      sourceSubmissionId,
      sourceItemId,
      sourceRevisionId,
      recurrenceOfIssueId,
      currentVersion,
      reportedAt: timestamp(root.reportedAt),
      resolvedAt,
      resolvedByUserId,
      cancelledAt,
      cancellationReason,
      updatedAt: timestamp(root.updatedAt),
      source: parseSource(root.source, sourceCount === 3),
    };
  } catch {
    return invalidSnapshot();
  }
}

export function parseIssueActor(
  value: Prisma.JsonValue,
  actorUserId: string | null,
): IssueActor {
  try {
    const actor = object(value);
    const id = nullableUuid(actor.id);
    const role = enumValue(actor.role, Object.values(Role));
    if (
      actor.schemaVersion !== 1 ||
      id !== actorUserId ||
      (id === null && role !== Role.GUEST)
    ) {
      return invalidSnapshot();
    }
    return { id, role, name: text(actor.name, 100) };
  } catch {
    return invalidSnapshot();
  }
}

export function buildIssueSnapshot(
  record: IssueRecord,
  requestKey: string,
): Prisma.InputJsonObject {
  try {
    if (typeof requestKey !== 'string' || !requestKey.trim()) {
      return invalidSnapshot();
    }
    const snapshot = {
      schemaVersion: 1,
      id: record.id,
      requestKey,
      propertyId: record.property.id,
      categoryId: record.category.id,
      title: record.title,
      description: record.description,
      areaLabel: record.areaLabel,
      isUrgent: record.isUrgent,
      status: record.status,
      sourceSubmissionId: record.sourceSubmissionId,
      sourceItemId: record.sourceItemId,
      sourceRevisionId: record.sourceRevisionId,
      recurrenceOfIssueId: record.recurrenceOfIssueId,
      currentVersion: record.currentVersion,
      reportedAt: record.reportedAt.toISOString(),
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
      resolvedByUserId: record.resolvedByUserId,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
      cancellationReason: record.cancellationReason,
      updatedAt: record.updatedAt.toISOString(),
      property: {
        id: record.property.id,
        name: record.property.name,
        region: record.property.region,
      },
      category: { id: record.category.id, name: record.category.name },
      source:
        record.source === null
          ? null
          : {
              checklistType: record.source.checklistType,
              templateId: record.source.templateId,
              templateTitle: record.source.templateTitle,
              templateVersion: record.source.templateVersion,
              sectionId: record.source.sectionId,
            },
    };
    parseIssueSnapshot(snapshot, {
      issueId: record.id,
      propertyId: record.property.id,
      version: record.currentVersion,
    });
    return snapshot;
  } catch {
    return invalidSnapshot();
  }
}

function parseSource(
  value: Prisma.JsonValue | undefined,
  hasSubmission: boolean,
): IssueRecord['source'] {
  if (!hasSubmission) {
    if (value !== null) return invalidSnapshot();
    return null;
  }
  const source = object(value);
  return {
    checklistType: enumValue(
      source.checklistType,
      Object.values(ChecklistType),
    ),
    templateId: uuid(source.templateId),
    templateTitle: text(source.templateTitle, 150),
    templateVersion: version(source.templateVersion),
    sectionId: uuid(source.sectionId),
  };
}

function object(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidSnapshot();
  }
  return value;
}

function uuid(value: Prisma.JsonValue | undefined): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    return invalidSnapshot();
  }
  return value;
}

function nullableUuid(value: Prisma.JsonValue | undefined): string | null {
  return value === null ? null : uuid(value);
}

function text(value: Prisma.JsonValue | undefined, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > maximum
  ) {
    return invalidSnapshot();
  }
  return value;
}

function nullableText(
  value: Prisma.JsonValue | undefined,
  maximum: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || [...value].length > maximum) {
    return invalidSnapshot();
  }
  return value;
}

function version(value: Prisma.JsonValue | undefined): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_DATABASE_INT
  ) {
    return invalidSnapshot();
  }
  return value;
}

function enumValue<T extends string>(
  value: Prisma.JsonValue | undefined,
  allowed: T[],
): T {
  return allowed.find((candidate) => candidate === value) ?? invalidSnapshot();
}

function timestamp(value: Prisma.JsonValue | undefined): Date {
  if (typeof value !== 'string') return invalidSnapshot();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return invalidSnapshot();
  }
  return date;
}

function nullableTimestamp(value: Prisma.JsonValue | undefined): Date | null {
  return value === null ? null : timestamp(value);
}

function invalidSnapshot(): never {
  throw new InternalServerErrorException({
    code: 'INVALID_ISSUE_SNAPSHOT',
    message: '저장된 이상사항 기록을 불러올 수 없습니다.',
  });
}
