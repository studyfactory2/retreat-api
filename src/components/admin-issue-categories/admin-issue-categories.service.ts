import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import { FALLBACK_ISSUE_CATEGORY_NAME } from '../../libs/constants/issue-category';
import type {
  AdminIssueCategoryDto,
  AdminIssueCategoryListDto,
} from '../../libs/dto/admin-issue-category/admin-issue-category';
import type {
  CreateAdminIssueCategoryInput,
  GetAdminIssueCategoriesInput,
  UpdateAdminIssueCategoryInput,
} from '../../libs/dto/admin-issue-category/admin-issue-category.input';

const categorySelect = {
  id: true,
  name: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.IssueCategorySelect;

type CategoryRow = Prisma.IssueCategoryGetPayload<{
  select: typeof categorySelect;
}>;

@Injectable()
export class AdminIssueCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  public async getCategories(
    input: GetAdminIssueCategoriesInput,
  ): Promise<AdminIssueCategoryListDto> {
    const where: Prisma.IssueCategoryWhereInput = {
      isActive: input.isActive,
      ...(input.search
        ? { name: { contains: input.search, mode: 'insensitive' } }
        : {}),
    };
    return await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.issueCategory.findMany({
          where,
          select: categorySelect,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.issueCategory.count({ where });
        return {
          items: rows.map((row) => this.toDto(row)),
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async createCategory(
    input: CreateAdminIssueCategoryInput,
    adminId: string,
  ): Promise<AdminIssueCategoryDto> {
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        await this.requireAdministrator(tx, adminId);
        const category = await tx.issueCategory.create({
          data: {
            name: input.name,
            sortOrder: input.sortOrder ?? 0,
            isActive: true,
          },
          select: categorySelect,
        });
        return this.toDto(category);
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  public async updateCategory(
    id: string,
    input: UpdateAdminIssueCategoryInput,
    adminId: string,
  ): Promise<AdminIssueCategoryDto> {
    if (
      input.name === undefined &&
      input.sortOrder === undefined &&
      input.isActive === undefined
    ) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: '변경할 내용을 입력해 주세요.',
      });
    }
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        await this.requireAdministrator(tx, adminId);
        const category = await tx.issueCategory.findUnique({
          where: { id: id.toLowerCase() },
          select: categorySelect,
        });
        if (!category) {
          throw new NotFoundException({
            code: 'ISSUE_CATEGORY_NOT_FOUND',
            message: '이상사항 분류를 찾을 수 없습니다.',
          });
        }
        if (category.updatedAt.toISOString() !== input.expectedUpdatedAt)
          throw this.changed();
        const name = input.name ?? category.name;
        const sortOrder = input.sortOrder ?? category.sortOrder;
        const isActive = input.isActive ?? category.isActive;
        if (
          (category.name === FALLBACK_ISSUE_CATEGORY_NAME &&
            (name !== category.name || input.isActive === false)) ||
          (category.name !== FALLBACK_ISSUE_CATEGORY_NAME &&
            name === FALLBACK_ISSUE_CATEGORY_NAME)
        ) {
          throw new ConflictException({
            code: 'ISSUE_CATEGORY_FALLBACK_PROTECTED',
            message:
              '기타는 기본 분류이므로 이름 변경이나 비활성화가 불가능합니다.',
          });
        }
        if (
          name === category.name &&
          sortOrder === category.sortOrder &&
          isActive === category.isActive
        )
          return this.toDto(category);
        const updatedAt = new Date(
          Math.max(Date.now(), category.updatedAt.getTime() + 1),
        );
        const result = await tx.issueCategory.updateMany({
          where: { id: category.id, updatedAt: category.updatedAt },
          data: { name, sortOrder, isActive, updatedAt },
        });
        if (result.count !== 1) throw this.changed();
        return this.toDto({
          ...category,
          name,
          sortOrder,
          isActive,
          updatedAt,
        });
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  private async requireAdministrator(
    tx: Prisma.TransactionClient,
    adminId: string,
  ): Promise<void> {
    const actor = await tx.user.findUnique({
      where: { id: adminId },
      select: { role: true, isActive: true, loginId: true, passwordHash: true },
    });
    if (
      !actor?.isActive ||
      actor.role !== Role.ADMIN ||
      !actor.loginId ||
      !actor.passwordHash
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '로그인이 필요합니다. 다시 로그인해 주세요.',
      });
    }
  }

  private toDto(category: CategoryRow): AdminIssueCategoryDto {
    return {
      ...category,
      isFallback: category.name === FALLBACK_ISSUE_CATEGORY_NAME,
    };
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'ISSUE_CATEGORY_CHANGED',
      message: '분류가 변경되었습니다. 다시 불러온 뒤 시도해 주세요.',
    });
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException({
        code: 'ISSUE_CATEGORY_NAME_EXISTS',
        message: '같은 이름의 분류가 이미 등록되어 있습니다.',
      });
    }
    throw error;
  }
}
