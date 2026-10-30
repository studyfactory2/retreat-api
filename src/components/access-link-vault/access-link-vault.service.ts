import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  readAccessLinkEncryptionKeys,
  type AccessLinkEncryptionKeys,
} from '../../config/access-link-encryption';
import { AccessLinkIssuanceUnavailableException } from '../../libs/exceptions/access-link-issuance-unavailable.exception';

@Injectable()
export class AccessLinkVault {
  private readonly configuration: AccessLinkEncryptionKeys | undefined;

  constructor(config: ConfigService) {
    this.configuration = readAccessLinkEncryptionKeys(
      config.get<unknown>('ACCESS_LINK_ENCRYPTION_KEYS'),
      config.get<unknown>('ACCESS_LINK_ACTIVE_KEY_ID'),
      config.get<string>('JWT_SECRET'),
    );
  }

  public seal(token: string, context: string): string {
    const config = this.configuration;
    const key = config?.keys.get(config.activeKeyId);
    if (!config || !key) throw new AccessLinkIssuanceUnavailableException();
    if (!this.isToken(token)) throw this.unavailable();
    this.validateContext(context);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(this.aad(config.activeKeyId, context));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      config.activeKeyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  public open(envelope: string, context: string): string {
    try {
      this.validateContext(context);
      if (envelope.length > 256) throw this.unavailable();
      const parts = envelope.split('.');
      if (parts.length !== 5 || parts[0] !== 'v1') throw this.unavailable();
      const [, keyId, ivText, tagText, encryptedText] = parts;
      const key = this.configuration?.keys.get(keyId);
      if (!key) throw this.unavailable();
      const iv = this.decode(ivText, 12);
      const tag = this.decode(tagText, 16);
      const ciphertext = this.decode(encryptedText, 43);
      const decipher = createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(this.aad(keyId, context));
      decipher.setAuthTag(tag);
      const token = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      if (!this.isToken(token)) throw this.unavailable();
      return token;
    } catch {
      // Deliberately discard crypto errors and their input-dependent details.
      throw this.unavailable();
    }
  }

  private aad(keyId: string, context: string): Buffer {
    return Buffer.from(`retreat-access-link:v1:${keyId}:${context}`, 'utf8');
  }

  private validateContext(context: string): void {
    if (context.length < 1 || context.length > 512) throw this.unavailable();
  }

  private decode(value: string, length: number): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw this.unavailable();
    const buffer = Buffer.from(value, 'base64url');
    if (buffer.length !== length || buffer.toString('base64url') !== value) {
      throw this.unavailable();
    }
    return buffer;
  }

  private isToken(value: string): boolean {
    return (
      /^[A-Za-z0-9_-]{43}$/.test(value) &&
      Buffer.from(value, 'base64url').toString('base64url') === value
    );
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'ACCESS_LINK_UNAVAILABLE',
      message: '링크를 불러오지 못했습니다. 서버 설정을 확인해 주세요.',
    });
  }
}
