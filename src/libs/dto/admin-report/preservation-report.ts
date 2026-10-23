export type ArchiveValue = string | number | Date | null;
export type ArchiveFields = Record<string, ArchiveValue>;
export type ArchiveSheetName =
  | '이용 일정'
  | '점검 기록'
  | '점검 답변'
  | '이상사항'
  | '변경 이력'
  | '사진 목록';

export interface ArchiveTable {
  name: ArchiveSheetName;
  headers: string[];
  rows: ArchiveValue[][];
}

export interface PreservationReport {
  from: string;
  to: string;
  generatedAt: Date;
  propertyLabel: string;
  tables: ArchiveTable[];
}
