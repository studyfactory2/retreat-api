import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { MessageSubjectType, Role } from '@prisma/client';
import type {
  MessageDispatchDto,
  MessagePreviewDto,
  MessagingStatusDto,
  MessagingSubjectDto,
} from '../../libs/dto/messaging/messaging';
import {
  MessagingEmptyInput,
  PreviewMessageInput,
  SendMessageInput,
} from '../../libs/dto/messaging/messaging.input';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MessagingService } from './messaging.service';

const idPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_MESSAGE_ID',
      message: '일정 또는 발송 ID를 확인해 주세요.',
    }),
});

@Controller('admin/messaging')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('status')
  public async status(
    @Query() query: MessagingEmptyInput,
  ): Promise<MessagingStatusDto> {
    void query;
    console.log('GET: getMessagingStatus');
    return await Promise.resolve(this.messaging.getStatus());
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('stays/:id')
  public async stay(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
  ): Promise<MessagingSubjectDto> {
    void query;
    console.log('GET: getStayMessaging');
    return await this.messaging.getSubject(MessageSubjectType.STAY, id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('tasks/:id')
  public async task(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
  ): Promise<MessagingSubjectDto> {
    void query;
    console.log('GET: getTaskMessaging');
    return await this.messaging.getSubject(MessageSubjectType.TASK, id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('stays/:id/preview')
  @HttpCode(HttpStatus.OK)
  public async previewStay(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
    @Body() input: PreviewMessageInput,
  ): Promise<MessagePreviewDto> {
    void query;
    console.log('POST: previewStayMessage');
    return await this.messaging.preview(MessageSubjectType.STAY, id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('tasks/:id/preview')
  @HttpCode(HttpStatus.OK)
  public async previewTask(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
    @Body() input: PreviewMessageInput,
  ): Promise<MessagePreviewDto> {
    void query;
    console.log('POST: previewTaskMessage');
    return await this.messaging.preview(MessageSubjectType.TASK, id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('stays/:id/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async sendStay(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
    @Body() input: SendMessageInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<MessageDispatchDto> {
    void query;
    console.log('POST: sendStayMessage');
    return await this.messaging.send(
      MessageSubjectType.STAY,
      id,
      input,
      actor.id,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('tasks/:id/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async sendTask(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
    @Body() input: SendMessageInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<MessageDispatchDto> {
    void query;
    console.log('POST: sendTaskMessage');
    return await this.messaging.send(
      MessageSubjectType.TASK,
      id,
      input,
      actor.id,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('dispatches/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async refresh(
    @Param('id', idPipe) id: string,
    @Query() query: MessagingEmptyInput,
    @Body() body: MessagingEmptyInput,
  ): Promise<MessageDispatchDto> {
    void query;
    void body;
    console.log('POST: refreshMessageDispatch');
    return await this.messaging.refresh(id);
  }
}
