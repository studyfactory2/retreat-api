import { createHash } from 'node:crypto';
import type { QrFlow } from '../../libs/dto/qr/qr';

export function hashQrToken(flow: QrFlow, token: string): string {
  return createHash('sha256').update(`${flow}:${token}`).digest('hex');
}
