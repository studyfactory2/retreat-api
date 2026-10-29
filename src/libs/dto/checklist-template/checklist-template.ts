import type {
  ChecklistType,
  ChecklistTemplateVersionSource,
} from '@prisma/client';
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

export interface ChecklistTemplateVersionSummaryDto {
  version: number;
  title: string;
  isActive: boolean;
  publishedAt: Date;
  actor: { id: string; name: string } | null;
  source: ChecklistTemplateVersionSource;
  sectionCount: number;
  itemCount: number;
}

export interface ChecklistTemplateVersionListDto extends ListDto<ChecklistTemplateVersionSummaryDto> {
  templateId: string;
  currentVersion: number;
}

export interface ChecklistTemplateVersionDto extends ChecklistTemplateVersionSummaryDto {
  templateId: string;
  propertyId: string;
  type: ChecklistType;
  definition: ChecklistDefinition;
}
