import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimText } from '../common/list.input';

export class EmptyAdminSubmissionStatusQueryInput {}

export class ChangeAdminSubmissionStatusInput {
  @IsInt({ message: '제출 내역 버전은 정수여야 합니다.' })
  @Min(1, { message: '제출 내역 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '제출 내역 버전을 확인해 주세요.' })
  expectedRevision: number;

  @Transform(trimText)
  @IsString({ message: '변경 사유는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '변경 사유를 입력해 주세요.' })
  @MaxLength(1000, { message: '변경 사유는 1000자 이하여야 합니다.' })
  reason: string;
}
