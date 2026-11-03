import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { RevealTaskPasswordInput } from '../../libs/dto/staff-cleaning-task/staff-cleaning-task.input';
import type {
  TaskPasswordDto,
  RevealedTaskPasswordDto,
} from '../../libs/dto/staff-cleaning-task/staff-cleaning-task';
import { StaffCleaningTasksService } from './staff-cleaning-tasks.service';

@Controller('submission-drafts/task-password')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class TaskPasswordController {
  constructor(private readonly service: StaffCleaningTasksService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  public async password(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<TaskPasswordDto> {
    console.log('GET: cleaningTaskPassword');
    return await this.service.password(authorization);
  }

  @Post('reveal')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async reveal(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: RevealTaskPasswordInput,
  ): Promise<RevealedTaskPasswordDto> {
    console.log('POST: revealCleaningTaskPassword');
    return await this.service.revealPassword(authorization, input);
  }
}
