import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ChecklistType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  QrFlow,
  type GuestQrContextDto,
  type QrChecklistDto,
  type StaffQrContextDto,
} from '../../libs/dto/qr/qr';
import { parseChecklistDefinition } from '../checklist-templates/checklist-definition';
import { hashQrToken } from './qr-token';

@Injectable()
export class QrService {
  constructor(private readonly prisma: PrismaService) {}

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

  // QR-scoped writes share this lookup inside their own transaction.
  public async resolveProperty(
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
    const hash = hashQrToken(flow, token);
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

  private invalidQr(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_QR',
      message: '사용할 수 없는 QR입니다. 관리자에게 문의해 주세요.',
    });
  }
}
