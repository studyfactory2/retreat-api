import { ConfigService } from '@nestjs/config';

export interface AutomationConfiguration {
  enabled: boolean;
  startAt: Date | null;
  checkoutReminderHour: number;
}

export function automationConfiguration(
  config: ConfigService,
): AutomationConfiguration {
  const flag = config.get<unknown>('MESSAGING_AUTOMATION_ENABLED') ?? 'false';
  if (flag !== 'true' && flag !== 'false') {
    throw new Error('MESSAGING_AUTOMATION_ENABLED must be true or false.');
  }
  const rawHour =
    config.get<unknown>('MESSAGING_CHECKOUT_REMINDER_HOUR') ?? '15';
  if (
    typeof rawHour !== 'string' ||
    !/^\d{1,2}$/.test(rawHour) ||
    Number(rawHour) > 23
  ) {
    throw new Error(
      'MESSAGING_CHECKOUT_REMINDER_HOUR must be 0 through 23 in Korea time.',
    );
  }
  const rawStart = config.get<unknown>('MESSAGING_AUTOMATION_START_AT');
  const startAt =
    typeof rawStart === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(rawStart)
      ? new Date(rawStart)
      : null;
  if (flag === 'true' && (!startAt || !Number.isFinite(startAt.getTime()))) {
    throw new Error(
      'MESSAGING_AUTOMATION_START_AT must be an explicit ISO date with timezone before automation is enabled.',
    );
  }
  return {
    enabled: flag === 'true',
    startAt: startAt && Number.isFinite(startAt.getTime()) ? startAt : null,
    checkoutReminderHour: Number(rawHour),
  };
}

export const AUTOMATION_LATENESS_MS = 60 * 60 * 1000;

export function checkInReminderAt(checkInAt: Date): Date {
  return new Date(checkInAt.getTime() - 7 * 24 * 60 * 60 * 1000);
}

export function checkoutReminderAt(checkOutAt: Date, koreaHour: number): Date {
  const korea = new Date(checkOutAt.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      korea.getUTCFullYear(),
      korea.getUTCMonth(),
      korea.getUTCDate() - 1,
      koreaHour - 9,
    ),
  );
}

export function automationReason(code: string | null): string | null {
  if (!code) return null;
  const reasons: Record<string, string> = {
    BEFORE_ACTIVATION:
      '자동 안내 시작 전 일정입니다. 필요하면 직접 발송해 주세요.',
    SHORT_NOTICE: '안내 시각 이후 등록된 일정입니다. 직접 발송해 주세요.',
    MISSED_WINDOW: '발송 시각이 지났습니다. 확인 후 직접 발송해 주세요.',
    SECURITY_REBASELINE:
      '보안 설정 변경으로 자동 안내를 다시 확인해야 합니다. 필요하면 직접 발송해 주세요.',
    SOURCE_CHANGED: '최신 일정으로 대체되었습니다.',
    SOURCE_CLOSED: '취소되었거나 종료된 일정입니다.',
    MESSAGING_BLOCKED: '연락처·개인 링크·비밀번호 준비 상태를 확인해 주세요.',
    CONFIGURATION: '발송 서비스 연결을 확인해 주세요.',
    DELIVERY_UNKNOWN: '발송 결과를 확인한 후 처리해 주세요.',
    DELIVERY_FAILED: '발송 내역에서 실패 결과를 확인해 주세요.',
  };
  return reasons[code] ?? '발송 준비 상태를 확인해 주세요.';
}
