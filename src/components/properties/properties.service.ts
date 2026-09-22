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
  PropertyDto,
  PropertyListDto,
} from '../../libs/dto/property/property';
import type {
  AssignStaffInput,
  CreatePropertyInput,
  GetPropertiesInput,
  UpdatePropertyInput,
} from '../../libs/dto/property/property.input';

const propertySelect = {
  id: true,
  name: true,
  region: true,
  isActive: true,
  staffUserId: true,
  vehicleRegistrationEnabled: true,
  staff: {
    select: {
      id: true,
      name: true,
      phone: true,
      isActive: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PropertySelect;

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  public async createProperty(
    input: CreatePropertyInput,
  ): Promise<PropertyDto> {
    try {
      return await this.prisma.property.create({
        data: {
          name: input.name,
          region: input.region,
          isActive: true,
          vehicleRegistrationEnabled: input.vehicleRegistrationEnabled,
        },
        select: propertySelect,
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  public async getProperties(
    input: GetPropertiesInput,
  ): Promise<PropertyListDto> {
    const where: Prisma.PropertyWhereInput = {
      isActive: input.isActive,
      staffUserId: input.staffUserId,
    };
    if (input.region !== undefined) {
      where.region = { equals: input.region, mode: 'insensitive' };
    }
    if (input.search) {
      where.OR = [
        { name: { contains: input.search, mode: 'insensitive' } },
        { region: { contains: input.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.property.findMany({
          where,
          select: propertySelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        this.prisma.property.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      items,
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  public async getProperty(id: string): Promise<PropertyDto> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: propertySelect,
    });
    if (!property) {
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: '휴양소를 찾을 수 없습니다.',
      });
    }
    return property;
  }

  public async updateProperty(
    id: string,
    input: UpdatePropertyInput,
  ): Promise<PropertyDto> {
    if (
      input.name === undefined &&
      input.region === undefined &&
      input.isActive === undefined &&
      input.vehicleRegistrationEnabled === undefined
    ) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: '변경할 내용을 입력해 주세요.',
      });
    }

    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const property = await tx.property.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!property) {
          throw new NotFoundException({
            code: 'PROPERTY_NOT_FOUND',
            message: '휴양소를 찾을 수 없습니다.',
          });
        }

        return tx.property.update({
          where: { id },
          data: {
            name: input.name,
            region: input.region,
            isActive: input.isActive,
            vehicleRegistrationEnabled: input.vehicleRegistrationEnabled,
          },
          select: propertySelect,
        });
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  public async assignStaff(
    id: string,
    input: AssignStaffInput,
  ): Promise<PropertyDto> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const property = await tx.property.findUnique({
        where: { id },
        select: { id: true, isActive: true },
      });
      if (!property) {
        throw new NotFoundException({
          code: 'PROPERTY_NOT_FOUND',
          message: '휴양소를 찾을 수 없습니다.',
        });
      }

      if (input.staffUserId !== null) {
        if (!property.isActive) {
          throw new ConflictException({
            code: 'PROPERTY_INACTIVE',
            message: '비활성 휴양소에는 직원을 배정할 수 없습니다.',
          });
        }
        const staff = await tx.user.findUnique({
          where: { id: input.staffUserId },
          select: { role: true, isActive: true },
        });
        if (!staff || staff.role !== Role.STAFF) {
          throw new NotFoundException({
            code: 'STAFF_NOT_FOUND',
            message: '직원을 찾을 수 없습니다.',
          });
        }
        if (!staff.isActive) {
          throw new ConflictException({
            code: 'STAFF_INACTIVE',
            message: '비활성 직원은 배정할 수 없습니다.',
          });
        }
      }

      return tx.property.update({
        where: { id },
        data: { staffUserId: input.staffUserId },
        select: propertySelect,
      });
    });
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException({
        code: 'PROPERTY_NAME_EXISTS',
        message: '같은 이름의 휴양소가 이미 등록되어 있습니다.',
      });
    }
    throw error;
  }
}
