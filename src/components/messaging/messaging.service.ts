import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageDispatch,
  MessageDispatchMode,
  MessageDispatchStatus,
  MessageKind,
  MessageSubjectType,
  Prisma,
  Role,
} from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RuntimeEnvironment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  MessageDispatchDto,
  MessagePreviewDto,
  MessagingBlocker,
  MessagingStatusDto,
  MessagingSubjectDto,
} from '../../libs/dto/messaging/messaging';
import type {
  PreviewMessageInput,
  SendMessageInput,
} from '../../libs/dto/messaging/messaging.input';
import {
  MessageContextService,
  type MessageContext,
} from './message-context.service';
import { MESSAGE_LABELS, messageKinds } from './message-templates';
import { SolapiProvider } from './solapi.provider';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const STALE_SENDING_MS = 60_000;
export interface AutomaticMessageInput {
  subjectType: MessageSubjectType;
  subjectId: string;
  kind: MessageKind;
  idempotencyKey: string;
  expectedVersion: number;
  expectedPreviewKey?: string;
}
interface DispatchInput {
  subjectType: MessageSubjectType;
  subjectId: string;
  kind: MessageKind;
  key: string;
  mode: MessageDispatchMode;
  actorUserId: string | null;
  expectedVersion?: number;
  previewKey?: string;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<RuntimeEnvironment, true>,
    private readonly contexts: MessageContextService,
    private readonly provider: SolapiProvider,
  ) {}

  public getStatus(): MessagingStatusDto {
    return this.provider.getStatus();
  }

  public async getSubject(
    subjectType: MessageSubjectType,
    id: string,
  ): Promise<MessagingSubjectDto> {
    const subjectId = id.toLowerCase();
    const exists =
      subjectType === MessageSubjectType.STAY
        ? await this.prisma.stay.findUnique({
            where: { id: subjectId },
            select: { id: true },
          })
        : await this.prisma.cleaningTask.findUnique({
            where: { id: subjectId },
            select: { id: true },
          });
    if (!exists)
      throw new NotFoundException({
        code: 'MESSAGE_SUBJECT_NOT_FOUND',
        message: '안내할 일정을 찾을 수 없습니다.',
      });
    const history = await this.prisma.messageDispatch.findMany({
      where: { subjectType, subjectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
    });
    return {
      subjectType,
      subjectId,
      availableKinds: messageKinds(subjectType),
      history: history.map((row) => this.toDto(row)),
    };
  }

  public async preview(
    subjectType: MessageSubjectType,
    id: string,
    input: PreviewMessageInput,
  ): Promise<MessagePreviewDto> {
    const context = await runSerializableTransaction(this.prisma, (tx) =>
      this.contexts.read(tx, subjectType, id.toLowerCase(), input.kind),
    );
    const blockers = this.blockers(context);
    return {
      subjectType,
      subjectId: context.subjectId,
      kind: input.kind,
      label: MESSAGE_LABELS[input.kind],
      channel: 'ALIMTALK',
      recipient: {
        name: context.recipientName,
        maskedPhone: context.maskedPhone,
      },
      body: context.body,
      buttons: context.buttons,
      previewKey: this.previewKey(this.contextHash(context)),
      canSend: blockers.length === 0,
      blockers,
      warnings: [
        '발송 접수는 전달 완료를 뜻하지 않습니다. 발송 내역에서 결과를 확인해 주세요.',
        '알림톡 실패 시 문자로 자동 대체하지 않습니다.',
        ...(input.kind === MessageKind.GUEST_CHECKIN
          ? [
              '예약 비밀번호 준비는 실제 도어록 변경을 의미하지 않습니다. 실제 설정은 별도로 확인해 주세요.',
            ]
          : []),
      ],
    };
  }

  public async send(
    subjectType: MessageSubjectType,
    id: string,
    input: SendMessageInput,
    actorUserId: string,
  ): Promise<MessageDispatchDto> {
    return await this.dispatch({
      subjectType,
      subjectId: id.toLowerCase(),
      kind: input.kind,
      key: `manual:${input.requestKey.toLowerCase()}`,
      mode: MessageDispatchMode.MANUAL,
      actorUserId,
      previewKey: input.previewKey,
    });
  }

  // Internal-only API; never expose automatic flags or caller-selected
  // recipients/templates/text to the controller.
  public async sendAutomatic(
    input: AutomaticMessageInput,
  ): Promise<MessageDispatchDto> {
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(input.idempotencyKey))
      throw new Error('Invalid automatic message key');
    return await this.dispatch({
      subjectType: input.subjectType,
      subjectId: input.subjectId.toLowerCase(),
      kind: input.kind,
      key: `automatic:${input.idempotencyKey}`,
      mode: MessageDispatchMode.AUTOMATIC,
      actorUserId: null,
      expectedVersion: input.expectedVersion,
      previewKey: input.expectedPreviewKey,
    });
  }

  public async refresh(id: string): Promise<MessageDispatchDto> {
    const row = await this.prisma.messageDispatch.findUnique({
      where: { id: id.toLowerCase() },
    });
    if (!row)
      throw new NotFoundException({
        code: 'MESSAGE_DISPATCH_NOT_FOUND',
        message: '발송 내역을 찾을 수 없습니다.',
      });
    if (
      row.status === MessageDispatchStatus.DELIVERED ||
      row.status === MessageDispatchStatus.FAILED
    )
      return this.toDto(row);
    if (!row.providerMessageId) {
      if (
        row.status === MessageDispatchStatus.SENDING &&
        row.createdAt.getTime() > Date.now() - STALE_SENDING_MS
      )
        return this.toDto(row);
      await this.prisma.messageDispatch.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: {
          status: MessageDispatchStatus.UNKNOWN,
          lastCheckedAt: new Date(),
          errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
        },
      });
    } else {
      const result = await this.provider.refresh(row.providerMessageId);
      // A failed status lookup does not erase the proven acceptance receipt.
      const status =
        result.status === MessageDispatchStatus.UNKNOWN &&
        row.status === MessageDispatchStatus.ACCEPTED
          ? row.status
          : result.status;
      await this.prisma.messageDispatch.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: {
          status,
          lastCheckedAt: new Date(),
          errorCode: result.errorCode,
          ...(status === MessageDispatchStatus.FAILED
            ? { deduplicationKey: null }
            : {}),
        },
      });
    }
    return this.toDto(
      await this.prisma.messageDispatch.findUniqueOrThrow({
        where: { id: row.id },
      }),
    );
  }

  private async dispatch(input: DispatchInput): Promise<MessageDispatchDto> {
    // This lookup intentionally precedes preview expiry or latest-domain checks.
    // A browser retry can only return the original receipt, never send again.
    const existing = await this.prisma.messageDispatch.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (existing) return this.existingResult(existing, input);
    let claim: { row: MessageDispatch; hash: string };
    try {
      claim = await runSerializableTransaction(this.prisma, async (tx) => {
        if (input.actorUserId)
          await this.requireAdministrator(tx, input.actorUserId);
        const context = await this.contexts.read(
          tx,
          input.subjectType,
          input.subjectId,
          input.kind,
        );
        this.assertReady(context, input);
        const hash = this.contextHash(context);
        const deduplicationKey = this.deduplicationKey(context);
        const duplicate = await tx.messageDispatch.findUnique({
          where: { deduplicationKey },
        });
        if (duplicate) throw this.alreadyRequested();
        const row = await tx.messageDispatch.create({
          data: {
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            kind: input.kind,
            mode: input.mode,
            idempotencyKey: input.key,
            deduplicationKey,
            contextHash: hash,
            status: MessageDispatchStatus.SENDING,
            maskedRecipient: context.maskedPhone,
            actorUserId: input.actorUserId,
          },
        });
        return { row, hash };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.messageDispatch.findUnique({
          where: { idempotencyKey: input.key },
        });
        if (duplicate) return this.existingResult(duplicate, input);
        throw this.alreadyRequested();
      }
      throw error;
    }
    // The claim commits before the remote request; never place provider I/O
    // inside a retried DB transaction. Recheck domain state immediately before I/O.
    let context: MessageContext;
    try {
      context = await runSerializableTransaction(this.prisma, async (tx) => {
        if (input.actorUserId)
          await this.requireAdministrator(tx, input.actorUserId);
        const latest = await this.contexts.read(
          tx,
          input.subjectType,
          input.subjectId,
          input.kind,
        );
        this.assertReady(latest, input);
        if (this.contextHash(latest) !== claim.hash)
          throw this.previewChanged();
        return latest;
      });
    } catch {
      // No remote operation started, so this is a definitive local failure.
      return this.toDto(
        await this.prisma.messageDispatch.update({
          where: { id: claim.row.id },
          data: {
            status: MessageDispatchStatus.FAILED,
            deduplicationKey: null,
            errorCode: 'CONTEXT_CHANGED_BEFORE_SEND',
          },
        }),
      );
    }
    const result = await this.provider.send({
      kind: input.kind,
      to: context.to,
      body: context.body,
      variables: context.variables,
      buttons: context.buttons,
    });
    const row = await this.prisma.messageDispatch.update({
      where: { id: claim.row.id },
      data: {
        ...result,
        lastCheckedAt: new Date(),
        ...(result.status === MessageDispatchStatus.FAILED
          ? { deduplicationKey: null }
          : {}),
      },
    });
    return this.toDto(row);
  }

  private blockers(context: MessageContext): MessagingBlocker[] {
    return [
      ...context.blockers,
      ...this.provider.blockers(context.kind),
      ...(context.body.length > 1000
        ? [
            {
              code: 'MESSAGE_TOO_LONG',
              message:
                '안내 내용이 너무 깁니다. 예약자와 휴양소 이름을 확인해 주세요.',
            },
          ]
        : []),
    ];
  }
  private assertReady(context: MessageContext, input: DispatchInput): void {
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== context.version
    )
      throw this.previewChanged();
    if (
      input.previewKey &&
      !this.validPreview(input.previewKey, this.contextHash(context))
    )
      throw this.previewChanged();
    const blockers = this.blockers(context);
    if (blockers.length || !context.to || !context.maskedPhone)
      throw new ConflictException({
        code: 'MESSAGING_BLOCKED',
        message: blockers[0]?.message ?? '메시지 발송 조건을 확인해 주세요.',
      });
  }
  private deduplicationKey(context: MessageContext): string {
    // Only event IDs/versions, not names, phone numbers, private links or
    // credentials. Stable across JWT signing-key rotation.
    return createHash('sha256')
      .update(
        JSON.stringify([
          'retreat-message-event-v1',
          context.subjectType,
          context.subjectId,
          context.kind,
          context.deduplicationIdentity,
        ]),
      )
      .digest('hex');
  }
  private contextHash(context: MessageContext): string {
    return this.hmac(
      JSON.stringify([
        'retreat-message-v1',
        context.subjectType,
        context.subjectId,
        context.kind,
        context.to,
        context.recipientName,
        context.body,
        context.variables,
        context.buttons,
        context.identity,
        this.provider.fingerprint(context.kind),
      ]),
    );
  }
  private previewKey(hash: string): string {
    const timestamp = Date.now().toString();
    return `${timestamp}.${this.hmac(`preview:${timestamp}:${hash}`)}`;
  }
  private validPreview(key: string, hash: string): boolean {
    const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(key);
    if (!match) return false;
    const age = Date.now() - Number(match[1]);
    if (age < 0 || age > PREVIEW_TTL_MS) return false;
    const expected = this.hmac(`preview:${match[1]}:${hash}`);
    return timingSafeEqual(
      Buffer.from(match[2], 'hex'),
      Buffer.from(expected, 'hex'),
    );
  }
  private hmac(value: string): string {
    return createHmac('sha256', this.config.get('JWT_SECRET', { infer: true }))
      .update(value)
      .digest('hex');
  }
  private existingResult(
    row: MessageDispatch,
    input: DispatchInput,
  ): MessageDispatchDto {
    if (
      row.subjectType !== input.subjectType ||
      row.subjectId !== input.subjectId ||
      row.kind !== input.kind ||
      row.mode !== input.mode
    )
      throw new ConflictException({
        code: 'MESSAGE_REQUEST_KEY_CONFLICT',
        message:
          '이 요청 ID는 다른 메시지에 사용되었습니다. 발송 내역을 확인해 주세요.',
      });
    return this.toDto(row);
  }
  private toDto(row: MessageDispatch): MessageDispatchDto {
    const stale =
      row.status === MessageDispatchStatus.SENDING &&
      row.createdAt.getTime() <= Date.now() - STALE_SENDING_MS;
    return {
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      kind: row.kind,
      mode: row.mode,
      status: stale ? MessageDispatchStatus.UNKNOWN : row.status,
      maskedRecipient: row.maskedRecipient,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastCheckedAt: row.lastCheckedAt,
      errorCode: stale ? 'PROVIDER_OUTCOME_UNKNOWN' : row.errorCode,
    };
  }
  private async requireAdministrator(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id },
      select: { isActive: true, role: true, loginId: true, passwordHash: true },
    });
    if (
      !user?.isActive ||
      user.role !== Role.ADMIN ||
      !user.loginId ||
      !user.passwordHash
    )
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '다시 로그인해 주세요.',
      });
  }
  private previewChanged(): ConflictException {
    return new ConflictException({
      code: 'MESSAGE_PREVIEW_CHANGED',
      message:
        '예약, 담당자 또는 안내 내용이 변경되었거나 미리보기 시간이 지났습니다. 다시 확인해 주세요.',
    });
  }
  private alreadyRequested(): ConflictException {
    return new ConflictException({
      code: 'MESSAGE_ALREADY_REQUESTED',
      message:
        '같은 안내의 발송 내역이 있습니다. 결과를 확인한 뒤 진행해 주세요.',
    });
  }
}
