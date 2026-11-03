import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CleaningTaskStatus } from '@prisma/client';
import {
  PaginationInput,
  trimNullableText,
  trimText,
} from '../common/list.input';

const timestampPattern =
  /^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export class GetCleaningTasksInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  propertyId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(CleaningTaskStatus)
  status?: CleaningTaskStatus;
}
export class SyncCleaningTasksInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  propertyId?: string;
}
class CleaningTaskScheduleInput {
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: '작업 일시를 확인해 주세요.' },
  )
  @Matches(timestampPattern, { message: '작업 일시는 시간대를 포함해 주세요.' })
  dueAt: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @MaxLength(500, { message: '작업 메모는 500자 이하여야 합니다.' })
  note?: string | null;
}
export class CreateCleaningTaskInput extends CleaningTaskScheduleInput {
  @IsUUID('4')
  requestKey: string;

  @IsUUID('4')
  propertyId: string;
}
export class UpdateCleaningTaskInput extends CleaningTaskScheduleInput {
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion: number;
}
export class CancelCleaningTaskInput {
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion: number;

  @Transform(trimText)
  @IsString()
  @IsNotEmpty({ message: '취소 사유를 입력해 주세요.' })
  @MaxLength(500)
  reason: string;
}
