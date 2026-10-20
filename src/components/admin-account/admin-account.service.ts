import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedSession } from '../../libs/dto/user/user';
import type {
  AdminAccountDto,
  PasswordChangedDto,
} from '../../libs/dto/user/account';
import type {
  ChangePasswordInput,
  UpdateAccountInput,
} from '../../libs/dto/user/account.input';
import { AuthService } from '../auth/auth.service';

const profileSelect = {
  id: true,
  name: true,
  loginId: true,
  phone: true,
  company: true,
  department: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private scope(actor: AuthenticatedSession) {
    return {
      id: actor.id,
      role: Role.ADMIN,
      isActive: true,
      sessionVersion: actor.sessionVersion,
    };
  }

  public async getAccount(
    actor: AuthenticatedSession,
  ): Promise<AdminAccountDto> {
    const user = await this.prisma.user.findFirst({
      where: this.scope(actor),
      select: profileSelect,
    });
    if (!user?.loginId) throw this.sessionChanged();
    return { ...user, loginId: user.loginId, role: 'ADMIN' };
  }

  public async updateProfile(
    actor: AuthenticatedSession,
    input: UpdateAccountInput,
  ): Promise<AdminAccountDto> {
    return await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: {
          ...this.scope(actor),
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        data: {
          name: input.name,
          phone: input.phone,
          company: input.company,
          department: input.department,
          updatedAt: new Date(
            Math.max(
              Date.now(),
              new Date(input.expectedUpdatedAt).getTime() + 1,
            ),
          ),
        },
      });
      if (updated.count !== 1) {
        const current = await transaction.user.findFirst({
          where: this.scope(actor),
          select: { id: true },
        });
        if (!current) throw this.sessionChanged();
        throw new ConflictException({
          code: 'ACCOUNT_CHANGED',
          message:
            '다른 화면에서 계정 정보가 변경되었습니다. 최신 정보를 확인해 주세요.',
        });
      }
      const user = await transaction.user.findFirst({
        where: this.scope(actor),
        select: profileSelect,
      });
      if (!user?.loginId) throw this.sessionChanged();
      return { ...user, loginId: user.loginId, role: 'ADMIN' };
    });
  }

  public async changePassword(
    actor: AuthenticatedSession,
    input: ChangePasswordInput,
  ): Promise<PasswordChangedDto> {
    if (input.newPassword !== input.confirmPassword)
      throw new BadRequestException({
        code: 'PASSWORD_CONFIRMATION_MISMATCH',
        message: '새 비밀번호가 서로 일치하지 않습니다.',
      });
    if (input.newPassword === input.currentPassword)
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: '현재 비밀번호와 다른 비밀번호를 입력해 주세요.',
      });
    const user = await this.prisma.user.findFirst({
      where: this.scope(actor),
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) throw this.sessionChanged();
    if (
      !(await this.auth.comparePasswords(
        input.currentPassword,
        user.passwordHash,
      ))
    )
      throw new BadRequestException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: '현재 비밀번호가 올바르지 않습니다.',
      });
    const passwordHash = await this.auth.hashPassword(input.newPassword);
    // Compare-and-swap prevents two concurrent password changes from both winning.
    const result = await this.prisma.user.updateMany({
      where: { ...this.scope(actor), passwordHash: user.passwordHash },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    if (result.count !== 1) throw this.sessionChanged();
    return { passwordChanged: true };
  }

  private sessionChanged() {
    return new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: '로그인 정보를 다시 확인해 주세요.',
    });
  }
}
