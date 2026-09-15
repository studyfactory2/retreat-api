import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChecklistType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  CreateChecklistTemplateInput,
  GetChecklistTemplatesInput,
  UpdateChecklistTemplateInput,
} from '../../libs/dto/checklist-template/checklist-template.input';
import type {
  ChecklistTemplateDto,
  ChecklistTemplateListDto,
} from '../../libs/dto/checklist-template/checklist-template';
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
  ): Promise<ChecklistTemplateDto> {
    const definition = buildChecklistDefinition(input.sections);

    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
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
        return this.toDto(created);
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
      const current = await this.findTemplate(tx, id);
      if (input.expectedVersion !== current.version) {
        throw this.versionConflict();
      }
      if (current.type !== ChecklistType.MAINTENANCE) {
        throw new ConflictException({
          code: 'GUEST_TEMPLATE_FIXED',
          message: '입실·퇴실 체크리스트는 초기 설정 후 수정할 수 없습니다.',
        });
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

      const result = await tx.checklistTemplate.updateMany({
        where: { id, version: input.expectedVersion },
        data: { title, definition, isActive, version: { increment: 1 } },
      });
      if (result.count !== 1) throw this.versionConflict();
      return await this.findTemplate(tx, id);
    });
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
