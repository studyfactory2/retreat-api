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
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  CancelStayInput,
  CreateStayInput,
  GetStayHistoryInput,
  GetStaysInput,
  RestoreStayInput,
  UpdateStayInput,
} from '../../libs/dto/stay/stay.input';
import type {
  StayDto,
  StayListDto,
  StayRevisionListDto,
} from '../../libs/dto/stay/stay';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaysService } from './stays.service';

const stayIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_STAY_ID',
      message: '이용 일정 ID를 확인해 주세요.',
    }),
});

@Controller('admin/stays')
export class StaysController {
  constructor(private readonly staysService: StaysService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @Header('Cache-Control', 'no-store')
  public async createStay(
    @Body() input: CreateStayInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<StayDto> {
    console.log('POST: createStay');
    return await this.staysService.createStay(input, actor);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getStays(@Query() input: GetStaysInput): Promise<StayListDto> {
    console.log('GET: getStays');
    return await this.staysService.getStays(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  public async getStay(@Param('id', stayIdPipe) id: string): Promise<StayDto> {
    console.log('GET: getStay');
    return await this.staysService.getStay(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/update')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async updateStay(
    @Param('id', stayIdPipe) id: string,
    @Body() input: UpdateStayInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<StayDto> {
    console.log('POST: updateStay');
    return await this.staysService.updateStay(id, input, actor);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async cancelStay(
    @Param('id', stayIdPipe) id: string,
    @Body() input: CancelStayInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<StayDto> {
    console.log('POST: cancelStay');
    return await this.staysService.cancelStay(id, input, actor);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async restoreStay(
    @Param('id', stayIdPipe) id: string,
    @Body() input: RestoreStayInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<StayDto> {
    console.log('POST: restoreStay');
    return await this.staysService.restoreStay(id, input, actor);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  public async getStayHistory(
    @Param('id', stayIdPipe) id: string,
    @Query() input: GetStayHistoryInput,
  ): Promise<StayRevisionListDto> {
    console.log('GET: getStayHistory');
    return await this.staysService.getStayHistory(id, input);
  }
}
