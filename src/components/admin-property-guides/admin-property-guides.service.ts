import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type StreamableFile,
} from '@nestjs/common';
import { Prisma, PropertyGuideType, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  SaveAdminPropertyGuideInput,
  SaveAdminPropertyGuidePdfInput,
} from '../../libs/dto/admin-property-guide/admin-property-guide.input';
import type { AdminPropertyGuideDto } from '../../libs/dto/admin-property-guide/admin-property-guide';
import {
  PropertyGuideFilesService,
  guidePdfFile,
  type GuidePdfFile,
} from '../property-guide-files/property-guide-files.service';

const guideSelect = {
  title: true,
  content: true,
  type: true,
  pdfBucket: true,
  pdfKey: true,
  pdfFilename: true,
  pdfSizeBytes: true,
  isPublished: true,
  version: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PropertyGuideSelect;
const propertySelect = {
  id: true,
  name: true,
  region: true,
  isActive: true,
  guide: { select: guideSelect },
} satisfies Prisma.PropertySelect;
type SelectedGuide = Prisma.PropertyGuideGetPayload<{
  select: typeof guideSelect;
}>;

@Injectable()
export class AdminPropertyGuidesService {
  private readonly logger = new Logger(AdminPropertyGuidesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: PropertyGuideFilesService,
  ) {}

  public async getGuide(propertyId: string): Promise<AdminPropertyGuideDto> {
    const { guide, ...property } = await this.findProperty(
      this.prisma,
      propertyId.toLowerCase(),
    );
    return { property, guide: this.toDto(guide) };
  }

  public async getPdf(
    propertyId: string,
    version?: number,
  ): Promise<StreamableFile> {
    const { guide } = await this.findProperty(
      this.prisma,
      propertyId.toLowerCase(),
    );
    if (version !== undefined && guide?.version !== version)
      throw this.changed();
    const file =
      guide?.type === PropertyGuideType.PDF ? guidePdfFile(guide) : null;
    if (!file) throw this.pdfMissing();
    return await this.files.download(file);
  }

  public async saveGuide(
    propertyId: string,
    input: SaveAdminPropertyGuideInput,
    actorId: string,
  ): Promise<AdminPropertyGuideDto> {
    return await this.persist(
      propertyId.toLowerCase(),
      input,
      actorId,
      PropertyGuideType.TEXT,
      null,
    );
  }

  public async savePdf(
    propertyId: string,
    input: SaveAdminPropertyGuidePdfInput,
    actorId: string,
    file?: Express.Multer.File,
  ): Promise<AdminPropertyGuideDto> {
    propertyId = propertyId.toLowerCase();
    // Reject missing/stale properties before spending resources parsing or uploading.
    const { guide } = await this.findProperty(this.prisma, propertyId);
    if ((guide?.version ?? 0) !== input.expectedVersion) throw this.changed();
    if (
      !file &&
      (guide?.type !== PropertyGuideType.PDF || !guidePdfFile(guide))
    )
      throw this.pdfMissing();
    const uploaded = file ? await this.files.upload(propertyId, file) : null;
    try {
      return await this.persist(
        propertyId,
        input,
        actorId,
        PropertyGuideType.PDF,
        uploaded,
      );
    } catch (error) {
      if (uploaded) {
        // Only a typed application rejection proves rollback. An unknown transport
        // failure may still be committing, even if another read sees the old row.
        if (
          error instanceof HttpException &&
          [400, 401, 403, 404, 409].includes(error.getStatus())
        ) {
          await this.retireIfUnused(propertyId, uploaded);
        } else {
          this.logger.warn(
            `Guide PDF save outcome uncertain; reconcile object ${uploaded.pdfKey}`,
          );
        }
      }
      throw error;
    }
  }

  private async persist(
    propertyId: string,
    input: SaveAdminPropertyGuideInput | SaveAdminPropertyGuidePdfInput,
    actorId: string,
    type: PropertyGuideType,
    uploaded: GuidePdfFile | null,
  ): Promise<AdminPropertyGuideDto> {
    try {
      const saved = await runSerializableTransaction(
        this.prisma,
        async (tx) => {
          const actor = await tx.user.findUnique({
            where: { id: actorId },
            select: {
              role: true,
              isActive: true,
              loginId: true,
              passwordHash: true,
            },
          });
          if (
            !actor?.isActive ||
            actor.role !== Role.ADMIN ||
            !actor.loginId ||
            !actor.passwordHash
          )
            throw new UnauthorizedException({
              code: 'UNAUTHENTICATED',
              message: '로그인이 필요합니다. 다시 로그인해 주세요.',
            });
          const { guide, ...property } = await this.findProperty(
            tx,
            propertyId,
          );
          if (
            (guide?.version ?? 0) !== input.expectedVersion ||
            (guide && guide.version >= 2147483647)
          )
            throw this.changed();
          const previous = guide ? guidePdfFile(guide) : null;
          const pdf =
            type === PropertyGuideType.PDF
              ? (uploaded ??
                (guide?.type === PropertyGuideType.PDF ? previous : null))
              : null;
          if (type === PropertyGuideType.PDF && !pdf) throw this.pdfMissing();
          const data = {
            title: input.title,
            content: input.content ?? guide?.content ?? '',
            type,
            pdfBucket: pdf?.pdfBucket ?? null,
            pdfKey: pdf?.pdfKey ?? null,
            pdfFilename: pdf?.pdfFilename ?? null,
            pdfSizeBytes: pdf?.pdfSizeBytes ?? null,
            isPublished: input.isPublished,
            updatedByUserId: actorId,
          };
          let current: SelectedGuide;
          if (!guide)
            current = await tx.propertyGuide.create({
              data: { propertyId, ...data },
              select: guideSelect,
            });
          else {
            const updated = await tx.propertyGuide.updateMany({
              where: { propertyId, version: input.expectedVersion },
              data: {
                ...data,
                version: { increment: 1 },
                updatedAt: new Date(
                  Math.max(Date.now(), guide.updatedAt.getTime() + 1),
                ),
              },
            });
            if (updated.count !== 1) throw this.changed();
            current = await tx.propertyGuide.findUniqueOrThrow({
              where: { propertyId },
              select: guideSelect,
            });
          }
          return {
            result: { property, guide: this.toDto(current) },
            retired: previous?.pdfKey !== pdf?.pdfKey ? previous : null,
          };
        },
      );
      // File removal happens only after the replacement is durably linked.
      await this.retireIfUnused(propertyId, saved.retired);
      return saved.result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.changed();
      throw error;
    }
  }

  private async retireIfUnused(
    propertyId: string,
    file: GuidePdfFile | null,
  ): Promise<void> {
    if (!file) return;
    try {
      const current = await this.prisma.propertyGuide.findUnique({
        where: { propertyId },
        select: { pdfKey: true },
      });
      if (current?.pdfKey !== file.pdfKey) await this.files.retire(file);
    } catch {
      this.logger.warn(
        `Guide PDF cleanup deferred; reconcile object ${file.pdfKey}`,
      );
    }
  }

  private async findProperty(tx: Prisma.TransactionClient, id: string) {
    const property = await tx.property.findUnique({
      where: { id },
      select: propertySelect,
    });
    if (!property)
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: '휴양소를 찾을 수 없습니다.',
      });
    return property;
  }
  private toDto(guide: SelectedGuide | null): AdminPropertyGuideDto['guide'] {
    if (!guide) return null;
    const {
      pdfBucket: _bucket,
      pdfKey: _key,
      pdfFilename,
      pdfSizeBytes,
      ...data
    } = guide;
    void _bucket;
    void _key;
    return {
      ...data,
      pdf:
        guide.type === PropertyGuideType.PDF && pdfFilename && pdfSizeBytes
          ? { filename: pdfFilename, sizeBytes: pdfSizeBytes }
          : null,
    };
  }
  private changed(): ConflictException {
    return new ConflictException({
      code: 'PROPERTY_GUIDE_CHANGED',
      message:
        '안내문이 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
    });
  }
  private pdfMissing(): BadRequestException {
    return new BadRequestException({
      code: 'PROPERTY_GUIDE_PDF_REQUIRED',
      message: '이용 안내 PDF를 선택해 주세요.',
    });
  }
}
