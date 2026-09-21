import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { trimNullableText, trimText } from '../common/list.input';

export class GetGuestSubmissionInput {}

export class GuestCorrectionAnswerInput {
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
}

export class CorrectGuestSubmissionInput {
  @IsInt({ message: '제출 내역 버전은 정수여야 합니다.' })
  @Min(1, { message: '제출 내역 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '제출 내역 버전을 확인해 주세요.' })
  expectedRevision: number;

  @IsArray({ message: '체크 결과는 배열이어야 합니다.' })
  @ArrayMaxSize(500, { message: '체크 결과는 500개까지 저장할 수 있습니다.' })
  @IsObject({ each: true, message: '체크 결과의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => GuestCorrectionAnswerInput)
  items: GuestCorrectionAnswerInput[];

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '전체 메모는 문자열이어야 합니다.' })
  @MaxLength(4000, { message: '전체 메모는 4000자 이하여야 합니다.' })
  generalNote?: string | null;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '수정 사유는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '수정 사유를 입력해 주세요.' })
  @MaxLength(1000, { message: '수정 사유는 1000자 이하여야 합니다.' })
  reason?: string;
}
