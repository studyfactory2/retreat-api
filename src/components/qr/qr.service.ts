import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChecklistType, Prisma, Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { RuntimeEnvironment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { RotatePropertyQrInput } from '../../libs/dto/qr/qr.input';
import {
  QrFlow,
  type GuestQrContextDto,
  type PropertyQrStatusDto,
  type QrChecklistDto,
  type QrIssueDto,
  type StaffQrContextDto,
} from '../../libs/dto/qr/qr';
import { parseChecklistDefinition } from '../checklist-templates/checklist-definition';

const qrStatusSelect = {
  id: true,
  isActive: true,
  guestQrTokenHash: true,
  staffQrTokenHash: true,
  guestQrRotatedAt: true,
  staffQrRotatedAt: true,
} satisfies Prisma.PropertySelect;

@Injectable()
export class QrService {
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
    const hash = this.hashToken(flow, token);
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

  public async getGuestContext(
    authorization: string | undefined,
  ): Promise<GuestQrContextDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const property = await this.resolveProperty(
          tx,
          QrFlow.GUEST,
          authorization,
        );
        return {
          flow: QrFlow.GUEST,
          property: {
            id: property.id,
            name: property.name,
            region: property.region,
          },
          checklists: await this.getChecklists(tx, property.id, [
            ChecklistType.CHECK_IN,
            ChecklistType.CHECK_OUT,
          ]),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getStaffContext(
    authorization: string | undefined,
  ): Promise<StaffQrContextDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const property = await this.resolveProperty(
          tx,
          QrFlow.STAFF,
          authorization,
        );
        const staff = property.staffUserId
          ? await tx.user.findFirst({
              where: {
                id: property.staffUserId,
                role: Role.STAFF,
                isActive: true,
              },
              select: { id: true, name: true },
            })
          : null;
        return {
          flow: QrFlow.STAFF,
          property: {
            id: property.id,
            name: property.name,
            region: property.region,
          },
          assignedStaff: staff,
          checklists: await this.getChecklists(tx, property.id, [
            ChecklistType.MAINTENANCE,
          ]),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async resolveProperty(
    tx: Prisma.TransactionClient,
    flow: QrFlow,
    authorization: string | undefined,
  ) {
    const match =
      typeof authorization === 'string' && authorization.length <= 100
        ? /^Bearer +([A-Za-z0-9_-]{43})$/i.exec(authorization)
        : null;
    if (!match) throw this.invalidQr();
    const token = match[1];
    if (Buffer.from(token, 'base64url').toString('base64url') !== token) {
      throw this.invalidQr();
    }
    const hash = this.hashToken(flow, token);
    const property = await tx.property.findUnique({
      where:
        flow === QrFlow.GUEST
          ? { guestQrTokenHash: hash }
          : { staffQrTokenHash: hash },
      select: {
        id: true,
        name: true,
        region: true,
        isActive: true,
        staffUserId: true,
      },
    });
    if (!property?.isActive) throw this.invalidQr();
    return property;
  }

  private async getChecklists(
    tx: Prisma.TransactionClient,
    propertyId: string,
    types: ChecklistType[],
  ): Promise<QrChecklistDto[]> {
    const templates = await tx.checklistTemplate.findMany({
      where: { propertyId, type: { in: types }, isActive: true },
      select: {
        id: true,
        type: true,
        title: true,
        version: true,
        definition: true,
      },
      orderBy: { type: 'asc' },
    });
    return templates.map((template) => ({
      ...template,
      definition: parseChecklistDefinition(template.definition),
    }));
  }

  private hashToken(flow: QrFlow, token: string): string {
    return createHash('sha256').update(`${flow}:${token}`).digest('hex');
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

  private invalidQr(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_QR',
      message: '사용할 수 없는 QR입니다. 관리자에게 문의해 주세요.',
    });
  }
}
