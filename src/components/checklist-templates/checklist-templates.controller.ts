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
import { Role } from '@prisma/client';
import {
  CreateChecklistTemplateInput,
  GetChecklistTemplatesInput,
  GetChecklistTemplateVersionsInput,
  UpdateChecklistTemplateInput,
} from '../../libs/dto/checklist-template/checklist-template.input';
import type {
  ChecklistTemplateDto,
  ChecklistTemplateListDto,
  ChecklistTemplateVersionDto,
  ChecklistTemplateVersionListDto,
} from '../../libs/dto/checklist-template/checklist-template';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/decorators/auth.decorator';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChecklistTemplatesService } from './checklist-templates.service';

const checklistTemplateIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_CHECKLIST_TEMPLATE_ID',
      message: '체크리스트 ID를 확인해 주세요.',
    }),
});

const checklistVersionPipe = {
  transform(value: string): number {
    const version = Number(value);
    if (
      !/^[1-9]\d*$/.test(value) ||
      !Number.isInteger(version) ||
      version > 2147483647
    ) {
      throw new BadRequestException({
        code: 'INVALID_CHECKLIST_VERSION',
        message: '체크리스트 버전을 확인해 주세요.',
      });
    }
    return version;
  },
};

@Controller('admin/checklist-templates')
export class ChecklistTemplatesController {
  constructor(
    private readonly checklistTemplatesService: ChecklistTemplatesService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @Header('Cache-Control', 'no-store')
  public async createChecklistTemplate(
    @Body() input: CreateChecklistTemplateInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<ChecklistTemplateDto> {
    console.log('POST: createChecklistTemplate');
    return await this.checklistTemplatesService.createChecklistTemplate(
      input,
      actor,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getChecklistTemplates(
    @Query() input: GetChecklistTemplatesInput,
  ): Promise<ChecklistTemplateListDto> {
    console.log('GET: getChecklistTemplates');
    return await this.checklistTemplatesService.getChecklistTemplates(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  public async getChecklistTemplate(
    @Param('id', checklistTemplateIdPipe) id: string,
  ): Promise<ChecklistTemplateDto> {
    console.log('GET: getChecklistTemplate');
    return await this.checklistTemplatesService.getChecklistTemplate(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/update')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async updateChecklistTemplate(
    @Param('id', checklistTemplateIdPipe) id: string,
    @Body() input: UpdateChecklistTemplateInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<ChecklistTemplateDto> {
    console.log('POST: updateChecklistTemplate');
    return await this.checklistTemplatesService.updateChecklistTemplate(
      id,
      input,
      actor,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/versions')
  @Header('Cache-Control', 'no-store')
  public getVersions(
    @Param('id', checklistTemplateIdPipe) id: string,
    @Query() input: GetChecklistTemplateVersionsInput,
  ): Promise<ChecklistTemplateVersionListDto> {
    return this.checklistTemplatesService.getVersions(id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id/versions/:version')
  @Header('Cache-Control', 'no-store')
  public getVersion(
    @Param('id', checklistTemplateIdPipe) id: string,
    @Param('version', checklistVersionPipe) version: number,
  ): Promise<ChecklistTemplateVersionDto> {
    return this.checklistTemplatesService.getVersion(id, version);
  }
}
