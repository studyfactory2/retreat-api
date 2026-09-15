import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../../../libs/dto/user/user';

export const AuthUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return user ? (data ? user[data] : user) : null;
  },
);
