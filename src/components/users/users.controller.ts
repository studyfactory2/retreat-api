import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LoginInput } from '../../libs/dto/user/user.input';
import type {
  AuthenticatedUser,
  LoginResponse,
} from '../../libs/dto/user/user';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  public login(@Body() input: LoginInput): Promise<LoginResponse> {
    return this.usersService.login(input);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  public me(@AuthUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
