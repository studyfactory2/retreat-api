import { Transform } from 'class-transformer';
import {
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
import { StayStatus } from '@prisma/client';
import {
  PaginationInput,
  trimNullableText,
  trimText,
} from '../common/list.input';

const timestampPattern =
  /^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

class StayGuestDetailsInput {
  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '회사명은 문자열이어야 합니다.' })
  @MaxLength(100, { message: '회사명은 100자 이하여야 합니다.' })
  company?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '부서명은 문자열이어야 합니다.' })
  @MaxLength(100, { message: '부서명은 100자 이하여야 합니다.' })
  department?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '연락처는 문자열이어야 합니다.' })
  @MaxLength(32, { message: '연락처는 32자 이하여야 합니다.' })
  phone?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '메모는 문자열이어야 합니다.' })
  @MaxLength(2000, { message: '메모는 2000자 이하여야 합니다.' })
  notes?: string | null;
}

export class CreateStayInput extends StayGuestDetailsInput {
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId: string;

  @Transform(trimText)
  @IsString({ message: '이용객 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이용객 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '이용객 이름은 100자 이하여야 합니다.' })
  guestName: string;

  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '입실 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, {
    message: '입실 일시는 시간대가 포함된 날짜와 시각으로 입력해 주세요.',
  })
  checkInAt: string;

  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '퇴실 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, {
    message: '퇴실 일시는 시간대가 포함된 날짜와 시각으로 입력해 주세요.',
  })
  checkOutAt: string;
}

export class UpdateStayInput extends StayGuestDetailsInput {
  @IsInt({ message: '기록 버전은 정수여야 합니다.' })
  @Min(1, { message: '기록 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '기록 버전을 확인해 주세요.' })
  expectedRevision: number;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '이용객 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이용객 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '이용객 이름은 100자 이하여야 합니다.' })
  guestName?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '입실 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, {
    message: '입실 일시는 시간대가 포함된 날짜와 시각으로 입력해 주세요.',
  })
  checkInAt?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '퇴실 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, {
    message: '퇴실 일시는 시간대가 포함된 날짜와 시각으로 입력해 주세요.',
  })
  checkOutAt?: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '수정 사유는 문자열이어야 합니다.' })
  @MaxLength(1000, { message: '수정 사유는 1000자 이하여야 합니다.' })
  reason?: string | null;
}

export class CancelStayInput {
  @IsInt({ message: '기록 버전은 정수여야 합니다.' })
  @Min(1, { message: '기록 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '기록 버전을 확인해 주세요.' })
  expectedRevision: number;

  @Transform(trimText)
  @IsString({ message: '취소 사유는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '취소 사유를 입력해 주세요.' })
  @MaxLength(1000, { message: '취소 사유는 1000자 이하여야 합니다.' })
  reason: string;
}

export class RestoreStayInput {
  @IsInt({ message: '기록 버전은 정수여야 합니다.' })
  @Min(1, { message: '기록 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '기록 버전을 확인해 주세요.' })
  expectedRevision: number;

  @Transform(trimText)
  @IsString({ message: '복원 사유는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '복원 사유를 입력해 주세요.' })
  @MaxLength(1000, { message: '복원 사유는 1000자 이하여야 합니다.' })
  reason: string;
}

export class GetStaysInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(StayStatus, { message: '이용 일정 상태를 확인해 주세요.' })
  status?: StayStatus;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '검색어는 문자열이어야 합니다.' })
  @MaxLength(100, { message: '검색어는 100자 이하여야 합니다.' })
  search?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 시작 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, {
    message: '조회 시작 일시는 시간대가 포함된 날짜와 시각으로 입력해 주세요.',
  })
  from?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '조회 종료 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, {
    message: '조회 종료 일시는 시간대가 포함된 날짜와 시각으로 입력해 주세요.',
  })
  to?: string;
}

export class GetStayHistoryInput extends PaginationInput {}
