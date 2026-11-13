import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { trimText } from '../common/list.input';

const normalizeContent = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : value;
const multipartVersion = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^(0|[1-9]\d{0,9})$/.test(value)
    ? Number(value)
    : value;

export class GetAdminPropertyGuideInput {}

export class GetPropertyGuidePdfInput {
  @Transform(multipartVersion)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt({ message: '안내문 버전을 확인해 주세요.' })
  @Min(1)
  @Max(2147483647)
  version?: number;
}

class PropertyGuideTitleInput {
  @Transform(trimText)
  @IsString({ message: '안내문 제목은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '안내문 제목을 입력해 주세요.' })
  @MaxLength(100, { message: '안내문 제목은 100자 이하여야 합니다.' })
  @Matches(/^[^\r\n]*$/u, {
    message: '안내문 제목에는 줄바꿈을 사용할 수 없습니다.',
  })
  @NotContains('\u0000', {
    message: '안내문 제목에는 널 문자를 사용할 수 없습니다.',
  })
  title: string;
}

export class SaveAdminPropertyGuideInput extends PropertyGuideTitleInput {
  @IsInt({ message: '안내문 버전을 확인해 주세요.' })
  @Min(0)
  @Max(2147483646)
  expectedVersion: number;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(['TEXT'])
  type?: 'TEXT';

  @Transform(normalizeContent)
  @IsString({ message: '안내문 내용은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '안내문 내용을 입력해 주세요.' })
  @MaxLength(20000, { message: '안내문 내용은 20,000자 이하여야 합니다.' })
  @NotContains('\u0000', {
    message: '안내문 내용에는 널 문자를 사용할 수 없습니다.',
  })
  content: string;

  @IsBoolean({ message: '공개 여부는 true 또는 false여야 합니다.' })
  isPublished: boolean;
}

export class SaveAdminPropertyGuidePdfInput extends PropertyGuideTitleInput {
  @Transform(multipartVersion)
  @IsInt({ message: '안내문 버전을 확인해 주세요.' })
  @Min(0)
  @Max(2147483646)
  expectedVersion: number;

  @Transform(normalizeContent)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString({ message: '안내문 내용은 문자열이어야 합니다.' })
  @MaxLength(20000, { message: '안내문 내용은 20,000자 이하여야 합니다.' })
  @NotContains('\u0000', {
    message: '안내문 내용에는 널 문자를 사용할 수 없습니다.',
  })
  content?: string;

  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: '공개 여부는 true 또는 false여야 합니다.' })
  isPublished: boolean;
}
