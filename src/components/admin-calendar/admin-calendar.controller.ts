import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { GetAdminCalendarInput } from '../../libs/dto/admin-calendar/admin-calendar.input';
import type { AdminCalendarDto } from '../../libs/dto/admin-calendar/admin-calendar';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminCalendarService } from './admin-calendar.service';

@Controller('admin/calendar')
export class AdminCalendarController {
  constructor(private readonly adminCalendarService: AdminCalendarService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getCalendar(
    @Query() input: GetAdminCalendarInput,
  ): Promise<AdminCalendarDto> {
    console.log('GET: getAdminCalendar');
    return await this.adminCalendarService.getCalendar(input);
  }
}
