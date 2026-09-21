export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
export const MAX_WORKBOOK_SHEETS = 40;
export const MAX_WORKBOOK_SHEET_ROWS = 2000;
export const MAX_WORKBOOK_ROWS = 5000;
export const MAX_WORKBOOK_COLUMNS = 32;
export const ROSTER_WORKBOOK_COLUMNS = 12;

export interface WorkbookCell {
  value: string | number | boolean | null;
  type: string;
  format: string | null;
  formula: boolean;
}

export interface WorkbookSheet {
  name: string;
  hidden: boolean;
  rows: Array<{ rowNumber: number; cells: WorkbookCell[] }>;
}

export interface WorkbookGrid {
  date1904: boolean;
  sheets: WorkbookSheet[];
}

export type WorkbookReadFailureCode =
  'INVALID_WORKBOOK' | 'WORKBOOK_LIMIT_EXCEEDED';

export type WorkbookReadResult =
  | { ok: true; workbook: WorkbookGrid }
  | { ok: false; code: WorkbookReadFailureCode };
