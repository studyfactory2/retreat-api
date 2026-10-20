import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import type {
  AuthenticatedSession,
  JwtPayload,
} from '../../libs/dto/user/user';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  public async hashPassword(password: string): Promise<string> {
    if ([...password].length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException({
        code: 'INVALID_PASSWORD',
        message: '비밀번호는 8자 이상, UTF-8 기준 72바이트 이하여야 합니다.',
      });
    }
    return bcrypt.hash(password, 12);
  }

  public async comparePasswords(
    password: string,
    hash: string,
  ): Promise<boolean> {
    if (Buffer.byteLength(password, 'utf8') > 72) return false;
    return bcrypt.compare(password, hash);
  }

  public async createToken(
    user: Pick<AuthenticatedSession, 'id' | 'sessionVersion'>,
    expiresIn: number,
  ): Promise<string> {
    return this.jwtService.signAsync(
      { userId: user.id, sessionVersion: user.sessionVersion },
      { expiresIn },
    );
  }

  public async authenticateHeader(
    header: string | undefined,
  ): Promise<AuthenticatedSession> {
    const match =
      typeof header === 'string' && header.length <= 8192
        ? /^Bearer +([^\s]+)$/i.exec(header)
        : null;
    if (!match) throw this.unauthorized();
    return this.verifyToken(match[1]);
  }

  public async verifyToken(token: string): Promise<AuthenticatedSession> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw this.unauthorized();
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.userId !== 'string' ||
      !isUUID(payload.userId) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat) ||
      (payload.sessionVersion !== undefined &&
        (!Number.isSafeInteger(payload.sessionVersion) ||
          payload.sessionVersion < 0))
    ) {
      throw this.unauthorized();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        role: true,
        loginId: true,
        passwordHash: true,
        sessionVersion: true,
        isActive: true,
      },
    });
    if (
      !user?.isActive ||
      user.role !== Role.ADMIN ||
      !user.loginId ||
      !user.passwordHash ||
      user.sessionVersion !== (payload.sessionVersion ?? 0)
    ) {
      throw this.unauthorized();
    }
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      loginId: user.loginId,
      sessionVersion: user.sessionVersion,
    };
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: '로그인이 필요합니다. 다시 로그인해 주세요.',
    });
  }
}
