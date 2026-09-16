import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  SaveDraftInput,
  StartGuestDraftInput,
  StartStaffDraftInput,
} from '../../libs/dto/submission-draft/submission-draft.input';
import type {
  StartDraftDto,
  SubmissionDraftDto,
} from '../../libs/dto/submission-draft/submission-draft';
import { SubmissionDraftsService } from './submission-drafts.service';

@Controller('submission-drafts')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class SubmissionDraftsController {
  constructor(
    private readonly submissionDraftsService: SubmissionDraftsService,
  ) {}

  @Post('guest/start')
  @Header('Cache-Control', 'no-store')
  public async startGuestDraft(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: StartGuestDraftInput,
  ): Promise<StartDraftDto> {
    console.log('POST: startGuestDraft');
    return await this.submissionDraftsService.startGuestDraft(
      authorization,
      input,
    );
  }

  @Post('staff/start')
  @Header('Cache-Control', 'no-store')
  public async startStaffDraft(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: StartStaffDraftInput,
  ): Promise<StartDraftDto> {
    console.log('POST: startStaffDraft');
    return await this.submissionDraftsService.startStaffDraft(
      authorization,
      input,
    );
  }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getDraft(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SubmissionDraftDto> {
    console.log('GET: getDraft');
    return await this.submissionDraftsService.getDraft(authorization);
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async saveDraft(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: SaveDraftInput,
  ): Promise<SubmissionDraftDto> {
    console.log('POST: saveDraft');
    return await this.submissionDraftsService.saveDraft(authorization, input);
  }
}
