import { plainToInstance, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ImportRowAction, ImportRowStatus } from '@prisma/client';
import { PaginationInput } from '../common/list.input';

export class StayImportPropertyMappingInput {
  @IsString({ message: '시트명은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '시트명을 입력해 주세요.' })
  @Matches(/\S/, { message: '시트명을 입력해 주세요.' })
  @MaxLength(31, { message: '시트명은 31자 이하여야 합니다.' })
  sheetName: string;

  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId: string;
}

function parsePropertyMappings({ value }: { value: unknown }): unknown {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return parsed;

    return parsed.map((mapping: unknown) => {
      if (
        mapping === null ||
        typeof mapping !== 'object' ||
        Array.isArray(mapping)
      ) {
        return mapping;
      }

      if (
        Object.keys(mapping).some(
          (key) => key !== 'sheetName' && key !== 'propertyId',
        )
      ) {
        return null;
      }

      return plainToInstance(StayImportPropertyMappingInput, mapping);
    });
  } catch {
    return value;
  }
}

export class CreateStayImportPreviewInput {
  @Transform(parsePropertyMappings)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray({ message: '시트 연결 정보는 JSON 배열이어야 합니다.' })
  @ArrayMaxSize(40, {
    message: '시트 연결 정보는 40개까지 입력할 수 있습니다.',
  })
  @IsObject({ each: true, message: '시트 연결 정보의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  propertyMappings?: StayImportPropertyMappingInput[];
}

export class GetStayImportPreviewInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ImportRowStatus, { message: '행 검증 상태를 확인해 주세요.' })
  validationStatus?: ImportRowStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ImportRowAction, { message: '행 처리 방법을 확인해 주세요.' })
  action?: ImportRowAction;
}

export class EmptyStayImportQueryInput {}
