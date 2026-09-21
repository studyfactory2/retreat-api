import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { StayAccessService } from '../../stay-access/stay-access.service';

@Injectable()
export class GuestStayAccessGuard implements CanActivate {
  constructor(private readonly stayAccessService: StayAccessService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.stayAccessService.authorize(request.headers.authorization);
    return true;
  }
}
