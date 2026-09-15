import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { LoginInput } from '../../libs/dto/user/user.input';
import type {
  AuthenticatedUser,
  LoginResponse,
} from '../../libs/dto/user/user';
import { AuthService } from '../auth/auth.service';

// A non-account hash keeps unknown IDs on the password-comparison path too.
const DUMMY_PASSWORD_HASH =
  '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  public async login(input: LoginInput): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { loginId: input.loginId },
      select: {
        id: true,
        name: true,
        role: true,
        loginId: true,
        passwordHash: true,
        isActive: true,
      },
    });
    const matches = await this.authService.comparePasswords(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (
      !user?.isActive ||
      user.role !== Role.ADMIN ||
      !user.loginId ||
      !user.passwordHash ||
      !matches
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '아이디 또는 비밀번호를 확인해 주세요.',
      });
    }

    const profile: AuthenticatedUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      loginId: user.loginId,
    };
    const expiresIn = (input.autoLogin ? 30 : 7) * 24 * 60 * 60;
    const token = await this.authService.createToken(profile, expiresIn);
    return { user: profile, token, tokenType: 'Bearer', expiresIn };
  }
}
