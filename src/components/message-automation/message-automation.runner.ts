import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MessageSubjectType,
  type MessageAutomationJob,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { AUTOMATION_LATENESS_MS } from './automation-config';
import { MessageAutomationService } from './message-automation.service';

const LEASE_MS = 120_000;

@Injectable()
export class MessageAutomationRunner
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MessageAutomationRunner.name);
  private readonly owner = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: MessageAutomationService,
    private readonly messaging: MessagingService,
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.automation.settings.enabled) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.timer.unref();
    void this.tick();
  }

  public onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  public async tick(now = new Date()): Promise<void> {
    const settings = this.automation.settings;
    if (
      this.stopping ||
      this.running ||
      !settings.enabled ||
      !settings.startAt ||
      settings.startAt > now ||
      !this.messaging.getStatus().ready
    )
      return;
    this.running = true;
    let leased = false;
    try {
      const state = await this.prisma.messageAutomationState.upsert({
        where: { id: 'primary' },
        update: {},
        create: {
          id: 'primary',
          activatedAt: now,
          fingerprintKeyId: this.automation.fingerprintKeyId,
        },
      });
      const lease = await this.prisma.messageAutomationState.updateMany({
        where: {
          id: 'primary',
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        data: {
          leaseOwner: this.owner,
          leaseUntil: new Date(now.getTime() + LEASE_MS),
        },
      });
      if (!lease.count) return;
      leased = true;
      if (!(await this.recoverAttempts())) return;
      const rebaseline =
        state.fingerprintKeyId !== this.automation.fingerprintKeyId;
      if (
        !(await this.automation.reconcile(
          state.activatedAt,
          () => this.renewLease(),
          now,
          rebaseline,
        ))
      )
        return;
      await this.prisma.messageAutomationState.updateMany({
        where: { id: 'primary', leaseOwner: this.owner },
        data: { fingerprintKeyId: this.automation.fingerprintKeyId },
      });
      let after: { dueAt: Date; id: string } | undefined;
      while (!this.stopping) {
        const where: Prisma.MessageAutomationJobWhereInput = {
          status: { in: ['PENDING', 'BLOCKED'] },
          dueAt: { lte: now },
          ...(after
            ? {
                OR: [
                  { dueAt: { gt: after.dueAt, lte: now } },
                  { dueAt: after.dueAt, id: { gt: after.id } },
                ],
              }
            : {}),
        };
        const jobs = await this.prisma.messageAutomationJob.findMany({
          where,
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          take: 25,
        });
        for (const job of jobs) {
          if (this.stopping || !(await this.renewLease())) return;
          await this.dispatch(job, new Date());
        }
        if (jobs.length < 25) break;
        after = jobs[jobs.length - 1];
      }
      await this.refreshResults();
      await this.prisma.messageAutomationState.updateMany({
        where: { id: 'primary', leaseOwner: this.owner },
        data: { lastScanAt: new Date() },
      });
    } catch {
      this.logger.warn(
        'Message automation scan could not complete; pending state was retained.',
      );
    } finally {
      if (leased) {
        await this.prisma.messageAutomationState
          .updateMany({
            where: { id: 'primary', leaseOwner: this.owner },
            data: { leaseOwner: null, leaseUntil: null },
          })
          .catch(() => undefined);
      }
      this.running = false;
    }
  }

  private async recoverAttempts(): Promise<boolean> {
    let cursor: string | undefined;
    while (true) {
      if (!(await this.renewLease())) return false;
      const jobs = await this.prisma.messageAutomationJob.findMany({
        where: { dispatchId: null },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const attempts = await this.prisma.messageDispatch.findMany({
        where: {
          idempotencyKey: { in: jobs.map((job) => `automatic:${job.key}`) },
        },
      });
      for (const job of jobs) {
        const attempt = attempts.find(
          (row) => row.idempotencyKey === `automatic:${job.key}`,
        );
        if (attempt) await this.recordDispatch(job, attempt.id, attempt.status);
      }
      if (jobs.length < 100) return true;
      cursor = jobs[jobs.length - 1].id;
    }
  }

  private async refreshResults(): Promise<void> {
    const now = Date.now();
    const rows = await this.prisma.messageDispatch.findMany({
      where: {
        createdAt: {
          gte: new Date(now - 72 * 60 * 60 * 1000),
          lte: new Date(now - 60_000),
        },
        OR: [
          { status: { in: ['ACCEPTED', 'SENDING'] } },
          { status: 'UNKNOWN', providerMessageId: { not: null } },
        ],
        AND: [
          {
            OR: [
              { lastCheckedAt: null },
              { lastCheckedAt: { lt: new Date(now - 60_000) } },
            ],
          },
        ],
      },
      orderBy: [
        { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        { id: 'asc' },
      ],
      take: 25,
    });
    for (const row of rows) {
      if (!(await this.renewLease())) return;
      try {
        const result = await this.messaging.refresh(row.id);
        const jobs = await this.prisma.messageAutomationJob.findMany({
          where: { dispatchId: row.id },
        });
        for (const job of jobs)
          await this.recordDispatch(job, result.id, result.status);
      } catch {
        this.logger.warn('Message delivery lookup will be checked again.');
      }
    }
  }

  private async renewLease(): Promise<boolean> {
    if (this.stopping) return false;
    const now = new Date();
    const result = await this.prisma.messageAutomationState.updateMany({
      where: { id: 'primary', leaseOwner: this.owner, leaseUntil: { gt: now } },
      data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    return result.count === 1;
  }

  private async dispatch(job: MessageAutomationJob, now: Date): Promise<void> {
    const existing = await this.prisma.messageDispatch.findUnique({
      where: { idempotencyKey: `automatic:${job.key}` },
    });
    if (existing) {
      await this.recordDispatch(job, existing.id, existing.status);
      return;
    }
    if (now.getTime() - job.dueAt.getTime() > AUTOMATION_LATENESS_MS) {
      await this.updateJob(job.id, 'SKIPPED', 'MISSED_WINDOW');
      return;
    }
    const source = await this.automation.readSource(
      job.subjectType,
      job.subjectId,
    );
    if (
      !source ||
      !source.eligible ||
      source.status === 'COMPLETED' ||
      (source.subjectType === MessageSubjectType.STAY && source.endAt <= now)
    ) {
      await this.updateJob(job.id, 'SKIPPED', 'SOURCE_CLOSED');
      return;
    }
    if (
      source.fingerprint !== job.sourceFingerprint ||
      source.version !== job.sourceVersion
    ) {
      await this.updateJob(job.id, 'SKIPPED', 'SOURCE_CHANGED');
      return;
    }
    try {
      const preview = await this.messaging.preview(
        job.subjectType,
        job.subjectId,
        { kind: job.kind },
      );
      if (!preview.canSend) {
        await this.updateJob(job.id, 'BLOCKED', 'MESSAGING_BLOCKED');
        return;
      }
      if (!(await this.renewLease())) return;
      const result = await this.messaging.sendAutomatic({
        subjectType: job.subjectType,
        subjectId: job.subjectId,
        kind: job.kind,
        idempotencyKey: job.key,
        expectedVersion: job.sourceVersion,
        expectedPreviewKey: preview.previewKey,
      });
      await this.recordDispatch(job, result.id, result.status);
    } catch {
      const attempt = await this.prisma.messageDispatch.findUnique({
        where: { idempotencyKey: `automatic:${job.key}` },
      });
      if (attempt) await this.recordDispatch(job, attempt.id, attempt.status);
      else await this.updateJob(job.id, 'BLOCKED', 'MESSAGING_BLOCKED');
    }
  }

  private async recordDispatch(
    job: MessageAutomationJob,
    dispatchId: string,
    dispatchStatus: string,
  ): Promise<void> {
    const status =
      dispatchStatus === 'UNKNOWN' || dispatchStatus === 'SENDING'
        ? 'UNKNOWN'
        : dispatchStatus === 'FAILED'
          ? 'FAILED'
          : 'COMPLETED';
    await this.prisma.messageAutomationJob.update({
      where: { id: job.id },
      data: {
        status,
        dispatchId,
        reasonCode:
          status === 'UNKNOWN'
            ? 'DELIVERY_UNKNOWN'
            : status === 'FAILED'
              ? 'DELIVERY_FAILED'
              : null,
      },
    });
  }

  private async updateJob(
    id: string,
    status: string,
    reasonCode: string,
  ): Promise<void> {
    await this.prisma.messageAutomationJob.update({
      where: { id },
      data: { status, reasonCode },
    });
  }
}
