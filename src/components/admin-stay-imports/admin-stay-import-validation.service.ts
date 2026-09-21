import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  ImportRowAction,
  ImportRowStatus,
  ImportStatus,
  Prisma,
  Role,
  StayStatus,
  type ImportRow,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateStayInput } from '../../libs/dto/stay/stay.input';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { checkRosterConflicts, stayBounds } from './roster-conflicts';
import {
  flag,
  ROSTER_PARSER_VERSION,
  type PreviewMessage,
  type PreviewRow,
  type RosterNormalized,
} from './roster-preview';

const reviewInclude = {
  sourceAttachment: { select: { kind: true, status: true } },
  rows: {
    orderBy: [{ sheetName: 'asc' }, { rowNumber: 'asc' }],
    take: 5001,
  },
} satisfies Prisma.ImportBatchInclude;

export type ImportReviewBatch = Prisma.ImportBatchGetPayload<{
  include: typeof reviewInclude;
}>;
export type ValidatedImportRow = PreviewRow & {
  id: string;
  batchId: string;
  original: ImportRow;
};

const dynamicMessages = new Set([
  'PROPERTY_NOT_MAPPED',
  'INACTIVE_PROPERTY',
  'EXISTING_STAY_OVERLAP',
  'POSSIBLE_EXISTING_DUPLICATE',
  'DUPLICATE_SOURCE_ROW',
  'SOURCE_STAY_OVERLAP',
  'INVALID_STAY_DATA',
]);
const invalidMessages = new Set([
  'FORMULA_OR_ERROR',
  'MISSING_GUEST_NAME',
  'TEXT_TOO_LONG',
  'INVALID_DATES',
  'INVALID_DATE_RANGE',
]);

function record(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class AdminStayImportValidationService {
  public async requireAdmin(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<AuthenticatedUser> {
    const actor = await tx.user.findFirst({
      where: { id, role: Role.ADMIN, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        loginId: true,
        passwordHash: true,
      },
    });
    if (!actor || !actor.loginId || !actor.passwordHash)
      throw new UnauthorizedException({
        code: 'INVALID_ADMIN_ACCESS',
        message: '관리자 로그인 상태를 확인해 주세요.',
      });
    return {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      loginId: actor.loginId,
    };
  }

  public async loadBatch(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ImportReviewBatch> {
    const batch = await tx.importBatch.findUnique({
      where: { id },
      include: reviewInclude,
    });
    if (!batch)
      throw new NotFoundException({
        code: 'IMPORT_PREVIEW_NOT_FOUND',
        message: '명단 미리보기를 찾을 수 없습니다.',
      });
    if (
      batch.parserVersion !== ROSTER_PARSER_VERSION ||
      batch.timezone !== 'Asia/Seoul' ||
      batch.sourceAttachment.kind !== AttachmentKind.IMPORT_SOURCE ||
      batch.sourceAttachment.status !== AttachmentStatus.READY ||
      batch.rows.length > 5000
    )
      throw new ConflictException({
        code: 'IMPORT_PREVIEW_UNSUPPORTED',
        message:
          '명단 미리보기 상태를 확인해 주세요. 파일을 다시 업로드해 주세요.',
      });
    return batch;
  }

  public requirePreviewVersion(
    batch: ImportReviewBatch,
    expectedVersion: number,
  ): void {
    if (
      batch.status !== ImportStatus.PREVIEW ||
      batch.version !== expectedVersion
    )
      throw this.versionConflict();
    if (
      batch.rows.some(
        (row) =>
          row.stayId !== null ||
          row.appliedAt !== null ||
          row.expectedStayRevision !== null ||
          row.beforeSnapshot !== null ||
          row.afterSnapshot !== null,
      )
    )
      throw new ConflictException({
        code: 'IMPORT_ROWS_ALREADY_APPLIED',
        message: '이미 반영된 명단 기록입니다. 처리 상태를 확인해 주세요.',
      });
  }

  public versionConflict(): ConflictException {
    return new ConflictException({
      code: 'STALE_IMPORT_VERSION',
      message:
        '명단이 변경되었거나 이미 확정되었습니다. 최신 내용을 확인해 주세요.',
    });
  }

  public async validateRows(
    tx: Prisma.TransactionClient,
    stored: ImportRow[],
  ): Promise<ValidatedImportRow[]> {
    const rows = stored.map((original): ValidatedImportRow => {
      if (
        original.action !== ImportRowAction.CREATE &&
        original.action !== ImportRowAction.SKIP
      )
        throw new BadRequestException({
          code: 'UNSUPPORTED_IMPORT_ACTION',
          message: '명단은 신규 등록 또는 제외로 처리해 주세요.',
        });
      const messages = this.readMessages(original.validationMessages).filter(
        (entry) => !dynamicMessages.has(entry.code),
      );
      return {
        id: original.id,
        batchId: original.batchId,
        original,
        sheetName: original.sheetName,
        rowNumber: original.rowNumber,
        // Conflict checking uses normalized values; original cells are never rewritten.
        rawData: { schemaVersion: 1, cells: [] },
        normalizedData: this.readNormalized(original.normalizedData),
        propertyId: original.propertyId,
        action: original.action,
        validationMessages: messages,
        validationStatus:
          original.action === ImportRowAction.SKIP
            ? ImportRowStatus.VALID
            : messages.some((entry) => invalidMessages.has(entry.code))
              ? ImportRowStatus.INVALID
              : messages.length
                ? ImportRowStatus.NEEDS_REVIEW
                : ImportRowStatus.VALID,
      };
    });
    const propertyIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.action === ImportRowAction.CREATE && row.propertyId
            ? [row.propertyId]
            : [],
        ),
      ),
    ];
    const properties = await tx.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, isActive: true },
    });
    const propertyMap = new Map(
      properties.map((property) => [property.id, property]),
    );
    for (const row of rows) {
      if (row.action === ImportRowAction.SKIP) continue;
      if (!row.propertyId || !propertyMap.has(row.propertyId))
        flag(
          row,
          'PROPERTY_NOT_MAPPED',
          '이 행에 해당하는 휴양소를 선택해 주세요.',
        );
      else if (!propertyMap.get(row.propertyId)?.isActive)
        flag(
          row,
          'INACTIVE_PROPERTY',
          '비활성 휴양소입니다. 등록 대상을 확인해 주세요.',
        );
      const data = row.normalizedData;
      if (!data) {
        flag(
          row,
          'INVALID_STAY_DATA',
          '이용 일정 정보를 다시 확인해 주세요.',
          true,
        );
        continue;
      }
      const input = plainToInstance(CreateStayInput, {
        // Missing mapping is a review issue separately from guest/date validation.
        propertyId: row.propertyId ?? '00000000-0000-4000-8000-000000000000',
        guestName: data.guestName,
        company: data.company,
        department: data.department,
        phone: data.phone,
        notes: data.notes,
        checkInAt: data.checkInAt,
        checkOutAt: data.checkOutAt,
      });
      if (
        validateSync(input, { whitelist: true, forbidNonWhitelisted: true })
          .length ||
        !data.checkInAt ||
        !data.checkOutAt ||
        Date.parse(data.checkInAt) >= Date.parse(data.checkOutAt)
      ) {
        flag(
          row,
          'INVALID_STAY_DATA',
          '이름, 연락처, 입퇴실 일시와 입력 길이를 확인해 주세요.',
          true,
        );
      } else {
        data.checkInAt = new Date(input.checkInAt).toISOString();
        data.checkOutAt = new Date(input.checkOutAt).toISOString();
        data.checkInDate = new Date(Date.parse(input.checkInAt) + 9 * 3600_000)
          .toISOString()
          .slice(0, 10);
        data.checkOutDate = new Date(
          Date.parse(input.checkOutAt) + 9 * 3600_000,
        )
          .toISOString()
          .slice(0, 10);
      }
    }
    const bounds = rows
      .filter((row) => row.action === ImportRowAction.CREATE)
      .map(stayBounds)
      .filter((value) => value !== null);
    const stays =
      bounds.length && propertyIds.length
        ? await tx.stay.findMany({
            where: {
              propertyId: { in: propertyIds },
              status: StayStatus.ACTIVE,
              checkInAt: {
                lt: new Date(Math.max(...bounds.map((value) => value.to))),
              },
              checkOutAt: {
                gt: new Date(Math.min(...bounds.map((value) => value.from))),
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
    return rows;
  }

  public async persistValidation(
    tx: Prisma.TransactionClient,
    rows: ValidatedImportRow[],
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += 100) {
      const chunk = rows.slice(offset, offset + 100);
      const values = chunk.map(
        (row) => Prisma.sql`(
        ${row.id}::text, ${row.batchId}::text, ${row.propertyId}::text,
        ${row.action}::"ImportRowAction", ${row.validationStatus}::"ImportRowStatus",
        ${JSON.stringify(row.normalizedData)}::jsonb,
        ${JSON.stringify(row.validationMessages)}::jsonb
      )`,
      );
      const changed = await tx.$executeRaw(Prisma.sql`
        UPDATE "ImportRow" AS r SET
          "propertyId" = v.property_id, "action" = v.action,
          "validationStatus" = v.validation_status, "normalizedData" = v.normalized_data,
          "validationMessages" = v.messages, "updatedAt" = CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(values)})
          AS v(id, batch_id, property_id, action, validation_status, normalized_data, messages)
        WHERE r.id = v.id AND r."batchId" = v.batch_id
          AND r."stayId" IS NULL AND r."appliedAt" IS NULL
      `);
      if (changed !== chunk.length) throw this.versionConflict();
    }
  }

  private readNormalized(value: Prisma.JsonValue): RosterNormalized | null {
    if (value === null) return null;
    if (
      !record(value) ||
      value.schemaVersion !== 1 ||
      value.guestCount !== null ||
      ![
        'guestName',
        'company',
        'department',
        'phone',
        'checkInDate',
        'checkOutDate',
        'checkInAt',
        'checkOutAt',
        'notes',
      ].every((key) => value[key] === null || typeof value[key] === 'string')
    )
      throw new InternalServerErrorException();
    return value as RosterNormalized;
  }

  private readMessages(value: Prisma.JsonValue): PreviewMessage[] {
    if (!Array.isArray(value)) throw new InternalServerErrorException();
    return value.map((entry) => {
      if (
        !record(entry) ||
        typeof entry.code !== 'string' ||
        typeof entry.message !== 'string'
      )
        throw new InternalServerErrorException();
      return { code: entry.code, message: entry.message };
    });
  }
}
