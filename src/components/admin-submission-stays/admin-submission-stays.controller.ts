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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import {
  EmptySubmissionStayQueryInput,
  GetSubmissionStayCandidatesInput,
  LinkSubmissionStayInput,
} from '../../libs/dto/admin-submission-stay/admin-submission-stay.input';
import type {
  SubmissionStayCandidatesDto,
  SubmissionStayLinkDto,
} from '../../libs/dto/admin-submission-stay/admin-submission-stay';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminSubmissionStaysService } from './admin-submission-stays.service';

const submissionIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_SUBMISSION_ID',
      message: '제출 내역 ID를 확인해 주세요.',
    }),
});

@Controller('admin/submissions')
export class AdminSubmissionStaysController {
  constructor(
    private readonly adminSubmissionStaysService: AdminSubmissionStaysService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get(':id/stay-candidates')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getCandidates(
    @Param('id', submissionIdPipe) id: string,
    @Query() input: GetSubmissionStayCandidatesInput,
  ): Promise<SubmissionStayCandidatesDto> {
    console.log('GET: getSubmissionStayCandidates');
    return await this.adminSubmissionStaysService.getCandidates(id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Post(':id/link-stay')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async linkStay(
    @Param('id', submissionIdPipe) id: string,
    @Body() input: LinkSubmissionStayInput,
    @Query() query: EmptySubmissionStayQueryInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<SubmissionStayLinkDto> {
    void query;
    console.log('POST: linkSubmissionStay');
    return await this.adminSubmissionStaysService.linkStay(id, input, actor);
  }
}
