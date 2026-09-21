import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StayStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { GetAdminCalendarInput } from '../../libs/dto/admin-calendar/admin-calendar.input';
import type { AdminCalendarDto } from '../../libs/dto/admin-calendar/admin-calendar';
import { readStayChecklists } from '../../libs/calendar/checklist-status';
import { seoulDateRange, seoulDay } from '../../libs/dates/seoul-date';

const staySelect = {
  id: true,
  propertyId: true,
  guestName: true,
  checkInAt: true,
  checkOutAt: true,
  currentRevision: true,
  property: { select: { id: true, name: true, region: true, isActive: true } },
} satisfies Prisma.StaySelect;

@Injectable()
export class AdminCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  public async getCalendar(
    input: GetAdminCalendarInput,
  ): Promise<AdminCalendarDto> {
    const { start, end } = seoulDateRange(
      input.from,
      input.to,
      62,
      'INVALID_CALENDAR_RANGE',
    );
    const propertyId = input.propertyId?.toLowerCase();
    const asOf = new Date();
    const today = seoulDay(asOf);
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
        const where: Prisma.StayWhereInput = {
          propertyId,
          status: StayStatus.ACTIVE,
          checkInAt: { lt: end },
          // Include departures exactly at the range start so their exit checklist remains visible.
          checkOutAt: { gte: start },
        };
        const stays = await tx.stay.findMany({
          where,
          select: staySelect,
          orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.stay.count({ where });
        const checklistStates = await readStayChecklists(tx, stays, today);
        return {
          from: input.from,
          to: input.to,
          timezone: 'Asia/Seoul',
          asOf,
          today,
          items: stays.map((stay) => {
            const checklists = checklistStates.get(stay.id);
            if (!checklists) throw new InternalServerErrorException();
            return {
              id: stay.id,
              property: stay.property,
              guestName: stay.guestName,
              checkInAt: stay.checkInAt,
              checkOutAt: stay.checkOutAt,
              currentRevision: stay.currentRevision,
              ...checklists,
            };
          }),
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
