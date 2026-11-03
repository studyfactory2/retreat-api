import { CleaningTaskStatus } from '@prisma/client';
import { PaginationInput } from '../common/list.input';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class StartCleaningTaskInput {
  @IsUUID('4', { message: '담당 직원을 확인해 주세요.' })
  confirmedStaffId: string;

  @IsInt({ message: '작업 버전을 확인해 주세요.' })
  @Min(1)
  @Max(2147483646)
  expectedVersion: number;
}

export class RevealTaskPasswordInput {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: '비밀번호 상태를 다시 확인해 주세요.' })
  fingerprint: string;
}

export class TaskConfirmationInput extends RevealTaskPasswordInput {
  @IsBoolean({ message: '비밀번호 변경 완료 여부를 확인해 주세요.' })
  passwordChanged: boolean;

  @IsBoolean({ message: '퇴실 확인 여부를 확인해 주세요.' })
  guestDeparted: boolean;
}

export class GetStaffCleaningTasksInput extends PaginationInput {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(CleaningTaskStatus)
  status?: CleaningTaskStatus;
}
