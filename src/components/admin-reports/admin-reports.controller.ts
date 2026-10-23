import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  Logger,
  type StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { PreservationZipDownload } from './preservation-zip.service';
import { Role } from '@prisma/client';
import { GetAdminReportInput } from '../../libs/dto/admin-report/admin-report.input';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminReportsService } from './admin-reports.service';

@Controller('admin/reports')
export class AdminReportsController {
  private readonly logger = new Logger(AdminReportsController.name);
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get('preservation-zip')
  @Header('Cache-Control', 'no-store')
  @Header(
    'Access-Control-Expose-Headers',
    'Content-Disposition, X-Archive-Photos-Total, X-Archive-Photos-Included, X-Archive-Photos-Skipped',
  )
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async getPreservationZip(
    @Query() input: GetAdminReportInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    console.log('GET: getPreservationZip');
    const controller = new AbortController();
    let download: PreservationZipDownload | undefined;
    const dispose = (): void => {
      if (download)
        void download.dispose().catch(() => {
          this.logger.error('Archive temporary file cleanup failed');
        });
    };
    const aborted = (): void => {
      controller.abort();
      dispose();
    };
    request.once('aborted', aborted);
    response.once('close', aborted);
    response.once('finish', dispose);
    try {
      download = await this.adminReportsService.getPreservationZip(
        input,
        controller.signal,
      );
      response.setHeader('X-Archive-Photos-Total', download.counts.total);
      response.setHeader('X-Archive-Photos-Included', download.counts.included);
      response.setHeader('X-Archive-Photos-Skipped', download.counts.skipped);
      return download.file;
    } catch (error) {
      if (download) await download.dispose();
      request.removeListener('aborted', aborted);
      response.removeListener('close', aborted);
      response.removeListener('finish', dispose);
      throw error;
    }
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get('preservation-excel')
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Expose-Headers', 'Content-Disposition')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async getPreservationExcel(
    @Query() input: GetAdminReportInput,
  ): Promise<StreamableFile> {
    console.log('GET: getPreservationExcel');
    return await this.adminReportsService.getPreservationExcel(input);
  }

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
