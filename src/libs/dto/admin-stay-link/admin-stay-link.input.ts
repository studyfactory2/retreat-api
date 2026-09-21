import { IsInt, Max, Min } from 'class-validator';

class ChangeStayGuestLinkInput {
  @IsInt({ message: '이용 일정 버전을 확인해 주세요.' })
  @Min(1, { message: '이용 일정 버전을 확인해 주세요.' })
  @Max(2147483647, { message: '이용 일정 버전을 확인해 주세요.' })
  expectedRevision: number;

  @IsInt({ message: '게스트 링크 버전을 확인해 주세요.' })
  @Min(0, { message: '게스트 링크 버전을 확인해 주세요.' })
  @Max(2147483647, { message: '게스트 링크 버전을 확인해 주세요.' })
  expectedLinkVersion: number;
}

export class IssueStayGuestLinkInput extends ChangeStayGuestLinkInput {}

export class RevokeStayGuestLinkInput extends ChangeStayGuestLinkInput {}
