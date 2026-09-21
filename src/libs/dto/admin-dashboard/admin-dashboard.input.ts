import { IsISO8601, IsUUID, Matches, ValidateIf } from 'class-validator';

const dashboardDatePattern =
  /^(?:19\d{2}|20\d{2}|2100)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export class GetAdminDashboardInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 날짜를 확인해 주세요.' },
  )
  @Matches(dashboardDatePattern, {
    message: '조회 날짜는 1900~2100년의 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  date?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;
}
