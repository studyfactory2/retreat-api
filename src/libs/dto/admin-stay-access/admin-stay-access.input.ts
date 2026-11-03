import { StayAccessCodeMethod } from '@prisma/client';
import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { SaveStayAccessAction } from './admin-stay-access';

export class GetAdminStayAccessInput {}
export class StayAccessVersionsInput {
  @IsInt({ message: '예약 버전을 확인해 주세요.' })
  @Min(0)
  @Max(2147483647)
  expectedStayRevision: number;

  @IsInt({ message: '설정 버전을 확인해 주세요.' })
  @Min(0)
  @Max(2147483647)
  expectedSettingsVersion: number;

  @IsInt({ message: '비밀번호 버전을 확인해 주세요.' })
  @Min(0)
  @Max(2147483647)
  expectedCodeVersion: number;
}
export class SaveAdminStayAccessInput extends StayAccessVersionsInput {
  @IsEnum(SaveStayAccessAction, { message: '처리할 작업을 확인해 주세요.' })
  action: SaveStayAccessAction;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(StayAccessCodeMethod, { message: '비밀번호 방식을 선택해 주세요.' })
  method?: StayAccessCodeMethod;
}
