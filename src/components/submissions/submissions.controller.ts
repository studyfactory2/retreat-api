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
import { SubmitChecklistInput } from '../../libs/dto/submission/submission.input';
import type { SubmissionReceiptDto } from '../../libs/dto/submission/submission';
import { SubmissionsService } from './submissions.service';

@Controller('submissions')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async submitChecklist(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: SubmitChecklistInput,
  ): Promise<SubmissionReceiptDto> {
    console.log('POST: submitChecklist');
    return await this.submissionsService.submitChecklist(authorization, input);
  }

  @Get('receipt')
  @Header('Cache-Control', 'no-store')
  public async getSubmissionReceipt(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SubmissionReceiptDto> {
    console.log('GET: getSubmissionReceipt');
    return await this.submissionsService.getReceipt(authorization);
  }
}
