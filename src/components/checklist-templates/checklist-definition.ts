import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ChecklistSectionInput } from '../../libs/dto/checklist-template/checklist-template.input';
import type { ChecklistDefinition } from '../../libs/dto/checklist-template/checklist-template';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 500;

export function buildChecklistDefinition(
  sections: ChecklistSectionInput[],
  current?: ChecklistDefinition,
): ChecklistDefinition {
  if (
    sections.reduce((total, section) => total + section.items.length, 0) >
    MAX_ITEMS
  ) {
    throw new BadRequestException({
      code: 'CHECKLIST_TOO_LARGE',
      message: '체크리스트 항목은 전체 500개까지 등록할 수 있습니다.',
    });
  }

  const currentSections = new Map(
    current?.sections.map((section) => [section.id.toLowerCase(), section]),
  );
  const reservedIds = new Set<string>();
  for (const section of current?.sections ?? []) {
    reservedIds.add(section.id.toLowerCase());
    for (const item of section.items) reservedIds.add(item.id.toLowerCase());
  }
  const usedIds = new Set<string>();
  const allocateId = (): string => {
    let id: string;
    do {
      id = randomUUID();
    } while (reservedIds.has(id) || usedIds.has(id));
    return id;
  };
  const claimId = (id: string): string => {
    if (usedIds.has(id)) {
      throw new BadRequestException({
        code: 'DUPLICATE_CHECKLIST_ID',
        message: '체크리스트의 구역 및 항목 ID는 중복될 수 없습니다.',
      });
    }
    usedIds.add(id);
    return id;
  };

  return {
    schemaVersion: 1,
    sections: sections.map((section) => {
      const suppliedId = section.id?.toLowerCase();
      const original = suppliedId ? currentSections.get(suppliedId) : undefined;
      if (section.id !== undefined && !original) {
        throw new BadRequestException({
          code: 'INVALID_CHECKLIST_SECTION_ID',
          message: '현재 체크리스트에 포함된 구역 ID인지 확인해 주세요.',
        });
      }
      const id = claimId(suppliedId ?? allocateId());
      const originalItemIds = new Set(
        original?.items.map((item) => item.id.toLowerCase()),
      );
      return {
        id,
        title: section.title.trim(),
        items: section.items.map((item) => {
          const suppliedItemId = item.id?.toLowerCase();
          if (
            item.id !== undefined &&
            (!suppliedItemId || !originalItemIds.has(suppliedItemId))
          ) {
            throw new BadRequestException({
              code: 'INVALID_CHECKLIST_ITEM_ID',
              message: '해당 구역에 포함된 항목 ID인지 확인해 주세요.',
            });
          }
          return {
            id: claimId(suppliedItemId ?? allocateId()),
            label: item.label.trim(),
            required: item.required,
            answerType: 'NORMAL_ABNORMAL' as const,
          };
        }),
      };
    }),
  };
}

export function parseChecklistDefinition(
  value: Prisma.JsonValue,
): ChecklistDefinition {
  const root = storedObject(value, ['schemaVersion', 'sections']);
  if (root.schemaVersion !== 1) invalidStoredDefinition();
  const sections = storedArray(root.sections, 20);
  const usedIds = new Set<string>();
  let totalItems = 0;

  const readId = (value: unknown): string => {
    if (typeof value !== 'string' || !UUID_V4.test(value)) {
      return invalidStoredDefinition();
    }
    const id = value.toLowerCase();
    if (usedIds.has(id)) invalidStoredDefinition();
    usedIds.add(id);
    return id;
  };

  return {
    schemaVersion: 1,
    sections: sections.map((value) => {
      const section = storedObject(value, ['id', 'title', 'items']);
      const id = readId(section.id);
      const title = storedText(section.title, 150);
      const items = storedArray(section.items, 50);
      totalItems += items.length;
      if (totalItems > MAX_ITEMS) invalidStoredDefinition();
      return {
        id,
        title,
        items: items.map((value) => {
          const item = storedObject(value, [
            'id',
            'label',
            'required',
            'answerType',
          ]);
          if (
            typeof item.required !== 'boolean' ||
            item.answerType !== 'NORMAL_ABNORMAL'
          ) {
            return invalidStoredDefinition();
          }
          return {
            id: readId(item.id),
            label: storedText(item.label, 300),
            required: item.required,
            answerType: 'NORMAL_ABNORMAL' as const,
          };
        }),
      };
    }),
  };
}

function storedObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidStoredDefinition();
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    return invalidStoredDefinition();
  }
  return value as Record<string, unknown>;
}

function storedArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    return invalidStoredDefinition();
  }
  return value;
}

function storedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return invalidStoredDefinition();
  const text = value.trim();
  if (text.length === 0 || [...text].length > maximum) {
    return invalidStoredDefinition();
  }
  return text;
}

function invalidStoredDefinition(): never {
  throw new InternalServerErrorException({
    code: 'INVALID_STORED_CHECKLIST_DEFINITION',
    message: '체크리스트 정보를 불러올 수 없습니다.',
  });
}
