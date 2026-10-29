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
  CreateStaffInput,
  GetStaffInput,
  UpdateStaffInput,
} from '../../libs/dto/user/staff.input';
import type { StaffDto, StaffListDto } from '../../libs/dto/user/staff';
import { DeactivateStaffInput } from '../../libs/dto/user/staff-deactivation.input';
import type {
  StaffDeactivationPreviewDto,
  StaffDeactivationResultDto,
} from '../../libs/dto/user/staff-deactivation';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminUsersService } from './admin-users.service';
import { StaffDeactivationService } from './staff-deactivation.service';

const staffIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_STAFF_ID',
      message: '직원 ID를 확인해 주세요.',
    }),
});

@Controller('admin')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly staffDeactivation: StaffDeactivationService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('staff')
  @Header('Cache-Control', 'no-store')
  public async createStaff(@Body() input: CreateStaffInput): Promise<StaffDto> {
    console.log('POST: createStaff');
    return await this.adminUsersService.createStaff(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('staff')
  @Header('Cache-Control', 'no-store')
  public async getStaffList(
    @Query() input: GetStaffInput,
  ): Promise<StaffListDto> {
    console.log('GET: getStaffList');
    return await this.adminUsersService.getStaffList(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('staff/:id')
  @Header('Cache-Control', 'no-store')
  public async getStaff(
    @Param('id', staffIdPipe) id: string,
  ): Promise<StaffDto> {
    console.log('GET: getStaff');
    return await this.adminUsersService.getStaff(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('staff/:id/update')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async updateStaff(
    @Param('id', staffIdPipe) id: string,
    @Body() input: UpdateStaffInput,
  ): Promise<StaffDto> {
    console.log('POST: updateStaff');
    return await this.adminUsersService.updateStaff(id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('staff/:id/deactivation-preview')
  @Header('Cache-Control', 'no-store')
  public async previewDeactivation(
    @Param('id', staffIdPipe) id: string,
  ): Promise<StaffDeactivationPreviewDto> {
    return this.staffDeactivation.preview(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('staff/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async deactivateStaff(
    @Param('id', staffIdPipe) id: string,
    @Body() input: DeactivateStaffInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<StaffDeactivationResultDto> {
    return this.staffDeactivation.deactivate(id, input, actor);
  }
}
