import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CleaningTaskStatus,
  MessageKind,
  MessageSubjectType,
  Prisma,
  Role,
  StayStatus,
} from '@prisma/client';
import type { RuntimeEnvironment } from '../../config/environment';
import type { MessagingBlocker } from '../../libs/dto/messaging/messaging';
import { QrFlow } from '../../libs/dto/qr/qr';
import { AccessLinkVault } from '../access-link-vault/access-link-vault.service';
import { AdminStayAccessService } from '../admin-stay-access/admin-stay-access.service';
import { hashQrToken } from '../qr/qr-token';
import { hashGuestStayToken } from '../stay-access/stay-link-policy';
import {
  maskedRecipient,
  messageKinds,
  normalizedRecipient,
  renderMessage,
} from './message-templates';

const propertySelect = {
  id: true,
  name: true,
  updatedAt: true,
  isActive: true,
  staffUserId: true,
  staffQrTokenHash: true,
  staffQrTokenCiphertext: true,
  staffQrRotatedAt: true,
  staff: {
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.PropertySelect;
export interface MessageContext {
  subjectType: MessageSubjectType;
  subjectId: string;
  kind: MessageKind;
  version: number;
  to: string | null;
  recipientName: string;
  maskedPhone: string | null;
  body: string;
  variables: Record<string, string>;
  buttons: { label: string; url: string }[];
  blockers: MessagingBlocker[];
  identity: unknown[];
  deduplicationIdentity: unknown[];
}

@Injectable()
export class MessageContextService {
  constructor(
    private readonly config: ConfigService<RuntimeEnvironment, true>,
    private readonly vault: AccessLinkVault,
    private readonly access: AdminStayAccessService,
  ) {}

  public async read(
    tx: Prisma.TransactionClient,
    subjectType: MessageSubjectType,
    id: string,
    kind: MessageKind,
  ): Promise<MessageContext> {
    if (!messageKinds(subjectType).includes(kind))
      throw new BadRequestException({
        code: 'INVALID_MESSAGE_KIND',
        message: '이 일정에 사용할 수 없는 안내 종류입니다.',
      });
    return subjectType === MessageSubjectType.STAY
      ? await this.stay(tx, id, kind)
      : await this.task(tx, id, kind);
  }
  private async stay(
    tx: Prisma.TransactionClient,
    id: string,
    kind: MessageKind,
  ): Promise<MessageContext> {
    const stay = await tx.stay.findUnique({
      where: { id },
      select: {
        id: true,
        currentRevision: true,
        guestName: true,
        phone: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        guestLinkVersion: true,
        guestLinkStayRevision: true,
        guestLinkExpiresAt: true,
        guestLinkTokenHash: true,
        guestLinkTokenCiphertext: true,
        property: { select: propertySelect },
      },
    });
    if (!stay)
      throw new NotFoundException({
        code: 'STAY_NOT_FOUND',
        message: '이용 일정을 찾을 수 없습니다.',
      });
    const blockers: MessagingBlocker[] = [];
    const cancel = kind === MessageKind.GUEST_CANCEL;
    if (!stay.property.isActive)
      blockers.push({
        code: 'PROPERTY_INACTIVE',
        message: '비활성 휴양소에는 안내를 보낼 수 없습니다.',
      });
    if (
      cancel
        ? stay.status !== StayStatus.CANCELLED
        : stay.status !== StayStatus.ACTIVE
    )
      blockers.push({
        code: 'MESSAGE_STAY_STATUS',
        message: cancel
          ? '취소된 예약에만 취소 안내를 보낼 수 있습니다.'
          : '취소된 예약에는 이 안내를 보낼 수 없습니다.',
      });
    const to = normalizedRecipient(stay.phone);
    if (!to)
      blockers.push({
        code: 'RECIPIENT_PHONE_INVALID',
        message: '예약자의 휴대폰 번호를 확인해 주세요.',
      });
    let url: string | null = null;
    if (!cancel) {
      if (
        !stay.guestLinkTokenHash ||
        !stay.guestLinkTokenCiphertext ||
        stay.guestLinkStayRevision !== stay.currentRevision ||
        !stay.guestLinkExpiresAt ||
        stay.guestLinkExpiresAt.getTime() <= Date.now()
      )
        blockers.push({
          code: 'GUEST_LINK_NOT_READY',
          message:
            '현재 예약에 사용할 수 있는 개인 예약 링크를 먼저 준비해 주세요.',
        });
      else
        url = this.recoverLink(
          stay.guestLinkTokenCiphertext,
          `stay:${stay.id.toLowerCase()}:${stay.guestLinkTokenHash}`,
          stay.guestLinkTokenHash,
          '/guest/stay',
          hashGuestStayToken,
          blockers,
        );
    }
    let accessIdentity: unknown = null;
    let codeVersion: number | null = null;
    if (kind === MessageKind.GUEST_CHECKIN) {
      try {
        const context = await this.access.readContext(tx, stay.id);
        accessIdentity = context.dto;
        codeVersion = context.dto.code?.version ?? null;
        if (
          context.dto.state !== 'PREPARED' ||
          context.dto.blockedReason ||
          !context.dto.code ||
          !context.code
        )
          blockers.push({
            code: 'ACCESS_CODE_NOT_READY',
            message:
              '예약 비밀번호 준비와 변경 사항 확인을 완료해 주세요. 실제 도어록 변경 여부는 별도로 확인해야 합니다.',
          });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        blockers.push({
          code: 'ACCESS_CODE_UNAVAILABLE',
          message: '예약 비밀번호 준비 상태를 확인할 수 없습니다.',
        });
      }
    }
    const template = renderMessage(kind, {
      name: stay.guestName,
      propertyName: stay.property.name,
      checkInAt: stay.checkInAt,
      checkOutAt: stay.checkOutAt,
      url,
    });
    return {
      subjectType: MessageSubjectType.STAY,
      subjectId: stay.id,
      kind,
      version: stay.currentRevision,
      to,
      recipientName: stay.guestName,
      maskedPhone: maskedRecipient(to),
      ...template,
      blockers,
      deduplicationIdentity: [
        stay.currentRevision,
        stay.property.updatedAt,
        cancel ? null : stay.guestLinkVersion,
        codeVersion,
      ],
      identity: [
        stay.currentRevision,
        stay.status,
        stay.property.id,
        stay.property.isActive,
        stay.property.updatedAt,
        stay.guestLinkVersion,
        stay.guestLinkTokenHash,
        stay.guestLinkExpiresAt,
        accessIdentity,
      ],
    };
  }
  private async task(
    tx: Prisma.TransactionClient,
    id: string,
    kind: MessageKind,
  ): Promise<MessageContext> {
    const task = await tx.cleaningTask.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        status: true,
        dueAt: true,
        property: { select: propertySelect },
      },
    });
    if (!task)
      throw new NotFoundException({
        code: 'CLEANING_TASK_NOT_FOUND',
        message: '청소 일정을 찾을 수 없습니다.',
      });
    const blockers: MessagingBlocker[] = [];
    const cancel = kind === MessageKind.STAFF_CANCEL;
    if (!task.property.isActive)
      blockers.push({
        code: 'PROPERTY_INACTIVE',
        message: '비활성 휴양소에는 안내를 보낼 수 없습니다.',
      });
    if (
      cancel
        ? task.status !== CleaningTaskStatus.CANCELLED
        : task.status !== CleaningTaskStatus.PLANNED &&
          task.status !== CleaningTaskStatus.IN_PROGRESS
    )
      blockers.push({
        code: 'MESSAGE_TASK_STATUS',
        message: cancel
          ? '취소된 청소 일정에만 취소 안내를 보낼 수 있습니다.'
          : '예정 또는 진행 중인 청소 일정에만 이 안내를 보낼 수 있습니다.',
      });
    const staff = task.property.staff;
    if (!staff?.isActive || staff.role !== Role.STAFF)
      blockers.push({
        code: 'STAFF_NOT_ASSIGNED',
        message: '활성 직원이 휴양소에 배정되어 있어야 합니다.',
      });
    const to = normalizedRecipient(staff?.phone ?? null);
    if (!to)
      blockers.push({
        code: 'RECIPIENT_PHONE_INVALID',
        message: '담당 직원의 휴대폰 번호를 확인해 주세요.',
      });
    let url: string | null = null;
    const property = task.property;
    if (!cancel) {
      if (
        !property.staffQrTokenHash ||
        !property.staffQrTokenCiphertext ||
        !property.staffQrRotatedAt
      )
        blockers.push({
          code: 'STAFF_LINK_NOT_READY',
          message:
            '현재 담당 직원에게 전달할 직원 QR 링크를 먼저 준비해 주세요.',
        });
      else
        url = this.recoverLink(
          property.staffQrTokenCiphertext,
          `property:${property.id.toLowerCase()}:${QrFlow.STAFF}:${property.staffQrTokenHash}`,
          property.staffQrTokenHash,
          '/staff',
          (token) => hashQrToken(QrFlow.STAFF, token),
          blockers,
        );
    }
    const name = staff?.name ?? '담당 직원';
    const template = renderMessage(kind, {
      name,
      propertyName: property.name,
      dueAt: task.dueAt,
      url,
    });
    return {
      subjectType: MessageSubjectType.TASK,
      subjectId: task.id,
      kind,
      version: task.version,
      to,
      recipientName: name,
      maskedPhone: maskedRecipient(to),
      ...template,
      blockers,
      deduplicationIdentity: [
        task.version,
        property.updatedAt,
        staff?.id,
        staff?.updatedAt,
        cancel ? null : property.staffQrTokenHash,
      ],
      identity: [
        task.version,
        task.status,
        task.dueAt,
        property.id,
        property.isActive,
        property.updatedAt,
        staff?.id,
        staff?.isActive,
        staff?.role,
        property.staffQrTokenHash,
        property.staffQrRotatedAt,
      ],
    };
  }
  private recoverLink(
    ciphertext: string,
    context: string,
    expectedHash: string,
    path: string,
    hash: (token: string) => string,
    blockers: MessagingBlocker[],
  ): string | null {
    try {
      const token = this.vault.open(ciphertext, context);
      if (hash(token) !== expectedHash) throw new Error('Invalid link');
      const url = new URL(
        path,
        this.config.get('FRONTEND_URL', { infer: true }),
      );
      url.hash = new URLSearchParams({ token }).toString();
      return url.toString();
    } catch {
      blockers.push({
        code: 'ACCESS_LINK_UNAVAILABLE',
        message:
          '저장된 이용 링크를 불러올 수 없습니다. 링크 설정을 확인해 주세요.',
      });
      return null;
    }
  }
}
