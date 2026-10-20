import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trimNullableText, trimText } from '../common/list.input';

export class UpdateAccountInput {
  @Transform(trimText)
  @IsString({ message: '이름을 확인해 주세요.' })
  @IsNotEmpty({ message: '이름을 입력해 주세요.' })
  @MaxLength(100, { message: '이름은 100자 이하여야 합니다.' })
  name: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '연락처를 확인해 주세요.' })
  @MaxLength(32, { message: '연락처는 32자 이하여야 합니다.' })
  phone?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '회사를 확인해 주세요.' })
  @MaxLength(100, { message: '회사는 100자 이하여야 합니다.' })
  company?: string | null;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '부서를 확인해 주세요.' })
  @MaxLength(100, { message: '부서는 100자 이하여야 합니다.' })
  department?: string | null;

  @IsISO8601({ strict: true }, { message: '최신 정보를 다시 불러와 주세요.' })
  expectedUpdatedAt: string;
}

export class ChangePasswordInput {
  @IsString({ message: '현재 비밀번호를 확인해 주세요.' })
  @IsNotEmpty({ message: '현재 비밀번호를 입력해 주세요.' })
  @MaxLength(72, { message: '현재 비밀번호가 너무 깁니다.' })
  currentPassword: string;

  @IsString({ message: '새 비밀번호를 확인해 주세요.' })
  @IsNotEmpty({ message: '새 비밀번호를 입력해 주세요.' })
  @MaxLength(72, { message: '새 비밀번호가 너무 깁니다.' })
  newPassword: string;

  @IsString({ message: '새 비밀번호 확인을 입력해 주세요.' })
  @IsNotEmpty({ message: '새 비밀번호를 다시 입력해 주세요.' })
  @MaxLength(72, { message: '새 비밀번호 확인이 너무 깁니다.' })
  confirmPassword: string;
}
