import { Prisma } from '@prisma/client';

export const stayAccessSelect = {
  id: true,
  propertyId: true,
  currentRevision: true,
  status: true,
  guestName: true,
  phone: true,
  checkInAt: true,
  checkOutAt: true,
  property: {
    select: {
      isActive: true,
      accessSettings: {
        select: {
          version: true,
          roomMode: true,
          fixedRoomCodeCiphertext: true,
        },
      },
    },
  },
  accessCode: true,
  accessCodeEvents: {
    select: {
      codeVersion: true,
      action: true,
      method: true,
      actorName: true,
      createdAt: true,
    },
    orderBy: { codeVersion: 'desc' as const },
    take: 5,
  },
} satisfies Prisma.StaySelect;

export type StayWithAccess = Prisma.StayGetPayload<{
  select: typeof stayAccessSelect;
}>;

export function phoneDigits(phone: string | null): string | null {
  if (typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9 ()-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[ ()-]/g, '').replace(/^\+/, '');
  return /^[0-9]{7,15}$/.test(digits) ? digits : null;
}
export function phoneIdentity(phone: string | null): string | null {
  return phoneDigits(phone) ?? phone;
}
export function sourceSnapshot(
  value: Prisma.JsonValue,
  stay: StayWithAccess,
  revision: number,
): { phone: string | null; guestName: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    value.id !== stay.id ||
    value.propertyId !== stay.propertyId ||
    value.currentRevision !== revision ||
    typeof value.guestName !== 'string' ||
    !(value.phone === null || typeof value.phone === 'string')
  )
    return null;
  return { phone: value.phone as string | null, guestName: value.guestName };
}
