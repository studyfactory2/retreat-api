import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class GetGuestStayVehicleInput {}

export class SaveGuestStayVehicleInput {
  @IsInt({ message: '차량 정보 버전을 확인해 주세요.' })
  @Min(0, { message: '차량 정보 버전은 0 이상이어야 합니다.' })
  @Max(2147483646, { message: '차량 정보 버전을 확인해 주세요.' })
  expectedVersion: number;

  // Basic input bounds, not verification of a government-issued registration.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.normalize('NFC').trim().replace(/ /g, '').toUpperCase()
      : value,
  )
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString({ message: '차량번호는 문자열 또는 null이어야 합니다.' })
  @MinLength(3, { message: '차량번호는 3자 이상이어야 합니다.' })
  @MaxLength(20, { message: '차량번호는 20자 이하여야 합니다.' })
  @Matches(/^(?=.*[0-9])[0-9A-Z가-힣-]+$/u, {
    message:
      '차량번호는 숫자를 포함한 한글, 영문, 숫자, 하이픈으로 입력해 주세요.',
  })
  plateNumber: string | null;
}
