import 'reflect-metadata';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeactivateStaffInput } from '../../libs/dto/user/staff-deactivation.input';
import type { AuthService } from '../auth/auth.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminUsersController } from './admin-users.controller';

const propertyId = '20000000-0000-4000-8000-000000000001';
const replacementStaffId = '10000000-0000-4000-8000-000000000002';
const valid = {
  expectedStateToken: 'a'.repeat(64),
  assignments: [{ propertyId, replacementStaffId }],
};

describe('staff handover request validation', () => {
  async function errors(input: unknown) {
    return validate(plainToInstance(DeactivateStaffInput, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it.each([
    valid,
    { ...valid, assignments: [{ propertyId, replacementStaffId: null }] },
    { ...valid, assignments: [] },
  ])('accepts an explicit selection or clear operation', async (input) => {
    expect(await errors(input)).toEqual([]);
  });

  it.each([
    {},
    { ...valid, expectedStateToken: 'invalid' },
    { ...valid, expectedStateToken: null },
    { ...valid, assignments: null },
    { ...valid, assignments: {} },
    { ...valid, assignments: [{ propertyId }] },
    { ...valid, assignments: [{ propertyId: 'wrong', replacementStaffId }] },
    { ...valid, assignments: [{ propertyId, replacementStaffId: '' }] },
    {
      ...valid,
      assignments: [{ propertyId, replacementStaffId, override: true }],
    },
    { ...valid, actorUserId: replacementStaffId },
    {
      ...valid,
      assignments: Array.from({ length: 1001 }, () => ({
        propertyId,
        replacementStaffId,
      })),
    },
  ])(
    'rejects incomplete, malformed, oversized or privileged inputs',
    async (input) => {
      expect((await errors(input)).length).toBeGreaterThan(0);
    },
  );
});

describe('staff handover route authorization', () => {
  const handlers = [
    // Read route metadata without invoking these unbound methods.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    AdminUsersController.prototype.previewDeactivation,
    // eslint-disable-next-line @typescript-eslint/unbound-method
    AdminUsersController.prototype.deactivateStaff,
  ];

  function context(handler: (typeof handlers)[number]): ExecutionContext {
    const request = { headers: { authorization: 'Bearer unit-test-only' } };
    return {
      getHandler: () => handler,
      getClass: () => AdminUsersController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it.each(handlers)('rejects unauthenticated requests', async (handler) => {
    const authenticateHeader = jest
      .fn()
      .mockRejectedValue(new UnauthorizedException());
    const guard = new RolesGuard(new Reflector(), {
      authenticateHeader,
    } as unknown as AuthService);
    await expect(guard.canActivate(context(handler))).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each(handlers)(
    'rejects STAFF and GUEST and accepts ADMIN',
    async (handler) => {
      for (const role of [Role.STAFF, Role.GUEST, Role.ADMIN]) {
        const authenticateHeader = jest.fn().mockResolvedValue({
          id: replacementStaffId,
          role,
          name: '테스트',
          loginId: 'test',
        });
        const guard = new RolesGuard(new Reflector(), {
          authenticateHeader,
        } as unknown as AuthService);
        if (role === Role.ADMIN) {
          await expect(guard.canActivate(context(handler))).resolves.toBe(true);
        } else {
          await expect(
            guard.canActivate(context(handler)),
          ).rejects.toMatchObject({ status: 403 });
        }
      }
    },
  );
});
