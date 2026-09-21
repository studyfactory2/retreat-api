import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { PaginationInput, trimText } from '../common/list.input';

export class GetSubmissionStayCandidatesInput extends PaginationInput {}

export class EmptySubmissionStayQueryInput {}

export class LinkSubmissionStayInput {
  @IsInt({ message: '제출 기록 버전은 정수여야 합니다.' })
  @Min(1, { message: '제출 기록 버전은 1 이상이어야 합니다.' })
  @Max(2147483646, { message: '제출 기록 버전을 확인해 주세요.' })
  expectedRevision: number;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID('4', { message: '연결할 이용 일정 ID를 확인해 주세요.' })
  stayId: string | null;

  @ValidateBy(
    {
      name: 'expectedStayRevisionForLink',
      validator: {
        validate(value: unknown, arguments_: ValidationArguments): boolean {
          const input = arguments_.object as { stayId?: unknown };
          return input.stayId === null
            ? value === undefined
            : typeof value === 'number' &&
                Number.isInteger(value) &&
                value >= 1 &&
                value <= 2147483646;
        },
      },
    },
    {
      message:
        '일정을 연결할 때는 유효한 이용 일정 버전을 입력하고 연결 해제 시에는 제외해 주세요.',
    },
  )
  expectedStayRevision?: number;

  @Transform(trimText)
  @IsString({ message: '연결 변경 사유는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '연결 변경 사유를 입력해 주세요.' })
  @MaxLength(1000, { message: '연결 변경 사유는 1000자 이하여야 합니다.' })
  reason: string;
}
