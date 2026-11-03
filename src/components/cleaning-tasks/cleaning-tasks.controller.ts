import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CancelCleaningTaskInput,
  CreateCleaningTaskInput,
  GetCleaningTasksInput,
  SyncCleaningTasksInput,
  UpdateCleaningTaskInput,
} from '../../libs/dto/cleaning-task/cleaning-task.input';
import type {
  CleaningTaskDto,
  CleaningTaskListDto,
  CleaningTaskSyncDto,
} from '../../libs/dto/cleaning-task/cleaning-task';
import { CleaningTasksService } from './cleaning-tasks.service';
const taskIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_CLEANING_TASK_ID',
      message: '작업 ID를 확인해 주세요.',
    }),
});

@Controller('admin/cleaning-tasks')
export class CleaningTasksController {
  constructor(private readonly tasks: CleaningTasksService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async list(
    @Query() input: GetCleaningTasksInput,
  ): Promise<CleaningTaskListDto> {
    console.log('GET: getCleaningTasks');
    return await this.tasks.list(input);
  }
  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  public async get(
    @Param('id', taskIdPipe) id: string,
  ): Promise<CleaningTaskDto> {
    console.log('GET: getCleaningTask');
    return await this.tasks.get(id);
  }
  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @Header('Cache-Control', 'no-store')
  public async create(
    @Body() input: CreateCleaningTaskInput,
  ): Promise<CleaningTaskDto> {
    console.log('POST: createCleaningTask');
    return await this.tasks.create(input);
  }
  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('sync')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  public async sync(
    @Body() input: SyncCleaningTasksInput,
  ): Promise<CleaningTaskSyncDto> {
    console.log('POST: syncCleaningTasks');
    return await this.tasks.sync(input);
  }
  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/update')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  public async update(
    @Param('id', taskIdPipe) id: string,
    @Body() input: UpdateCleaningTaskInput,
  ): Promise<CleaningTaskDto> {
    console.log('POST: updateCleaningTask');
    return await this.tasks.update(id, input);
  }
  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  public async cancel(
    @Param('id', taskIdPipe) id: string,
    @Body() input: CancelCleaningTaskInput,
  ): Promise<CleaningTaskDto> {
    console.log('POST: cancelCleaningTask');
    return await this.tasks.cancel(id, input);
  }
}
