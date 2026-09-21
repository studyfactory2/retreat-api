import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  ImportRowAction,
  ImportRowStatus,
  Prisma,
  Role,
  StayStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type {} from 'multer';
import { PrismaService } from '../../database/prisma.service';
import type {
  CreateStayImportPreviewInput,
  GetStayImportPreviewInput,
  StayImportPropertyMappingInput,
} from '../../libs/dto/stay-import/stay-import.input';
import type { StayImportPreviewDto } from '../../libs/dto/stay-import/stay-import';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { ImportSourceStorageService } from '../../storage/import-source-storage.service';
import { RosterWorkbookReaderService } from './roster-workbook-reader.service';
import { checkRosterConflicts, stayBounds } from './roster-conflicts';
import {
  flag,
  isManagedSheet,
  MAX_IMPORT_BYTES,
  parseRoster,
  ROSTER_PARSER_VERSION,
  type PreviewRow,
} from './roster-preview';

const rowSelect = {
  id: true,
  sheetName: true,
  rowNumber: true,
  propertyId: true,
  action: true,
  validationStatus: true,
  normalizedData: true,
  validationMessages: true,
  rawData: true,
  stayId: true,
  appliedAt: true,
} satisfies Prisma.ImportRowSelect;

@Injectable()
export class AdminStayImportsService {
  private readonly logger = new Logger(AdminStayImportsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: RosterWorkbookReaderService,
    private readonly storage: ImportSourceStorageService,
  ) {}

  public async preview(
    file: Express.Multer.File | undefined,
    input: CreateStayImportPreviewInput,
    actor: AuthenticatedUser,
  ): Promise<StayImportPreviewDto> {
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 ||
      file.size !== file.buffer.length ||
      file.buffer.length > MAX_IMPORT_BYTES ||
      !/\.xls$/i.test(file.originalname)
    )
      throw this.invalidFile();
    let filename = file.originalname;
    if ([...filename].every((character) => character.charCodeAt(0) <= 255)) {
      const decoded = Buffer.from(filename, 'latin1').toString('utf8');
      if (!decoded.includes('\uFFFD')) filename = decoded;
    }
    filename = filename.normalize('NFC').split(/[\\/]/).pop() ?? '';
    if (
      !filename ||
      filename.length > 255 ||
      [...filename].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw this.invalidFile();
    const workbook = await this.reader.read(file.buffer);
    const rows = parseRoster(workbook);
    const mappings = input.propertyMappings ?? [];
    const sheetNames = new Set(workbook.sheets.map((sheet) => sheet.name));
    if (
      new Set(mappings.map((mapping) => mapping.sheetName)).size !==
        mappings.length ||
      new Set(mappings.map((mapping) => mapping.propertyId)).size !==
        mappings.length ||
      mappings.some(
        (mapping) =>
          !sheetNames.has(mapping.sheetName) ||
          !isManagedSheet(mapping.sheetName),
      )
    )
      throw this.invalidMapping();
    this.storage.assertConfigured();
    const attachmentId = randomUUID();
    const storageBucket = this.storage.getBucket();
    const storageKey = `imports/${attachmentId}.xls`;
    const checksum = createHash('sha256').update(file.buffer).digest();
    await this.prisma.$transaction(async (tx) => {
      await this.assertAdmin(tx, actor.id);
      await this.checkMappings(tx, mappings);
      await tx.attachment.create({
        data: {
          id: attachmentId,
          kind: AttachmentKind.IMPORT_SOURCE,
          status: AttachmentStatus.PENDING,
          storageBucket,
          storageKey,
          originalFilename: filename,
          contentType: 'application/vnd.ms-excel',
          sizeBytes: file.buffer.length,
          checksumSha256: checksum.toString('hex'),
          uploadedByUserId: actor.id,
        },
      });
    });
    let batchId: string;
    try {
      await this.storage.putSource(
        storageKey,
        file.buffer,
        'application/vnd.ms-excel',
        checksum.toString('base64'),
      );
      batchId = await this.prisma.$transaction(
        async (tx) => {
          await this.assertAdmin(tx, actor.id);
          const properties = await this.checkMappings(tx, mappings);
          for (const row of rows) {
            if (row.action === ImportRowAction.SKIP) continue;
            const mapping = mappings.find(
              (entry) => entry.sheetName === row.sheetName,
            );
            row.propertyId = mapping?.propertyId ?? null;
            if (!mapping)
              flag(
                row,
                'PROPERTY_NOT_MAPPED',
                '이 시트에 해당하는 휴양소를 선택해 주세요.',
              );
            else if (
              !properties.find((property) => property.id === mapping.propertyId)
                ?.isActive
            )
              flag(
                row,
                'INACTIVE_PROPERTY',
                '비활성 휴양소입니다. 등록 대상을 확인해 주세요.',
              );
          }
          await this.checkConflicts(tx, rows);
          const ready = await tx.attachment.updateMany({
            where: {
              id: attachmentId,
              status: AttachmentStatus.PENDING,
              kind: AttachmentKind.IMPORT_SOURCE,
              importBatch: { is: null },
            },
            data: { status: AttachmentStatus.READY, readyAt: new Date() },
          });
          if (ready.count !== 1)
            throw new ConflictException({
              code: 'IMPORT_SOURCE_CHANGED',
              message: '명단 업로드 상태가 변경되었습니다. 다시 시도해 주세요.',
            });
          const batch = await tx.importBatch.create({
            data: {
              sourceAttachmentId: attachmentId,
              uploadedByUserId: actor.id,
              parserVersion: ROSTER_PARSER_VERSION,
              timezone: 'Asia/Seoul',
              rows: {
                createMany: {
                  data: rows.map((row) => ({
                    ...row,
                    normalizedData: row.normalizedData ?? Prisma.JsonNull,
                  })),
                },
              },
            },
            select: { id: true },
          });
          return batch.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      await this.cleanupFailedSource(attachmentId, storageBucket, storageKey);
      throw error;
    }
    return await this.getPreview(batchId, { page: 1, limit: 20 });
  }

  public async getPreview(
    id: string,
    input: GetStayImportPreviewInput,
  ): Promise<StayImportPreviewDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            version: true,
            parserVersion: true,
            timezone: true,
            createdAt: true,
            confirmedAt: true,
            confirmedByUserId: true,
            sourceAttachment: {
              select: {
                kind: true,
                status: true,
                originalFilename: true,
                sizeBytes: true,
              },
            },
          },
        });
        if (!batch)
          throw new NotFoundException({
            code: 'IMPORT_PREVIEW_NOT_FOUND',
            message: '명단 미리보기를 찾을 수 없습니다.',
          });
        if (
          batch.sourceAttachment.kind !== AttachmentKind.IMPORT_SOURCE ||
          batch.sourceAttachment.status !== AttachmentStatus.READY
        )
          throw new InternalServerErrorException();
        const where: Prisma.ImportRowWhereInput = {
          batchId: id,
          validationStatus: input.validationStatus,
          action: input.action,
        };
        const items = await tx.importRow.findMany({
          where,
          select: rowSelect,
          orderBy: [{ sheetName: 'asc' }, { rowNumber: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.importRow.count({ where });
        const groups = await tx.importRow.groupBy({
          by: ['action', 'validationStatus'],
          where: { batchId: id },
          _count: { _all: true },
        });
        const summary = {
          total: 0,
          ready: 0,
          needsReview: 0,
          invalid: 0,
          skipped: 0,
        };
        for (const group of groups) {
          const count = group._count._all;
          summary.total += count;
          if (group.action === ImportRowAction.SKIP) summary.skipped += count;
          else if (group.validationStatus === ImportRowStatus.INVALID)
            summary.invalid += count;
          else if (group.validationStatus === ImportRowStatus.NEEDS_REVIEW)
            summary.needsReview += count;
          else summary.ready += count;
        }
        return {
          batch: {
            id: batch.id,
            status: batch.status,
            version: batch.version,
            parserVersion: batch.parserVersion,
            timezone: batch.timezone,
            createdAt: batch.createdAt,
            confirmedAt: batch.confirmedAt,
            confirmedByUserId: batch.confirmedByUserId,
            source: {
              filename: batch.sourceAttachment.originalFilename,
              sizeBytes: batch.sourceAttachment.sizeBytes,
            },
            summary,
          },
          rows: {
            items,
            total,
            page: input.page,
            limit: input.limit,
            totalPages: Math.ceil(total / input.limit),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async assertAdmin(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const actor = await tx.user.findFirst({
      where: { id, role: Role.ADMIN, isActive: true },
      select: { id: true },
    });
    if (!actor)
      throw new UnauthorizedException({
        code: 'INVALID_ADMIN_ACCESS',
        message: '관리자 로그인 상태를 확인해 주세요.',
      });
  }

  private async checkMappings(
    tx: Prisma.TransactionClient,
    mappings: StayImportPropertyMappingInput[],
  ) {
    const properties = await tx.property.findMany({
      where: { id: { in: mappings.map((mapping) => mapping.propertyId) } },
      select: { id: true, isActive: true },
    });
    if (properties.length !== mappings.length) throw this.invalidMapping();
    return properties;
  }

  private async checkConflicts(
    tx: Prisma.TransactionClient,
    rows: PreviewRow[],
  ): Promise<void> {
    const bounds = rows.map(stayBounds).filter((value) => value !== null);
    const propertyIds = [
      ...new Set(
        rows.flatMap((row) => (row.propertyId ? [row.propertyId] : [])),
      ),
    ];
    const stays =
      bounds.length && propertyIds.length
        ? await tx.stay.findMany({
            where: {
              propertyId: { in: propertyIds },
              status: StayStatus.ACTIVE,
              checkInAt: {
                lt: new Date(Math.max(...bounds.map((bound) => bound.to))),
              },
              checkOutAt: {
                gt: new Date(Math.min(...bounds.map((bound) => bound.from))),
              },
            },
            select: {
              id: true,
              propertyId: true,
              guestName: true,
              checkInAt: true,
              checkOutAt: true,
            },
            take: 5001,
          })
        : [];
    if (stays.length > 5000)
      throw new BadRequestException({
        code: 'IMPORT_RANGE_TOO_LARGE',
        message: '조회할 이용 일정이 너무 많습니다. 명단의 기간을 줄여 주세요.',
      });
    checkRosterConflicts(rows, stays);
  }

  private async cleanupFailedSource(
    id: string,
    bucket: string,
    key: string,
  ): Promise<void> {
    try {
      // Never delete a source that an uncertain successful commit already saved.
      const failed = await this.prisma.attachment.updateMany({
        where: {
          id,
          status: AttachmentStatus.PENDING,
          importBatch: { is: null },
        },
        data: { status: AttachmentStatus.FAILED },
      });
      if (failed.count === 1) await this.storage.deleteSource(bucket, key);
    } catch {
      this.logger.warn('Import source cleanup requires a retry.');
    }
  }

  private invalidFile(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_IMPORT_FILE',
      message: '5MB 이하의 .xls 이용자 명단 파일을 선택해 주세요.',
    });
  }
  private invalidMapping(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_PROPERTY_MAPPING',
      message:
        '시트와 휴양소 연결 정보를 확인해 주세요. 중복 연결은 허용되지 않습니다.',
    });
  }
}
