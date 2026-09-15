import {
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../../libs/dto/user/user';
import { AuthService } from '../auth.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthGuard } from './auth.guard';

@Injectable()
export class RolesGuard extends AuthGuard {
  constructor(
    private readonly reflector: Reflector,
    authService: AuthService,
  ) {
    super(authService);
  }

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (roles?.length && (!user || !roles.includes(user.role))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '접근 권한이 없습니다.',
      });
    }
    return true;
  }
}
