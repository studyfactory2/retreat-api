import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { GetAdminStayVehicleInput } from '../../libs/dto/admin-stay-vehicle/admin-stay-vehicle.input';
import type { AdminStayVehicleDto } from '../../libs/dto/admin-stay-vehicle/admin-stay-vehicle';

const stayVehicleSelect = {
  id: true,
  guestName: true,
  checkInAt: true,
  checkOutAt: true,
  status: true,
  currentRevision: true,
  property: {
    select: {
      id: true,
      name: true,
      region: true,
      isActive: true,
      vehicleRegistrationEnabled: true,
    },
  },
  vehicle: {
    select: {
      plateNumber: true,
      version: true,
      stayRevision: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.StaySelect;

@Injectable()
export class AdminStayVehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  public async getVehicle(
    id: string,
    input: GetAdminStayVehicleInput,
  ): Promise<AdminStayVehicleDto> {
    void input;
    return await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.stay.findUnique({
          where: { id: id.toLowerCase() },
          select: stayVehicleSelect,
        });
        if (!row)
          throw new NotFoundException({
            code: 'STAY_NOT_FOUND',
            message: '이용 일정을 찾을 수 없습니다.',
          });
        const { vehicle, ...stay } = row;
        return {
          stay,
          vehicle,
          needsReview:
            vehicle !== null &&
            vehicle.plateNumber !== null &&
            vehicle.stayRevision !== stay.currentRevision,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
