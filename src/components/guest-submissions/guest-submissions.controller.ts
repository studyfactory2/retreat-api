import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { GetGuestSubmissionInput } from '../../libs/dto/guest-submission/guest-submission.input';
import type {
  GuestSubmissionDto,
  GuestSubmissionPhotoViewDto,
} from '../../libs/dto/guest-submission/guest-submission';
import { GuestSubmissionAccessGuard } from '../auth/guards/guest-submission-access.guard';
import { GuestSubmissionsService } from './guest-submissions.service';

const photoIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PHOTO_ID',
      message: '사진 ID를 확인해 주세요.',
    }),
});

@Controller('guest/submissions')
@UseGuards(ThrottlerGuard, GuestSubmissionAccessGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestSubmissionsController {
  constructor(
    private readonly guestSubmissionsService: GuestSubmissionsService,
  ) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  public async getCurrent(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetGuestSubmissionInput,
  ): Promise<GuestSubmissionDto> {
    console.log('GET: getGuestSubmission');
    return await this.guestSubmissionsService.getCurrent(authorization, input);
  }

  @Get('photos/:id/view')
  @Header('Cache-Control', 'no-store')
  public async getPhotoView(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', photoIdPipe) id: string,
    @Query() input: GetGuestSubmissionInput,
  ): Promise<GuestSubmissionPhotoViewDto> {
    console.log('GET: getGuestSubmissionPhotoView');
    return await this.guestSubmissionsService.getPhotoView(
      authorization,
      id,
      input,
    );
  }
}
