import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { IssueStatus, Prisma, StayStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { readStayChecklists } from '../../libs/calendar/checklist-status';
import { seoulDateRange, seoulDay } from '../../libs/dates/seoul-date';
import type { CalendarChecklistDto } from '../../libs/dto/admin-calendar/admin-calendar';
import type {
  AdminDashboardDto,
  DashboardChecklistCounts,
} from '../../libs/dto/admin-dashboard/admin-dashboard';
import type { GetAdminDashboardInput } from '../../libs/dto/admin-dashboard/admin-dashboard.input';
import { readMaintenanceSummary } from '../../libs/maintenance/maintenance-progress';

const staySelect = {
  id: true,
  propertyId: true,
  guestName: true,
  checkInAt: true,
  checkOutAt: true,
  currentRevision: true,
} satisfies Prisma.StaySelect;

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  public async getDashboard(
    input: GetAdminDashboardInput,
  ): Promise<AdminDashboardDto> {
    const asOf = new Date();
    const today = seoulDay(asOf);
    const date = input.date ?? today;
    const { start, end } = seoulDateRange(date, date, 1);
    const propertyId = input.propertyId?.toLowerCase();

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

        const stays = { arrivals: 0, departures: 0 };
        const checklists = {
          checkIn: this.emptyChecklistCounts(),
          checkOut: this.emptyChecklistCounts(),
        };
        let afterId: string | undefined;
        // Count every relevant stay while bounding snapshot reads to one batch.
        for (;;) {
          const batch = await tx.stay.findMany({
            where: {
              propertyId,
              status: StayStatus.ACTIVE,
              ...(afterId ? { id: { gt: afterId } } : {}),
              OR: [
                { checkInAt: { gte: start, lt: end } },
                { checkOutAt: { gte: start, lt: end } },
              ],
            },
            select: staySelect,
            orderBy: { id: 'asc' },
            take: 100,
          });
          if (!batch.length) break;
          const states = await readStayChecklists(tx, batch, today);
          for (const stay of batch) {
            const state = states.get(stay.id);
            if (!state) throw new InternalServerErrorException();
            if (stay.checkInAt >= start && stay.checkInAt < end) {
              stays.arrivals += 1;
              this.countChecklist(checklists.checkIn, state.checkIn.status);
            }
            if (stay.checkOutAt >= start && stay.checkOutAt < end) {
              stays.departures += 1;
              this.countChecklist(checklists.checkOut, state.checkOut.status);
            }
          }
          afterId = batch[batch.length - 1].id;
          if (batch.length < 100) break;
        }

        const maintenance = await readMaintenanceSummary(
          tx,
          propertyId,
          start,
          end,
          asOf,
        );
        // Open issues are the current backlog, including problems reported before this day.
        const issueGroups = await tx.issue.groupBy({
          by: ['status'],
          where: {
            propertyId,
            cancelledAt: null,
            status: { in: [IssueStatus.NEW, IssueStatus.IN_PROGRESS] },
          },
          _count: { _all: true },
        });
        const issues = { new: 0, inProgress: 0, total: 0 };
        for (const group of issueGroups) {
          if (group.status === IssueStatus.NEW) issues.new += group._count._all;
          if (group.status === IssueStatus.IN_PROGRESS)
            issues.inProgress += group._count._all;
          issues.total += group._count._all;
        }

        return {
          date,
          today,
          timezone: 'Asia/Seoul',
          asOf,
          stays,
          checklists,
          maintenance,
          issues,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30_000,
      },
    );
  }

  private emptyChecklistCounts(): DashboardChecklistCounts {
    return {
      scheduled: 0,
      notSubmitted: 0,
      submitted: 0,
      needsReview: 0,
      total: 0,
    };
  }

  private countChecklist(
    counts: DashboardChecklistCounts,
    status: CalendarChecklistDto['status'],
  ): void {
    counts.total += 1;
    switch (status) {
      case 'SCHEDULED':
        counts.scheduled += 1;
        break;
      case 'NOT_SUBMITTED':
        counts.notSubmitted += 1;
        break;
      case 'SUBMITTED':
        counts.submitted += 1;
        break;
      case 'NEEDS_REVIEW':
        counts.needsReview += 1;
        break;
    }
  }
}
