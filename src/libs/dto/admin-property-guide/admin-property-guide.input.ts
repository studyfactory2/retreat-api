import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  NotContains,
} from 'class-validator';
import { trimText } from '../common/list.input';

export class GetAdminPropertyGuideInput {}

export class SaveAdminPropertyGuideInput {
  @IsInt({ message: '안내문 버전을 확인해 주세요.' })
  @Min(0, { message: '안내문 버전은 0 이상이어야 합니다.' })
  @Max(2147483646, { message: '안내문 버전을 확인해 주세요.' })
  expectedVersion: number;

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

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : value,
  )
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
