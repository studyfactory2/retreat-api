import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageDispatchStatus, MessageKind } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import type { RuntimeEnvironment } from '../../config/environment';
import type {
  MessagingBlocker,
  MessagingStatusDto,
} from '../../libs/dto/messaging/messaging';
import { MESSAGE_LABELS } from './message-templates';

export interface ProviderMessage {
  kind: MessageKind;
  to: string;
  body: string;
  variables: Record<string, string>;
  buttons: { label: string; url: string }[];
}
export interface ProviderResult {
  status: MessageDispatchStatus;
  providerMessageId: string | null;
  providerGroupId: string | null;
  errorCode: string | null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value
    : null;
}
function statusCode(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}$/.test(value) ? value : null;
}
export function deliveryStatus(code: string | null): MessageDispatchStatus {
  if (code === '4000') return MessageDispatchStatus.DELIVERED;
  if (code === '2000' || code === '2100' || code === '3000')
    return MessageDispatchStatus.ACCEPTED;
  if (code === '3014' || code === '3048') return MessageDispatchStatus.UNKNOWN;
  if (code && /^[123]\d{3}$/.test(code)) return MessageDispatchStatus.FAILED;
  return MessageDispatchStatus.UNKNOWN;
}

@Injectable()
export class SolapiProvider {
  constructor(
    private readonly config: ConfigService<RuntimeEnvironment, true>,
  ) {}

  public getStatus(): MessagingStatusDto {
    const reasons = this.blockers();
    const templates = Object.values(MessageKind).map((kind) => ({
      kind,
      label: MESSAGE_LABELS[kind],
      configured: Boolean(this.templateId(kind)),
    }));
    if (!templates.every((template) => template.configured))
      reasons.push({
        code: 'TEMPLATES_NOT_CONFIGURED',
        message: '일부 알림톡 템플릿이 설정되지 않았습니다.',
      });
    return {
      enabled: this.config.get('MESSAGING_ENABLED', { infer: true }) === true,
      ready:
        reasons.length === 0 &&
        templates.every((template) => template.configured),
      channel: 'ALIMTALK',
      smsFallbackEnabled: false,
      reasons,
      templates,
    };
  }
  public blockers(kind?: MessageKind): MessagingBlocker[] {
    const reasons: MessagingBlocker[] = [];
    if (this.config.get('MESSAGING_ENABLED', { infer: true }) !== true)
      reasons.push({
        code: 'MESSAGING_DISABLED',
        message: '메시지 발송이 비활성화되어 있습니다.',
      });
    if (
      this.config.get('MESSAGING_TEMPLATES_APPROVED', { infer: true }) !== true
    )
      reasons.push({
        code: 'TEMPLATES_NOT_APPROVED',
        message: '알림톡 채널과 안내 문구 승인 확인이 필요합니다.',
      });
    if (
      !this.config.get('SOLAPI_API_KEY', { infer: true }) ||
      !this.config.get('SOLAPI_API_SECRET', { infer: true }) ||
      !this.config.get('SOLAPI_PF_ID', { infer: true })
    )
      reasons.push({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: '알림톡 발송 설정이 완료되지 않았습니다.',
      });
    if (kind && !this.templateId(kind))
      reasons.push({
        code: 'TEMPLATE_NOT_CONFIGURED',
        message: '선택한 안내의 알림톡 템플릿이 설정되지 않았습니다.',
      });
    return reasons;
  }
  public templateId(kind: MessageKind): string | undefined {
    return this.config.get(`SOLAPI_TEMPLATE_${kind}`, { infer: true });
  }
  public fingerprint(kind: MessageKind): string[] {
    // Include routing/template settings in the preview fingerprint, without
    // ever returning their values to an administrator or persisting them.
    return [
      this.config.get('SOLAPI_PF_ID', { infer: true }) ?? '',
      this.templateId(kind) ?? '',
      this.config.get('SOLAPI_SENDER', { infer: true }) ?? '',
    ];
  }
  public async send(message: ProviderMessage): Promise<ProviderResult> {
    if (this.blockers(message.kind).length)
      return this.unknown('PROVIDER_DISABLED');
    try {
      const response = await this.request('/messages/v4/send-many/detail', {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            {
              to: message.to,
              from: this.config.get('SOLAPI_SENDER', { infer: true }),
              type: 'ATA',
              text: message.body,
              country: '82',
              autoTypeDetect: false,
              kakaoOptions: {
                pfId: this.config.get('SOLAPI_PF_ID', { infer: true }),
                templateId: this.templateId(message.kind),
                variables: message.variables,
                disableSms: true,
                ...(message.buttons.length
                  ? {
                      buttons: message.buttons.map((button) => ({
                        buttonType: 'WL',
                        buttonName: button.label,
                        linkMo: button.url,
                        linkPc: button.url,
                      })),
                    }
                  : {}),
              },
            },
          ],
          strict: true,
          allowDuplicates: false,
          showMessageList: true,
        }),
      });
      if (!response.ok) {
        // Explicit request rejection is known not to have been accepted.
        // Network/timeout/5xx/408 cases remain ambiguous and must never retry.
        if ([400, 401, 403, 404, 413, 422, 429].includes(response.status)) {
          await response.body?.cancel();
          return {
            ...this.unknown(`HTTP_${response.status}`),
            status: MessageDispatchStatus.FAILED,
          };
        }
        await response.body?.cancel();
        return this.unknown('PROVIDER_RESPONSE_UNKNOWN');
      }
      const data = record(await response.json());
      const failed = data?.failedMessageList;
      const list = data?.messageList;
      if (failed !== undefined && !Array.isArray(failed))
        return this.unknown('PROVIDER_RESPONSE_UNKNOWN');
      if (Array.isArray(failed) && failed.length > 0) {
        const failure = failed.length === 1 ? record(failed[0]) : null;
        const failureCode = statusCode(failure?.statusCode);
        const noSuccesses =
          list === undefined || (Array.isArray(list) && list.length === 0);
        if (
          noSuccesses &&
          failure?.to === message.to &&
          failure?.type === 'ATA' &&
          deliveryStatus(failureCode) === MessageDispatchStatus.FAILED
        ) {
          return {
            ...this.unknown(failureCode),
            status: MessageDispatchStatus.FAILED,
          };
        }
        return this.unknown('PROVIDER_RESPONSE_UNKNOWN');
      }
      const item =
        Array.isArray(list) && list.length === 1 ? record(list[0]) : null;
      const messageId = identifier(item?.messageId);
      const groupId = identifier(record(data?.groupInfo)?.groupId);
      if (!messageId)
        return {
          ...this.unknown('PROVIDER_RESPONSE_UNKNOWN'),
          providerGroupId: groupId,
        };
      const code = statusCode(item?.statusCode);
      return {
        status: deliveryStatus(code),
        providerMessageId: messageId,
        providerGroupId: groupId,
        errorCode:
          code && deliveryStatus(code) === MessageDispatchStatus.FAILED
            ? code
            : null,
      };
    } catch {
      // Do not log errors: transport errors may contain headers or request bodies.
      return this.unknown('PROVIDER_OUTCOME_UNKNOWN');
    }
  }
  public async refresh(messageId: string): Promise<ProviderResult> {
    if (
      !this.config.get('SOLAPI_API_KEY', { infer: true }) ||
      !this.config.get('SOLAPI_API_SECRET', { infer: true })
    )
      return this.unknown('PROVIDER_NOT_CONFIGURED');
    try {
      const params = new URLSearchParams({
        messageIds: JSON.stringify([messageId]),
        limit: '1',
      });
      const response = await this.request(
        `/messages/v4/list?${params.toString()}`,
        { method: 'GET' },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return this.unknown('PROVIDER_LOOKUP_UNAVAILABLE');
      }
      const data = record(await response.json());
      const item = record(record(data?.messageList)?.[messageId]);
      if (
        !item ||
        item.messageId !== messageId ||
        item.type !== 'ATA' ||
        item.replacement === true
      )
        return this.unknown('PROVIDER_LOOKUP_UNKNOWN');
      const code = statusCode(item.statusCode);
      const status = deliveryStatus(code);
      return {
        status,
        providerMessageId: messageId,
        providerGroupId: identifier(item.groupId),
        errorCode:
          status === MessageDispatchStatus.FAILED
            ? code
            : status === MessageDispatchStatus.UNKNOWN
              ? 'PROVIDER_STATUS_UNKNOWN'
              : null,
      };
    } catch {
      return this.unknown('PROVIDER_LOOKUP_UNAVAILABLE');
    }
  }
  private async request(path: string, init: RequestInit): Promise<Response> {
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString('hex');
    const signature = createHmac(
      'sha256',
      this.config.get('SOLAPI_API_SECRET', { infer: true }),
    )
      .update(date + salt)
      .digest('hex');
    return await fetch(`https://api.solapi.com${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `HMAC-SHA256 apiKey=${this.config.get('SOLAPI_API_KEY', { infer: true })}, date=${date}, salt=${salt}, signature=${signature}`,
      },
    });
  }
  private unknown(errorCode: string): ProviderResult {
    return {
      status: MessageDispatchStatus.UNKNOWN,
      providerMessageId: null,
      providerGroupId: null,
      errorCode,
    };
  }
}
