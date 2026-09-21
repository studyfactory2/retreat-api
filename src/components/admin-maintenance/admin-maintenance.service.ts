import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChecklistType, Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { seoulDateRange } from '../../libs/dates/seoul-date';
import type { GetAdminMaintenanceInput } from '../../libs/dto/admin-maintenance/admin-maintenance.input';
import type { AdminMaintenanceDto } from '../../libs/dto/admin-maintenance/admin-maintenance';
import {
  classifyMaintenance,
  maintenanceProgressSelect,
} from '../../libs/maintenance/maintenance-progress';

@Injectable()
export class AdminMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  public async getMaintenance(
    input: GetAdminMaintenanceInput,
  ): Promise<AdminMaintenanceDto> {
    if (
      (input.from === undefined) !== (input.to === undefined) ||
      (input.dateField === 'SUBMITTED' && input.view === 'UNFINISHED')
    )
      throw new BadRequestException({
        code: 'INVALID_MAINTENANCE_FILTER',
        message:
          '시작일과 종료일을 함께 입력하고, 미완료 기록은 정비 시작일로 조회해 주세요.',
      });
    const range =
      input.from !== undefined && input.to !== undefined
        ? seoulDateRange(input.from, input.to)
        : null;
    const propertyId = input.propertyId?.toLowerCase();
    const asOf = new Date();
    return await this.prisma.$transaction(
      async (tx) => {
        if (propertyId) {
          const property = await tx.property.findUnique({
            where: { id: propertyId },
            select: { id: true },
          });
          if (!property)
            throw new NotFoundException({
              code: 'PROPERTY_NOT_FOUND',
              message: '휴양소를 찾을 수 없습니다.',
            });
        }
        const where: Prisma.ChecklistSubmissionWhereInput = {
          propertyId,
          type: ChecklistType.MAINTENANCE,
          cancelledAt: null,
          status:
            input.view === 'UNFINISHED'
              ? SubmissionStatus.DRAFT
              : input.view === 'COMPLETED'
                ? SubmissionStatus.SUBMITTED
                : {
                    in: [SubmissionStatus.DRAFT, SubmissionStatus.SUBMITTED],
                  },
          ...(range
            ? input.dateField === 'SUBMITTED'
              ? { submittedAt: { gte: range.start, lt: range.end } }
              : { startedAt: { gte: range.start, lt: range.end } }
            : {}),
        };
        const orderBy: Prisma.ChecklistSubmissionOrderByWithRelationInput[] = [
          input.dateField === 'SUBMITTED'
            ? { submittedAt: { sort: 'desc', nulls: 'last' } }
            : { startedAt: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ];
        const rows = await tx.checklistSubmission.findMany({
          where,
          orderBy,
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          select: maintenanceProgressSelect,
        });
        const total = await tx.checklistSubmission.count({ where });
        return {
          items: rows.map((row) => classifyMaintenance(row, asOf)),
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
          asOf,
          timezone: 'Asia/Seoul',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
