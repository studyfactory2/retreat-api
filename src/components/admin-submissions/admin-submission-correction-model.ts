import { ChecklistType, PhotoPurpose } from '@prisma/client';
import type { CorrectAdminSubmissionInput } from '../../libs/dto/admin-submission/admin-submission-correction.input';
import type {
  DraftAnswers,
  DraftTemplateSnapshot,
} from '../../libs/dto/submission-draft/submission-draft';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import { buildDraftAnswers } from '../submission-drafts/draft-answers';
import {
  assertCompleteAnswers,
  prepareSubmissionPhotos,
} from '../submissions/submission-validation';

export function canonicalCorrectionAnswers(
  answers: DraftAnswers,
  template: DraftTemplateSnapshot,
): DraftAnswers {
  const order = new Map(
    template.definition.sections
      .flatMap((section) => section.items)
      .map((item, index) => [item.id, index]),
  );
  return {
    ...answers,
    items: [...answers.items].sort(
      (left, right) => order.get(left.itemId) - order.get(right.itemId),
    ),
  };
}

export function requestedAdminAnswers(
  input: CorrectAdminSubmissionInput,
  template: DraftTemplateSnapshot,
): DraftAnswers {
  const requested = canonicalCorrectionAnswers(
    buildDraftAnswers(
      input.items,
      input.generalNote,
      template.definition,
      false,
    ),
    template,
  );
  assertCompleteAnswers(template.definition, requested);
  return requested;
}

export function preserveMaintenanceRepairs(
  requested: DraftAnswers,
  previous: DraftAnswers,
  type: ChecklistType,
): DraftAnswers {
  if (type !== ChecklistType.MAINTENANCE) return requested;
  const byItem = new Map(
    previous.items.map((answer) => [answer.itemId, answer]),
  );
  return {
    ...requested,
    items: requested.items.map((answer) => {
      const before = byItem.get(answer.itemId);
      return answer.value === 'ABNORMAL' && before?.value === 'ABNORMAL'
        ? {
            ...answer,
            repairReported: before.repairReported,
            repairNote: before.repairNote,
          }
        : answer;
    }),
  };
}

export function retainedCorrectionPhotos(
  photos: PreparedSubmissionPhoto[],
  template: DraftTemplateSnapshot,
  answers: DraftAnswers,
  type: ChecklistType,
): PreparedSubmissionPhoto[] {
  const byItem = new Map(
    answers.items.map((answer) => [answer.itemId, answer]),
  );
  return prepareSubmissionPhotos(
    photos.filter((photo) => {
      const answer =
        photo.itemId === null ? undefined : byItem.get(photo.itemId);
      if (photo.purpose === PhotoPurpose.DEFECT)
        return answer?.value === 'ABNORMAL';
      if (photo.purpose === PhotoPurpose.REPAIR)
        return answer?.value === 'ABNORMAL' && answer.repairReported;
      return true;
    }),
    template.definition,
    answers,
    type === ChecklistType.MAINTENANCE,
  );
}
