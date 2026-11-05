import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { MessageKind, MessageSubjectType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  AUTOMATION_LATENESS_MS,
  type AutomationConfiguration,
  automationConfiguration,
  automationReason,
  checkInReminderAt,
  checkoutReminderAt,
} from './automation-config';
import {
  type AutomationSource,
  automationStaySelect,
  automationTaskSelect,
  staySource,
  taskSource,
} from './automation-source';

const MUTABLE_STATUSES = ['PENDING', 'BLOCKED', 'SKIPPED'];
const REMINDERS: MessageKind[] = [
  MessageKind.GUEST_CHECKIN,
  MessageKind.GUEST_CHECKOUT,
];

@Injectable()
export class MessageAutomationService {
  public readonly settings: AutomationConfiguration;
  public readonly fingerprintKeyId: string;
  private readonly fingerprintSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.settings = automationConfiguration(config);
    this.fingerprintSecret = config.getOrThrow<string>('JWT_SECRET');
    this.fingerprintKeyId = createHmac('sha256', this.fingerprintSecret)
      .update('automation-key-v1')
      .digest('hex');
  }

  public async getSubject(subjectType: MessageSubjectType, subjectId: string) {
    const source = await this.readSource(subjectType, subjectId);
    if (!source)
      throw new NotFoundException({
        code: 'MESSAGE_SUBJECT_NOT_FOUND',
        message: '일정 또는 작업을 찾을 수 없습니다.',
      });
    const [state, jobs] = await Promise.all([
      this.prisma.messageAutomationState.findUnique({
        where: { id: 'primary' },
      }),
      this.prisma.messageAutomationJob.findMany({
        where: { subjectType, subjectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 40,
      }),
    ]);
    return {
      enabled: this.settings.enabled,
      activatedAt: state?.activatedAt ?? null,
      checkoutReminderHour: this.settings.checkoutReminderHour,
      jobs: jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        dueAt: job.dueAt,
        status: job.status,
        reason: automationReason(job.reasonCode),
        dispatchId: job.dispatchId,
      })),
    };
  }

  public async readSource(
    subjectType: MessageSubjectType,
    id: string,
  ): Promise<AutomationSource | null> {
    if (subjectType === MessageSubjectType.STAY) {
      const stay = await this.prisma.stay.findUnique({
        where: { id },
        select: automationStaySelect,
      });
      return stay ? staySource(stay, this.fingerprintSecret) : null;
    }
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id },
      select: automationTaskSelect,
    });
    return task ? taskSource(task, this.fingerprintSecret) : null;
  }

  public async reconcile(
    activatedAt: Date,
    keepLease: () => Promise<boolean>,
    now = new Date(),
    rebaseline = false,
  ): Promise<boolean> {
    // Scan by stable identity, not timestamps: a long import can commit after its recorded date.
    for (const subjectType of [
      MessageSubjectType.STAY,
      MessageSubjectType.TASK,
    ]) {
      let cursor: string | undefined;
      while (true) {
        if (!(await keepLease())) return false;
        const page =
          subjectType === MessageSubjectType.STAY
            ? (
                await this.prisma.stay.findMany({
                  where: {
                    OR: [
                      { checkOutAt: { gte: activatedAt } },
                      { updatedAt: { gte: activatedAt } },
                    ],
                  },
                  select: automationStaySelect,
                  orderBy: { id: 'asc' },
                  take: 100,
                  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                })
              ).map((stay) => staySource(stay, this.fingerprintSecret))
            : (
                await this.prisma.cleaningTask.findMany({
                  where: {
                    OR: [
                      { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
                      { dueAt: { gte: activatedAt } },
                      { updatedAt: { gte: activatedAt } },
                    ],
                  },
                  select: automationTaskSelect,
                  orderBy: { id: 'asc' },
                  take: 100,
                  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                })
              ).map((task) => taskSource(task, this.fingerprintSecret));
        for (const source of page) {
          if (!(await keepLease())) return false;
          await this.observe(source, activatedAt, now, rebaseline);
        }
        if (page.length < 100) break;
        cursor = page[page.length - 1].id;
      }
    }
    return true;
  }

  public async observe(
    source: AutomationSource,
    activatedAt: Date,
    now: Date,
    rebaseline = false,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const id = `${source.subjectType}:${source.id}`;
      const previous = await tx.messageAutomationTarget.findUnique({
        where: { id },
      });
      const closed =
        !source.eligible ||
        source.status === 'COMPLETED' ||
        (source.subjectType === MessageSubjectType.STAY && source.endAt <= now);
      const scope = {
        subjectType: source.subjectType,
        subjectId: source.id,
        dispatchId: null,
        status: { in: ['PENDING', 'BLOCKED'] },
      };
      if (closed || source.status === 'CANCELLED') {
        await tx.messageAutomationJob.updateMany({
          where: {
            ...scope,
            ...(closed
              ? {}
              : {
                  kind: {
                    notIn: [MessageKind.GUEST_CANCEL, MessageKind.STAFF_CANCEL],
                  },
                }),
          },
          data: { status: 'SKIPPED', reasonCode: 'SOURCE_CLOSED' },
        });
      }
      if (
        !closed &&
        source.subjectType === MessageSubjectType.STAY &&
        source.status === 'ACTIVE'
      ) {
        await this.reminder(
          tx,
          source,
          MessageKind.GUEST_CHECKIN,
          checkInReminderAt(source.checkInAt),
          activatedAt,
          now,
        );
        await this.reminder(
          tx,
          source,
          MessageKind.GUEST_CHECKOUT,
          checkoutReminderAt(source.endAt, this.settings.checkoutReminderHour),
          activatedAt,
          now,
        );
      }

      const changed = previous && previous.fingerprint !== source.fingerprint;
      const eventSequence = (previous?.eventSequence ?? 0) + (changed ? 1 : 0);
      if (rebaseline && previous) {
        await tx.messageAutomationJob.updateMany({
          where: { ...scope, kind: { notIn: REMINDERS } },
          data: { status: 'SKIPPED', reasonCode: 'SECURITY_REBASELINE' },
        });
      }
      if (!closed && changed && !rebaseline) {
        await tx.messageAutomationJob.updateMany({
          where: { ...scope, kind: { notIn: REMINDERS } },
          data: { status: 'SKIPPED', reasonCode: 'SOURCE_CHANGED' },
        });
        const kind =
          source.subjectType === MessageSubjectType.STAY
            ? source.status === 'CANCELLED'
              ? MessageKind.GUEST_CANCEL
              : MessageKind.GUEST_CHANGE
            : source.status === 'CANCELLED'
              ? MessageKind.STAFF_CANCEL
              : MessageKind.STAFF_CHANGE;
        await this.event(tx, source, kind, now, eventSequence);
      } else if (
        !previous &&
        !closed &&
        source.status === 'ACTIVE' &&
        source.subjectType === MessageSubjectType.TASK &&
        source.createdAt >= activatedAt
      ) {
        await this.event(
          tx,
          source,
          MessageKind.STAFF_ASSIGNMENT,
          now,
          eventSequence,
        );
      }
      // Non-material revision bumps (notes/check start) must not strand queued work.
      await tx.messageAutomationJob.updateMany({
        where: { ...scope, sourceFingerprint: source.fingerprint },
        data: { sourceVersion: source.version },
      });
      const data = {
        subjectType: source.subjectType,
        subjectId: source.id,
        sourceVersion: source.version,
        fingerprint: source.fingerprint,
        observedStatus: source.status,
        observedAt: now,
        eventSequence,
      };
      await tx.messageAutomationTarget.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    });
  }

  private async reminder(
    tx: Prisma.TransactionClient,
    source: AutomationSource,
    kind: MessageKind,
    dueAt: Date,
    activatedAt: Date,
    now: Date,
  ): Promise<void> {
    const reasonCode =
      dueAt < activatedAt
        ? 'BEFORE_ACTIVATION'
        : dueAt < source.createdAt
          ? 'SHORT_NOTICE'
          : now.getTime() - dueAt.getTime() > AUTOMATION_LATENESS_MS
            ? 'MISSED_WINDOW'
            : null;
    const key = `auto:${source.subjectType}:${source.id}:${kind}`;
    const existing = await tx.messageAutomationJob.findUnique({
      where: { key },
    });
    if (
      existing &&
      (existing.dispatchId || !MUTABLE_STATUSES.includes(existing.status))
    )
      return;
    const data = {
      subjectType: source.subjectType,
      subjectId: source.id,
      kind,
      sourceVersion: source.version,
      sourceFingerprint: source.fingerprint,
      dueAt,
      status: reasonCode ? 'SKIPPED' : 'PENDING',
      reasonCode,
    };
    await tx.messageAutomationJob.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
  }

  private async event(
    tx: Prisma.TransactionClient,
    source: AutomationSource,
    kind: MessageKind,
    now: Date,
    eventSequence: number,
  ): Promise<void> {
    const key = `auto:${source.subjectType}:${source.id}:${kind}:${eventSequence}:${source.version}`;
    await tx.messageAutomationJob.upsert({
      where: { key },
      update: {},
      create: {
        key,
        subjectType: source.subjectType,
        subjectId: source.id,
        kind,
        sourceVersion: source.version,
        sourceFingerprint: source.fingerprint,
        dueAt: now,
      },
    });
  }
}
