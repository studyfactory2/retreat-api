import { IsString, IsUUID, Matches } from 'class-validator';

export class GuestIssuePhotoInput {}

export class GuestIssuePhotoClaimInput {
  @IsUUID('4', { message: '사진 ID를 확인해 주세요.' })
  id: string;

  @IsString({ message: '사진 접근 정보를 확인해 주세요.' })
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: '사진 접근 정보를 확인해 주세요.',
  })
  token: string;
}
