import { Controller, Get, Header, Headers, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {
  GuestQrContextDto,
  StaffQrContextDto,
} from '../../libs/dto/qr/qr';
import { QrService } from './qr.service';

@Controller('qr')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @Get('guest')
  @Header('Cache-Control', 'no-store')
  public async getGuestContext(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<GuestQrContextDto> {
    console.log('GET: getGuestContext');
    return await this.qrService.getGuestContext(authorization);
  }

  @Get('staff')
  @Header('Cache-Control', 'no-store')
  public async getStaffContext(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<StaffQrContextDto> {
    console.log('GET: getStaffContext');
    return await this.qrService.getStaffContext(authorization);
  }
}
