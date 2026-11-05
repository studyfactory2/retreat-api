import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { MessageSubjectType, Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MessageAutomationService } from './message-automation.service';

const idPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_MESSAGE_SUBJECT',
      message: '일정 또는 작업을 확인해 주세요.',
    }),
});

@Controller('admin/message-automation')
export class MessageAutomationController {
  constructor(private readonly automation: MessageAutomationService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('stays/:id')
  @Header('Cache-Control', 'no-store')
  public async stay(@Param('id', idPipe) id: string) {
    console.log('GET: getStayMessageAutomation');
    return await this.automation.getSubject(MessageSubjectType.STAY, id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('tasks/:id')
  @Header('Cache-Control', 'no-store')
  public async task(@Param('id', idPipe) id: string) {
    console.log('GET: getTaskMessageAutomation');
    return await this.automation.getSubject(MessageSubjectType.TASK, id);
  }
}
