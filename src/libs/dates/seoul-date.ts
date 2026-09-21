import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export function seoulDay(value: Date): string {
  return new Date(value.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** Inclusive local dates, represented as a half-open UTC timestamp interval. */
export function seoulDateRange(
  from: string,
  to: string,
  maxDays = 62,
  errorCode = 'INVALID_DATE_RANGE',
): { start: Date; end: Date } {
  const invalid = () =>
    new BadRequestException({
      code: errorCode,
      message: `조회 기간은 올바른 날짜 순서로 최대 ${maxDays}일까지 선택해 주세요.`,
    });
  const parse = (value: string): Date => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '1900-01-01' ||
      value > '2100-12-31'
    )
      throw invalid();
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw invalid();
    return date;
  };
  const startDay = parse(from);
  const lastDay = parse(to);
  const days = (lastDay.getTime() - startDay.getTime()) / DAY_MS + 1;
  if (days < 1 || days > maxDays) throw invalid();
  return {
    start: new Date(startDay.getTime() - SEOUL_OFFSET_MS),
    end: new Date(lastDay.getTime() + DAY_MS - SEOUL_OFFSET_MS),
  };
}
