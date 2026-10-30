import { HttpException } from '@nestjs/common';
import { ChecklistType, Prisma, Role, SubmissionStatus } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { StaffDto } from '../../libs/dto/user/staff';
import type { DeactivateStaffInput } from '../../libs/dto/user/staff-deactivation.input';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AdminUsersService } from './admin-users.service';
import { StaffDeactivationService } from './staff-deactivation.service';

const sourceId = '10000000-0000-4000-8000-000000000001';
const replacementId = '10000000-0000-4000-8000-000000000002';
const activePropertyId = '20000000-0000-4000-8000-000000000001';
const inactivePropertyId = '20000000-0000-4000-8000-000000000002';
const actor: AuthenticatedUser = {
  id: '10000000-0000-4000-8000-000000000003',
  name: '관리자',
  role: Role.ADMIN,
  loginId: 'admin',
};
const earlier = new Date('2026-10-01T00:00:00.000Z');

function setup() {
  const properties = [
    {
      id: activePropertyId,
      name: '운영 휴양소',
      region: '서울',
      isActive: true,
      updatedAt: earlier,
      staffQrTokenHash: 'old-active-qr-hash',
      staffQrRotatedAt: earlier,
    },
    {
      id: inactivePropertyId,
      name: '비활성 휴양소',
      region: null,
      isActive: false,
      updatedAt: earlier,
      staffQrTokenHash: 'old-inactive-qr-hash',
      staffQrRotatedAt: earlier,
    },
  ];
  const staff: StaffDto = {
    id: sourceId,
    name: '기존 직원',
    role: Role.STAFF,
    phone: null,
    company: '기존 회사',
    department: null,
    isActive: true,
    createdAt: earlier,
    updatedAt: earlier,
    assignedProperties: properties.map(({ id, name, region, isActive }) => ({
      id,
      name,
      region,
      isActive,
    })),
  };
  const tokens = [
    {
      id: 'draft-current-property',
      propertyId: activePropertyId,
      status: SubmissionStatus.DRAFT,
      updatedAt: earlier,
      currentRevision: 0,
      privateTokenHash: 'private-draft-hash',
    },
    {
      id: 'draft-former-property',
      propertyId: '20000000-0000-4000-8000-000000000003',
      status: SubmissionStatus.DRAFT,
      updatedAt: earlier,
      currentRevision: 0,
      privateTokenHash: 'private-former-draft-hash',
    },
    {
      id: 'submitted-receipt',
      propertyId: activePropertyId,
      status: SubmissionStatus.SUBMITTED,
      updatedAt: earlier,
      currentRevision: 2,
      privateTokenHash: 'private-receipt-hash',
    },
  ];
  const updatedStaff = { ...staff, isActive: false, assignedProperties: [] };
  const audit = {
    id: '30000000-0000-4000-8000-000000000001',
    staffUserId: sourceId,
    actorUserId: actor.id,
    actorSnapshot: { id: actor.id, name: actor.name },
    staffSnapshot: { id: sourceId, name: staff.name },
    assignments: [
      {
        propertyId: activePropertyId,
        propertyName: properties[0].name,
        propertyRegion: properties[0].region,
        isActive: true,
        replacementStaffId: replacementId,
        replacementStaffName: '후임 직원',
      },
      {
        propertyId: inactivePropertyId,
        propertyName: properties[1].name,
        propertyRegion: null,
        isActive: false,
        replacementStaffId: null,
        replacementStaffName: null,
      },
    ],
    revokedDraftCount: 2,
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
  };
  const tx = {
    user: {
      findFirst: jest
        .fn()
        .mockImplementation((input: Prisma.UserFindFirstArgs) =>
          Promise.resolve(
            input.where?.role === Role.ADMIN
              ? { id: actor.id, name: actor.name }
              : staff,
          ),
        ),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: replacementId, name: '후임 직원' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(staff),
    },
    property: {
      findMany: jest.fn().mockResolvedValue(properties),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    checklistSubmission: {
      findMany: jest.fn().mockResolvedValue(tokens),
    },
    staffDeactivation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(audit),
    },
    $executeRaw: jest
      .fn<Promise<number>, [Prisma.Sql]>()
      .mockResolvedValue(tokens.length),
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation(
        (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
          work(tx as unknown as Prisma.TransactionClient),
      ),
  };
  const service = new StaffDeactivationService(
    prisma as unknown as PrismaService,
  );
  return {
    service,
    prisma,
    tx,
    staff,
    updatedStaff,
    properties,
    tokens,
    audit,
  };
}

type Fixture = ReturnType<typeof setup>;

async function inputFor(fixture: Fixture): Promise<DeactivateStaffInput> {
  const preview = await fixture.service.preview(sourceId);
  return {
    expectedStateToken: preview.expectedStateToken,
    assignments: [
      { propertyId: activePropertyId, replacementStaffId: replacementId },
      { propertyId: inactivePropertyId, replacementStaffId: null },
    ],
  };
}

async function expectCode(work: Promise<unknown>, code: string) {
  try {
    await work;
    throw new Error('Expected a business error');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({ code });
  }
}

function expectNoWrites(fixture: Fixture) {
  expect(fixture.tx.property.updateMany).not.toHaveBeenCalled();
  expect(fixture.tx.user.updateMany).not.toHaveBeenCalled();
  expect(fixture.tx.$executeRaw).not.toHaveBeenCalled();
  expect(fixture.tx.staffDeactivation.create).not.toHaveBeenCalled();
}

describe('StaffDeactivationService', () => {
  it('previews former-property drafts too, without exposing credential hashes', async () => {
    const fixture = setup();
    const preview = await fixture.service.preview(sourceId);
    expect(preview.unfinishedDraftCount).toBe(2);
    expect(preview.properties.map((row) => row.unfinishedDraftCount)).toEqual([
      1, 0,
    ]);
    expect(preview.expectedStateToken).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(preview)).not.toContain('qr-hash');
    expect(JSON.stringify(preview)).not.toContain('private-');
    expect(preview.latestDeactivation).toBeNull();
    expect(fixture.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expectNoWrites(fixture);
  });

  it('transfers active properties, clears inactive ones, and revokes only staff access in one serializable transaction', async () => {
    const fixture = setup();
    const input = await inputFor(fixture);
    fixture.tx.user.findFirst
      .mockResolvedValueOnce(fixture.staff)
      .mockResolvedValueOnce({ id: actor.id, name: actor.name })
      .mockResolvedValueOnce(fixture.updatedStaff);

    const result = await fixture.service.deactivate(sourceId, input, actor);

    expect(result.staff.isActive).toBe(false);
    expect(result.staff.assignedProperties).toEqual([]);
    expect(result.revokedDraftCount).toBe(2);
    expect(result.reassignedPropertyIds).toEqual([activePropertyId]);
    expect(result.clearedPropertyIds).toEqual([inactivePropertyId]);
    expect(result.staffQrReissuePropertyIds).toEqual([activePropertyId]);
    expect(fixture.prisma.$transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    for (const [index, replacementStaffId] of [replacementId, null].entries()) {
      expect(fixture.tx.property.updateMany).toHaveBeenNthCalledWith(
        index + 1,
        {
          where: {
            id: fixture.properties[index].id,
            staffUserId: sourceId,
            isActive: fixture.properties[index].isActive,
            updatedAt: earlier,
          },
          data: {
            staffUserId: replacementStaffId,
            staffQrTokenHash: null,
            staffQrTokenCiphertext: null,
            staffQrRotatedAt: expect.any(Date) as Date,
          },
        },
      );
    }
    expect(fixture.tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: sourceId,
        role: Role.STAFF,
        isActive: true,
        updatedAt: earlier,
      },
      data: { isActive: false, updatedAt: expect.any(Date) as Date },
    });
    expect(fixture.tx.staffDeactivation.create).toHaveBeenCalledWith({
      data: {
        staffUserId: sourceId,
        actorUserId: actor.id,
        actorSnapshot: { id: actor.id, name: actor.name },
        staffSnapshot: { id: sourceId, name: fixture.staff.name },
        assignments: fixture.audit.assignments,
        revokedDraftCount: 2,
        createdAt: expect.any(Date) as Date,
      },
    });
  });

  it('revokes every maintenance private link using parameterized credential-only SQL without changing record timestamps, expiry, authors, or snapshots', async () => {
    const fixture = setup();
    const input = await inputFor(fixture);
    await fixture.service.deactivate(sourceId, input, actor);
    const query = fixture.tx.$executeRaw.mock.calls[0][0];
    expect(query.values).toEqual([sourceId, ChecklistType.MAINTENANCE]);
    expect(query.text.replace(/\s+/g, ' ').trim()).toBe(
      'UPDATE "ChecklistSubmission" SET "privateTokenHash" = NULL WHERE "authorUserId" = $1 AND "type" = $2::"ChecklistType" AND "privateTokenHash" IS NOT NULL',
    );
    expect(fixture.tx.checklistSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          authorUserId: sourceId,
          type: ChecklistType.MAINTENANCE,
          privateTokenHash: { not: null },
        },
      }),
    );
  });

  it.each([
    [
      'profile edit',
      (fixture: Fixture) => (fixture.staff.name = '변경된 이름'),
    ],
    [
      'property edit',
      (fixture: Fixture) => (fixture.properties[0].name = '변경'),
    ],
    ['property reassignment', (fixture: Fixture) => fixture.properties.pop()],
    [
      'QR rotation',
      (fixture: Fixture) =>
        (fixture.properties[0].staffQrTokenHash = 'new-hash'),
    ],
    [
      'draft save',
      (fixture: Fixture) =>
        (fixture.tokens[0].updatedAt = new Date('2026-10-29T00:00:00.000Z')),
    ],
    [
      'new draft',
      (fixture: Fixture) =>
        fixture.tokens.push({ ...fixture.tokens[0], id: 'new-draft' }),
    ],
  ])(
    'rejects a stale preview after %s before any mutation',
    async (_label, change) => {
      const fixture = setup();
      const input = await inputFor(fixture);
      change(fixture);
      await expectCode(
        fixture.service.deactivate(sourceId, input, actor),
        'STAFF_HANDOVER_CHANGED',
      );
      expectNoWrites(fixture);
    },
  );

  it.each([
    [
      'missing property',
      [{ propertyId: activePropertyId, replacementStaffId: replacementId }],
    ],
    [
      'duplicate property',
      [
        { propertyId: activePropertyId, replacementStaffId: replacementId },
        { propertyId: activePropertyId, replacementStaffId: replacementId },
      ],
    ],
    [
      'foreign property',
      [
        { propertyId: replacementId, replacementStaffId: replacementId },
        { propertyId: inactivePropertyId, replacementStaffId: null },
      ],
    ],
    [
      'missing replacement',
      [
        { propertyId: activePropertyId, replacementStaffId: null },
        { propertyId: inactivePropertyId, replacementStaffId: null },
      ],
    ],
    [
      'self assignment',
      [
        { propertyId: activePropertyId, replacementStaffId: sourceId },
        { propertyId: inactivePropertyId, replacementStaffId: null },
      ],
    ],
    [
      'inactive property transfer',
      [
        { propertyId: activePropertyId, replacementStaffId: replacementId },
        { propertyId: inactivePropertyId, replacementStaffId: replacementId },
      ],
    ],
  ])('rejects %s before any mutation', async (_label, assignments) => {
    const fixture = setup();
    const input = await inputFor(fixture);
    await expectCode(
      fixture.service.deactivate(sourceId, { ...input, assignments }, actor),
      'STAFF_HANDOVER_ASSIGNMENTS_INVALID',
    );
    expectNoWrites(fixture);
  });

  it('rejects an unavailable replacement and checks active STAFF eligibility inside the transaction', async () => {
    const fixture = setup();
    const input = await inputFor(fixture);
    fixture.tx.user.findMany.mockResolvedValue([]);
    await expectCode(
      fixture.service.deactivate(sourceId, input, actor),
      'STAFF_REPLACEMENT_UNAVAILABLE',
    );
    expect(fixture.tx.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [replacementId] }, role: Role.STAFF, isActive: true },
      select: { id: true, name: true },
    });
    expectNoWrites(fixture);
  });

  it('requires a currently active administrator before writing', async () => {
    const fixture = setup();
    const input = await inputFor(fixture);
    fixture.tx.user.findFirst
      .mockResolvedValueOnce(fixture.staff)
      .mockResolvedValueOnce(null);
    await expect(
      fixture.service.deactivate(sourceId, input, actor),
    ).rejects.toMatchObject({ status: 401 });
    expectNoWrites(fixture);
  });

  it('fails closed on a conditional property write or revocation count conflict without creating an audit', async () => {
    for (const conflict of ['property', 'token', 'staff']) {
      const fixture = setup();
      const input = await inputFor(fixture);
      if (conflict === 'property')
        fixture.tx.property.updateMany.mockResolvedValueOnce({ count: 0 });
      if (conflict === 'token') fixture.tx.$executeRaw.mockResolvedValueOnce(0);
      if (conflict === 'staff')
        fixture.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });
      await expectCode(
        fixture.service.deactivate(sourceId, input, actor),
        'STAFF_HANDOVER_CHANGED',
      );
      expect(fixture.tx.staffDeactivation.create).not.toHaveBeenCalled();
    }
  });

  it('can deactivate an unassigned worker while still revoking their previous maintenance links', async () => {
    const fixture = setup();
    fixture.properties.splice(0);
    fixture.staff.assignedProperties = [];
    fixture.tx.user.findMany.mockResolvedValue([]);
    const input = await inputFor(fixture);
    await fixture.service.deactivate(
      sourceId,
      { ...input, assignments: [] },
      actor,
    );
    expect(fixture.tx.property.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fixture.tx.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('allows inactive previews to recover the committed audit after a lost response but never repeats deactivation', async () => {
    const fixture = setup();
    fixture.staff.isActive = false;
    fixture.properties.splice(0);
    fixture.staff.assignedProperties = [];
    fixture.tx.staffDeactivation.findFirst.mockResolvedValue(fixture.audit);
    const preview = await fixture.service.preview(sourceId);
    expect(preview.latestDeactivation).toMatchObject({
      id: fixture.audit.id,
      actor: { id: actor.id, name: actor.name },
      assignments: fixture.audit.assignments,
      revokedDraftCount: 2,
      staffQrReissuePropertyIds: [activePropertyId],
    });
    await expectCode(
      fixture.service.deactivate(
        sourceId,
        {
          expectedStateToken: preview.expectedStateToken,
          assignments: [],
        },
        actor,
      ),
      'STAFF_ALREADY_INACTIVE',
    );
    expectNoWrites(fixture);
  });

  it('propagates audit failure out of the same transaction, so the database rolls back the handover', async () => {
    const fixture = setup();
    const input = await inputFor(fixture);
    fixture.tx.staffDeactivation.create.mockRejectedValue(
      new Error('audit unavailable'),
    );
    await expect(
      fixture.service.deactivate(sourceId, input, actor),
    ).rejects.toThrow('audit unavailable');
    // The unit mock checks the transaction boundary, not real database rollback.
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('legacy staff update activity transitions', () => {
  it('cannot bypass the handover even when the employee has no assigned property', async () => {
    const fixture = setup();
    const service = new AdminUsersService(
      fixture.prisma as unknown as PrismaService,
    );
    fixture.staff.assignedProperties = [];
    await expectCode(
      service.updateStaff(sourceId, { isActive: false }),
      'STAFF_DEACTIVATION_REQUIRED',
    );
    expect(fixture.tx.user.update).not.toHaveBeenCalled();
  });

  it('reactivates explicitly without restoring assignments or private access', async () => {
    const fixture = setup();
    const service = new AdminUsersService(
      fixture.prisma as unknown as PrismaService,
    );
    fixture.staff.isActive = false;
    fixture.staff.assignedProperties = [];
    await service.updateStaff(sourceId, { isActive: true });
    expect(fixture.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: undefined,
          phone: undefined,
          company: undefined,
          department: undefined,
          isActive: true,
        },
      }),
    );
    expect(fixture.tx.property.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.$executeRaw).not.toHaveBeenCalled();
  });
});
