import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  GetGuestStayInput,
  StartStayGuestDraftInput,
} from '../../libs/dto/guest-stay/guest-stay.input';
import type { GuestStayDto } from '../../libs/dto/guest-stay/guest-stay';
import type { StartDraftDto } from '../../libs/dto/submission-draft/submission-draft';
import { GuestStayAccessGuard } from '../auth/guards/guest-stay-access.guard';
import { GuestStaysService } from './guest-stays.service';

@Controller('guest/stays')
@UseGuards(ThrottlerGuard, GuestStayAccessGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestStaysController {
  constructor(private readonly guestStaysService: GuestStaysService) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  public async getCurrent(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetGuestStayInput,
  ): Promise<GuestStayDto> {
    console.log('GET: getGuestStay');
    return await this.guestStaysService.getCurrent(authorization, input);
  }

  @Post('drafts/start')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async startGuestDraft(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: GetGuestStayInput,
    @Body() input: StartStayGuestDraftInput,
  ): Promise<StartDraftDto> {
    void query;
    console.log('POST: startStayGuestDraft');
    return await this.guestStaysService.startGuestDraft(authorization, input);
  }
}
