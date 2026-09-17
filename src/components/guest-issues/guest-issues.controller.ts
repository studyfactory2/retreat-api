import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  GetGuestIssueCategoriesInput,
  ReportGuestIssueInput,
} from '../../libs/dto/guest-issue/guest-issue.input';
import type {
  GuestIssueCategoryListDto,
  GuestIssueReceiptDto,
} from '../../libs/dto/guest-issue/guest-issue';
import { GuestIssuesService } from './guest-issues.service';

@Controller('guest/issues')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestIssuesController {
  constructor(private readonly guestIssuesService: GuestIssuesService) {}

  @Get('categories')
  @Header('Cache-Control', 'no-store')
  public async getCategories(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetGuestIssueCategoriesInput,
  ): Promise<GuestIssueCategoryListDto> {
    console.log('GET: getGuestIssueCategories');
    return await this.guestIssuesService.getCategories(authorization, input);
  }

  @Post('report')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async reportIssue(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: ReportGuestIssueInput,
  ): Promise<GuestIssueReceiptDto> {
    console.log('POST: reportGuestIssue');
    return await this.guestIssuesService.reportIssue(authorization, input);
  }
}
