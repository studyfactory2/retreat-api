import { BadRequestException } from '@nestjs/common';
import { ImportRowAction, ImportRowStatus } from '@prisma/client';
import { SSF } from 'xlsx';
import type { WorkbookCell, WorkbookGrid } from './roster-workbook';

export const ROSTER_PARSER_VERSION = 'retreat-roster-v1';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const managedNames = new Set([
  '부산휴양소(해운대)',
  '부산휴양소(기장)',
  '경주휴양소',
  '애월1호점',
  '애월2호점',
  '가평휴양소',
]);
const key = (name: string): string => name.normalize('NFC').replace(/\s/g, '');
export const isManagedSheet = (name: string): boolean =>
  managedNames.has(key(name));

export type PreviewMessage = {
  code: string;
  message: string;
  stayIds?: string[];
};
export type RosterNormalized = {
  schemaVersion: 1;
  guestName: string | null;
  company: string | null;
  department: string | null;
  phone: string | null;
  guestCount: null;
  checkInDate: string | null;
  checkOutDate: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  notes: string | null;
};
export type PreviewRow = {
  sheetName: string;
  rowNumber: number;
  rawData: {
    schemaVersion: 1;
    cells: Array<{
      column: string;
      value: string | number | boolean | null;
      type: string;
      format: string | null;
      formula: boolean;
    }>;
  };
  normalizedData: RosterNormalized | null;
  validationStatus: ImportRowStatus;
  validationMessages: PreviewMessage[];
  action: ImportRowAction;
  propertyId: string | null;
};

export function flag(
  row: PreviewRow,
  code: string,
  message: string,
  invalid = false,
): void {
  if (!row.validationMessages.some((entry) => entry.code === code))
    row.validationMessages.push({ code, message });
  if (invalid) row.validationStatus = ImportRowStatus.INVALID;
  else if (row.validationStatus !== ImportRowStatus.INVALID)
    row.validationStatus = ImportRowStatus.NEEDS_REVIEW;
}

function text(cell: WorkbookCell | undefined): string | null {
  return typeof cell?.value === 'string' ? cell.value.trim() || null : null;
}

type LocalDate = {
  date: string | null;
  at: string | null;
  missingTime: boolean;
};
type DateCode = {
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
  S: number;
  u?: number;
};
function isDateCode(value: unknown): value is DateCode {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    ['y', 'm', 'd', 'H', 'M', 'S'].every(
      (key) => typeof record[key] === 'number' && Number.isFinite(record[key]),
    ) &&
    (record.u === undefined ||
      (typeof record.u === 'number' && Number.isFinite(record.u)))
  );
}
function readDate(
  cell: WorkbookCell | undefined,
  date1904: boolean,
): LocalDate {
  const none = { date: null, at: null, missingTime: false };
  if (!cell || cell.formula) return none;
  let parts: number[];
  let missingTime = false;
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    const value: unknown = (
      SSF as unknown as {
        parse_date_code: (
          serial: number,
          options: { date1904: boolean },
        ) => unknown;
      }
    ).parse_date_code(cell.value, { date1904 });
    if (!isDateCode(value)) return none;
    parts = [
      value.y,
      value.m,
      value.d,
      value.H,
      value.M,
      value.S,
      Math.round((value.u || 0) * 1000),
    ];
    // A date-only cell supplies no operational arrival/departure time.
    const format = (cell.format ?? '').replace(/"[^"]*"|\\./g, '');
    missingTime = !/[hs]/i.test(format) && Number.isInteger(cell.value);
  } else {
    const value = text(cell);
    const match = value?.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?)?$/,
    );
    if (!match) return none;
    missingTime = match[4] === undefined;
    parts = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
      Number((match[7] ?? '').padEnd(3, '0')),
    ];
  }
  const [year, month, day, hour, minute, second, ms] = parts;
  if (
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    ms > 999
  )
    return none;
  const wall = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, ms),
  );
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day
  )
    return none;
  return {
    date: wall.toISOString().slice(0, 10),
    at: missingTime
      ? null
      : new Date(wall.getTime() - 9 * 3600_000).toISOString(),
    missingTime,
  };
}

export function parseRoster(grid: WorkbookGrid): PreviewRow[] {
  if (
    new Set(grid.sheets.map((sheet) => sheet.name)).size !== grid.sheets.length
  )
    throw invalidWorkbook();
  const result: PreviewRow[] = [];
  let recognized = false;
  for (const sheet of grid.sheets) {
    const managed = isManagedSheet(sheet.name);
    if (managed) {
      recognized = true;
      const header = sheet.rows.find((row) => row.rowNumber === 1)?.cells;
      const labels = [
        '번호',
        '자원명',
        '아이디',
        '이동전화',
        '제목',
        '',
        '',
        '',
        '시작일',
        '종료일',
      ];
      if (
        !header ||
        header.some((cell) => cell.formula || cell.type === 'e') ||
        labels.some((label, index) => (text(header[index]) ?? '') !== label)
      )
        throw invalidWorkbook();
      if (
        !['요청날짜', '상태'].includes(text(header[10]) ?? '') ||
        text(header[11])
      )
        throw invalidWorkbook();
    }
    for (const source of sheet.rows) {
      if (source.rowNumber <= 1) continue;
      const cells = source.cells;
      if (cells.every((cell) => cell.value === null || cell.value === ''))
        continue;
      if (
        cells.some(
          (cell) => typeof cell.value === 'string' && cell.value.length > 4000,
        )
      )
        throw invalidWorkbook();
      const row: PreviewRow = {
        sheetName: sheet.name,
        rowNumber: source.rowNumber,
        rawData: {
          schemaVersion: 1,
          cells: cells.map((cell, index) => ({
            column: String.fromCharCode(65 + index),
            ...cell,
          })),
        },
        normalizedData: null,
        validationStatus: ImportRowStatus.VALID,
        validationMessages: [],
        action: ImportRowAction.SKIP,
        propertyId: null,
      };
      result.push(row);
      if (!managed) {
        row.validationMessages.push({
          code: 'UNMANAGED_SHEET',
          message: '관리 대상 휴양소 시트가 아니므로 제외합니다.',
        });
        continue;
      }
      if (
        text(cells[4]) === '예약 가능일' &&
        !cells.some((cell) => cell.formula || cell.type === 'e') &&
        [3, 5, 6, 7].every(
          (i) =>
            cells[i]?.value === null ||
            cells[i]?.value === undefined ||
            (typeof cells[i].value === 'string' &&
              cells[i].value.trim() === ''),
        )
      ) {
        row.validationMessages.push({
          code: 'AVAILABILITY_ROW',
          message: '예약 가능일 안내 행이므로 이용 일정에서 제외합니다.',
        });
        continue;
      }
      row.action = ImportRowAction.CREATE;
      const arrival = readDate(cells[8], grid.date1904);
      const departure = readDate(cells[9], grid.date1904);
      row.normalizedData = {
        schemaVersion: 1,
        guestName: text(cells[6]),
        company: text(cells[4]),
        department: text(cells[5]),
        phone: text(cells[3]),
        guestCount: null,
        checkInDate: arrival.date,
        checkOutDate: departure.date,
        checkInAt: arrival.at,
        checkOutAt: departure.at,
        notes: text(cells[11]),
      };
      const data = row.normalizedData;
      if (sheet.hidden)
        flag(
          row,
          'HIDDEN_SHEET',
          '숨겨진 시트의 이용 일정입니다. 포함 여부를 확인해 주세요.',
        );
      if (cells.some((cell) => cell.formula || cell.type === 'e'))
        flag(
          row,
          'FORMULA_OR_ERROR',
          '수식 또는 오류 셀이 있습니다. 원본 값을 확인해 주세요.',
          true,
        );
      const resource = text(cells[1]);
      if (!resource || key(resource) !== key(sheet.name))
        flag(
          row,
          'RESOURCE_MISMATCH',
          '시트와 자원명이 일치하지 않습니다. 휴양소를 확인해 주세요.',
        );
      if (text(cells[4]) === '예약 가능일')
        flag(
          row,
          'AMBIGUOUS_AVAILABILITY',
          '예약 가능일 행에 이용객 정보가 있습니다. 확인해 주세요.',
        );
      const role = text(cells[7]);
      const knownRole =
        /^(사원|주임|대리|과장|차장|부장|팀장|실장|본부장|이사|상무보|상무|전무|감사|대표|대표이사|선임|책임|수석|연구원|매니저|프로|임원|파트장)$/;
      if (
        data.guestName &&
        (/\s|팀$|사업부$|본부$|센터$|지원실$/.test(data.guestName) ||
          (role !== null && !knownRole.test(role)))
      ) {
        data.guestName = null;
        flag(
          row,
          'AMBIGUOUS_GUEST_COLUMNS',
          '이름과 부서 또는 직급의 열 위치를 확인해 주세요.',
        );
      } else if (!data.guestName)
        flag(row, 'MISSING_GUEST_NAME', '이용객 이름이 없습니다.', true);
      if (data.company && /예약|신청|휴양|이용/.test(data.company)) {
        data.company = null;
        flag(
          row,
          'AMBIGUOUS_COMPANY',
          '제목이 회사명인지 이용 요청 내용인지 확인해 주세요.',
        );
      }
      if (!data.phone)
        flag(
          row,
          'MISSING_PHONE',
          '연락처가 없거나 문자 형식이 아닙니다. 확인해 주세요.',
        );
      if (data.phone && !/^[0-9+()\-\s]{6,30}$/.test(data.phone))
        flag(row, 'INVALID_PHONE', '연락처 형식을 확인해 주세요.');
      for (const [name, limit] of [
        ['guestName', 100],
        ['company', 100],
        ['department', 100],
        ['notes', 2000],
      ] as const)
        if ((data[name]?.length ?? 0) > limit)
          flag(
            row,
            'TEXT_TOO_LONG',
            '이용객 정보 또는 메모가 너무 깁니다.',
            true,
          );
      if (!arrival.date || !departure.date)
        flag(row, 'INVALID_DATES', '입실일과 퇴실일을 확인해 주세요.', true);
      if (arrival.missingTime || departure.missingTime)
        flag(
          row,
          'MISSING_TIME',
          '날짜만 있고 시간이 없습니다. 입퇴실 시간을 확인해 주세요.',
        );
      if (arrival.at && departure.at && arrival.at >= departure.at)
        flag(row, 'INVALID_DATE_RANGE', '퇴실은 입실보다 늦어야 합니다.', true);
      if (arrival.date && departure.date && arrival.date > departure.date)
        flag(row, 'INVALID_DATE_RANGE', '퇴실일이 입실일보다 빠릅니다.', true);
    }
  }
  if (
    !recognized ||
    !result.some((row) => row.action === ImportRowAction.CREATE)
  )
    throw invalidWorkbook();
  return result;
}

export function invalidWorkbook(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_ROSTER_FORMAT',
    message: '전달받은 이용자 명단과 같은 양식의 Excel 파일을 선택해 주세요.',
  });
}
