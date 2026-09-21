import { parentPort, workerData } from 'node:worker_threads';
import * as XLSX from 'xlsx';
import {
  MAX_WORKBOOK_BYTES,
  MAX_WORKBOOK_COLUMNS,
  MAX_WORKBOOK_ROWS,
  MAX_WORKBOOK_SHEET_ROWS,
  MAX_WORKBOOK_SHEETS,
  ROSTER_WORKBOOK_COLUMNS,
  type WorkbookCell,
  type WorkbookGrid,
  type WorkbookReadFailureCode,
  type WorkbookReadResult,
} from './roster-workbook';

const CFB_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

class WorkbookReadFailure extends Error {
  constructor(public readonly code: WorkbookReadFailureCode) {
    super(code);
  }
}

function checkRange(value: unknown): XLSX.Range | null {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(value)
  ) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  const range = XLSX.utils.decode_range(value);
  if (
    ![range.s.r, range.s.c, range.e.r, range.e.c].every(Number.isSafeInteger) ||
    range.s.r < 0 ||
    range.s.c < 0 ||
    range.e.r < range.s.r ||
    range.e.c < range.s.c
  ) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  if (
    range.e.r >= MAX_WORKBOOK_SHEET_ROWS ||
    range.e.c >= MAX_WORKBOOK_COLUMNS
  ) {
    throw new WorkbookReadFailure('WORKBOOK_LIMIT_EXCEEDED');
  }
  return range;
}

function readCell(input: unknown): WorkbookCell {
  if (input === undefined || input === null) {
    return { value: null, type: 'z', format: null, formula: false };
  }
  if (typeof input !== 'object') {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  const cell = input as Partial<XLSX.CellObject>;
  if (typeof cell.t !== 'string') {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  const value: unknown = cell.v;
  if (
    value !== undefined &&
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  return {
    value:
      value === undefined || value === null
        ? null
        : (value as WorkbookCell['value']),
    type: cell.t,
    format: typeof cell.z === 'string' ? cell.z : null,
    formula: typeof cell.f === 'string' || typeof cell.F === 'string',
  };
}

function readWorkbook(bytes: unknown): WorkbookGrid {
  if (!(bytes instanceof Uint8Array)) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_WORKBOOK_BYTES) {
    throw new WorkbookReadFailure('WORKBOOK_LIMIT_EXCEEDED');
  }
  if (
    buffer.length < CFB_SIGNATURE.length ||
    !buffer.subarray(0, CFB_SIGNATURE.length).equals(CFB_SIGNATURE)
  ) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: true,
    cellFormula: true,
    cellText: false,
    dense: false,
    sheetRows: MAX_WORKBOOK_SHEET_ROWS + 2,
    WTF: true,
  });
  if (!workbook.SheetNames.length) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) {
    throw new WorkbookReadFailure('WORKBOOK_LIMIT_EXCEEDED');
  }
  if (new Set(workbook.SheetNames).size !== workbook.SheetNames.length) {
    throw new WorkbookReadFailure('INVALID_WORKBOOK');
  }
  let totalRows = 0;
  return {
    date1904: workbook.Workbook?.WBProps?.date1904 === true,
    sheets: workbook.SheetNames.map((name, sheetIndex) => {
      const sheet = workbook.Sheets[name];
      if (!sheet) throw new WorkbookReadFailure('INVALID_WORKBOOK');
      const range = checkRange(sheet['!ref']);
      checkRange(sheet['!fullref']);
      const rows: WorkbookGrid['sheets'][number]['rows'] = [];
      for (let row = range?.s.r ?? 0; range && row <= range.e.r; row += 1) {
        let nonempty = false;
        const cells: WorkbookCell[] = [];
        for (
          let column = 0;
          column <= Math.max(range.e.c, ROSTER_WORKBOOK_COLUMNS - 1);
          column += 1
        ) {
          const cell = readCell(
            sheet[XLSX.utils.encode_cell({ r: row, c: column })],
          );
          if ((cell.value !== null && cell.value !== '') || cell.formula) {
            nonempty = true;
          }
          if (column < ROSTER_WORKBOOK_COLUMNS) cells.push(cell);
        }
        if (nonempty) {
          totalRows += 1;
          if (totalRows > MAX_WORKBOOK_ROWS) {
            throw new WorkbookReadFailure('WORKBOOK_LIMIT_EXCEEDED');
          }
          rows.push({ rowNumber: row + 1, cells });
        }
      }
      return {
        name,
        hidden: (workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden ?? 0) !== 0,
        rows,
      };
    }),
  };
}

let result: WorkbookReadResult;
try {
  const input: unknown = workerData;
  result = { ok: true, workbook: readWorkbook(input) };
} catch (error) {
  result = {
    ok: false,
    code:
      error instanceof WorkbookReadFailure ? error.code : 'INVALID_WORKBOOK',
  };
}
parentPort?.postMessage(result);
