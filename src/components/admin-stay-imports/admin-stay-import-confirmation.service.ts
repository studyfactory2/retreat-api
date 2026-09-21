import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  ImportRowAction,
  ImportRowStatus,
  ImportStatus,
  Prisma,
  StayRevisionAction,
  StaySource,
  StayStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { StayImportConfirmationDto } from '../../libs/dto/stay-import/stay-import';
import type { ConfirmStayImportInput } from '../../libs/dto/stay-import/stay-import.input';
import type { StayDto } from '../../libs/dto/stay/stay';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import {
  buildStayActorSnapshot,
  buildStaySnapshot,
} from '../stays/stay-snapshot';
import {
  AdminStayImportValidationService,
  type ImportReviewBatch,
  type ValidatedImportRow,
} from './admin-stay-import-validation.service';

const CONFIRM_CHUNK_SIZE = 200;

type Application = {
  rowId: string;
  stay: StayDto;
  snapshot: Prisma.InputJsonObject;
};

@Injectable()
export class AdminStayImportConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: AdminStayImportValidationService,
  ) {}

  public async confirm(
    id: string,
    input: ConfirmStayImportInput,
    actor: AuthenticatedUser,
  ): Promise<StayImportConfirmationDto> {
    return await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const administrator = await this.validation.requireAdmin(tx, actor.id);
        const batch = await this.validation.loadBatch(tx, id.toLowerCase());
        if (batch.status === ImportStatus.CONFIRMED) {
          if (input.expectedVersion !== batch.version - 1) throw this.changed();
          return this.receipt(batch);
        }
        this.validation.requirePreviewVersion(batch, input.expectedVersion);
        if (
          batch.sourceAttachment.kind !== AttachmentKind.IMPORT_SOURCE ||
          batch.sourceAttachment.status !== AttachmentStatus.READY ||
          batch.rows.some(
            (row) =>
              row.stayId !== null ||
              row.appliedAt !== null ||
              row.afterSnapshot !== null,
          )
        ) {
          throw this.changed();
        }

        const rows = await this.validation.validateRows(tx, batch.rows);
        const originalIds = new Set(batch.rows.map((row) => row.id));
        if (
          rows.length !== batch.rows.length ||
          new Set(rows.map((row) => row.id)).size !== rows.length ||
          rows.some((row) => !originalIds.has(row.id))
        ) {
          throw this.invalidConfirmation();
        }
        const creating = rows.filter(
          (row) => row.action !== ImportRowAction.SKIP,
        );
        const unresolved = creating.filter((row) => !this.isReady(row));
        if (unresolved.length > 0) throw this.notReady(unresolved);

        const properties = await tx.property.findMany({
          where: {
            id: { in: [...new Set(creating.map((row) => row.propertyId))] },
            isActive: true,
          },
          select: { id: true, name: true, region: true, isActive: true },
        });
        const byProperty = new Map(
          properties.map((property) => [property.id, property]),
        );
        const confirmedAt = new Date();
        const applications: Application[] = creating.map((row) => {
          const normalized = row.normalizedData;
          const property = byProperty.get(row.propertyId);
          if (!property) throw this.notReady();
          const stay: StayDto = {
            id: randomUUID(),
            propertyId: property.id,
            guestUserId: null,
            guestName: normalized.guestName,
            company: normalized.company,
            department: normalized.department,
            phone: normalized.phone,
            notes: normalized.notes,
            checkInAt: new Date(normalized.checkInAt),
            checkOutAt: new Date(normalized.checkOutAt),
            status: StayStatus.ACTIVE,
            source: StaySource.EXCEL,
            createdByUserId: administrator.id,
            currentRevision: 1,
            cancelledAt: null,
            cancellationReason: null,
            createdAt: confirmedAt,
            updatedAt: confirmedAt,
            property,
            createdBy: { id: administrator.id, name: administrator.name },
          };
          return { rowId: row.id, stay, snapshot: buildStaySnapshot(stay) };
        });

        // Claim the preview version before applying any stays. All changes below
        // remain invisible until this serializable transaction commits together.
        const claimed = await tx.importBatch.updateMany({
          where: {
            id: batch.id,
            status: ImportStatus.PREVIEW,
            version: input.expectedVersion,
          },
          data: {
            status: ImportStatus.CONFIRMED,
            version: { increment: 1 },
            confirmedAt,
            confirmedByUserId: administrator.id,
          },
        });
        if (claimed.count !== 1) throw this.changed();
        await this.validation.persistValidation(tx, rows);

        const actorSnapshot = buildStayActorSnapshot(administrator);
        for (
          let offset = 0;
          offset < applications.length;
          offset += CONFIRM_CHUNK_SIZE
        ) {
          const chunk = applications.slice(offset, offset + CONFIRM_CHUNK_SIZE);
          const stays = await tx.stay.createMany({
            data: chunk.map(({ stay }) => ({
              id: stay.id,
              propertyId: stay.propertyId,
              guestUserId: null,
              guestName: stay.guestName,
              company: stay.company,
              department: stay.department,
              phone: stay.phone,
              notes: stay.notes,
              checkInAt: stay.checkInAt,
              checkOutAt: stay.checkOutAt,
              status: StayStatus.ACTIVE,
              source: StaySource.EXCEL,
              createdByUserId: administrator.id,
              currentRevision: 1,
              createdAt: confirmedAt,
              updatedAt: confirmedAt,
            })),
          });
          if (stays.count !== chunk.length) throw this.changed();
          const revisions = await tx.stayRevision.createMany({
            data: chunk.map(({ rowId, stay, snapshot }) => ({
              id: randomUUID(),
              stayId: stay.id,
              version: 1,
              action: StayRevisionAction.CREATED,
              snapshot,
              actorUserId: administrator.id,
              actorSnapshot,
              importRowId: rowId,
              createdAt: confirmedAt,
            })),
          });
          if (revisions.count !== chunk.length) throw this.changed();
          const values = chunk.map(
            ({ rowId, stay, snapshot }) => Prisma.sql`
            (${rowId}::text, ${stay.propertyId}::text, ${stay.id}::text,
             ${JSON.stringify(snapshot)}::jsonb, ${confirmedAt}::timestamptz)
          `,
          );
          const applied = await tx.$executeRaw(Prisma.sql`
            UPDATE "ImportRow" AS target
            SET "propertyId" = application."propertyId",
                "stayId" = application."stayId",
                "afterSnapshot" = application."afterSnapshot",
                "appliedAt" = application."appliedAt",
                "updatedAt" = application."appliedAt"
            FROM (VALUES ${Prisma.join(values)})
              AS application("id", "propertyId", "stayId", "afterSnapshot", "appliedAt")
            WHERE target."id" = application."id"
              AND target."batchId" = ${batch.id}
              AND target."action" = 'CREATE'::"ImportRowAction"
              AND target."validationStatus" = 'VALID'::"ImportRowStatus"
              AND target."stayId" IS NULL
              AND target."appliedAt" IS NULL
          `);
          if (applied !== chunk.length) throw this.changed();
        }
        return {
          batchId: batch.id,
          status: ImportStatus.CONFIRMED,
          version: batch.version + 1,
          confirmedAt,
          confirmedByUserId: administrator.id,
          createdCount: applications.length,
          skippedCount: rows.length - applications.length,
        };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private isReady(row: ValidatedImportRow): boolean {
    const data = row.normalizedData;
    if (
      row.action !== ImportRowAction.CREATE ||
      row.validationStatus !== ImportRowStatus.VALID ||
      !row.propertyId ||
      !data ||
      typeof data.guestName !== 'string' ||
      !data.guestName.trim() ||
      !data.checkInAt ||
      !data.checkOutAt
    ) {
      return false;
    }
    const from = new Date(data.checkInAt).getTime();
    const to = new Date(data.checkOutAt).getTime();
    return Number.isFinite(from) && Number.isFinite(to) && from < to;
  }

  private receipt(batch: ImportReviewBatch): StayImportConfirmationDto {
    const created = batch.rows.filter(
      (row) => row.stayId !== null && row.appliedAt !== null,
    );
    const skipped = batch.rows.filter(
      (row) => row.action === ImportRowAction.SKIP,
    );
    if (
      !batch.confirmedAt ||
      !batch.confirmedByUserId ||
      batch.version < 2 ||
      created.length + skipped.length !== batch.rows.length ||
      created.some((row) => row.action !== ImportRowAction.CREATE) ||
      skipped.some((row) => row.stayId !== null || row.appliedAt !== null)
    ) {
      throw this.invalidConfirmation();
    }
    return {
      batchId: batch.id,
      status: ImportStatus.CONFIRMED,
      version: batch.version,
      confirmedAt: batch.confirmedAt,
      confirmedByUserId: batch.confirmedByUserId,
      createdCount: created.length,
      skippedCount: skipped.length,
    };
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'IMPORT_BATCH_CHANGED',
      message: '명단 상태가 변경되었습니다. 최신 미리보기를 확인해 주세요.',
    });
  }

  private notReady(rows?: ValidatedImportRow[]): ConflictException {
    return new ConflictException({
      code: 'IMPORT_ROWS_NOT_READY',
      message:
        '최신 충돌 내역을 확인하고 해당 행을 다시 검토하거나 제외한 뒤 확정해 주세요.',
      ...(rows
        ? {
            errors: rows.slice(0, 100).map((row) => ({
              field: `rows.${row.id}`,
              messages:
                row.validationMessages.length > 0
                  ? row.validationMessages.map((entry) => entry.message)
                  : ['이 행의 이용 정보를 다시 확인해 주세요.'],
            })),
          }
        : {}),
    });
  }

  private invalidConfirmation(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'IMPORT_CONFIRMATION_INVALID',
      message:
        '명단 확정 내역을 확인하지 못했습니다. 관리자에게 문의해 주세요.',
    });
  }
}
