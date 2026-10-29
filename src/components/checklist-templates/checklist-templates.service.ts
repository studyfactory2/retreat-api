import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ChecklistTemplateVersionSource,
  Prisma,
  Role,
  type ChecklistTemplateVersion,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
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
  ChecklistTemplateVersionSummaryDto,
} from '../../libs/dto/checklist-template/checklist-template';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import {
  buildChecklistDefinition,
  parseChecklistDefinition,
} from './checklist-definition';

const templateSelect = {
  id: true,
  propertyId: true,
  type: true,
  title: true,
  version: true,
  definition: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { id: true, name: true, region: true, isActive: true } },
} satisfies Prisma.ChecklistTemplateSelect;

type SelectedTemplate = Prisma.ChecklistTemplateGetPayload<{
  select: typeof templateSelect;
}>;

@Injectable()
export class ChecklistTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  public async createChecklistTemplate(
    input: CreateChecklistTemplateInput,
    actor: AuthenticatedUser,
  ): Promise<ChecklistTemplateDto> {
    const definition = buildChecklistDefinition(input.sections);

    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const publisher = await this.requirePublisher(tx, actor);
        await this.requireActiveProperty(tx, input.propertyId);
        const existing = await tx.checklistTemplate.findUnique({
          where: {
            propertyId_type: { propertyId: input.propertyId, type: input.type },
          },
          select: { id: true },
        });
        if (existing) throw this.duplicateTemplate();

        const created = await tx.checklistTemplate.create({
          data: {
            propertyId: input.propertyId,
            type: input.type,
            title: input.title,
            definition,
            version: 1,
            isActive: true,
          },
          select: templateSelect,
        });
        const saved = this.toDto(created);
        await this.archivePublished(tx, saved, publisher);
        return saved;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.duplicateTemplate();
      }
      throw error;
    }
  }

  public async getChecklistTemplates(
    input: GetChecklistTemplatesInput,
  ): Promise<ChecklistTemplateListDto> {
    const where: Prisma.ChecklistTemplateWhereInput = {
      propertyId: input.propertyId,
      type: input.type,
      isActive: input.isActive,
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search, mode: 'insensitive' } },
              {
                property: {
                  name: { contains: input.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.checklistTemplate.findMany({
          where,
          select: templateSelect,
          orderBy: [{ propertyId: 'asc' }, { type: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        this.prisma.checklistTemplate.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  public async getChecklistTemplate(id: string): Promise<ChecklistTemplateDto> {
    return await this.findTemplate(this.prisma, id);
  }

  public async updateChecklistTemplate(
    id: string,
    input: UpdateChecklistTemplateInput,
    actor: AuthenticatedUser,
  ): Promise<ChecklistTemplateDto> {
    if (
      input.title === undefined &&
      input.sections === undefined &&
      input.isActive === undefined
    ) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: '변경할 체크리스트 내용을 입력해 주세요.',
      });
    }

    return await runSerializableTransaction(this.prisma, async (tx) => {
      const publisher = await this.requirePublisher(tx, actor);
      const current = await this.findTemplate(tx, id);
      if (input.expectedVersion !== current.version) {
        throw this.versionConflict();
      }
      await this.requireActiveProperty(tx, current.propertyId);

      const definition =
        input.sections === undefined
          ? current.definition
          : buildChecklistDefinition(input.sections, current.definition);
      const title = input.title ?? current.title;
      const isActive = input.isActive ?? current.isActive;
      if (
        title === current.title &&
        isActive === current.isActive &&
        JSON.stringify(definition) === JSON.stringify(current.definition)
      ) {
        return current;
      }

      // A pre-upgrade API must not publish between the baseline migration and
      // this release. Do not extend an archive whose current version is missing.
      const archivedCurrent = await tx.checklistTemplateVersion.findUnique({
        where: {
          templateId_version: { templateId: id, version: current.version },
        },
        select: { version: true },
      });
      if (!archivedCurrent) {
        throw new ConflictException({
          code: 'CHECKLIST_HISTORY_UNAVAILABLE',
          message:
            '현재 버전의 보관 이력을 확인할 수 없습니다. 관리자에게 문의해 주세요.',
        });
      }

      const result = await tx.checklistTemplate.updateMany({
        where: { id, version: input.expectedVersion },
        data: {
          title,
          definition,
          isActive,
          version: { increment: 1 },
          updatedAt: new Date(
            Math.max(Date.now(), current.updatedAt.getTime() + 1),
          ),
        },
      });
      if (result.count !== 1) throw this.versionConflict();
      const saved = await this.findTemplate(tx, id);
      await this.archivePublished(tx, saved, publisher);
      return saved;
    });
  }

  public async getVersions(
    id: string,
    input: GetChecklistTemplateVersionsInput,
  ): Promise<ChecklistTemplateVersionListDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const template = await this.findTemplate(tx, id);
        const where = { templateId: template.id };
        const [rows, total] = await Promise.all([
          tx.checklistTemplateVersion.findMany({
            where,
            orderBy: { version: 'desc' },
            skip: (input.page - 1) * input.limit,
            take: input.limit,
          }),
          tx.checklistTemplateVersion.count({ where }),
        ]);
        return {
          templateId: template.id,
          currentVersion: template.version,
          items: rows.map((row) => this.versionSummary(row)),
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getVersion(
    id: string,
    version: number,
  ): Promise<ChecklistTemplateVersionDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const template = await this.findTemplate(tx, id);
        const row = await tx.checklistTemplateVersion.findUnique({
          where: { templateId_version: { templateId: template.id, version } },
        });
        if (!row)
          throw new NotFoundException({
            code: 'CHECKLIST_VERSION_NOT_FOUND',
            message: '보관된 체크리스트 버전을 찾을 수 없습니다.',
          });
        return {
          ...this.versionSummary(row),
          templateId: template.id,
          propertyId: template.propertyId,
          type: template.type,
          definition: parseChecklistDefinition(row.definition),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async requirePublisher(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
  ) {
    if (!actor?.id) throw new UnauthorizedException();
    const publisher = await tx.user.findFirst({
      where: { id: actor.id, role: Role.ADMIN, isActive: true },
      select: { id: true, name: true },
    });
    if (!publisher) throw new UnauthorizedException();
    return publisher;
  }

  private async archivePublished(
    tx: Prisma.TransactionClient,
    template: ChecklistTemplateDto,
    publisher: { id: string; name: string },
  ): Promise<void> {
    await tx.checklistTemplateVersion.create({
      data: {
        templateId: template.id,
        version: template.version,
        title: template.title,
        definition: template.definition,
        isActive: template.isActive,
        publishedAt: template.updatedAt,
        source: ChecklistTemplateVersionSource.PUBLISHED,
        actorUserId: publisher.id,
        actorName: publisher.name,
      },
    });
  }

  private versionSummary(
    row: ChecklistTemplateVersion,
  ): ChecklistTemplateVersionSummaryDto {
    const definition = parseChecklistDefinition(row.definition);
    const baseline = row.source === ChecklistTemplateVersionSource.BASELINE;
    if (
      (baseline && (row.actorUserId !== null || row.actorName !== null)) ||
      (!baseline && (!row.actorUserId || !row.actorName))
    ) {
      throw new InternalServerErrorException({
        code: 'INVALID_CHECKLIST_HISTORY',
        message: '체크리스트 이력을 확인할 수 없습니다.',
      });
    }
    return {
      version: row.version,
      title: row.title,
      isActive: row.isActive,
      publishedAt: row.publishedAt,
      actor: baseline ? null : { id: row.actorUserId, name: row.actorName },
      source: row.source,
      sectionCount: definition.sections.length,
      itemCount: definition.sections.reduce(
        (total, section) => total + section.items.length,
        0,
      ),
    };
  }

  private async findTemplate(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ChecklistTemplateDto> {
    const row = await tx.checklistTemplate.findUnique({
      where: { id },
      select: templateSelect,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CHECKLIST_TEMPLATE_NOT_FOUND',
        message: '체크리스트를 찾을 수 없습니다.',
      });
    }
    return this.toDto(row);
  }

  private toDto(row: SelectedTemplate): ChecklistTemplateDto {
    return { ...row, definition: parseChecklistDefinition(row.definition) };
  }

  private async requireActiveProperty(
    tx: Prisma.TransactionClient,
    propertyId: string,
  ): Promise<void> {
    const property = await tx.property.findUnique({
      where: { id: propertyId },
      select: { isActive: true },
    });
    if (!property) {
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: '휴양소를 찾을 수 없습니다.',
      });
    }
    if (!property.isActive) {
      throw new ConflictException({
        code: 'PROPERTY_INACTIVE',
        message: '비활성 휴양소의 체크리스트는 설정할 수 없습니다.',
      });
    }
  }

  private duplicateTemplate(): ConflictException {
    return new ConflictException({
      code: 'CHECKLIST_TEMPLATE_EXISTS',
      message: '해당 휴양소에 같은 유형의 체크리스트가 이미 있습니다.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'STALE_TEMPLATE_VERSION',
      message: '체크리스트가 변경되었습니다. 최신 내용을 확인해 주세요.',
    });
  }
}
