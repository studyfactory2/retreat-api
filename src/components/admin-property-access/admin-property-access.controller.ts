import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import {
  GetAdminPropertyAccessSettingsInput,
  RevealAdminPropertyAccessCodeInput,
  SaveAdminPropertyAccessSettingsInput,
} from '../../libs/dto/admin-property-access/admin-property-access.input';
import type {
  AdminPropertyAccessSettingsDto,
  RevealedPropertyAccessCodeDto,
} from '../../libs/dto/admin-property-access/admin-property-access';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminPropertyAccessService } from './admin-property-access.service';

const propertyIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PROPERTY_ID',
      message: '휴양소 ID를 확인해 주세요.',
    }),
});

@Controller('admin/properties/:id/access-settings')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AdminPropertyAccessController {
  constructor(private readonly access: AdminPropertyAccessService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  public async getSettings(
    @Param('id', propertyIdPipe) id: string,
    @Query() input: GetAdminPropertyAccessSettingsInput,
  ): Promise<AdminPropertyAccessSettingsDto> {
    void input;
    console.log('GET: getPropertyAccessSettings');
    return await this.access.getSettings(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async saveSettings(
    @Param('id', propertyIdPipe) id: string,
    @Query() query: GetAdminPropertyAccessSettingsInput,
    @Body() input: SaveAdminPropertyAccessSettingsInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<AdminPropertyAccessSettingsDto> {
    void query;
    console.log('POST: savePropertyAccessSettings');
    return await this.access.saveSettings(id, input, actor.id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('reveal')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async revealCode(
    @Param('id', propertyIdPipe) id: string,
    @Query() query: GetAdminPropertyAccessSettingsInput,
    @Body() input: RevealAdminPropertyAccessCodeInput,
  ): Promise<RevealedPropertyAccessCodeDto> {
    void query;
    console.log('POST: revealPropertyAccessCode');
    return await this.access.revealCode(id, input);
  }
}
