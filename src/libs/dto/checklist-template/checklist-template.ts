import type { ChecklistType } from '@prisma/client';
import type { ListDto } from '../common/list';

export type ChecklistItem = {
  id: string;
  label: string;
  required: boolean;
  answerType: 'NORMAL_ABNORMAL';
};

export type ChecklistSection = {
  id: string;
  title: string;
  items: ChecklistItem[];
};

export type ChecklistDefinition = {
  schemaVersion: 1;
  sections: ChecklistSection[];
};

export interface ChecklistTemplatePropertyDto {
  id: string;
  name: string;
  region: string | null;
  isActive: boolean;
}

export interface ChecklistTemplateDto {
  id: string;
  propertyId: string;
  type: ChecklistType;
  title: string;
  version: number;
  definition: ChecklistDefinition;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  property: ChecklistTemplatePropertyDto;
}

export type ChecklistTemplateListDto = ListDto<ChecklistTemplateDto>;
