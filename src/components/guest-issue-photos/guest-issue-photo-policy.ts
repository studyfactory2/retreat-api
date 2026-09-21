import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const MAX_GUEST_ISSUE_PHOTOS = 10;
export const GUEST_ISSUE_PHOTO_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function hashGuestIssuePhotoToken(
  id: string,
  token: string | undefined,
): string {
  if (
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token, 'base64url').toString('base64url') !== token
  ) {
    throw new UnauthorizedException({
      code: 'INVALID_ISSUE_PHOTO_ACCESS',
      message: '사진 접근 정보가 올바르지 않습니다. 사진을 다시 등록해 주세요.',
    });
  }
  return createHash('sha256')
    .update(`guest-issue-photo:${id.toLowerCase()}:${token}`)
    .digest('hex');
}
