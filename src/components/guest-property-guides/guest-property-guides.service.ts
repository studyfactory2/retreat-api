import {
  ConflictException,
  Injectable,
  NotFoundException,
  type StreamableFile,
} from '@nestjs/common';
import { Prisma, PropertyGuideType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { GetGuestPropertyGuideInput } from '../../libs/dto/guest-property-guide/guest-property-guide.input';
import type { GuestPropertyGuideDto } from '../../libs/dto/guest-property-guide/guest-property-guide';
import { QrFlow } from '../../libs/dto/qr/qr';
import { QrService } from '../qr/qr.service';
import { StayAccessService } from '../stay-access/stay-access.service';
import {
  PropertyGuideFilesService,
  guidePdfFile,
} from '../property-guide-files/property-guide-files.service';

@Injectable()
export class GuestPropertyGuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
    private readonly stayAccessService: StayAccessService,
    private readonly files: PropertyGuideFilesService,
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

  public async getPdf(
    authorization: string | undefined,
    kind: 'qr' | 'stay',
    version?: number,
  ): Promise<StreamableFile> {
    const file = await this.prisma.$transaction(
      async (tx) => {
        const property =
          kind === 'qr'
            ? await this.qrService.resolveProperty(
                tx,
                QrFlow.GUEST,
                authorization,
              )
            : (await this.stayAccessService.resolveStay(tx, authorization))
                .property;
        const guide = await tx.propertyGuide.findFirst({
          where: {
            propertyId: property.id,
            isPublished: true,
            type: PropertyGuideType.PDF,
          },
        });
        // Missing and unpublished guides are indistinguishable to guests.
        if (!guide) throw this.pdfMissing();
        if (version !== undefined && guide.version !== version)
          throw new ConflictException({
            code: 'PROPERTY_GUIDE_CHANGED',
            message:
              '이용 안내가 변경되었습니다. 최신 내용을 다시 확인해 주세요.',
          });
        const currentFile = guidePdfFile(guide);
        if (!currentFile) throw this.pdfMissing();
        return currentFile;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return await this.files.download(file);
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
        type: true,
        pdfFilename: true,
        pdfSizeBytes: true,
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
            content: guide.type === PropertyGuideType.TEXT ? guide.content : '',
            type: guide.type,
            pdf:
              guide.type === PropertyGuideType.PDF &&
              guide.pdfFilename &&
              guide.pdfSizeBytes
                ? { filename: guide.pdfFilename, sizeBytes: guide.pdfSizeBytes }
                : null,
            version: guide.version,
            updatedAt: guide.updatedAt,
          }
        : null,
    };
  }
  private pdfMissing(): NotFoundException {
    return new NotFoundException({
      code: 'PROPERTY_GUIDE_PDF_NOT_FOUND',
      message: '공개된 이용 안내 PDF가 없습니다. 최신 내용을 확인해 주세요.',
    });
  }
}
