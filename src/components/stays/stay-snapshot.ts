import type { Prisma } from '@prisma/client';
import type {
  StayActorSnapshot,
  StayDto,
  StaySnapshot,
} from '../../libs/dto/stay/stay';
import type { AuthenticatedUser } from '../../libs/dto/user/user';

export function buildStaySnapshot(stay: StayDto): Prisma.InputJsonObject {
  return {
    schemaVersion: 1,
    id: stay.id,
    propertyId: stay.propertyId,
    guestUserId: stay.guestUserId,
    guestName: stay.guestName,
    company: stay.company,
    department: stay.department,
    phone: stay.phone,
    checkInAt: stay.checkInAt.toISOString(),
    checkOutAt: stay.checkOutAt.toISOString(),
    status: stay.status,
    source: stay.source,
    notes: stay.notes,
    createdByUserId: stay.createdByUserId,
    currentRevision: stay.currentRevision,
    cancelledAt: stay.cancelledAt?.toISOString() ?? null,
    cancellationReason: stay.cancellationReason,
    createdAt: stay.createdAt.toISOString(),
    updatedAt: stay.updatedAt.toISOString(),
    property: {
      id: stay.property.id,
      name: stay.property.name,
      region: stay.property.region,
      isActive: stay.property.isActive,
    },
  } satisfies StaySnapshot;
}

export function buildStayActorSnapshot(
  actor: AuthenticatedUser,
): Prisma.InputJsonObject {
  return {
    schemaVersion: 1,
    id: actor.id,
    name: actor.name,
    role: actor.role,
  } satisfies StayActorSnapshot;
}
