import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trimNullableText, trimText } from '../common/list.input';

export class GetGuestIssueCategoriesInput {}

export class ReportGuestIssueInput {
  @IsUUID('4', { message: '신고 요청 ID를 확인해 주세요.' })
  requestKey: string;

  @IsUUID('4', { message: '이상사항 분류 ID를 확인해 주세요.' })
  categoryId: string;

  @Transform(trimText)
  @IsString({ message: '이용객 이름은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '이용객 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '이용객 이름은 100자 이하여야 합니다.' })
  guestName: string;

  @Transform(trimText)
  @IsString({ message: '신고 제목은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '신고 제목을 입력해 주세요.' })
  @MaxLength(300, { message: '신고 제목은 300자 이하여야 합니다.' })
  title: string;

  @Transform(trimNullableText)
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: '신고 내용은 문자열이어야 합니다.' })
  @MaxLength(2000, { message: '신고 내용은 2000자 이하여야 합니다.' })
  description?: string | null;
}
