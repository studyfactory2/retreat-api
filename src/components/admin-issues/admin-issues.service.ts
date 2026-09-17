import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorSource,
  IssueEventType,
  IssueStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  AddAdminIssueNoteInput,
  ChangeAdminIssueStatusInput,
  GetAdminIssueHistoryInput,
  GetAdminIssuesInput,
} from '../../libs/dto/admin-issue/admin-issue.input';
import type {
  AdminIssueDetailDto,
  AdminIssueHistoryDto,
  AdminIssueListDto,
  AdminIssueRecordDto,
  AdminIssueSummaryDto,
} from '../../libs/dto/admin-issue/admin-issue';
import {
  adminIssueEventSelect,
  adminIssueInclude,
  AdminIssueReader,
} from './admin-issue-reader';
import { buildAdminIssueSnapshot } from './admin-issue-snapshot';

@Injectable()
export class AdminIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminIssueReader,
  ) {}

  public async getIssues(
    input: GetAdminIssuesInput,
  ): Promise<AdminIssueListDto> {
    const from =
      input.from === undefined ? undefined : this.dayStart(input.from);
    const to = input.to === undefined ? undefined : this.dayStart(input.to);
    if (from && to && from > to) {
      throw new BadRequestException({
        code: 'INVALID_ISSUE_DATE_RANGE',
        message: '조회 종료일은 시작일보다 빠를 수 없습니다.',
      });
    }
    const where: Prisma.IssueWhereInput = {
      cancelledAt: null,
      currentVersion: { gte: 1 },
      propertyId: input.propertyId?.toLowerCase(),
      status: input.status,
      isUrgent: input.isUrgent,
      ...(from || to
        ? {
            reportedAt: {
              gte: from,
              lt: to && new Date(to.getTime() + 86400000),
            },
          }
        : {}),
    };
    return await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.issue.findMany({
          where,
          include: {
            ...adminIssueInclude,
            events: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true, snapshot: true },
            },
          },
          orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.issue.count({ where });
        const items: AdminIssueSummaryDto[] = rows.map((row) => {
          const latest = row.events[0];
          if (!latest) throw new InternalServerErrorException();
          const record = this.reader.currentRecord(row, latest);
          return {
            id: record.id,
            property: record.property,
            category: record.category,
            title: record.title,
            areaLabel: record.areaLabel,
            isUrgent: record.isUrgent,
            status: record.status,
            currentVersion: record.currentVersion,
            reportedAt: record.reportedAt,
            resolvedAt: record.resolvedAt,
            updatedAt: record.updatedAt,
          };
        });
        return {
          items,
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getIssue(id: string): Promise<AdminIssueDetailDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        return await this.reader.readDetail(
          tx,
          await this.reader.findIssue(tx, id),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async getHistory(
    id: string,
    input: GetAdminIssueHistoryInput,
  ): Promise<AdminIssueHistoryDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        const issue = await this.reader.findIssue(tx, id);
        const where = {
          issueId: issue.id,
          version: { lte: issue.currentVersion },
        };
        const rows = await tx.issueEvent.findMany({
          where,
          select: adminIssueEventSelect,
          orderBy: { version: 'desc' },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        });
        const total = await tx.issueEvent.count({ where });
        const items = [];
        for (const row of rows)
          items.push((await this.reader.mapEvent(tx, issue, row)).dto);
        return {
          items,
          total,
          page: input.page,
          limit: input.limit,
          totalPages: Math.ceil(total / input.limit),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async addNote(
    id: string,
    input: AddAdminIssueNoteInput,
    adminId: string,
  ): Promise<AdminIssueDetailDto> {
    const note = this.note(input.note);
    if (!note) throw this.noteRequired();
    return await this.recordAction(id, input.expectedVersion, adminId, {
      note,
    });
  }

  public async changeStatus(
    id: string,
    input: ChangeAdminIssueStatusInput,
    adminId: string,
  ): Promise<AdminIssueDetailDto> {
    return await this.recordAction(id, input.expectedVersion, adminId, {
      note: this.note(input.note),
      status: input.status,
    });
  }

  private async recordAction(
    id: string,
    expectedVersion: number,
    adminId: string,
    action: { note: string | null; status?: IssueStatus },
  ): Promise<AdminIssueDetailDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: adminId },
        select: {
          id: true,
          name: true,
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
      ) {
        throw new UnauthorizedException({
          code: 'UNAUTHENTICATED',
          message: '로그인이 필요합니다. 다시 로그인해 주세요.',
        });
      }
      const issue = await this.reader.findIssue(tx, id);
      if (issue.cancelledAt) {
        throw new ConflictException({
          code: 'ISSUE_CANCELLED',
          message: '취소된 이상사항은 변경할 수 없습니다.',
        });
      }
      if (
        issue.currentVersion !== expectedVersion ||
        issue.currentVersion >= 2147483647
      )
        throw this.changed();
      const current = await this.reader.readDetail(tx, issue);
      const status = action.status ?? issue.status;
      const type =
        action.status === undefined
          ? IssueEventType.UPDATED
          : this.statusEvent(issue.status, status, action.note);
      const now = new Date(Math.max(Date.now(), issue.updatedAt.getTime() + 1));
      const data = {
        status,
        currentVersion: issue.currentVersion + 1,
        updatedAt: now,
        resolvedAt:
          action.status === undefined
            ? issue.resolvedAt
            : status === IssueStatus.RESOLVED
              ? now
              : null,
        resolvedByUserId:
          action.status === undefined
            ? issue.resolvedByUserId
            : status === IssueStatus.RESOLVED
              ? actor.id
              : null,
      };
      const result = await tx.issue.updateMany({
        where: {
          id: issue.id,
          currentVersion: expectedVersion,
          updatedAt: issue.updatedAt,
          cancelledAt: null,
        },
        data,
      });
      if (result.count !== 1) throw this.changed();
      const record: AdminIssueRecordDto = {
        ...current.issue,
        ...data,
        property: issue.property,
        category: issue.category,
      };
      await tx.issueEvent.create({
        data: {
          issueId: issue.id,
          version: data.currentVersion,
          type,
          actorSource: ActorSource.ADMIN_SESSION,
          actorUserId: actor.id,
          actorSnapshot: {
            schemaVersion: 1,
            id: actor.id,
            name: actor.name,
            role: actor.role,
          },
          sourceRevisionId: null,
          note: action.note,
          fromStatus: issue.status,
          toStatus: status,
          snapshot: buildAdminIssueSnapshot(record, issue.requestKey),
          createdAt: now,
        },
      });
      return await this.reader.readDetail(tx, { ...issue, ...data });
    });
  }

  private statusEvent(
    from: IssueStatus,
    to: IssueStatus,
    note: string | null,
  ): IssueEventType {
    if (from === to) {
      throw new ConflictException({
        code: 'ISSUE_STATUS_UNCHANGED',
        message: '이미 해당 상태입니다. 최신 내용을 확인해 주세요.',
      });
    }
    if (
      to === IssueStatus.RESOLVED &&
      (from === IssueStatus.NEW || from === IssueStatus.IN_PROGRESS)
    ) {
      if (!note) throw this.noteRequired();
      return IssueEventType.RESOLVED;
    }
    if (to === IssueStatus.IN_PROGRESS && from === IssueStatus.NEW)
      return IssueEventType.STATUS_CHANGED;
    if (to === IssueStatus.IN_PROGRESS && from === IssueStatus.RESOLVED) {
      if (!note) throw this.noteRequired();
      return IssueEventType.REOPENED;
    }
    throw new BadRequestException({
      code: 'INVALID_ISSUE_STATUS_CHANGE',
      message: '해당 상태로 변경할 수 없습니다.',
    });
  }

  private note(value: string | undefined): string | null {
    if (value === undefined) return null;
    const note = value.trim();
    if (!note || [...note].length > 2000) throw this.noteRequired();
    return note;
  }

  private noteRequired(): BadRequestException {
    return new BadRequestException({
      code: 'ISSUE_NOTE_REQUIRED',
      message: '조치 내용을 1자 이상 2000자 이하로 입력해 주세요.',
    });
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'ISSUE_CHANGED',
      message: '이상사항이 변경되었습니다. 다시 불러온 뒤 시도해 주세요.',
    });
  }

  private dayStart(value: string): Date {
    const day = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(day.getTime()) ||
      day.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException({
        code: 'INVALID_ISSUE_DATE',
        message: '조회 날짜는 올바른 YYYY-MM-DD 형식이어야 합니다.',
      });
    }
    // Report timestamps are filtered by inclusive Korean calendar days.
    return new Date(day.getTime() - 9 * 60 * 60 * 1000);
  }
}
