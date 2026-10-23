import { ConflictException } from '@nestjs/common';
import { Prisma, StayStatus } from '@prisma/client';

export const OPERATION_STAY_PREVIEW_LIMIT = 5;

export function blockingPropertyStays(
  propertyId: string,
  now: Date,
): Prisma.StayWhereInput {
  return { propertyId, status: StayStatus.ACTIVE, checkOutAt: { gt: now } };
}

export async function requirePropertyOperationChange(
  tx: Prisma.TransactionClient,
  property: { id: string; isActive: boolean; updatedAt: Date },
  isActive: boolean,
  expectedUpdatedAt: string | undefined,
): Promise<void> {
  if (
    !expectedUpdatedAt ||
    property.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
  ) {
    throw new ConflictException({
      code: 'PROPERTY_CHANGED',
      message: '휴양소 정보가 변경되었습니다. 최신 정보를 확인해 주세요.',
    });
  }
  if (!isActive && property.isActive) {
    // All stay creation, date changes and restoration (including Excel import)
    // read property activity in serializable transactions. Reading this predicate
    // before writing the property makes concurrent conflicting stays retry safely.
    const count = await tx.stay.count({
      where: blockingPropertyStays(property.id, new Date()),
    });
    if (count > 0) {
      throw new ConflictException({
        code: 'PROPERTY_HAS_PENDING_STAYS',
        message: `진행 중이거나 예정된 이용 일정이 ${count}건 있습니다. 일정을 확인해 주세요.`,
      });
    }
  }
}
