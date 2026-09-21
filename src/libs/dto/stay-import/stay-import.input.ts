import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { ImportRowAction, ImportRowStatus } from '@prisma/client';
import { PaginationInput } from '../common/list.input';
import { CreateStayInput } from '../stay/stay.input';

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

class StayImportVersionInput {
  @IsInt({ message: '가져오기 버전은 정수여야 합니다.' })
  @Min(1, { message: '가져오기 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '가져오기 버전을 확인해 주세요.' })
  expectedVersion: number;
}

export class ReviewStayImportRowInput {
  @IsUUID('4', { message: '명단 행 ID를 확인해 주세요.' })
  id: string;

  @IsIn([ImportRowAction.CREATE, ImportRowAction.SKIP], {
    message: '행 처리 방법은 CREATE 또는 SKIP이어야 합니다.',
  })
  action: typeof ImportRowAction.CREATE | typeof ImportRowAction.SKIP;

  @ValidateBy(
    {
      name: 'stayImportRowData',
      validator: {
        validate(value: unknown, arguments_: ValidationArguments): boolean {
          const row = arguments_.object as { action?: unknown };
          return row.action === ImportRowAction.CREATE
            ? value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value)
            : value === undefined;
        },
      },
    },
    {
      message:
        'CREATE 행에는 이용 일정 정보를 입력하고 SKIP 행에서는 제외해 주세요.',
    },
  )
  @ValidateNested()
  @Type(() => CreateStayInput)
  data?: CreateStayInput;
}

export class ReviewStayImportInput extends StayImportVersionInput {
  @IsArray({ message: '검토할 명단 행은 배열이어야 합니다.' })
  @ArrayMinSize(1, { message: '검토할 명단 행을 1개 이상 선택해 주세요.' })
  @ArrayMaxSize(100, {
    message: '명단 행은 한 번에 100개까지 검토할 수 있습니다.',
  })
  @IsObject({ each: true, message: '명단 행의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => ReviewStayImportRowInput)
  rows: ReviewStayImportRowInput[];
}

export class ConfirmStayImportInput extends StayImportVersionInput {}
