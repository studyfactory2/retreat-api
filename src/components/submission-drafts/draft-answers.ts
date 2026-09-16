import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ChecklistDefinition } from '../../libs/dto/checklist-template/checklist-template';
import type { DraftAnswerInput } from '../../libs/dto/submission-draft/submission-draft.input';
import type {
  DraftAnswer,
  DraftAnswers,
} from '../../libs/dto/submission-draft/submission-draft';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANSWER_KEYS = [
  'itemId',
  'value',
  'description',
  'isUrgent',
  'repairReported',
  'repairNote',
];

export function buildDraftAnswers(
  items: DraftAnswerInput[],
  generalNote: string | null | undefined,
  definition: ChecklistDefinition,
  isStaff: boolean,
): DraftAnswers {
  const availableIds = definitionItemIds(definition);
  const usedIds = new Set<string>();

  return {
    schemaVersion: 1,
    items: items.map((input) => {
      const itemId = input.itemId.toLowerCase();
      if (!availableIds.has(itemId)) {
        throw new BadRequestException({
          code: 'INVALID_DRAFT_ITEM',
          message: '이 체크리스트에 포함된 항목인지 확인해 주세요.',
        });
      }
      if (usedIds.has(itemId)) {
        throw new BadRequestException({
          code: 'INVALID_DRAFT_ANSWERS',
          message: '같은 체크 항목은 한 번만 입력해 주세요.',
        });
      }
      usedIds.add(itemId);
      if (
        !isStaff &&
        (input.repairReported !== undefined || input.repairNote !== undefined)
      ) {
        throw new BadRequestException({
          code: 'STAFF_ANSWER_ONLY',
          message: '조치 내용은 직원만 작성할 수 있습니다.',
        });
      }
      const answer: DraftAnswer = {
        itemId,
        value: input.value,
        description: normalizeText(input.description),
        isUrgent: input.isUrgent ?? false,
        repairReported: input.repairReported ?? false,
        repairNote: normalizeText(input.repairNote),
      };
      if (!hasValidSemantics(answer, isStaff)) {
        throw new BadRequestException({
          code: 'INVALID_DRAFT_ANSWERS',
          message: '이상 여부와 조치 내용을 확인해 주세요.',
        });
      }
      return answer;
    }),
    generalNote: normalizeText(generalNote),
  };
}

export function parseDraftAnswers(
  value: Prisma.JsonValue,
  definition: ChecklistDefinition,
  isStaff: boolean,
): DraftAnswers {
  const root = storedObject(value, ['schemaVersion', 'items', 'generalNote']);
  if (
    root.schemaVersion !== 1 ||
    !Array.isArray(root.items) ||
    root.items.length > 500
  ) {
    return invalidStoredAnswers();
  }
  const availableIds = definitionItemIds(definition);
  const usedIds = new Set<string>();
  return {
    schemaVersion: 1,
    items: root.items.map((value: unknown) => {
      const item = storedObject(value, ANSWER_KEYS);
      if (
        typeof item.itemId !== 'string' ||
        !UUID_V4.test(item.itemId) ||
        (item.value !== 'NORMAL' && item.value !== 'ABNORMAL') ||
        typeof item.isUrgent !== 'boolean' ||
        typeof item.repairReported !== 'boolean'
      ) {
        return invalidStoredAnswers();
      }
      const itemId = item.itemId.toLowerCase();
      if (!availableIds.has(itemId) || usedIds.has(itemId)) {
        return invalidStoredAnswers();
      }
      usedIds.add(itemId);
      const answer: DraftAnswer = {
        itemId,
        value: item.value,
        description: storedText(item.description, 2000),
        isUrgent: item.isUrgent,
        repairReported: item.repairReported,
        repairNote: storedText(item.repairNote, 2000),
      };
      if (!hasValidSemantics(answer, isStaff)) return invalidStoredAnswers();
      return answer;
    }),
    generalNote: storedText(root.generalNote, 4000),
  };
}

function definitionItemIds(definition: ChecklistDefinition): Set<string> {
  return new Set(
    definition.sections.flatMap((section) =>
      section.items.map((item) => item.id.toLowerCase()),
    ),
  );
}

function normalizeText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function hasValidSemantics(answer: DraftAnswer, isStaff: boolean): boolean {
  if (!isStaff && (answer.repairReported || answer.repairNote !== null)) {
    return false;
  }
  if (answer.repairNote !== null && !answer.repairReported) return false;
  return (
    answer.value !== 'NORMAL' ||
    (answer.description === null &&
      !answer.isUrgent &&
      !answer.repairReported &&
      answer.repairNote === null)
  );
}

function storedObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidStoredAnswers();
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    return invalidStoredAnswers();
  }
  return value as Record<string, unknown>;
}

function storedText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalidStoredAnswers();
  const text = normalizeText(value);
  if (text !== null && [...text].length > maximum)
    return invalidStoredAnswers();
  return text;
}

function invalidStoredAnswers(): never {
  throw new InternalServerErrorException({
    code: 'INVALID_STORED_DRAFT_ANSWERS',
    message: '작성 중인 체크리스트를 불러올 수 없습니다.',
  });
}
