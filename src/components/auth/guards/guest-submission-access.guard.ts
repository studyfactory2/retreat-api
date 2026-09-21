import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { GuestSubmissionsService } from '../../guest-submissions/guest-submissions.service';

@Injectable()
export class GuestSubmissionAccessGuard implements CanActivate {
  constructor(
    private readonly guestSubmissionsService: GuestSubmissionsService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.guestSubmissionsService.authorize(request.headers.authorization);
    return true;
  }
}
