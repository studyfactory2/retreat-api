import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export function trimText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function trimNullableText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() || null : value;
}

function queryInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
}

function queryBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class ListInput {
  @Transform(queryInteger)
  @IsInt({ message: '페이지는 정수여야 합니다.' })
  @Min(1, { message: '페이지는 1 이상이어야 합니다.' })
  @Max(100000, { message: '페이지는 100000 이하여야 합니다.' })
  page: number = 1;

  @Transform(queryInteger)
  @IsInt({ message: '페이지당 개수는 정수여야 합니다.' })
  @Min(1, { message: '페이지당 개수는 1 이상이어야 합니다.' })
  @Max(100, { message: '페이지당 개수는 100 이하여야 합니다.' })
  limit: number = 20;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '검색어는 문자열이어야 합니다.' })
  @MaxLength(100, { message: '검색어는 100자 이하여야 합니다.' })
  search?: string;

  @Transform(queryBoolean)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '활성 여부는 true 또는 false여야 합니다.' })
  isActive?: boolean;
}
