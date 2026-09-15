import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../libs/dto/user/user';
import { AuthService } from '../auth.service';

@Injectable()
export class WithoutGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = null;
    if (request.headers.authorization) {
      try {
        request.user = await this.authService.authenticateHeader(
          request.headers.authorization,
        );
      } catch (error: unknown) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    return true;
  }
}
