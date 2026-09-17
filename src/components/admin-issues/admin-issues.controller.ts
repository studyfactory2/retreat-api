import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
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
  AddAdminIssueNoteInput,
  ChangeAdminIssueStatusInput,
  GetAdminIssueHistoryInput,
  GetAdminIssuesInput,
} from '../../libs/dto/admin-issue/admin-issue.input';
import type {
  AdminIssueDetailDto,
  AdminIssueHistoryDto,
  AdminIssueListDto,
  AdminIssuePhotoViewDto,
} from '../../libs/dto/admin-issue/admin-issue';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminIssuePhotosService } from './admin-issue-photos.service';
import { AdminIssuesService } from './admin-issues.service';

const issueIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_ISSUE_ID',
      message: '이상사항 ID를 확인해 주세요.',
    }),
});

const eventIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_ISSUE_EVENT_ID',
      message: '이상사항 이력 ID를 확인해 주세요.',
    }),
});

const photoIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PHOTO_ID',
      message: '사진 ID를 확인해 주세요.',
    }),
});

@Controller('admin/issues')
export class AdminIssuesController {
  constructor(
    private readonly adminIssuesService: AdminIssuesService,
    private readonly adminIssuePhotosService: AdminIssuePhotosService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getIssues(
    @Query() input: GetAdminIssuesInput,
  ): Promise<AdminIssueListDto> {
    console.log('GET: getIssues');
    return await this.adminIssuesService.getIssues(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  public async getIssue(
    @Param('id', issueIdPipe) id: string,
  ): Promise<AdminIssueDetailDto> {
    console.log('GET: getIssue');
    return await this.adminIssuesService.getIssue(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  public async getHistory(
    @Param('id', issueIdPipe) id: string,
    @Query() input: GetAdminIssueHistoryInput,
  ): Promise<AdminIssueHistoryDto> {
    console.log('GET: getHistory');
    return await this.adminIssuesService.getHistory(id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/events/:eventId/photos/:photoId/view')
  @Header('Cache-Control', 'no-store')
  public async getPhotoView(
    @Param('id', issueIdPipe) id: string,
    @Param('eventId', eventIdPipe) eventId: string,
    @Param('photoId', photoIdPipe) photoId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AdminIssuePhotoViewDto> {
    console.log('GET: getPhotoView');
    return await this.adminIssuePhotosService.getPhotoView(
      id,
      eventId,
      photoId,
      authorization,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/notes')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async addNote(
    @Param('id', issueIdPipe) id: string,
    @Body() input: AddAdminIssueNoteInput,
    @AuthUser('id') adminId: string,
  ): Promise<AdminIssueDetailDto> {
    console.log('POST: addNote');
    return await this.adminIssuesService.addNote(id, input, adminId);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async changeStatus(
    @Param('id', issueIdPipe) id: string,
    @Body() input: ChangeAdminIssueStatusInput,
    @AuthUser('id') adminId: string,
  ): Promise<AdminIssueDetailDto> {
    console.log('POST: changeStatus');
    return await this.adminIssuesService.changeStatus(id, input, adminId);
  }
}
