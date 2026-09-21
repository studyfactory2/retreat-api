import type {
  ImportRowAction,
  ImportRowStatus,
  ImportStatus,
  Prisma,
} from '@prisma/client';
import type { ListDto } from '../common/list';

export interface StayImportRowDto {
  id: string;
  sheetName: string;
  rowNumber: number;
  propertyId: string | null;
  action: ImportRowAction;
  validationStatus: ImportRowStatus;
  normalizedData: Prisma.JsonValue | null;
  validationMessages: Prisma.JsonValue;
  rawData: Prisma.JsonValue;
}

export interface StayImportPreviewDto {
  batch: {
    id: string;
    status: ImportStatus;
    version: number;
    parserVersion: string;
    timezone: string;
    createdAt: Date;
    source: { filename: string; sizeBytes: number };
    summary: {
      total: number;
      ready: number;
      needsReview: number;
      invalid: number;
      skipped: number;
    };
  };
  rows: ListDto<StayImportRowDto>;
}
