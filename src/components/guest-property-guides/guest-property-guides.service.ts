import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { GetGuestPropertyGuideInput } from '../../libs/dto/guest-property-guide/guest-property-guide.input';
import type { GuestPropertyGuideDto } from '../../libs/dto/guest-property-guide/guest-property-guide';
import { QrFlow } from '../../libs/dto/qr/qr';
import { QrService } from '../qr/qr.service';
import { StayAccessService } from '../stay-access/stay-access.service';

@Injectable()
export class GuestPropertyGuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
    private readonly stayAccessService: StayAccessService,
  ) {}

  public async getQrGuide(
    authorization: string | undefined,
    input: GetGuestPropertyGuideInput,
  ): Promise<GuestPropertyGuideDto> {
    void input;
    return await this.prisma.$transaction(
      async (tx) => {
        const property = await this.qrService.resolveProperty(
          tx,
          QrFlow.GUEST,
          authorization,
        );
        return await this.readGuide(tx, property);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getStayGuide(
    authorization: string | undefined,
    input: GetGuestPropertyGuideInput,
  ): Promise<GuestPropertyGuideDto> {
    void input;
    return await this.prisma.$transaction(
      async (tx) => {
        const stay = await this.stayAccessService.resolveStay(
          tx,
          authorization,
        );
        return await this.readGuide(tx, stay.property);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async readGuide(
    tx: Prisma.TransactionClient,
    property: GuestPropertyGuideDto['property'],
  ): Promise<GuestPropertyGuideDto> {
    const guide = await tx.propertyGuide.findFirst({
      where: { propertyId: property.id, isPublished: true },
      select: {
        title: true,
        content: true,
        version: true,
        updatedAt: true,
      },
    });
    return {
      property: {
        id: property.id,
        name: property.name,
        region: property.region,
      },
      guide: guide
        ? {
            title: guide.title,
            content: guide.content,
            version: guide.version,
            updatedAt: guide.updatedAt,
          }
        : null,
    };
  }
}
