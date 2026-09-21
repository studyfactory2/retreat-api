import {
  Controller,
  Get,
  Header,
  Query,
  type StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { GetAdminReportInput } from '../../libs/dto/admin-report/admin-report.input';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminReportsService } from './admin-reports.service';

@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get('excel')
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'Content-Disposition')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async getExcel(
    @Query() input: GetAdminReportInput,
  ): Promise<StreamableFile> {
    console.log('GET: getAdminReportExcel');
    return await this.adminReportsService.getExcel(input);
  }
}
