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
  GetAdminPropertyGuideInput,
  SaveAdminPropertyGuideInput,
} from '../../libs/dto/admin-property-guide/admin-property-guide.input';
import type { AdminPropertyGuideDto } from '../../libs/dto/admin-property-guide/admin-property-guide';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminPropertyGuidesService } from './admin-property-guides.service';

const propertyIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PROPERTY_ID',
      message: '휴양소 ID를 확인해 주세요.',
    }),
});

@Controller('admin/properties/:id/guide')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AdminPropertyGuidesController {
  constructor(
    private readonly adminPropertyGuidesService: AdminPropertyGuidesService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  public async getGuide(
    @Param('id', propertyIdPipe) id: string,
    @Query() input: GetAdminPropertyGuideInput,
  ): Promise<AdminPropertyGuideDto> {
    void input;
    console.log('GET: getPropertyGuide');
    return await this.adminPropertyGuidesService.getGuide(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async saveGuide(
    @Param('id', propertyIdPipe) id: string,
    @Query() query: GetAdminPropertyGuideInput,
    @Body() input: SaveAdminPropertyGuideInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<AdminPropertyGuideDto> {
    void query;
    console.log('POST: savePropertyGuide');
    return await this.adminPropertyGuidesService.saveGuide(id, input, actor.id);
  }
}
