import { PropertyRoomCodeMode } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PropertyAccessCodeKind } from './admin-property-access';

export class GetAdminPropertyAccessSettingsInput {}

class PropertyAccessVersionInput {
  @IsInt({ message: '설정 버전을 확인해 주세요.' })
  @Min(0, { message: '설정 버전을 확인해 주세요.' })
  @Max(2147483647, { message: '설정 버전을 확인해 주세요.' })
  expectedVersion: number;
}

// No transforms: leading zeros and explicit null deletion are significant.
export class SaveAdminPropertyAccessSettingsInput extends PropertyAccessVersionInput {
  @IsEnum(PropertyRoomCodeMode, {
    message: '객실 비밀번호 방식을 선택해 주세요.',
  })
  roomMode: PropertyRoomCodeMode;

  @IsOptional()
  @IsString({ message: '공동현관 비밀번호를 확인해 주세요.' })
  @Matches(/^[0-9*#]{1,32}$/, {
    message: '비밀번호는 숫자, *, #으로 1~32자 입력해 주세요.',
  })
  entranceCode?: string | null;

  @IsOptional()
  @IsString({ message: '고정 비밀번호를 확인해 주세요.' })
  @Matches(/^[0-9*#]{1,32}$/, {
    message: '비밀번호는 숫자, *, #으로 1~32자 입력해 주세요.',
  })
  fixedRoomCode?: string | null;

  @IsOptional()
  @IsString({ message: '공실 비밀번호를 확인해 주세요.' })
  @Matches(/^[0-9*#]{1,32}$/, {
    message: '비밀번호는 숫자, *, #으로 1~32자 입력해 주세요.',
  })
  vacancyCode?: string | null;
}

export class RevealAdminPropertyAccessCodeInput extends PropertyAccessVersionInput {
  @IsEnum(PropertyAccessCodeKind, {
    message: '확인할 비밀번호 종류를 선택해 주세요.',
  })
  kind: PropertyAccessCodeKind;
}
