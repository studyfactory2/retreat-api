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
import { GuestStayAccessGuard } from '../auth/guards/guest-stay-access.guard';
import {
  GetGuestStayVehicleInput,
  SaveGuestStayVehicleInput,
} from '../../libs/dto/guest-stay-vehicle/guest-stay-vehicle.input';
import type { GuestStayVehicleDto } from '../../libs/dto/guest-stay-vehicle/guest-stay-vehicle';
import { GuestStayVehiclesService } from './guest-stay-vehicles.service';

@Controller('guest/stays/vehicle')
@UseGuards(ThrottlerGuard, GuestStayAccessGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestStayVehiclesController {
  constructor(
    private readonly guestStayVehiclesService: GuestStayVehiclesService,
  ) {}

  @Get()
  public async getVehicle(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetGuestStayVehicleInput,
  ): Promise<GuestStayVehicleDto> {
    void input;
    console.log('GET: getGuestStayVehicle');
    return await this.guestStayVehiclesService.getVehicle(authorization);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async saveVehicle(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: GetGuestStayVehicleInput,
    @Body() input: SaveGuestStayVehicleInput,
  ): Promise<GuestStayVehicleDto> {
    void query;
    console.log('POST: saveGuestStayVehicle');
    return await this.guestStayVehiclesService.saveVehicle(
      authorization,
      input,
    );
  }
}
