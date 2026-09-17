import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IssueStatus } from '@prisma/client';
import { PaginationInput, trimText } from '../common/list.input';

const datePattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function queryBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class GetAdminIssuesInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(IssueStatus, { message: '이상사항 처리 상태를 확인해 주세요.' })
  status?: IssueStatus;

  @Transform(queryBoolean)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '긴급 여부는 true 또는 false여야 합니다.' })
  isUrgent?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 시작일을 확인해 주세요.' },
  )
  @Matches(datePattern, {
    message: '조회 시작일은 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  from?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 종료일을 확인해 주세요.' },
  )
  @Matches(datePattern, {
    message: '조회 종료일은 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  to?: string;
}

export class GetAdminIssueHistoryInput extends PaginationInput {}

class AdminIssueVersionInput {
  @IsInt({ message: '이상사항 버전은 정수여야 합니다.' })
  @Min(1, { message: '이상사항 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '이상사항 버전을 확인해 주세요.' })
  expectedVersion: number;
}

export class AddAdminIssueNoteInput extends AdminIssueVersionInput {
  @Transform(trimText)
  @IsString({ message: '메모는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '메모를 입력해 주세요.' })
  @MaxLength(2000, { message: '메모는 2000자 이하여야 합니다.' })
  note: string;
}

export class ChangeAdminIssueStatusInput extends AdminIssueVersionInput {
  @IsEnum(IssueStatus, { message: '이상사항 처리 상태를 확인해 주세요.' })
  status: IssueStatus;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '처리 메모는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '처리 메모를 입력해 주세요.' })
  @MaxLength(2000, { message: '처리 메모는 2000자 이하여야 합니다.' })
  note?: string;
}
