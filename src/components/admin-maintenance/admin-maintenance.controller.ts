import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { GetAdminMaintenanceInput } from '../../libs/dto/admin-maintenance/admin-maintenance.input';
import type { AdminMaintenanceDto } from '../../libs/dto/admin-maintenance/admin-maintenance';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminMaintenanceService } from './admin-maintenance.service';

@Controller('admin/maintenance')
export class AdminMaintenanceController {
  constructor(
    private readonly adminMaintenanceService: AdminMaintenanceService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getMaintenance(
    @Query() input: GetAdminMaintenanceInput,
  ): Promise<AdminMaintenanceDto> {
    console.log('GET: getAdminMaintenance');
    return await this.adminMaintenanceService.getMaintenance(input);
  }
}
