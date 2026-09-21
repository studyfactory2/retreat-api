import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ChecklistType, SubmissionStatus } from '@prisma/client';
import { PaginationInput } from '../common/list.input';

const visitDatePattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export class GetAdminSubmissionsInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['LINKED', 'UNLINKED'], {
    message: '이용 일정 연결 상태를 확인해 주세요.',
  })
  linkStatus?: 'LINKED' | 'UNLINKED';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ChecklistType, { message: '체크리스트 유형을 확인해 주세요.' })
  type?: ChecklistType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn([SubmissionStatus.SUBMITTED, SubmissionStatus.CANCELLED], {
    message: '제출 내역 상태를 확인해 주세요.',
  })
  status?:
    typeof SubmissionStatus.SUBMITTED | typeof SubmissionStatus.CANCELLED;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 시작일을 확인해 주세요.' },
  )
  @Matches(visitDatePattern, {
    message: '조회 시작일은 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  from?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 종료일을 확인해 주세요.' },
  )
  @Matches(visitDatePattern, {
    message: '조회 종료일은 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  to?: string;
}

export class GetAdminSubmissionHistoryInput extends PaginationInput {}
