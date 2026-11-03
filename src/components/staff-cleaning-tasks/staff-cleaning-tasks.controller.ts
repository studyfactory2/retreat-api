import {
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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CleaningTaskListDto } from '../../libs/dto/cleaning-task/cleaning-task';
import {
  GetStaffCleaningTasksInput,
  StartCleaningTaskInput,
} from '../../libs/dto/staff-cleaning-task/staff-cleaning-task.input';
import type { StartDraftDto } from '../../libs/dto/submission-draft/submission-draft';
import { StaffCleaningTasksService } from './staff-cleaning-tasks.service';

@Controller('staff/cleaning-tasks')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class StaffCleaningTasksController {
  constructor(private readonly service: StaffCleaningTasksService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  public async list(
    @Headers('authorization') authorization: string | undefined,
    @Query() input: GetStaffCleaningTasksInput,
  ): Promise<CleaningTaskListDto> {
    console.log('GET: staffCleaningTasks');
    return await this.service.list(authorization, input);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async sync(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: GetStaffCleaningTasksInput,
  ): Promise<CleaningTaskListDto> {
    console.log('POST: syncStaffCleaningTasks');
    return await this.service.sync(authorization, input);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async start(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: StartCleaningTaskInput,
  ): Promise<StartDraftDto> {
    console.log('POST: startCleaningTask');
    return await this.service.start(authorization, id, input);
  }
}
