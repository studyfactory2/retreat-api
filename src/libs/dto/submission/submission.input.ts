import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PhotoPurpose } from '@prisma/client';
import { trimNullableText } from '../common/list.input';

const utcTimestampPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export class SubmissionPhotoInput {
  @IsUUID('4', { message: '사진 ID를 확인해 주세요.' })
  attachmentId: string;

  @IsEnum(PhotoPurpose, { message: '사진 용도를 확인해 주세요.' })
  purpose: PhotoPurpose;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsUUID('4', { message: '사진의 구역 ID를 확인해 주세요.' })
  sectionId?: string | null;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsUUID('4', { message: '사진의 체크 항목 ID를 확인해 주세요.' })
  itemId?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '사진의 위치 설명은 문자열이어야 합니다.' })
  @MaxLength(150, { message: '사진의 위치 설명은 150자 이하여야 합니다.' })
  areaLabel?: string | null;
}

export class SubmitChecklistInput {
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '임시 저장 일시를 확인해 주세요.' },
  )
  @Matches(utcTimestampPattern, {
    message: '임시 저장 일시는 밀리초가 포함된 UTC 형식이어야 합니다.',
  })
  expectedUpdatedAt: string;

  @IsArray({ message: '제출할 사진 정보는 배열이어야 합니다.' })
  @ArrayMaxSize(40, { message: '사진은 최대 40장까지 제출할 수 있습니다.' })
  @IsObject({ each: true, message: '제출할 사진 정보의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => SubmissionPhotoInput)
  photos: SubmissionPhotoInput[];
}
