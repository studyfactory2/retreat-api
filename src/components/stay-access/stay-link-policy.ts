import { createHash } from 'node:crypto';

export const STAY_LINK_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function hashGuestStayToken(token: string): string {
  return createHash('sha256').update(`guest-stay:${token}`).digest('hex');
}
