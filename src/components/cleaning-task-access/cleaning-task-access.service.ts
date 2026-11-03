import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CleaningTaskStatus,
  PhotoPurpose,
  Prisma,
  PropertyRoomCodeMode,
  StayStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PropertyAccessCodeKind } from '../../libs/dto/admin-property-access/admin-property-access';
import type { TaskPasswordDto } from '../../libs/dto/staff-cleaning-task/staff-cleaning-task';
import type { TaskConfirmationInput } from '../../libs/dto/staff-cleaning-task/staff-cleaning-task.input';
import type { PreparedSubmissionPhoto } from '../../libs/dto/submission/submission';
import { AdminStayAccessService } from '../admin-stay-access/admin-stay-access.service';
import { PropertyAccessCodeVault } from '../admin-property-access/property-access-code-vault';
import type { DraftRecord } from '../submission-drafts/submission-drafts.service';

const taskAccessSelect = {
  id: true,
  propertyId: true,
  dueAt: true,
  version: true,
  status: true,
  departingStayId: true,
  currentSubmissionId: true,
  departingStay: {
    select: {
      id: true,
      currentRevision: true,
      status: true,
      checkInAt: true,
      checkOutAt: true,
    },
  },
  property: {
    select: {
      id: true,
      isActive: true,
      staffUserId: true,
      staffQrTokenHash: true,
      accessSettings: true,
    },
  },
} satisfies Prisma.CleaningTaskSelect;

@Injectable()
export class CleaningTaskAccessService {
  constructor(
    private readonly stayAccess: AdminStayAccessService,
    private readonly propertyVault: PropertyAccessCodeVault,
  ) {}

  public async context(
    tx: Prisma.TransactionClient,
    taskId: string,
    submissionId: string,
  ) {
    const task = await tx.cleaningTask.findUnique({
      where: { id: taskId },
      select: taskAccessSelect,
    });
    if (
      !task ||
      task.currentSubmissionId !== submissionId ||
      task.status !== CleaningTaskStatus.IN_PROGRESS ||
      !task.property.isActive
    )
      throw new UnauthorizedException({
        code: 'INVALID_TASK_ACCESS',
        message: '현재 작업 링크를 다시 열어 주세요.',
      });
    const now = new Date();
    const settings = task.property.accessSettings;
    const rotating = settings?.roomMode === PropertyRoomCodeMode.ROTATING;
    const base = {
      schemaVersion: 1,
      taskId: task.id,
      taskVersion: task.version,
      dueAt: task.dueAt.toISOString(),
      departingStayId: task.departingStayId,
      departingStayRevision: task.departingStay?.currentRevision ?? null,
      departingCheckOutAt: task.departingStay?.checkOutAt.toISOString() ?? null,
      settingsVersion: settings?.version ?? 0,
      staffUserId: task.property.staffUserId,
      qrGeneration: task.property.staffQrTokenHash,
    };
    const next = await tx.stay.findFirst({
      where: {
        propertyId: task.propertyId,
        status: StayStatus.ACTIVE,
        ...(task.departingStayId ? { id: { not: task.departingStayId } } : {}),
        checkInAt: { gte: task.departingStay?.checkOutAt ?? task.dueAt },
      },
      orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        currentRevision: true,
        checkInAt: true,
        checkOutAt: true,
        accessCode: { select: { version: true } },
      },
    });
    const occupied = await tx.stay.findFirst({
      where: {
        propertyId: task.propertyId,
        status: StayStatus.ACTIVE,
        checkInAt: { lte: now },
        checkOutAt: { gt: now },
      },
      select: { id: true },
    });
    let kind: TaskPasswordDto['kind'] = rotating
      ? next
        ? 'NEXT_STAY'
        : 'VACANCY'
      : 'FIXED';
    let blockedReason: string | null =
      task.dueAt > now ||
      (task.departingStay && task.departingStay.checkOutAt > now)
        ? '퇴실 및 작업 예정 시간이 지나지 않았습니다.'
        : task.departingStay?.status === StayStatus.CANCELLED
          ? '예약이 취소되었습니다. 관리자에게 작업을 확인해 주세요.'
          : occupied
            ? '이용 중인 예약이 있어 완료할 수 없습니다.'
            : !settings
              ? '휴양소 비밀번호 설정이 필요합니다.'
              : rotating && next && next.checkInAt <= now
                ? '다음 예약의 입실 시간이 지났습니다. 관리자에게 확인해 주세요.'
                : null;
    let code: string | null = null;
    if (!blockedReason && settings) {
      if (!rotating) {
        if (!settings.fixedRoomCodeCiphertext)
          blockedReason = '고정 비밀번호 설정이 필요합니다.';
      } else if (next) {
        const prepared = await this.stayAccess.readContext(tx, next.id);
        if (
          prepared.dto.state !== 'PREPARED' ||
          prepared.dto.blockedReason ||
          !prepared.code
        )
          blockedReason =
            '다음 예약 비밀번호를 먼저 준비하거나 다시 확인해 주세요.';
        else code = prepared.code;
      } else if (!settings.vacancyCodeCiphertext) {
        blockedReason = '공실 비밀번호를 먼저 등록해 주세요.';
      } else {
        code = this.propertyVault.open(
          settings.vacancyCodeCiphertext,
          task.propertyId,
          PropertyAccessCodeKind.VACANCY,
        );
      }
    }
    const target = {
      targetKind: kind,
      targetStayId: next?.id ?? null,
      targetStayRevision: next?.currentRevision ?? null,
      targetCodeVersion: next?.accessCode?.version ?? null,
      nextCheckInAt: next?.checkInAt.toISOString() ?? null,
      nextCheckOutAt: next?.checkOutAt.toISOString() ?? null,
    };
    // Only versions and identities are hashed. Passwords never enter fingerprints or history.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...base, ...target }))
      .digest('hex');
    if (blockedReason) kind = 'BLOCKED';
    const dto: TaskPasswordDto = {
      taskId: task.id,
      fingerprint,
      kind,
      canComplete: !blockedReason,
      blockedReason,
      nextCheckInAt: next?.checkInAt ?? null,
      requiresChange: rotating,
    };
    return { task, dto, code, metadata: { ...base, ...target } };
  }

  public async complete(
    tx: Prisma.TransactionClient,
    draft: DraftRecord,
    confirmation: TaskConfirmationInput | undefined,
    photos: PreparedSubmissionPhoto[],
    completedAt: Date,
  ): Promise<void> {
    if (!draft.cleaningTaskId) {
      if (confirmation) throw this.changed();
      return;
    }
    if (!confirmation || !confirmation.guestDeparted)
      throw new ConflictException({
        code: 'TASK_CONFIRMATION_REQUIRED',
        message: '퇴실 여부와 비밀번호 변경 완료를 확인해 주세요.',
      });
    if (
      !photos.some((photo) => photo.purpose === PhotoPurpose.MAINTENANCE_AFTER)
    )
      throw new ConflictException({
        code: 'TASK_AFTER_PHOTO_REQUIRED',
        message: '정비 후 사진을 1장 이상 첨부해 주세요.',
      });
    const context = await this.context(tx, draft.cleaningTaskId, draft.id);
    if (!context.dto.canComplete)
      throw new ConflictException({
        code: 'TASK_PASSWORD_BLOCKED',
        message: context.dto.blockedReason,
      });
    if (context.dto.fingerprint !== confirmation.fingerprint)
      throw this.changed();
    if (context.dto.requiresChange && !confirmation.passwordChanged)
      throw new ConflictException({
        code: 'TASK_PASSWORD_CONFIRMATION_REQUIRED',
        message: '현장 비밀번호 변경 완료를 확인해 주세요.',
      });
    const { qrGeneration: _qrGeneration, ...metadata } = context.metadata;
    void _qrGeneration;
    const completion: Prisma.InputJsonObject = {
      ...metadata,
      submissionId: draft.id,
      staffName: this.authorName(draft),
      guestDeparted: true,
      passwordChanged: context.dto.requiresChange,
      confirmedAt: completedAt.toISOString(),
      targetFingerprint: context.dto.fingerprint,
    };
    const updated = await tx.cleaningTask.updateMany({
      where: {
        id: context.task.id,
        version: context.task.version,
        status: CleaningTaskStatus.IN_PROGRESS,
        currentSubmissionId: draft.id,
      },
      data: {
        status: CleaningTaskStatus.COMPLETED,
        version: { increment: 1 },
        completedAt,
        completion,
      },
    });
    if (updated.count !== 1) throw this.changed();
  }

  public changed(): ConflictException {
    return new ConflictException({
      code: 'TASK_PASSWORD_CHANGED',
      message:
        '작업 또는 비밀번호가 변경되었습니다. 최신 내용을 다시 확인해 주세요.',
    });
  }

  private authorName(draft: DraftRecord): string {
    const value = draft.authorSnapshot;
    return value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.name === 'string'
      ? value.name
      : '';
  }
}
