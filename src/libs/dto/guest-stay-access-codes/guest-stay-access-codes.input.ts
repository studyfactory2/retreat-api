import { IsIn, Matches } from 'class-validator';
import type { GuestAccessCodeKind } from './guest-stay-access-codes';

export class GetGuestStayAccessCodesInput {}

export class RevealGuestStayAccessCodeInput {
  @IsIn(['ENTRANCE', 'ROOM'], { message: '비밀번호 종류를 확인해 주세요.' })
  kind: GuestAccessCodeKind;

  @Matches(/^[a-f0-9]{64}$/, { message: '최신 상태를 확인해 주세요.' })
  fingerprint: string;
}
