import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { GetAdminDashboardInput } from '../../libs/dto/admin-dashboard/admin-dashboard.input';
import type { AdminDashboardDto } from '../../libs/dto/admin-dashboard/admin-dashboard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getDashboard(
    @Query() input: GetAdminDashboardInput,
  ): Promise<AdminDashboardDto> {
    console.log('GET: getAdminDashboard');
    return await this.adminDashboardService.getDashboard(input);
  }
}
