import { BadRequestException, Injectable } from '@nestjs/common';
import { ImportRowAction, ImportRowStatus, ImportStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { ReviewStayImportInput } from '../../libs/dto/stay-import/stay-import.input';
import type { StayImportPreviewDto } from '../../libs/dto/stay-import/stay-import';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AdminStayImportsService } from './admin-stay-imports.service';
import { AdminStayImportValidationService } from './admin-stay-import-validation.service';

const seoulDate = (timestamp: string): string =>
  new Date(Date.parse(timestamp) + 9 * 3600_000).toISOString().slice(0, 10);

@Injectable()
export class AdminStayImportReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: AdminStayImportValidationService,
    private readonly previews: AdminStayImportsService,
  ) {}

  public async review(
    id: string,
    input: ReviewStayImportInput,
    actor: AuthenticatedUser,
  ): Promise<StayImportPreviewDto> {
    if (new Set(input.rows.map((row) => row.id)).size !== input.rows.length)
      throw new BadRequestException({
        code: 'DUPLICATE_IMPORT_ROW',
        message: '같은 명단 행을 중복으로 수정할 수 없습니다.',
      });
    await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const reviewer = await this.validation.requireAdmin(tx, actor.id);
        const batch = await this.validation.loadBatch(tx, id);
        this.validation.requirePreviewVersion(batch, input.expectedVersion);
        const rowMap = new Map(batch.rows.map((row) => [row.id, row]));
        const at = new Date().toISOString();
        for (const edit of input.rows) {
          const row = rowMap.get(edit.id);
          if (!row)
            throw new BadRequestException({
              code: 'INVALID_IMPORT_ROW',
              message: '이 명단에 포함된 행만 수정할 수 있습니다.',
            });
          if (edit.action === ImportRowAction.SKIP) {
            row.action = ImportRowAction.SKIP;
            row.validationStatus = ImportRowStatus.VALID;
            if (
              row.normalizedData !== null &&
              typeof row.normalizedData === 'object' &&
              !Array.isArray(row.normalizedData)
            )
              row.normalizedData = {
                ...row.normalizedData,
                review: {
                  actor: {
                    id: reviewer.id,
                    name: reviewer.name,
                    role: reviewer.role,
                  },
                  at,
                  action: ImportRowAction.SKIP,
                },
              };
            continue;
          }
          if (row.normalizedData === null || !edit.data)
            throw new BadRequestException({
              code: 'INVALID_IMPORT_ROW_REVIEW',
              message:
                '이용객 행의 전체 정보를 확인해 주세요. 안내 행은 등록할 수 없습니다.',
            });
          const data = edit.data;
          if (Date.parse(data.checkInAt) >= Date.parse(data.checkOutAt))
            throw new BadRequestException({
              code: 'INVALID_DATE_RANGE',
              message: '퇴실 일시는 입실 일시보다 늦어야 합니다.',
            });
          const property = await tx.property.findUnique({
            where: { id: data.propertyId },
            select: { id: true },
          });
          if (!property)
            throw new BadRequestException({
              code: 'INVALID_PROPERTY_MAPPING',
              message: '등록된 휴양소를 선택해 주세요.',
            });
          row.propertyId = data.propertyId;
          row.action = ImportRowAction.CREATE;
          row.validationStatus = ImportRowStatus.VALID;
          row.validationMessages = [];
          row.normalizedData = {
            schemaVersion: 1,
            guestCount: null,
            guestName: data.guestName,
            company: data.company ?? null,
            department: data.department ?? null,
            phone: data.phone ?? null,
            notes: data.notes ?? null,
            checkInAt: new Date(data.checkInAt).toISOString(),
            checkOutAt: new Date(data.checkOutAt).toISOString(),
            checkInDate: seoulDate(data.checkInAt),
            checkOutDate: seoulDate(data.checkOutAt),
            review: {
              actor: {
                id: reviewer.id,
                name: reviewer.name,
                role: reviewer.role,
              },
              at,
              action: ImportRowAction.CREATE,
            },
          };
        }
        const rows = await this.validation.validateRows(tx, batch.rows);
        const updated = await tx.importBatch.updateMany({
          where: {
            id,
            status: ImportStatus.PREVIEW,
            version: input.expectedVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw this.validation.versionConflict();
        await this.validation.persistValidation(tx, rows);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return await this.previews.getPreview(id, { page: 1, limit: 20 });
  }
}
