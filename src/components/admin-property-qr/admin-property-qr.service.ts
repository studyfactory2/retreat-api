import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { AccessLinkVault } from '../access-link-vault/access-link-vault.service';

const qrStatusSelect = {
  id: true,
  isActive: true,
  guestQrTokenHash: true,
  staffQrTokenHash: true,
  guestQrTokenCiphertext: true,
  staffQrTokenCiphertext: true,
  guestQrRotatedAt: true,
  staffQrRotatedAt: true,
} satisfies Prisma.PropertySelect;

@Injectable()
export class AdminPropertyQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<RuntimeEnvironment, true>,
    private readonly vault: AccessLinkVault,
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
        canReopen: Boolean(
          property.guestQrTokenHash && property.guestQrTokenCiphertext,
        ),
        rotatedAt: property.guestQrRotatedAt,
      },
      staff: {
        issued: property.staffQrTokenHash !== null,
        enabled: property.isActive && property.staffQrTokenHash !== null,
        canReopen: Boolean(
          property.staffQrTokenHash && property.staffQrTokenCiphertext,
        ),
        rotatedAt: property.staffQrRotatedAt,
      },
    };
  }

  public async getCurrentPropertyQrLink(
    id: string,
    flow: QrFlow,
  ): Promise<QrIssueDto> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: qrStatusSelect,
    });
    if (!property) throw this.propertyNotFound();
    if (!property.isActive) {
      throw new ConflictException({
        code: 'PROPERTY_INACTIVE',
        message: '비활성 휴양소의 QR은 열 수 없습니다.',
      });
    }
    const hash =
      flow === QrFlow.GUEST
        ? property.guestQrTokenHash
        : property.staffQrTokenHash;
    const ciphertext =
      flow === QrFlow.GUEST
        ? property.guestQrTokenCiphertext
        : property.staffQrTokenCiphertext;
    const rotatedAt =
      flow === QrFlow.GUEST
        ? property.guestQrRotatedAt
        : property.staffQrRotatedAt;
    if (!hash || !rotatedAt) {
      throw new ConflictException({
        code: 'QR_NOT_ISSUED',
        message: '현재 발급된 QR이 없습니다. 최신 상태를 확인해 주세요.',
      });
    }
    if (!ciphertext) {
      throw new ConflictException({
        code: 'QR_LINK_NOT_RECOVERABLE',
        message:
          '이전에 발급한 QR은 다시 볼 수 없습니다. 보관 중인 QR은 계속 사용할 수 있습니다.',
      });
    }
    const token = this.vault.open(
      ciphertext,
      this.vaultContext(id, flow, hash),
    );
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      Buffer.from(token, 'base64url').toString('base64url') !== token ||
      hashQrToken(flow, token) !== hash
    ) {
      throw new ServiceUnavailableException({
        code: 'ACCESS_LINK_UNAVAILABLE',
        message: 'QR을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return {
      propertyId: id,
      flow,
      url: this.linkUrl(flow, token),
      canReopen: true,
      rotatedAt,
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
    const ciphertext = this.vault.seal(
      token,
      this.vaultContext(id, flow, hash),
    );

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
            ? {
                guestQrTokenHash: hash,
                guestQrTokenCiphertext: ciphertext,
                guestQrRotatedAt: rotatedAt,
              }
            : {
                staffQrTokenHash: hash,
                staffQrTokenCiphertext: ciphertext,
                staffQrRotatedAt: rotatedAt,
              },
      });
      if (result.count !== 1) throw this.staleQr();
      return {
        propertyId: id,
        flow,
        url: this.linkUrl(flow, token),
        canReopen: true,
        rotatedAt,
      };
    });
  }

  private vaultContext(id: string, flow: QrFlow, hash: string): string {
    return `property:${id.toLowerCase()}:${flow}:${hash}`;
  }

  private linkUrl(flow: QrFlow, token: string): string {
    const url = new URL(
      flow === QrFlow.GUEST ? '/guest' : '/staff',
      this.config.get('FRONTEND_URL', { infer: true }),
    );
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
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
