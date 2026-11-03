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
  GetAdminStayAccessInput,
  SaveAdminStayAccessInput,
  StayAccessVersionsInput,
} from '../../libs/dto/admin-stay-access/admin-stay-access.input';
import type {
  AdminStayAccessDto,
  RevealedStayAccessCodeDto,
} from '../../libs/dto/admin-stay-access/admin-stay-access';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminStayAccessService } from './admin-stay-access.service';

const stayIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_STAY_ID',
      message: '이용 일정 ID를 확인해 주세요.',
    }),
});

@Controller('admin/stays/:id/access-code')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AdminStayAccessController {
  constructor(private readonly access: AdminStayAccessService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  public async getAccessCode(
    @Param('id', stayIdPipe) id: string,
    @Query() input: GetAdminStayAccessInput,
  ): Promise<AdminStayAccessDto> {
    void input;
    console.log('GET: getStayAccessCode');
    return await this.access.getAccessCode(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async saveAccessCode(
    @Param('id', stayIdPipe) id: string,
    @Query() query: GetAdminStayAccessInput,
    @Body() input: SaveAdminStayAccessInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<AdminStayAccessDto> {
    void query;
    console.log('POST: saveStayAccessCode');
    return await this.access.saveAccessCode(id, input, actor.id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('reveal')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async revealAccessCode(
    @Param('id', stayIdPipe) id: string,
    @Query() query: GetAdminStayAccessInput,
    @Body() input: StayAccessVersionsInput,
  ): Promise<RevealedStayAccessCodeDto> {
    void query;
    console.log('POST: revealStayAccessCode');
    return await this.access.revealAccessCode(id, input);
  }
}
