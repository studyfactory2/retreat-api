import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  readAccessLinkEncryptionKeys,
  type AccessLinkEncryptionKeys,
} from '../../config/access-link-encryption';

@Injectable()
export class StayAccessCodeVault {
  private readonly configuration: AccessLinkEncryptionKeys | undefined;

  constructor(config: ConfigService) {
    this.configuration = readAccessLinkEncryptionKeys(
      config.get<unknown>('ACCESS_LINK_ENCRYPTION_KEYS'),
      config.get<unknown>('ACCESS_LINK_ACTIVE_KEY_ID'),
      config.get<string>('JWT_SECRET'),
    );
  }

  public seal(code: string, stayId: string): string {
    try {
      if (!/^[0-9*#]{1,32}$/.test(code)) throw this.unavailable();
      const config = this.configuration;
      const key = config?.keys.get(config.activeKeyId);
      if (!config || !key) throw this.unavailable();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16,
      });
      cipher.setAAD(this.aad(config.activeKeyId, stayId));
      const ciphertext = Buffer.concat([
        cipher.update(code, 'utf8'),
        cipher.final(),
      ]);
      return [
        'v1',
        config.activeKeyId,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    } catch {
      throw this.unavailable();
    }
  }

  public open(envelope: string, stayId: string): string {
    try {
      if (envelope.length > 256) throw this.unavailable();
      const parts = envelope.split('.');
      if (parts.length !== 5 || parts[0] !== 'v1') throw this.unavailable();
      const [, keyId, ivText, tagText, ciphertextText] = parts;
      const key = this.configuration?.keys.get(keyId);
      if (!key) throw this.unavailable();
      const iv = this.decode(ivText, 12, 12);
      const tag = this.decode(tagText, 16, 16);
      const ciphertext = this.decode(ciphertextText, 1, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(this.aad(keyId, stayId));
      decipher.setAuthTag(tag);
      const code = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      if (!/^[0-9*#]{1,32}$/.test(code)) throw this.unavailable();
      return code;
    } catch {
      throw this.unavailable();
    }
  }

  private aad(keyId: string, stayId: string): Buffer {
    if (!/^[a-f0-9-]{36}$/.test(stayId)) throw this.unavailable();
    return Buffer.from(`retreat-stay-access:v1:${keyId}:${stayId}`, 'utf8');
  }

  private decode(value: string, min: number, max: number): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw this.unavailable();
    const decoded = Buffer.from(value, 'base64url');
    if (
      decoded.length < min ||
      decoded.length > max ||
      decoded.toString('base64url') !== value
    )
      throw this.unavailable();
    return decoded;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'STAY_ACCESS_CODE_UNAVAILABLE',
      message: '출입 비밀번호를 처리하지 못했습니다.',
    });
  }
}
