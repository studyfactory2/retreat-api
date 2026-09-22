import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, StayStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { hashGuestStayToken } from './stay-link-policy';

const stayAccessSelect = {
  id: true,
  propertyId: true,
  guestName: true,
  company: true,
  department: true,
  phone: true,
  checkInAt: true,
  checkOutAt: true,
  status: true,
  currentRevision: true,
  guestLinkTokenHash: true,
  guestLinkExpiresAt: true,
  guestLinkVersion: true,
  guestLinkStayRevision: true,
  property: {
    select: {
      id: true,
      name: true,
      region: true,
      isActive: true,
      vehicleRegistrationEnabled: true,
    },
  },
} satisfies Prisma.StaySelect;

type StayAccessRecord = Prisma.StayGetPayload<{
  select: typeof stayAccessSelect;
}>;
export type GuestAccessibleStay = StayAccessRecord & {
  guestLinkExpiresAt: Date;
};

@Injectable()
export class StayAccessService {
  constructor(private readonly prisma: PrismaService) {}

  public async authorize(authorization: string | undefined): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.resolveStay(tx, authorization);
    });
  }

  public async resolveStay(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ): Promise<GuestAccessibleStay> {
    const match =
      typeof authorization === 'string' && authorization.length <= 100
        ? /^Bearer +([A-Za-z0-9_-]{43})$/i.exec(authorization)
        : null;
    if (
      !match ||
      Buffer.from(match[1], 'base64url').toString('base64url') !== match[1]
    )
      throw this.invalidAccess();

    const stay = await tx.stay.findUnique({
      where: { guestLinkTokenHash: hashGuestStayToken(match[1]) },
      select: stayAccessSelect,
    });
    this.assertEnabled(stay);
    return stay;
  }

  // A draft token is valid only while its original parent invitation is valid.
  public async resolveLinkedStay(
    tx: Prisma.TransactionClient,
    stayId: string,
    version: number,
  ): Promise<GuestAccessibleStay> {
    const stay = await tx.stay.findUnique({
      where: { id: stayId },
      select: stayAccessSelect,
    });
    this.assertEnabled(stay);
    if (stay.guestLinkVersion !== version) throw this.invalidAccess();
    return stay;
  }

  private assertEnabled(
    stay: StayAccessRecord | null,
  ): asserts stay is GuestAccessibleStay {
    if (
      !stay ||
      stay.status !== StayStatus.ACTIVE ||
      !stay.property.isActive ||
      !stay.guestLinkTokenHash ||
      !stay.guestLinkExpiresAt ||
      stay.guestLinkExpiresAt.getTime() <= Date.now() ||
      stay.guestLinkVersion < 1 ||
      stay.guestLinkStayRevision !== stay.currentRevision
    )
      throw this.invalidAccess();
  }

  private invalidAccess(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_STAY_ACCESS',
      message:
        '이용 링크를 사용할 수 없습니다. 관리자에게 새 링크를 요청해 주세요.',
    });
  }
}
