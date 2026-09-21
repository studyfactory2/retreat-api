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
import {
  IssueStayGuestLinkInput,
  RevokeStayGuestLinkInput,
} from '../../libs/dto/admin-stay-link/admin-stay-link.input';
import type {
  AdminStayLinkStatusDto,
  IssueStayGuestLinkDto,
} from '../../libs/dto/admin-stay-link/admin-stay-link';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminStayLinksService } from './admin-stay-links.service';

const stayIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_STAY_ID',
      message: '이용 일정 ID를 확인해 주세요.',
    }),
});

@Controller('admin/stays')
export class AdminStayLinksController {
  constructor(private readonly adminStayLinksService: AdminStayLinksService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/guest-link')
  @Header('Cache-Control', 'no-store')
  public async getStayGuestLinkStatus(
    @Param('id', stayIdPipe) id: string,
  ): Promise<AdminStayLinkStatusDto> {
    console.log('GET: getStayGuestLinkStatus');
    return await this.adminStayLinksService.getStayGuestLinkStatus(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/guest-link/issue')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async issueStayGuestLink(
    @Param('id', stayIdPipe) id: string,
    @Body() input: IssueStayGuestLinkInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<IssueStayGuestLinkDto> {
    console.log('POST: issueStayGuestLink');
    return await this.adminStayLinksService.issueStayGuestLink(
      id,
      input,
      actor.id,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/guest-link/revoke')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async revokeStayGuestLink(
    @Param('id', stayIdPipe) id: string,
    @Body() input: RevokeStayGuestLinkInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<AdminStayLinkStatusDto> {
    console.log('POST: revokeStayGuestLink');
    return await this.adminStayLinksService.revokeStayGuestLink(
      id,
      input,
      actor.id,
    );
  }
}
