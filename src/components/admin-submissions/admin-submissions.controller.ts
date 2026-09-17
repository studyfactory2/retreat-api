import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  GetAdminSubmissionHistoryInput,
  GetAdminSubmissionsInput,
} from '../../libs/dto/admin-submission/admin-submission.input';
import type {
  AdminSubmissionDetailDto,
  AdminSubmissionHistoryDto,
  AdminSubmissionListDto,
  AdminSubmissionPhotoViewDto,
} from '../../libs/dto/admin-submission/admin-submission';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminSubmissionsService } from './admin-submissions.service';

const submissionIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_SUBMISSION_ID',
      message: '제출 내역 ID를 확인해 주세요.',
    }),
});

const revisionIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_SUBMISSION_REVISION_ID',
      message: '제출 이력 ID를 확인해 주세요.',
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

@Controller('admin/submissions')
export class AdminSubmissionsController {
  constructor(
    private readonly adminSubmissionsService: AdminSubmissionsService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getSubmissions(
    @Query() input: GetAdminSubmissionsInput,
  ): Promise<AdminSubmissionListDto> {
    console.log('GET: getSubmissions');
    return await this.adminSubmissionsService.getSubmissions(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  public async getSubmission(
    @Param('id', submissionIdPipe) id: string,
  ): Promise<AdminSubmissionDetailDto> {
    console.log('GET: getSubmission');
    return await this.adminSubmissionsService.getSubmission(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  public async getHistory(
    @Param('id', submissionIdPipe) id: string,
    @Query() input: GetAdminSubmissionHistoryInput,
  ): Promise<AdminSubmissionHistoryDto> {
    console.log('GET: getHistory');
    return await this.adminSubmissionsService.getHistory(id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/revisions/:revisionId/photos/:photoId/view')
  @Header('Cache-Control', 'no-store')
  public async getPhotoView(
    @Param('id', submissionIdPipe) id: string,
    @Param('revisionId', revisionIdPipe) revisionId: string,
    @Param('photoId', photoIdPipe) photoId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AdminSubmissionPhotoViewDto> {
    console.log('GET: getPhotoView');
    return await this.adminSubmissionsService.getPhotoView(
      id,
      revisionId,
      photoId,
      authorization,
    );
  }
}
