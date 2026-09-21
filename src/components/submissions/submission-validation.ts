import { BadRequestException } from '@nestjs/common';
import { PhotoPurpose } from '@prisma/client';
import type { ChecklistDefinition } from '../../libs/dto/checklist-template/checklist-template';
import type { DraftAnswers } from '../../libs/dto/submission-draft/submission-draft';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import type { SubmissionPhotoInput } from '../../libs/dto/submission/submission.input';
import { MAX_DRAFT_PHOTOS } from '../photo-processing/photo-policy';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertCompleteAnswers(
  definition: ChecklistDefinition,
  answers: DraftAnswers,
): void {
  const answeredIds = new Set(
    answers.items
      .filter(
        (answer) => answer.value === 'NORMAL' || answer.value === 'ABNORMAL',
      )
      .map((answer) => answer.itemId.toLowerCase()),
  );
  if (
    definition.sections.some((section) =>
      section.items.some(
        (item) => item.required && !answeredIds.has(item.id.toLowerCase()),
      ),
    )
  ) {
    throw new BadRequestException({
      code: 'INCOMPLETE_CHECKLIST',
      message: '필수 체크 항목을 모두 작성한 뒤 제출해 주세요.',
    });
  }
}

export function prepareSubmissionPhotos(
  photos: SubmissionPhotoInput[],
  definition: ChecklistDefinition,
  answers: DraftAnswers,
  isStaff: boolean,
): PreparedSubmissionPhoto[] {
  if (!Array.isArray(photos) || photos.length > MAX_DRAFT_PHOTOS) {
    return invalidPhotos();
  }
  const sectionIds = new Set(
    definition.sections.map((section) => section.id.toLowerCase()),
  );
  const itemSections = new Map(
    definition.sections.flatMap((section) =>
      section.items.map(
        (item) => [item.id.toLowerCase(), section.id.toLowerCase()] as const,
      ),
    ),
  );
  const savedAnswers = new Map(
    answers.items.map((answer) => [answer.itemId.toLowerCase(), answer]),
  );
  const usedAttachmentIds = new Set<string>();

  return photos.map((photo, sortOrder) => {
    if (typeof photo !== 'object' || photo === null || Array.isArray(photo)) {
      return invalidPhotos();
    }
    const attachmentId = normalizedId(photo.attachmentId);
    if (usedAttachmentIds.has(attachmentId)) return invalidPhotos();
    usedAttachmentIds.add(attachmentId);
    if (!Object.values(PhotoPurpose).includes(photo.purpose))
      return invalidPhotos();

    let sectionId = nullableId(photo.sectionId);
    const itemId = nullableId(photo.itemId);
    const areaLabel = normalizedArea(photo.areaLabel);
    if (sectionId !== null && !sectionIds.has(sectionId))
      return invalidPhotos();
    if (itemId !== null) {
      const itemSectionId = itemSections.get(itemId);
      if (
        !itemSectionId ||
        (sectionId !== null && sectionId !== itemSectionId)
      ) {
        return invalidPhotos();
      }
      sectionId = itemSectionId;
    }

    const answer = itemId === null ? undefined : savedAnswers.get(itemId);
    if (!isStaff && photo.purpose !== PhotoPurpose.DEFECT)
      return invalidPhotos();
    switch (photo.purpose) {
      case PhotoPurpose.DEFECT:
        if (answer?.value !== 'ABNORMAL') return invalidPhotos();
        break;
      case PhotoPurpose.REPAIR:
        if (
          !isStaff ||
          answer?.value !== 'ABNORMAL' ||
          !answer.repairReported
        ) {
          return invalidPhotos();
        }
        break;
      case PhotoPurpose.MAINTENANCE_BEFORE:
      case PhotoPurpose.MAINTENANCE_AFTER:
        if (
          !isStaff ||
          (sectionId === null && itemId === null && areaLabel === null)
        ) {
          return invalidPhotos();
        }
        break;
    }

    return {
      attachmentId,
      purpose: photo.purpose,
      sectionId,
      itemId,
      areaLabel,
      sortOrder,
    };
  });
}

function normalizedId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return invalidPhotos();
  return value.toLowerCase();
}

function nullableId(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : normalizedId(value);
}

function normalizedArea(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return invalidPhotos();
  const trimmed = value.trim();
  if ([...trimmed].length > 150) return invalidPhotos();
  return trimmed || null;
}

function invalidPhotos(): never {
  throw new BadRequestException({
    code: 'INVALID_SUBMISSION_PHOTOS',
    message: '사진 용도와 연결된 체크 항목 또는 위치를 확인해 주세요.',
  });
}
