import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { SubmissionDraftsService } from '../../submission-drafts/submission-drafts.service';

@Injectable()
export class DraftPhotoAccessGuard implements CanActivate {
  constructor(
    private readonly submissionDraftsService: SubmissionDraftsService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.submissionDraftsService.getDraft(request.headers.authorization);
    return true;
  }
}
