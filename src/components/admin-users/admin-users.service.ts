import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  CreateStaffInput,
  GetStaffInput,
  UpdateStaffInput,
} from '../../libs/dto/user/staff.input';
import type { StaffDto, StaffListDto } from '../../libs/dto/user/staff';

const staffSelect = {
  id: true,
  name: true,
  role: true,
  phone: true,
  company: true,
  department: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  assignedProperties: {
    select: { id: true, name: true, region: true, isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.UserSelect;

type StaffRecord = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  public async createStaff(input: CreateStaffInput): Promise<StaffDto> {
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        role: Role.STAFF,
        phone: input.phone,
        company: input.company,
        department: input.department,
        isActive: true,
      },
      select: staffSelect,
    });
    return this.toStaffDto(user);
  }

  public async getStaffList(input: GetStaffInput): Promise<StaffListDto> {
    const where: Prisma.UserWhereInput = {
      role: Role.STAFF,
      isActive: input.isActive,
      ...(input.search
        ? {
            OR: [
              { name: { contains: input.search, mode: 'insensitive' } },
              { phone: { contains: input.search, mode: 'insensitive' } },
              { company: { contains: input.search, mode: 'insensitive' } },
              { department: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.prisma.$transaction(
      [
        this.prisma.user.findMany({
          where,
          select: staffSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        this.prisma.user.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: users.map((user) => this.toStaffDto(user)),
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  public async getStaff(id: string): Promise<StaffDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, role: Role.STAFF },
      select: staffSelect,
    });
    if (!user) throw this.staffNotFound();
    return this.toStaffDto(user);
  }

  public async updateStaff(
    id: string,
    input: UpdateStaffInput,
  ): Promise<StaffDto> {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: '변경할 직원 정보를 입력해 주세요.',
      });
    }
    return await runSerializableTransaction(
      this.prisma,
      async (transaction) => {
        const user = await transaction.user.findFirst({
          where: { id, role: Role.STAFF },
          select: { id: true },
        });
        if (!user) throw this.staffNotFound();

        if (input.isActive === false) {
          const assignment = await transaction.property.findFirst({
            where: { staffUserId: id },
            select: { id: true },
          });
          if (assignment) {
            throw new ConflictException({
              code: 'STAFF_HAS_ASSIGNMENTS',
              message: '담당 휴양소를 해제하거나 다른 직원으로 변경해 주세요.',
            });
          }
        }

        const updated = await transaction.user.update({
          where: { id },
          data: {
            name: input.name,
            phone: input.phone,
            company: input.company,
            department: input.department,
            isActive: input.isActive,
          },
          select: staffSelect,
        });
        return this.toStaffDto(updated);
      },
    );
  }

  private toStaffDto(user: StaffRecord): StaffDto {
    return { ...user, role: Role.STAFF };
  }

  private staffNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'STAFF_NOT_FOUND',
      message: '직원 정보를 찾을 수 없습니다.',
    });
  }
}
