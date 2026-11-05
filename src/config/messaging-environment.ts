import { isISO8601 } from 'class-validator';
export const MESSAGING_TEMPLATE_KEYS = [
  'SOLAPI_TEMPLATE_GUEST_CHECKIN',
  'SOLAPI_TEMPLATE_GUEST_CHECKOUT',
  'SOLAPI_TEMPLATE_GUEST_CHANGE',
  'SOLAPI_TEMPLATE_GUEST_CANCEL',
  'SOLAPI_TEMPLATE_STAFF_ASSIGNMENT',
  'SOLAPI_TEMPLATE_STAFF_CHANGE',
  'SOLAPI_TEMPLATE_STAFF_CANCEL',
] as const;
export type MessagingEnvironment = {
  MESSAGING_ENABLED: boolean;
  MESSAGING_TEMPLATES_APPROVED: boolean;
  MESSAGING_AUTOMATION_ENABLED: 'true' | 'false';
  MESSAGING_AUTOMATION_START_AT?: string;
  MESSAGING_CHECKOUT_REMINDER_HOUR: string;
  SOLAPI_API_KEY?: string;
  SOLAPI_API_SECRET?: string;
  SOLAPI_PF_ID?: string;
  SOLAPI_SENDER?: string;
} & Partial<Record<(typeof MESSAGING_TEMPLATE_KEYS)[number], string>>;

export function readMessagingEnvironment(
  input: Record<string, unknown>,
): MessagingEnvironment {
  const result: MessagingEnvironment = {
    MESSAGING_ENABLED: flag(input, 'MESSAGING_ENABLED'),
    MESSAGING_TEMPLATES_APPROVED: flag(input, 'MESSAGING_TEMPLATES_APPROVED'),
    MESSAGING_AUTOMATION_ENABLED: flag(input, 'MESSAGING_AUTOMATION_ENABLED')
      ? 'true'
      : 'false',
    MESSAGING_CHECKOUT_REMINDER_HOUR: '15',
  };
  const hour = input.MESSAGING_CHECKOUT_REMINDER_HOUR ?? '15';
  if (
    typeof hour !== 'string' ||
    !/^\d{1,2}$/.test(hour) ||
    Number(hour) > 23
  ) {
    throw new Error(
      'MESSAGING_CHECKOUT_REMINDER_HOUR must be 0 through 23 in Korea time.',
    );
  }
  result.MESSAGING_CHECKOUT_REMINDER_HOUR = hour;
  const start = input.MESSAGING_AUTOMATION_START_AT;
  if (start !== undefined && start !== '') {
    if (
      typeof start !== 'string' ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) ||
      !isISO8601(start, { strict: true, strictSeparator: true })
    ) {
      throw new Error(
        'MESSAGING_AUTOMATION_START_AT must be a valid ISO date and time with timezone.',
      );
    }
    result.MESSAGING_AUTOMATION_START_AT = start;
  }
  if (
    result.MESSAGING_AUTOMATION_ENABLED === 'true' &&
    !result.MESSAGING_AUTOMATION_START_AT
  ) {
    throw new Error(
      'MESSAGING_AUTOMATION_START_AT is required before automation is enabled.',
    );
  }
  for (const key of [
    'SOLAPI_API_KEY',
    'SOLAPI_API_SECRET',
    'SOLAPI_PF_ID',
    'SOLAPI_SENDER',
    ...MESSAGING_TEMPLATE_KEYS,
  ] as const) {
    const value = input[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
      throw new Error(`${key} must be an identifier without whitespace.`);
    }
    result[key] = value;
  }
  if (result.SOLAPI_SENDER && !/^\d{8,15}$/.test(result.SOLAPI_SENDER)) {
    throw new Error('SOLAPI_SENDER must contain 8 to 15 digits.');
  }
  return result;
}
function flag(input: Record<string, unknown>, key: string): boolean {
  const value = input[key] ?? 'false';
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${key} must be true or false.`);
  }
  return value === 'true';
}
