import { IsISO8601, IsUUID, Matches, ValidateIf } from 'class-validator';
import { PaginationInput } from '../common/list.input';

const calendarDatePattern =
  /^(?:19\d{2}|20\d{2}|2100)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export class GetAdminCalendarInput extends PaginationInput {
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 시작일을 확인해 주세요.' },
  )
  @Matches(calendarDatePattern, {
    message: '조회 시작일은 1900~2100년의 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  from: string;

  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 종료일을 확인해 주세요.' },
  )
  @Matches(calendarDatePattern, {
    message: '조회 종료일은 1900~2100년의 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  to: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;
}
