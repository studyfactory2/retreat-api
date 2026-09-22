import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { SaveGuestStayVehicleInput } from '../../libs/dto/guest-stay-vehicle/guest-stay-vehicle.input';
import type { GuestStayVehicleDto } from '../../libs/dto/guest-stay-vehicle/guest-stay-vehicle';
import {
  StayAccessService,
  type GuestAccessibleStay,
} from '../stay-access/stay-access.service';

const vehicleSelect = {
  plateNumber: true,
  version: true,
  stayRevision: true,
  updatedAt: true,
} satisfies Prisma.StayVehicleSelect;

type Vehicle = Prisma.StayVehicleGetPayload<{ select: typeof vehicleSelect }>;

@Injectable()
export class GuestStayVehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stayAccessService: StayAccessService,
  ) {}

  public async getVehicle(
    authorization: string | undefined,
  ): Promise<GuestStayVehicleDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const stay = await this.stayAccessService.resolveStay(
          tx,
          authorization,
        );
        const vehicle = await tx.stayVehicle.findUnique({
          where: { stayId: stay.id },
          select: vehicleSelect,
        });
        return this.toDto(stay, vehicle);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async saveVehicle(
    authorization: string | undefined,
    input: SaveGuestStayVehicleInput,
  ): Promise<GuestStayVehicleDto> {
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const stay = await this.stayAccessService.resolveStay(
          tx,
          authorization,
        );
        if (!stay.property.vehicleRegistrationEnabled) {
          throw new ConflictException({
            code: 'VEHICLE_REGISTRATION_DISABLED',
            message: '이 휴양소는 차량번호를 수집하지 않습니다.',
          });
        }
        const vehicle = await tx.stayVehicle.findUnique({
          where: { stayId: stay.id },
          select: vehicleSelect,
        });
        if (
          (vehicle?.version ?? 0) !== input.expectedVersion ||
          (vehicle && vehicle.version >= 2147483647)
        )
          throw this.changed();

        // Vehicle edits never change the stay revision or invitation version.
        const data = {
          plateNumber: input.plateNumber,
          stayRevision: stay.currentRevision,
        };
        if (!vehicle) {
          const created = await tx.stayVehicle.create({
            data: { stayId: stay.id, ...data },
            select: vehicleSelect,
          });
          return this.toDto(stay, created);
        }

        const updated = await tx.stayVehicle.updateMany({
          where: { stayId: stay.id, version: input.expectedVersion },
          data: {
            ...data,
            version: { increment: 1 },
            updatedAt: new Date(
              Math.max(Date.now(), vehicle.updatedAt.getTime() + 1),
            ),
          },
        });
        if (updated.count !== 1) throw this.changed();
        return this.toDto(
          stay,
          await tx.stayVehicle.findUniqueOrThrow({
            where: { stayId: stay.id },
            select: vehicleSelect,
          }),
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.changed();
      throw error;
    }
  }

  private toDto(
    stay: GuestAccessibleStay,
    vehicle: Vehicle | null,
  ): GuestStayVehicleDto {
    const enabled = stay.property.vehicleRegistrationEnabled;
    const current = vehicle?.stayRevision === stay.currentRevision;
    const visibleVehicle = enabled && current ? vehicle : null;
    return {
      stayId: stay.id,
      property: {
        id: stay.property.id,
        name: stay.property.name,
        region: stay.property.region,
      },
      enabled,
      version: vehicle?.version ?? 0,
      plateNumber: visibleVehicle?.plateNumber ?? null,
      needsConfirmation: enabled && !!vehicle?.plateNumber && !current,
      updatedAt: visibleVehicle?.updatedAt ?? null,
    };
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'STAY_VEHICLE_CHANGED',
      message:
        '차량 정보가 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
    });
  }
}
