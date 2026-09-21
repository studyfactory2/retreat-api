import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChecklistType,
  Prisma,
  StayStatus,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { GetAdminCalendarInput } from '../../libs/dto/admin-calendar/admin-calendar.input';
import type { AdminCalendarDto } from '../../libs/dto/admin-calendar/admin-calendar';
import {
  calendarChecklist,
  calendarSubmissionSelect,
  seoulDay,
} from './calendar-checklist';

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
    const { start, end } = this.range(input.from, input.to);
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
        const groups = stays.length
          ? await tx.checklistSubmission.groupBy({
              by: ['stayId', 'type'],
              where: {
                stayId: { in: stays.map((stay) => stay.id) },
                status: SubmissionStatus.SUBMITTED,
                type: { in: [ChecklistType.CHECK_IN, ChecklistType.CHECK_OUT] },
              },
              _count: { _all: true },
            })
          : [];
        const singletonGroups = groups.filter(
          (group) => group._count._all === 1,
        );
        const submissions = singletonGroups.length
          ? await tx.checklistSubmission.findMany({
              where: {
                status: SubmissionStatus.SUBMITTED,
                OR: singletonGroups.map((group) => ({
                  stayId: group.stayId,
                  type: group.type,
                })),
              },
              select: calendarSubmissionSelect,
            })
          : [];
        const counts = new Map(
          groups.map((group) => [
            `${group.stayId}:${group.type}`,
            group._count._all,
          ]),
        );
        const records = new Map(
          submissions.map((record) => [
            `${record.stayId}:${record.type}`,
            record,
          ]),
        );
        return {
          from: input.from,
          to: input.to,
          timezone: 'Asia/Seoul',
          asOf,
          today,
          items: stays.map(({ propertyId: _propertyId, ...stay }) => {
            const context = { ...stay, propertyId: _propertyId };
            return {
              ...stay,
              checkIn: calendarChecklist(
                context,
                'CHECK_IN',
                counts.get(`${stay.id}:CHECK_IN`) ?? 0,
                records.get(`${stay.id}:CHECK_IN`),
                today,
              ),
              checkOut: calendarChecklist(
                context,
                'CHECK_OUT',
                counts.get(`${stay.id}:CHECK_OUT`) ?? 0,
                records.get(`${stay.id}:CHECK_OUT`),
                today,
              ),
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

  private range(from: string, to: string): { start: Date; end: Date } {
    const parse = (value: string): Date => {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        value < '1900-01-01' ||
        value > '2100-12-31'
      )
        throw this.invalidRange();
      const date = new Date(`${value}T00:00:00.000Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      )
        throw this.invalidRange();
      return date;
    };
    const startDay = parse(from);
    const lastDay = parse(to);
    const days = (lastDay.getTime() - startDay.getTime()) / 86400_000 + 1;
    if (days < 1 || days > 62) throw this.invalidRange();
    return {
      start: new Date(startDay.getTime() - 9 * 3600_000),
      end: new Date(lastDay.getTime() + 15 * 3600_000),
    };
  }

  private invalidRange(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_CALENDAR_RANGE',
      message: '조회 기간은 올바른 날짜 순서로 최대 62일까지 선택해 주세요.',
    });
  }
}
