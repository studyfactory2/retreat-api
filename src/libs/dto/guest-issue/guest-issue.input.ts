import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { trimNullableText, trimText } from '../common/list.input';
import { GuestIssuePhotoClaimInput } from '../guest-issue-photo/guest-issue-photo.input';

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

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray({ message: '사진 목록은 배열이어야 합니다.' })
  @ArrayMaxSize(10, { message: '사진은 10개까지 첨부할 수 있습니다.' })
  @ArrayUnique(
    (photo: GuestIssuePhotoClaimInput) =>
      typeof photo?.id === 'string' ? photo.id.toLowerCase() : photo?.id,
    { message: '같은 사진을 중복으로 첨부할 수 없습니다.' },
  )
  @IsObject({ each: true, message: '사진 정보의 형식을 확인해 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => GuestIssuePhotoClaimInput)
  photos?: GuestIssuePhotoClaimInput[];
}
