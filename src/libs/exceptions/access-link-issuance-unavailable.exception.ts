import { ServiceUnavailableException } from '@nestjs/common';

export const ACCESS_LINK_ISSUANCE_UNAVAILABLE_CODE =
  'ACCESS_LINK_ISSUANCE_UNAVAILABLE';
export const ACCESS_LINK_ISSUANCE_UNAVAILABLE_MESSAGE =
  '링크 발급 설정이 필요합니다. 서버 설정을 확인해 주세요. 이번 요청으로 기존 링크는 변경되지 않았습니다.';

// Only use before an issuance transaction starts. This public failure guarantees
// that the attempted replacement did not change the currently issued credential.
export class AccessLinkIssuanceUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: ACCESS_LINK_ISSUANCE_UNAVAILABLE_CODE,
      message: ACCESS_LINK_ISSUANCE_UNAVAILABLE_MESSAGE,
    });
  }
}
