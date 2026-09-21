import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { RuntimeEnvironment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { RotatePropertyQrInput } from '../../libs/dto/qr/qr.input';
import {
  QrFlow,
  type PropertyQrStatusDto,
  type QrIssueDto,
} from '../../libs/dto/qr/qr';
import { hashQrToken } from '../qr/qr-token';

const qrStatusSelect = {
  id: true,
  isActive: true,
  guestQrTokenHash: true,
  staffQrTokenHash: true,
  guestQrRotatedAt: true,
  staffQrRotatedAt: true,
} satisfies Prisma.PropertySelect;

@Injectable()
export class AdminPropertyQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<RuntimeEnvironment, true>,
  ) {}

  public async getPropertyQrStatus(id: string): Promise<PropertyQrStatusDto> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: qrStatusSelect,
    });
    if (!property) throw this.propertyNotFound();
    return {
      propertyId: property.id,
      propertyIsActive: property.isActive,
      guest: {
        issued: property.guestQrTokenHash !== null,
        enabled: property.isActive && property.guestQrTokenHash !== null,
        rotatedAt: property.guestQrRotatedAt,
      },
      staff: {
        issued: property.staffQrTokenHash !== null,
        enabled: property.isActive && property.staffQrTokenHash !== null,
        rotatedAt: property.staffQrRotatedAt,
      },
    };
  }

  public async rotatePropertyQr(
    id: string,
    flow: QrFlow,
    input: RotatePropertyQrInput,
  ): Promise<QrIssueDto> {
    const expected =
      input.expectedRotatedAt === null
        ? null
        : new Date(input.expectedRotatedAt);
    const token = randomBytes(32).toString('base64url');
    const hash = hashQrToken(flow, token);
    const url = new URL(
      flow === QrFlow.GUEST ? '/guest' : '/staff',
      this.config.get('FRONTEND_URL', { infer: true }),
    );
    url.hash = new URLSearchParams({ token }).toString();

    return await runSerializableTransaction(this.prisma, async (tx) => {
      const property = await tx.property.findUnique({
        where: { id },
        select: qrStatusSelect,
      });
      if (!property) throw this.propertyNotFound();
      if (!property.isActive) {
        throw new ConflictException({
          code: 'PROPERTY_INACTIVE',
          message: '비활성 휴양소의 QR은 발급할 수 없습니다.',
        });
      }

      const current =
        flow === QrFlow.GUEST
          ? property.guestQrRotatedAt
          : property.staffQrRotatedAt;
      if ((current?.getTime() ?? null) !== (expected?.getTime() ?? null)) {
        throw this.staleQr();
      }
      const rotatedAt = new Date(
        Math.max(Date.now(), (current?.getTime() ?? 0) + 1),
      );
      const result = await tx.property.updateMany({
        where: {
          id,
          isActive: true,
          ...(flow === QrFlow.GUEST
            ? {
                guestQrTokenHash: property.guestQrTokenHash,
                guestQrRotatedAt: current,
              }
            : {
                staffQrTokenHash: property.staffQrTokenHash,
                staffQrRotatedAt: current,
              }),
        },
        data:
          flow === QrFlow.GUEST
            ? { guestQrTokenHash: hash, guestQrRotatedAt: rotatedAt }
            : { staffQrTokenHash: hash, staffQrRotatedAt: rotatedAt },
      });
      if (result.count !== 1) throw this.staleQr();
      return { propertyId: id, flow, url: url.toString(), rotatedAt };
    });
  }

  private propertyNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PROPERTY_NOT_FOUND',
      message: '휴양소를 찾을 수 없습니다.',
    });
  }

  private staleQr(): ConflictException {
    return new ConflictException({
      code: 'STALE_QR_CODE',
      message: 'QR이 변경되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.',
    });
  }
}
