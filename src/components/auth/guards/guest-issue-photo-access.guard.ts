import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { GuestIssuePhotosService } from '../../guest-issue-photos/guest-issue-photos.service';

@Injectable()
export class GuestIssuePhotoAccessGuard implements CanActivate {
  constructor(
    private readonly guestIssuePhotosService: GuestIssuePhotosService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.guestIssuePhotosService.authorize(request.headers.authorization);
    return true;
  }
}
