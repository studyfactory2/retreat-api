import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { GetAdminStayVehicleInput } from '../../libs/dto/admin-stay-vehicle/admin-stay-vehicle.input';
import type { AdminStayVehicleDto } from '../../libs/dto/admin-stay-vehicle/admin-stay-vehicle';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminStayVehiclesService } from './admin-stay-vehicles.service';

const stayIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_STAY_ID',
      message: '이용 일정 ID를 확인해 주세요.',
    }),
});

@Controller('admin/stays')
export class AdminStayVehiclesController {
  constructor(
    private readonly adminStayVehiclesService: AdminStayVehiclesService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get(':id/vehicle')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getVehicle(
    @Param('id', stayIdPipe) id: string,
    @Query() input: GetAdminStayVehicleInput,
  ): Promise<AdminStayVehicleDto> {
    console.log('GET: getStayVehicle');
    return await this.adminStayVehiclesService.getVehicle(id, input);
  }
}
