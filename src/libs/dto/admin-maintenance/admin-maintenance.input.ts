import { IsIn, IsISO8601, IsUUID, Matches, ValidateIf } from 'class-validator';
import { PaginationInput } from '../common/list.input';

const maintenanceDatePattern =
  /^(?:19\d{2}|20\d{2}|2100)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export class GetAdminMaintenanceInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 시작일을 확인해 주세요.' },
  )
  @Matches(maintenanceDatePattern, {
    message: '조회 시작일은 1900~2100년의 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  from?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 종료일을 확인해 주세요.' },
  )
  @Matches(maintenanceDatePattern, {
    message: '조회 종료일은 1900~2100년의 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  to?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;

  @IsIn(['STARTED', 'SUBMITTED'], {
    message: '조회 기준은 시작 또는 제출 날짜를 선택해 주세요.',
  })
  dateField: 'STARTED' | 'SUBMITTED' = 'STARTED';

  @IsIn(['ALL', 'UNFINISHED', 'COMPLETED'], {
    message: '조회할 정비 기록 상태를 확인해 주세요.',
  })
  view: 'ALL' | 'UNFINISHED' | 'COMPLETED' = 'ALL';
}
