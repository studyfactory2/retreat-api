import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class LoginInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '아이디는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '아이디를 입력해 주세요.' })
  @MaxLength(80, { message: '아이디는 80자 이하여야 합니다.' })
  loginId: string;

  @IsString({ message: '비밀번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '비밀번호를 입력해 주세요.' })
  @MaxLength(72, { message: '비밀번호가 너무 깁니다.' })
  password: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '로그인 유지 여부를 확인해 주세요.' })
  autoLogin?: boolean;
}
