import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
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
import { ChecklistType } from '@prisma/client';
import { ListInput, trimText } from '../common/list.input';

export class ChecklistItemInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '체크 항목 ID를 확인해 주세요.' })
  id?: string;

  @Transform(trimText)
  @IsString({ message: '체크 항목 문구는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '체크 항목 문구를 입력해 주세요.' })
  @MaxLength(300, { message: '체크 항목 문구는 300자 이하여야 합니다.' })
  label: string;

  @IsBoolean({ message: '필수 여부는 true 또는 false여야 합니다.' })
  required: boolean;

  @Equals('NORMAL_ABNORMAL', {
    message: '응답 방식은 NORMAL_ABNORMAL이어야 합니다.',
  })
  answerType: 'NORMAL_ABNORMAL';
}

export class ChecklistSectionInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '체크리스트 구역 ID를 확인해 주세요.' })
  id?: string;

  @Transform(trimText)
  @IsString({ message: '구역 제목은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '구역 제목을 입력해 주세요.' })
  @MaxLength(150, { message: '구역 제목은 150자 이하여야 합니다.' })
  title: string;

  @IsArray({ message: '체크 항목은 배열이어야 합니다.' })
  @ArrayMinSize(1, { message: '구역마다 체크 항목을 1개 이상 입력해 주세요.' })
  @ArrayMaxSize(50, { message: '구역마다 체크 항목은 50개까지 가능합니다.' })
  @IsObject({ each: true, message: '체크 항목의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemInput)
  items: ChecklistItemInput[];
}

export class CreateChecklistTemplateInput {
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId: string;

  @IsEnum(ChecklistType, { message: '체크리스트 유형을 확인해 주세요.' })
  type: ChecklistType;

  @Transform(trimText)
  @IsString({ message: '체크리스트 제목은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '체크리스트 제목을 입력해 주세요.' })
  @MaxLength(150, { message: '체크리스트 제목은 150자 이하여야 합니다.' })
  title: string;

  @IsArray({ message: '체크리스트 구역은 배열이어야 합니다.' })
  @ArrayMinSize(1, { message: '체크리스트 구역을 1개 이상 입력해 주세요.' })
  @ArrayMaxSize(20, { message: '체크리스트 구역은 20개까지 가능합니다.' })
  @IsObject({ each: true, message: '체크리스트 구역의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => ChecklistSectionInput)
  sections: ChecklistSectionInput[];
}

export class UpdateChecklistTemplateInput {
  @IsInt({ message: '체크리스트 버전은 정수여야 합니다.' })
  @Min(1, { message: '체크리스트 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '체크리스트 버전을 확인해 주세요.' })
  expectedVersion: number;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '체크리스트 제목은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '체크리스트 제목을 입력해 주세요.' })
  @MaxLength(150, { message: '체크리스트 제목은 150자 이하여야 합니다.' })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray({ message: '체크리스트 구역은 배열이어야 합니다.' })
  @ArrayMinSize(1, { message: '체크리스트 구역을 1개 이상 입력해 주세요.' })
  @ArrayMaxSize(20, { message: '체크리스트 구역은 20개까지 가능합니다.' })
  @IsObject({ each: true, message: '체크리스트 구역의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => ChecklistSectionInput)
  sections?: ChecklistSectionInput[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '활성 여부는 true 또는 false여야 합니다.' })
  isActive?: boolean;
}

export class GetChecklistTemplatesInput extends ListInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ChecklistType, { message: '체크리스트 유형을 확인해 주세요.' })
  type?: ChecklistType;
}
