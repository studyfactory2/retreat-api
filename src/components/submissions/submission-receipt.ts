import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SubmissionReceiptDto } from '../../libs/dto/submission/submission';
import type { DraftRecord } from '../submission-drafts/submission-drafts.service';

export function readSubmissionReceipt(
  snapshot: Prisma.JsonValue,
  submission: DraftRecord,
): SubmissionReceiptDto {
  const root = record(snapshot);
  const receipt = record(root.receipt);
  const property = record(receipt.property);
  if (
    root.schemaVersion !== 1 ||
    receipt.id !== submission.id ||
    receipt.status !== 'SUBMITTED' ||
    receipt.type !== submission.type ||
    receipt.revision !== 1 ||
    property.id !== submission.propertyId ||
    typeof property.name !== 'string' ||
    (property.region !== null && typeof property.region !== 'string') ||
    typeof receipt.visitDate !== 'string' ||
    receipt.visitDate !== submission.visitDate.toISOString().slice(0, 10) ||
    !submission.privateTokenExpiresAt ||
    !submission.submittedAt
  ) {
    throw new InternalServerErrorException();
  }
  const submittedAt = timestamp(receipt.submittedAt);
  if (submittedAt.getTime() !== submission.submittedAt.getTime()) {
    throw new InternalServerErrorException();
  }
  return {
    id: submission.id,
    status: 'SUBMITTED',
    type: submission.type,
    property: {
      id: submission.propertyId,
      name: property.name,
      region: typeof property.region === 'string' ? property.region : null,
    },
    visitDate: receipt.visitDate,
    startedAt: receipt.startedAt === null ? null : timestamp(receipt.startedAt),
    submittedAt,
    revision: 1,
    answeredItemCount: count(receipt.answeredItemCount),
    photoCount: count(receipt.photoCount),
    reportedIssueCount: count(receipt.reportedIssueCount),
    expiresAt: submission.privateTokenExpiresAt,
  };
}

export function readSubmissionRequestHash(snapshot: Prisma.JsonValue): string {
  const root = record(snapshot);
  if (
    root.schemaVersion !== 1 ||
    typeof root.requestHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(root.requestHash)
  ) {
    throw new InternalServerErrorException();
  }
  return root.requestHash;
}

function record(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InternalServerErrorException();
  }
  return value;
}

function count(value: Prisma.JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new InternalServerErrorException();
  }
  return value;
}

function timestamp(value: Prisma.JsonValue | undefined): Date {
  if (typeof value !== 'string') throw new InternalServerErrorException();
  const result = new Date(value);
  if (Number.isNaN(result.getTime()) || result.toISOString() !== value) {
    throw new InternalServerErrorException();
  }
  return result;
}
