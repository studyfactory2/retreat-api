import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedSession } from '../../libs/dto/user/user';
import type {
  AdminAccountDto,
  PasswordChangedDto,
} from '../../libs/dto/user/account';
import {
  ChangePasswordInput,
  UpdateAccountInput,
} from '../../libs/dto/user/account.input';
import { AdminAccountService } from './admin-account.service';

@Controller('admin/account')
export class AdminAccountController {
  constructor(private readonly account: AdminAccountService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getAccount(
    @AuthUser() actor: AuthenticatedSession,
  ): Promise<AdminAccountDto> {
    console.log('GET: getAccount');
    return await this.account.getAccount(actor);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('profile')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  public async updateProfile(
    @AuthUser() actor: AuthenticatedSession,
    @Body() input: UpdateAccountInput,
  ): Promise<AdminAccountDto> {
    console.log('POST: updateProfile');
    return await this.account.updateProfile(actor, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Post('password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  public async changePassword(
    @AuthUser() actor: AuthenticatedSession,
    @Body() input: ChangePasswordInput,
  ): Promise<PasswordChangedDto> {
    console.log('POST: changePassword');
    return await this.account.changePassword(actor, input);
  }
}
