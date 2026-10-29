import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class StaffHandoverAssignmentInput {
  @IsUUID('4', { message: '휴양소 ID를 확인해 주세요.' })
  propertyId: string;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('4', { message: '후임 직원 ID를 확인해 주세요.' })
  replacementStaffId: string | null;
}

export class DeactivateStaffInput {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, {
    message: '직원 인계 정보를 다시 불러와 주세요.',
  })
  expectedStateToken: string;

  @IsArray()
  @ArrayMaxSize(1000, {
    message: '한 번에 인계할 휴양소는 최대 1,000곳입니다.',
  })
  @ValidateNested({ each: true })
  @Type(() => StaffHandoverAssignmentInput)
  assignments: StaffHandoverAssignmentInput[];
}
