import { createHmac } from 'node:crypto';
import { MessageSubjectType, Prisma } from '@prisma/client';
import { normalizedRecipient } from '../messaging/message-templates';

export const automationStaySelect = {
  id: true,
  propertyId: true,
  currentRevision: true,
  status: true,
  guestName: true,
  phone: true,
  checkInAt: true,
  checkOutAt: true,
  createdAt: true,
  property: { select: { name: true, isActive: true } },
} satisfies Prisma.StaySelect;

export const automationTaskSelect = {
  id: true,
  propertyId: true,
  version: true,
  status: true,
  dueAt: true,
  createdAt: true,
  note: true,
  property: {
    select: {
      name: true,
      isActive: true,
      staffUserId: true,
      staff: {
        select: {
          id: true,
          role: true,
          isActive: true,
          name: true,
          phone: true,
        },
      },
    },
  },
} satisfies Prisma.CleaningTaskSelect;

type StaySource = Prisma.StayGetPayload<{
  select: typeof automationStaySelect;
}>;
type TaskSource = Prisma.CleaningTaskGetPayload<{
  select: typeof automationTaskSelect;
}>;

export interface AutomationSource {
  id: string;
  subjectType: MessageSubjectType;
  version: number;
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  eligible: boolean;
  createdAt: Date;
  endAt: Date;
  checkInAt?: Date;
  fingerprint: string;
}

function fingerprint(secret: string, fields: unknown[]): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(fields))
    .digest('hex');
}

export function staySource(stay: StaySource, secret: string): AutomationSource {
  return {
    id: stay.id,
    subjectType: MessageSubjectType.STAY,
    version: stay.currentRevision,
    status: stay.status,
    eligible: stay.property.isActive,
    createdAt: stay.createdAt,
    endAt: stay.checkOutAt,
    checkInAt: stay.checkInAt,
    fingerprint: fingerprint(secret, [
      stay.propertyId,
      stay.property.name,
      stay.property.isActive,
      stay.guestName,
      normalizedRecipient(stay.phone) ?? stay.phone ?? '',
      stay.checkInAt.toISOString(),
      stay.checkOutAt.toISOString(),
      stay.status,
    ]),
  };
}

export function taskSource(task: TaskSource, secret: string): AutomationSource {
  const status =
    task.status === 'CANCELLED'
      ? 'CANCELLED'
      : task.status === 'COMPLETED'
        ? 'COMPLETED'
        : 'ACTIVE';
  const staff = task.property.staff;
  return {
    id: task.id,
    subjectType: MessageSubjectType.TASK,
    version: task.version,
    status,
    eligible:
      task.property.isActive &&
      staff?.isActive === true &&
      staff.role === 'STAFF',
    createdAt: task.createdAt,
    endAt: task.dueAt,
    fingerprint: fingerprint(secret, [
      task.propertyId,
      task.property.name,
      task.property.isActive,
      task.property.staffUserId,
      staff?.name,
      staff?.isActive,
      staff?.role,
      normalizedRecipient(staff?.phone ?? null) ?? staff?.phone ?? '',
      task.dueAt.toISOString(),
      task.note,
      status,
    ]),
  };
}
