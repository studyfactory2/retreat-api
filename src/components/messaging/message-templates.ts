import { MessageKind, MessageSubjectType } from '@prisma/client';

export const MESSAGE_LABELS: Record<MessageKind, string> = {
  GUEST_CHECKIN: '입실 안내',
  GUEST_CHECKOUT: '퇴실 안내',
  GUEST_CHANGE: '예약 변경 안내',
  GUEST_CANCEL: '예약 취소 안내',
  STAFF_ASSIGNMENT: '청소 배정 안내',
  STAFF_CHANGE: '청소 일정 변경 안내',
  STAFF_CANCEL: '청소 취소 안내',
};
export const GUEST_MESSAGE_KINDS: MessageKind[] = [
  MessageKind.GUEST_CHECKIN,
  MessageKind.GUEST_CHECKOUT,
  MessageKind.GUEST_CHANGE,
  MessageKind.GUEST_CANCEL,
];
export const STAFF_MESSAGE_KINDS: MessageKind[] = [
  MessageKind.STAFF_ASSIGNMENT,
  MessageKind.STAFF_CHANGE,
  MessageKind.STAFF_CANCEL,
];
export function messageKinds(type: MessageSubjectType): MessageKind[] {
  return type === MessageSubjectType.STAY
    ? GUEST_MESSAGE_KINDS
    : STAFF_MESSAGE_KINDS;
}
export interface TemplateContext {
  name: string;
  propertyName: string;
  checkInAt?: Date;
  checkOutAt?: Date;
  dueAt?: Date;
  url: string | null;
}
export function koreanDateTime(date: Date): string {
  const local = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}
// These exact draft bodies and button labels must be registered and approved
// before MESSAGING_TEMPLATES_APPROVED may be enabled. No editable free text.
export function renderMessage(kind: MessageKind, context: TemplateContext) {
  const variables: Record<string, string> = {
    '#{이름}': context.name,
    '#{휴양소}': context.propertyName,
  };
  const guest = GUEST_MESSAGE_KINDS.includes(kind);
  if (guest) {
    variables['#{입실일시}'] = koreanDateTime(context.checkInAt);
    variables['#{퇴실일시}'] = koreanDateTime(context.checkOutAt);
  } else variables['#{청소일시}'] = koreanDateTime(context.dueAt);
  const link = context.url ?? '[사용 가능한 링크 필요]';
  const schedule = guest
    ? `입실: ${variables['#{입실일시}']}\n퇴실: ${variables['#{퇴실일시}']}`
    : `청소 예정: ${variables['#{청소일시}']}`;
  const lines: Record<MessageKind, string[]> = {
    GUEST_CHECKIN: [
      `${context.name}님, ${context.propertyName} 입실 안내입니다.`,
      schedule,
      '개인 예약 페이지에서 이용 안내와 입실 체크리스트를 확인해 주세요.',
      '예약 비밀번호는 입실 7일 전부터 퇴실 시각까지 개인 예약 페이지에서 확인할 수 있습니다.',
    ],
    GUEST_CHECKOUT: [
      `${context.name}님, ${context.propertyName} 퇴실 안내입니다.`,
      schedule,
      '퇴실 전 개인 예약 페이지에서 퇴실 체크리스트를 작성해 주세요.',
    ],
    GUEST_CHANGE: [
      `${context.name}님, ${context.propertyName} 예약 내용이 변경되었습니다.`,
      schedule,
      '아래 개인 예약 페이지에서 변경된 이용 일정을 확인해 주세요.',
    ],
    GUEST_CANCEL: [
      `${context.name}님, ${context.propertyName} 예약이 취소되었습니다.`,
      schedule,
      '취소된 예약의 개인 이용 링크는 사용할 수 없습니다.',
    ],
    STAFF_ASSIGNMENT: [
      `${context.name}님, ${context.propertyName} 청소가 배정되었습니다.`,
      schedule,
      '직원 페이지에서 청소 일정을 확인해 주세요. 청소 완료 후 체크리스트와 사진을 제출해 주세요.',
    ],
    STAFF_CHANGE: [
      `${context.name}님, ${context.propertyName} 청소 일정이 변경되었습니다.`,
      schedule,
      '직원 페이지에서 변경된 청소 일정을 확인해 주세요.',
    ],
    STAFF_CANCEL: [
      `${context.name}님, ${context.propertyName} 청소 일정이 취소되었습니다.`,
      schedule,
      '해당 일정의 청소를 진행하지 마세요.',
    ],
  };
  const cancelled =
    kind === MessageKind.GUEST_CANCEL || kind === MessageKind.STAFF_CANCEL;
  if (!cancelled) variables['#{링크}'] = link;
  return {
    body: [
      ...lines[kind],
      ...(!cancelled
        ? [`${guest ? '개인 예약' : '직원 페이지'}: ${link}`]
        : []),
    ].join('\n'),
    variables,
    buttons: cancelled
      ? []
      : [{ label: guest ? '개인 예약 확인' : '청소 일정 확인', url: link }],
  };
}
export function normalizedRecipient(phone: string | null): string | null {
  if (!phone || !/^[+\d\s()-]+$/.test(phone)) return null;
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('82')) digits = `0${digits.slice(2)}`;
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
}
export function maskedRecipient(phone: string | null): string | null {
  return phone ? `${phone.slice(0, 3)}-****-${phone.slice(-4)}` : null;
}
