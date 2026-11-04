import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {
  GuestStayAccessCodesDto,
  RevealedGuestStayAccessCodeDto,
} from '../../libs/dto/guest-stay-access-codes/guest-stay-access-codes';
import {
  GetGuestStayAccessCodesInput,
  RevealGuestStayAccessCodeInput,
} from '../../libs/dto/guest-stay-access-codes/guest-stay-access-codes.input';
import { GuestStayAccessGuard } from '../auth/guards/guest-stay-access.guard';
import { GuestStayCodesService } from './guest-stay-codes.service';

@Controller('guest/stays/current/access-codes')
@UseGuards(ThrottlerGuard, GuestStayAccessGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class GuestStayCodesController {
  constructor(private readonly service: GuestStayCodesService) {}

  @Get()
  public async get(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: GetGuestStayAccessCodesInput,
  ): Promise<GuestStayAccessCodesDto> {
    void query;
    console.log('GET: guestStayAccessCodes');
    return await this.service.get(authorization);
  }

  @Post('reveal')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async reveal(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: GetGuestStayAccessCodesInput,
    @Body() input: RevealGuestStayAccessCodeInput,
  ): Promise<RevealedGuestStayAccessCodeDto> {
    void query;
    console.log('POST: revealGuestStayAccessCode');
    return await this.service.reveal(authorization, input);
  }
}
