import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ListInput, trimNullableText, trimText } from '../common/list.input';

export class CreatePropertyInput {
  @Transform(trimText)
  @IsString({ message: '휴양소 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '휴양소 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '휴양소 이름은 100자 이하여야 합니다.' })
  name: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '지역은 문자열이어야 합니다.' })
  @MaxLength(100, { message: '지역은 100자 이하여야 합니다.' })
  region?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '차량 등록 사용 여부는 true 또는 false여야 합니다.' })
  vehicleRegistrationEnabled?: boolean;
}

export class UpdatePropertyInput {
  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '휴양소 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '휴양소 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '휴양소 이름은 100자 이하여야 합니다.' })
  name?: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '지역은 문자열이어야 합니다.' })
  @MaxLength(100, { message: '지역은 100자 이하여야 합니다.' })
  region?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '활성 여부는 true 또는 false여야 합니다.' })
  isActive?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: '차량 등록 사용 여부는 true 또는 false여야 합니다.' })
  vehicleRegistrationEnabled?: boolean;
}

export class AssignStaffInput {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('4', { message: '직원 ID는 올바른 UUID이거나 null이어야 합니다.' })
  staffUserId: string | null;
}

export class GetPropertiesInput extends ListInput {
  @Transform(trimText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: '지역은 문자열이어야 합니다.' })
  @MaxLength(100, { message: '지역은 100자 이하여야 합니다.' })
  region?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4', { message: '직원 ID를 확인해 주세요.' })
  staffUserId?: string;
}
