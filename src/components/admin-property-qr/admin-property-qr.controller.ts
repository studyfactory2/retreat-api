import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { RotatePropertyQrInput } from '../../libs/dto/qr/qr.input';
import { QrFlow } from '../../libs/dto/qr/qr';
import type { PropertyQrStatusDto, QrIssueDto } from '../../libs/dto/qr/qr';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminPropertyQrService } from './admin-property-qr.service';

const propertyIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PROPERTY_ID',
      message: '휴양소 ID를 확인해 주세요.',
    }),
});

@Controller('admin/properties')
export class AdminPropertyQrController {
  constructor(private readonly qrService: AdminPropertyQrService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/qr')
  @Header('Cache-Control', 'no-store')
  public async getPropertyQrStatus(
    @Param('id', propertyIdPipe) id: string,
  ): Promise<PropertyQrStatusDto> {
    console.log('GET: getPropertyQrStatus');
    return await this.qrService.getPropertyQrStatus(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/qr/guest/rotate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async rotateGuestQr(
    @Param('id', propertyIdPipe) id: string,
    @Body() input: RotatePropertyQrInput,
  ): Promise<QrIssueDto> {
    console.log('POST: rotateGuestQr');
    return await this.qrService.rotatePropertyQr(id, QrFlow.GUEST, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/qr/staff/rotate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async rotateStaffQr(
    @Param('id', propertyIdPipe) id: string,
    @Body() input: RotatePropertyQrInput,
  ): Promise<QrIssueDto> {
    console.log('POST: rotateStaffQr');
    return await this.qrService.rotatePropertyQr(id, QrFlow.STAFF, input);
  }
}
