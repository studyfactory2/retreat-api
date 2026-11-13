import {
  Controller,
  Get,
  Header,
  Headers,
  Query,
  UseGuards,
  type StreamableFile,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { GetPropertyGuidePdfInput } from '../../libs/dto/admin-property-guide/admin-property-guide.input';
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

  @Get('qr/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Access-Control-Expose-Headers', 'Content-Disposition')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async getQrPdf(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetPropertyGuidePdfInput,
  ): Promise<StreamableFile> {
    console.log('GET: getGuestPropertyGuidePdfByQr');
    return await this.guestPropertyGuidesService.getPdf(
      authorization,
      'qr',
      input.version,
    );
  }

  @Get('stay/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Access-Control-Expose-Headers', 'Content-Disposition')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async getStayPdf(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetPropertyGuidePdfInput,
  ): Promise<StreamableFile> {
    console.log('GET: getGuestPropertyGuidePdfByStay');
    return await this.guestPropertyGuidesService.getPdf(
      authorization,
      'stay',
      input.version,
    );
  }
}
