import {
  Controller,
  Get,
  Header,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { GetGuestPropertyGuideInput } from '../../libs/dto/guest-property-guide/guest-property-guide.input';
import type { GuestPropertyGuideDto } from '../../libs/dto/guest-property-guide/guest-property-guide';
import { GuestPropertyGuidesService } from './guest-property-guides.service';

@Controller('guest/property-guides')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestPropertyGuidesController {
  constructor(
    private readonly guestPropertyGuidesService: GuestPropertyGuidesService,
  ) {}

  @Get('qr')
  @Header('Cache-Control', 'no-store')
  public async getQrGuide(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetGuestPropertyGuideInput,
  ): Promise<GuestPropertyGuideDto> {
    console.log('GET: getGuestPropertyGuideByQr');
    return await this.guestPropertyGuidesService.getQrGuide(
      authorization,
      input,
    );
  }

  @Get('stay')
  @Header('Cache-Control', 'no-store')
  public async getStayGuide(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetGuestPropertyGuideInput,
  ): Promise<GuestPropertyGuideDto> {
    console.log('GET: getGuestPropertyGuideByStay');
    return await this.guestPropertyGuidesService.getStayGuide(
      authorization,
      input,
    );
  }
}
