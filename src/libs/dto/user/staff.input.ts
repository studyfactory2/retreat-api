import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ListInput, trimNullableText, trimText } from '../common/list.input';

export class CreateStaffInput {
  @Transform(trimText)
  @IsString({ message: '직원 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '직원 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '직원 이름은 100자 이하여야 합니다.' })
  name: string;

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
}

export class UpdateStaffInput {
  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '직원 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '직원 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '직원 이름은 100자 이하여야 합니다.' })
  name?: string;

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

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '활성 여부는 true 또는 false여야 합니다.' })
  isActive?: boolean;
}

export class GetStaffInput extends ListInput {}
