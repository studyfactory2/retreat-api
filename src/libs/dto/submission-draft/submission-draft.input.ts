import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ChecklistType } from '@prisma/client';
import { trimNullableText, trimText } from '../common/list.input';

const visitDatePattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const utcTimestampPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export class StartGuestDraftInput {
  @IsUUID('4', { message: '작성 요청 ID를 확인해 주세요.' })
  requestKey: string;

  @IsIn([ChecklistType.CHECK_IN, ChecklistType.CHECK_OUT], {
    message: '이용객 체크리스트 유형을 확인해 주세요.',
  })
  type: typeof ChecklistType.CHECK_IN | typeof ChecklistType.CHECK_OUT;

  @Matches(visitDatePattern, {
    message: '이용일은 YYYY-MM-DD 형식으로 입력해 주세요.',
  })
  visitDate: string;

  @Transform(trimText)
  @IsString({ message: '이용객 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이용객 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '이용객 이름은 100자 이하여야 합니다.' })
  guestName: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '회사명은 문자열이어야 합니다.' })
  @MaxLength(150, { message: '회사명은 150자 이하여야 합니다.' })
  company?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '부서명은 문자열이어야 합니다.' })
  @MaxLength(150, { message: '부서명은 150자 이하여야 합니다.' })
  department?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '연락처는 문자열이어야 합니다.' })
  @MaxLength(50, { message: '연락처는 50자 이하여야 합니다.' })
  phone?: string | null;
}

export class StartStaffDraftInput {
  @IsUUID('4', { message: '작성 요청 ID를 확인해 주세요.' })
  requestKey: string;

  @IsUUID('4', { message: '확인한 담당자 ID를 확인해 주세요.' })
  confirmedStaffId: string;
}

export class DraftAnswerInput {
  @IsUUID('4', { message: '체크 항목 ID를 확인해 주세요.' })
  itemId: string;

  @IsIn(['NORMAL', 'ABNORMAL'], {
    message: '체크 결과는 NORMAL 또는 ABNORMAL이어야 합니다.',
  })
  value: 'NORMAL' | 'ABNORMAL';

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '이상 내용은 문자열이어야 합니다.' })
  @MaxLength(2000, { message: '이상 내용은 2000자 이하여야 합니다.' })
  description?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '긴급 여부는 true 또는 false여야 합니다.' })
  isUrgent?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '조치 여부는 true 또는 false여야 합니다.' })
  repairReported?: boolean;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '조치 내용은 문자열이어야 합니다.' })
  @MaxLength(2000, { message: '조치 내용은 2000자 이하여야 합니다.' })
  repairNote?: string | null;
}

export class SaveDraftInput {
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '임시 저장 일시를 확인해 주세요.' },
  )
  @Matches(utcTimestampPattern, {
    message: '임시 저장 일시는 밀리초가 포함된 UTC 형식이어야 합니다.',
  })
  expectedUpdatedAt: string;

  @IsArray({ message: '체크 결과는 배열이어야 합니다.' })
  @ArrayMaxSize(500, { message: '체크 결과는 500개까지 저장할 수 있습니다.' })
  @IsObject({ each: true, message: '체크 결과의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => DraftAnswerInput)
  items: DraftAnswerInput[];

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '전체 메모는 문자열이어야 합니다.' })
  @MaxLength(4000, { message: '전체 메모는 4000자 이하여야 합니다.' })
  generalNote?: string | null;
}
