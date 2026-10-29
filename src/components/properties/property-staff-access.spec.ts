import { Prisma, Role } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { PropertiesService } from './properties.service';

const propertyId = '20000000-0000-4000-8000-000000000001';
const oldStaffId = '10000000-0000-4000-8000-000000000001';
const newStaffId = '10000000-0000-4000-8000-000000000002';

function setup(staffUserId: string | null, isActive = true) {
  const rotatedAt = new Date(Date.now() + 60_000);
  const tx = {
    property: {
      findUnique: jest.fn().mockResolvedValue({
        id: propertyId,
        isActive,
        staffUserId,
        staffQrRotatedAt: rotatedAt,
      }),
      update: jest.fn().mockResolvedValue({ id: propertyId }),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ role: Role.STAFF, isActive: true }),
    },
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation(
        (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
          work(tx as unknown as Prisma.TransactionClient),
      ),
  };
  return {
    service: new PropertiesService(prisma as unknown as PrismaService),
    tx,
    prisma,
    rotatedAt,
  };
}

describe('property staff assignment credentials', () => {
  it.each([
    [oldStaffId, newStaffId, true],
    [oldStaffId, null, true],
    [oldStaffId, null, false],
    [null, newStaffId, true],
  ])(
    'revokes the prior staff QR on identity changes without touching guest access',
    async (previous, next, active) => {
      const fixture = setup(previous, active);
      await fixture.service.assignStaff(propertyId, { staffUserId: next });
      expect(fixture.tx.property.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            staffUserId: next,
            staffQrTokenHash: null,
            staffQrRotatedAt: new Date(fixture.rotatedAt.getTime() + 1),
          },
        }),
      );
      expect(fixture.prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  );

  it.each([oldStaffId, null])(
    'preserves QR access when the saved assignment has not changed',
    async (staffUserId) => {
      const fixture = setup(staffUserId);
      await fixture.service.assignStaff(propertyId, { staffUserId });
      expect(fixture.tx.property.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { staffUserId } }),
      );
    },
  );

  it('does not revoke access when an inactive replacement is rejected', async () => {
    const fixture = setup(oldStaffId);
    fixture.tx.user.findUnique.mockResolvedValue({
      role: Role.STAFF,
      isActive: false,
    });
    await expect(
      fixture.service.assignStaff(propertyId, { staffUserId: newStaffId }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fixture.tx.property.update).not.toHaveBeenCalled();
  });
});
