import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListInput, trimText } from '../common/list.input';

const utcTimestampPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export class GetAdminIssueCategoriesInput extends ListInput {}

export class CreateAdminIssueCategoryInput {
  @Transform(trimText)
  @IsString({ message: '분류명은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '분류명을 입력해 주세요.' })
  @MaxLength(100, { message: '분류명은 100자 이하여야 합니다.' })
  name: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt({ message: '표시 순서는 정수여야 합니다.' })
  @Min(0, { message: '표시 순서는 0 이상이어야 합니다.' })
  @Max(2147483647, { message: '표시 순서를 확인해 주세요.' })
  sortOrder?: number;
}

export class UpdateAdminIssueCategoryInput {
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '분류 수정 일시를 확인해 주세요.' },
  )
  @Matches(utcTimestampPattern, {
    message: '분류 수정 일시는 밀리초가 포함된 UTC 형식이어야 합니다.',
  })
  expectedUpdatedAt: string;

  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '분류명은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '분류명을 입력해 주세요.' })
  @MaxLength(100, { message: '분류명은 100자 이하여야 합니다.' })
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt({ message: '표시 순서는 정수여야 합니다.' })
  @Min(0, { message: '표시 순서는 0 이상이어야 합니다.' })
  @Max(2147483647, { message: '표시 순서를 확인해 주세요.' })
  sortOrder?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '활성 여부는 true 또는 false여야 합니다.' })
  isActive?: boolean;
}
