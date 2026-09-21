import { InternalServerErrorException } from '@nestjs/common';
import {
  ActorSource,
  ChecklistType,
  PhotoPurpose,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type {
  SubmissionActor,
  SubmissionRecord,
} from '../dto/submission-record/submission-record';
import type { PreparedSubmissionPhoto } from '../dto/submission/submission';
import type { SubmissionPhotoInput } from '../dto/submission/submission.input';
import { MAX_DRAFT_PHOTOS } from '../../components/photo-processing/photo-policy';
import { parseChecklistDefinition } from '../../components/checklist-templates/checklist-definition';
import { parseDraftAnswers } from '../../components/submission-drafts/draft-answers';
import {
  assertCompleteAnswers,
  prepareSubmissionPhotos,
} from '../../components/submissions/submission-validation';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSubmissionSnapshot(
  snapshot: Prisma.JsonValue,
  expected: {
    submissionId: string;
    propertyId: string;
    type: ChecklistType;
    version: number;
    status: SubmissionStatus;
  },
): { record: SubmissionRecord; photos: PreparedSubmissionPhoto[] } {
  try {
    const root = object(snapshot);
    const submission = object(root.submission);
    const property = object(root.property);
    const template = object(root.template);
    const author = object(root.author);
    const type = enumValue(submission.type, Object.values(ChecklistType));
    const status = enumValue(
      submission.status,
      Object.values(SubmissionStatus),
    );
    if (
      root.schemaVersion !== 1 ||
      uuid(submission.id) !== expected.submissionId ||
      uuid(submission.propertyId) !== expected.propertyId ||
      type !== expected.type ||
      status !== expected.status ||
      status === SubmissionStatus.DRAFT ||
      positiveInteger(submission.currentRevision) !== expected.version ||
      uuid(property.id) !== expected.propertyId ||
      template.schemaVersion !== 1 ||
      uuid(template.id) !== uuid(submission.templateId) ||
      template.type !== type ||
      positiveInteger(template.version) !==
        positiveInteger(submission.templateVersion) ||
      author.schemaVersion !== 1
    ) {
      return invalidSnapshot();
    }

    const isStaff = type === ChecklistType.MAINTENANCE;
    const authorRole = isStaff ? Role.STAFF : Role.GUEST;
    const authorId = nullableUuid(submission.authorUserId);
    const authorSource = enumValue(
      submission.authorSource,
      Object.values(ActorSource),
    );
    if (
      author.role !== authorRole ||
      (isStaff && authorId === null) ||
      (authorSource === ActorSource.STAFF_QR && !isStaff) ||
      (authorSource === ActorSource.GUEST_QR && isStaff)
    ) {
      return invalidSnapshot();
    }

    const definition = parseChecklistDefinition(required(template.definition));
    const answers = parseDraftAnswers(
      required(root.answers),
      definition,
      isStaff,
    );
    assertCompleteAnswers(definition, answers);
    const photos = prepareSubmissionPhotos(
      storedPhotos(root.photos),
      definition,
      answers,
      isStaff,
    );
    const startedAt = nullableTimestamp(submission.startedAt);
    const submittedAt = timestamp(submission.submittedAt);
    const cancelledAt = nullableTimestamp(submission.cancelledAt);
    if (
      (isStaff && startedAt === null) ||
      (status === SubmissionStatus.CANCELLED && cancelledAt === null) ||
      (status === SubmissionStatus.SUBMITTED && cancelledAt !== null)
    ) {
      return invalidSnapshot();
    }

    return {
      record: {
        property: {
          id: expected.propertyId,
          name: text(property.name, 100),
          region: nullableText(property.region, 100),
        },
        type,
        visitDate: visitDate(submission.visitDate),
        stayId: nullableUuid(submission.stayId),
        authorSource,
        author: {
          id: authorId,
          role: authorRole,
          name: text(author.name, 100),
          company: nullableText(author.company, 150),
          department: nullableText(author.department, 150),
          phone: nullableText(author.phone, 50),
        },
        template: {
          schemaVersion: 1,
          id: uuid(template.id),
          type,
          title: text(template.title, 150),
          version: positiveInteger(template.version),
          definition,
        },
        answers,
        startedAt,
        submittedAt,
        cancelledAt,
        createdAt: timestamp(submission.createdAt),
        updatedAt: timestamp(submission.updatedAt),
      },
      photos,
    };
  } catch {
    return invalidSnapshot();
  }
}

export function parseSubmissionActor(
  value: Prisma.JsonValue,
  actorUserId: string | null,
): SubmissionActor {
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

function storedPhotos(
  value: Prisma.JsonValue | undefined,
): SubmissionPhotoInput[] {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_PHOTOS) {
    return invalidSnapshot();
  }
  return value.map((value, index) => {
    const photo = object(value);
    if (photo.sortOrder !== index) return invalidSnapshot();
    // Revalidate the stored grouping without accepting sortOrder as caller input.
    return {
      attachmentId: uuid(photo.attachmentId),
      purpose: enumValue(photo.purpose, Object.values(PhotoPurpose)),
      sectionId: nullableUuid(photo.sectionId),
      itemId: nullableUuid(photo.itemId),
      areaLabel: nullableText(photo.areaLabel, 150),
    };
  });
}

function object(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidSnapshot();
  }
  return value;
}

function required(value: Prisma.JsonValue | undefined): Prisma.JsonValue {
  if (value === undefined) return invalidSnapshot();
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

function positiveInteger(value: Prisma.JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalidSnapshot();
  }
  return value;
}

function enumValue<T extends string>(
  value: Prisma.JsonValue | undefined,
  allowed: T[],
): T {
  const matched = allowed.find((candidate) => candidate === value);
  return matched ?? invalidSnapshot();
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

function visitDate(value: Prisma.JsonValue | undefined): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '2100-12-31'
  ) {
    return invalidSnapshot();
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return invalidSnapshot();
  }
  return value;
}

function invalidSnapshot(): never {
  throw new InternalServerErrorException({
    code: 'INVALID_SUBMISSION_SNAPSHOT',
    message: '저장된 제출 기록을 불러올 수 없습니다.',
  });
}
