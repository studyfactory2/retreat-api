import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Prisma,
  PropertyRoomCodeMode,
  Role,
  StayAccessCodeAction,
  StayAccessCodeMethod,
  StayRevisionAction,
  StayStatus,
} from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import { PropertyAccessCodeKind } from '../../libs/dto/admin-property-access/admin-property-access';
import {
  SaveStayAccessAction,
  type AccessCodeReviewReason,
  type AdminStayAccessDto,
  type RevealedStayAccessCodeDto,
} from '../../libs/dto/admin-stay-access/admin-stay-access';
import type {
  SaveAdminStayAccessInput,
  StayAccessVersionsInput,
} from '../../libs/dto/admin-stay-access/admin-stay-access.input';
import { PropertyAccessCodeVault } from '../admin-property-access/property-access-code-vault';
import { StayAccessCodeVault } from './stay-access-code-vault';
import {
  phoneDigits,
  phoneIdentity,
  sourceSnapshot,
  stayAccessSelect,
  type StayWithAccess,
} from './stay-access-data';

interface AccessContext {
  stay: StayWithAccess;
  code: string | null;
  fixedCode: string | null;
  neighbors: string[];
  dto: AdminStayAccessDto;
}

@Injectable()
export class AdminStayAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: StayAccessCodeVault,
    private readonly propertyVault: PropertyAccessCodeVault,
  ) {}

  public async getAccessCode(stayId: string): Promise<AdminStayAccessDto> {
    try {
      return await runSerializableTransaction(
        this.prisma,
        async (tx) => (await this.context(tx, stayId.toLowerCase())).dto,
      );
    } catch (error) {
      throw this.safeError(error);
    }
  }

  public async revealAccessCode(
    stayId: string,
    input: StayAccessVersionsInput,
  ): Promise<RevealedStayAccessCodeDto> {
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const stay = await this.findStay(tx, stayId.toLowerCase());
        this.checkVersions(stay, input);
        if (!stay.accessCode)
          throw new NotFoundException({
            code: 'STAY_ACCESS_CODE_NOT_SET',
            message: '저장된 예약 비밀번호가 없습니다.',
          });
        return {
          stayId: stay.id,
          code: this.vault.open(stay.accessCode.ciphertext, stay.id),
          version: stay.accessCode.version,
        };
      });
    } catch (error) {
      throw this.safeError(error);
    }
  }

  public async saveAccessCode(
    stayId: string,
    input: SaveAdminStayAccessInput,
    actorId: string,
  ): Promise<AdminStayAccessDto> {
    try {
      this.checkAction(input);
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: {
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
        )
          throw new UnauthorizedException({
            code: 'UNAUTHENTICATED',
            message: '다시 로그인해 주세요.',
          });
        const context = await this.context(tx, stayId.toLowerCase());
        const { stay, dto } = context;
        this.checkVersions(stay, input);
        if (dto.blockedReason)
          throw new ConflictException({
            code: 'STAY_ACCESS_CODE_BLOCKED',
            message:
              '현재 예약 또는 휴양소 설정에서는 비밀번호를 준비할 수 없습니다. 최신 상태를 확인해 주세요.',
          });
        const previous = stay.accessCode;
        if (
          (input.action === SaveStayAccessAction.PREPARE && previous) ||
          (input.action !== SaveStayAccessAction.PREPARE && !previous)
        )
          throw this.changed();
        if ((previous?.version ?? 0) >= 2147483647) throw this.changed();
        const currentRevision = await tx.stayRevision.findUnique({
          where: {
            stayId_version: { stayId: stay.id, version: stay.currentRevision },
          },
          select: { snapshot: true },
        });
        const currentSource = currentRevision
          ? sourceSnapshot(currentRevision.snapshot, stay, stay.currentRevision)
          : null;
        if (
          !currentSource ||
          phoneIdentity(currentSource.phone) !== phoneIdentity(stay.phone) ||
          currentSource.guestName !== stay.guestName
        )
          throw new ConflictException({
            code: 'STAY_ACCESS_SOURCE_UNAVAILABLE',
            message:
              '예약 변경 이력을 확인할 수 없습니다. 관리자에게 문의해 주세요.',
          });
        let method: StayAccessCodeMethod;
        let ciphertext: string;
        if (input.action === SaveStayAccessAction.CONFIRM) {
          if (!dto.canConfirm)
            throw new ConflictException({
              code: 'STAY_ACCESS_REPLACEMENT_REQUIRED',
              message:
                '현재 번호를 유지할 수 없습니다. 새 번호를 준비해 주세요.',
            });
          method = previous.method;
          ciphertext = previous.ciphertext;
        } else {
          method = input.method;
          const candidate = this.prepareCode(context, method);
          ciphertext = this.vault.seal(candidate, stay.id);
        }
        const version = (previous?.version ?? 0) + 1;
        const now = new Date(
          Math.max(Date.now(), (previous?.updatedAt.getTime() ?? 0) + 1),
        );
        const data = {
          version,
          method,
          ciphertext,
          sourceStayRevision: stay.currentRevision,
          sourceSettingsVersion: dto.propertySettings.version,
          updatedAt: now,
        };
        if (previous) {
          const updated = await tx.stayAccessCode.updateMany({
            where: { stayId: stay.id, version: previous.version },
            data,
          });
          if (updated.count !== 1) throw this.changed();
        } else {
          await tx.stayAccessCode.create({
            data: { stayId: stay.id, ...data, preparedAt: now },
            select: { stayId: true },
          });
        }
        await tx.stayAccessCodeEvent.create({
          data: {
            stayId: stay.id,
            codeVersion: version,
            action:
              input.action === SaveStayAccessAction.PREPARE
                ? StayAccessCodeAction.PREPARED
                : input.action === SaveStayAccessAction.REPLACE
                  ? StayAccessCodeAction.REPLACED
                  : StayAccessCodeAction.CONFIRMED,
            method,
            actorUserId: actorId,
            actorName: actor.name,
            createdAt: now,
          },
          select: { id: true },
        });
        return (await this.context(tx, stay.id)).dto;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.changed();
      throw this.safeError(error);
    }
  }

  private checkAction(input: SaveAdminStayAccessInput): void {
    if (
      !Object.values(SaveStayAccessAction).includes(input.action) ||
      (input.action === SaveStayAccessAction.CONFIRM
        ? input.method !== undefined
        : !Object.values(StayAccessCodeMethod).includes(input.method))
    )
      throw new BadRequestException({
        code: 'INVALID_STAY_ACCESS_ACTION',
        message: '비밀번호 작업과 방식을 확인해 주세요.',
      });
  }

  private prepareCode(
    context: AccessContext,
    method: StayAccessCodeMethod,
  ): string {
    const { stay, fixedCode, neighbors, code: previous } = context;
    if (stay.property.accessSettings.roomMode === PropertyRoomCodeMode.FIXED) {
      if (method !== StayAccessCodeMethod.FIXED || !fixedCode)
        throw new BadRequestException({
          code: 'STAY_ACCESS_FIXED_REQUIRED',
          message: '이 휴양소는 설정된 고정 비밀번호를 사용합니다.',
        });
      return fixedCode;
    }
    if (method === StayAccessCodeMethod.FIXED)
      throw new BadRequestException({
        code: 'STAY_ACCESS_ROTATING_REQUIRED',
        message: '자동 생성 또는 휴대폰 뒤 6자리를 선택해 주세요.',
      });
    const excluded = new Set(neighbors);
    if (previous) excluded.add(previous);
    if (method === StayAccessCodeMethod.PHONE_LAST6) {
      const digits = phoneDigits(stay.phone);
      if (!digits)
        throw new BadRequestException({
          code: 'STAY_ACCESS_PHONE_INVALID',
          message: '예약 연락처를 확인하거나 자동 생성을 선택해 주세요.',
        });
      const candidate = digits.slice(-6);
      if (candidate === previous)
        throw new ConflictException({
          code: 'STAY_ACCESS_CODE_UNCHANGED',
          message:
            '기존 번호와 같습니다. 번호 유지 확인 또는 자동 생성을 선택해 주세요.',
        });
      if (excluded.has(candidate))
        throw new ConflictException({
          code: 'STAY_ACCESS_CODE_CONFLICT',
          message: '앞뒤 예약의 번호와 같습니다. 자동 생성을 선택해 주세요.',
        });
      return candidate;
    }
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = randomInt(0, 1_000_000).toString().padStart(6, '0');
      if (!excluded.has(candidate)) return candidate;
    }
    throw new ServiceUnavailableException(
      'Reservation code generation failed.',
    );
  }

  private async context(
    tx: Prisma.TransactionClient,
    stayId: string,
  ): Promise<AccessContext> {
    const stay = await this.findStay(tx, stayId);
    const saved = stay.accessCode;
    const settings = stay.property.accessSettings;
    const code = saved ? this.vault.open(saved.ciphertext, stay.id) : null;
    const fixedCode =
      settings?.roomMode === PropertyRoomCodeMode.FIXED &&
      settings.fixedRoomCodeCiphertext
        ? this.propertyVault.open(
            settings.fixedRoomCodeCiphertext,
            stay.propertyId,
            PropertyAccessCodeKind.FIXED_ROOM,
          )
        : null;
    const neighbors =
      settings?.roomMode === PropertyRoomCodeMode.ROTATING
        ? await this.neighborCodes(tx, stay)
        : [];
    const reviewReasons: AccessCodeReviewReason[] = [];
    if (saved) {
      const source = await tx.stayRevision.findUnique({
        where: {
          stayId_version: {
            stayId: stay.id,
            version: saved.sourceStayRevision,
          },
        },
        select: { snapshot: true },
      });
      const snapshot = source
        ? sourceSnapshot(source.snapshot, stay, saved.sourceStayRevision)
        : null;
      if (!snapshot) reviewReasons.push('SOURCE_UNAVAILABLE');
      else {
        if (phoneIdentity(snapshot.phone) !== phoneIdentity(stay.phone))
          reviewReasons.push('PHONE_CHANGED');
        if (snapshot.guestName !== stay.guestName)
          reviewReasons.push('GUEST_CHANGED');
      }
      if (stay.status === StayStatus.ACTIVE) {
        const restored = await tx.stayRevision.findFirst({
          where: {
            stayId: stay.id,
            version: { gt: saved.sourceStayRevision },
            action: {
              in: [StayRevisionAction.CANCELLED, StayRevisionAction.RESTORED],
            },
          },
          select: { id: true },
        });
        if (restored) reviewReasons.push('RESTORED');
      }
      if (
        !settings ||
        (saved.method === StayAccessCodeMethod.FIXED) !==
          (settings.roomMode === PropertyRoomCodeMode.FIXED)
      )
        reviewReasons.push('PROPERTY_MODE_CHANGED');
      else if (
        settings.roomMode === PropertyRoomCodeMode.FIXED &&
        code !== fixedCode
      )
        reviewReasons.push('FIXED_CODE_CHANGED');
      if (
        settings?.roomMode === PropertyRoomCodeMode.ROTATING &&
        neighbors.includes(code)
      )
        reviewReasons.push('NEIGHBOR_CODE_CONFLICT');
    }
    const blockedReason: AdminStayAccessDto['blockedReason'] =
      stay.status === StayStatus.CANCELLED
        ? 'CANCELLED'
        : stay.checkOutAt.getTime() <= Date.now()
          ? 'ENDED'
          : !stay.property.isActive
            ? 'PROPERTY_INACTIVE'
            : !settings
              ? 'PROPERTY_UNCONFIGURED'
              : settings.roomMode === PropertyRoomCodeMode.FIXED && !fixedCode
                ? 'FIXED_CODE_MISSING'
                : null;
    return {
      stay,
      code,
      fixedCode,
      neighbors,
      dto: {
        stay: {
          id: stay.id,
          propertyId: stay.propertyId,
          currentRevision: stay.currentRevision,
          status: stay.status,
          checkOutAt: stay.checkOutAt,
          propertyIsActive: stay.property.isActive,
        },
        propertySettings: {
          version: settings?.version ?? 0,
          roomMode: settings?.roomMode ?? null,
          hasFixedRoomCode: Boolean(settings?.fixedRoomCodeCiphertext),
        },
        state: !saved
          ? 'UNSET'
          : reviewReasons.length
            ? 'REVIEW_REQUIRED'
            : 'PREPARED',
        blockedReason,
        phoneEligible: phoneDigits(stay.phone) !== null,
        reviewReasons,
        code: saved
          ? {
              version: saved.version,
              method: saved.method,
              preparedAt: saved.preparedAt,
              updatedAt: saved.updatedAt,
              sourceStayRevision: saved.sourceStayRevision,
              sourceSettingsVersion: saved.sourceSettingsVersion,
              phoneMatchesCurrent:
                saved.method === StayAccessCodeMethod.PHONE_LAST6
                  ? code === phoneDigits(stay.phone)?.slice(-6)
                  : null,
            }
          : null,
        canConfirm: Boolean(
          saved &&
          !blockedReason &&
          reviewReasons.length &&
          reviewReasons.every(
            (reason) =>
              reason === 'PHONE_CHANGED' ||
              reason === 'GUEST_CHANGED' ||
              reason === 'RESTORED',
          ),
        ),
        history: stay.accessCodeEvents.map((event) => ({
          version: event.codeVersion,
          action: event.action,
          method: event.method,
          actorName: event.actorName,
          createdAt: event.createdAt,
        })),
      },
    };
  }

  private async neighborCodes(
    tx: Prisma.TransactionClient,
    stay: StayWithAccess,
  ): Promise<string[]> {
    const select = {
      id: true,
      accessCode: { select: { ciphertext: true } },
    } satisfies Prisma.StaySelect;
    const where = {
      propertyId: stay.propertyId,
      status: StayStatus.ACTIVE,
      id: { not: stay.id },
    };

    const previous = await tx.stay.findFirst({
      where: { ...where, checkOutAt: { lte: stay.checkInAt } },
      orderBy: [{ checkOutAt: 'desc' }, { id: 'asc' }],
      select,
    });
    const next = await tx.stay.findFirst({
      where: { ...where, checkInAt: { gte: stay.checkOutAt } },
      orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
      select,
    });
    return [previous, next].flatMap((neighbor) =>
      neighbor?.accessCode
        ? [this.vault.open(neighbor.accessCode.ciphertext, neighbor.id)]
        : [],
    );
  }

  private async findStay(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<StayWithAccess> {
    const stay = await tx.stay.findUnique({
      where: { id },
      select: stayAccessSelect,
    });
    if (!stay)
      throw new NotFoundException({
        code: 'STAY_NOT_FOUND',
        message: '이용 일정을 찾을 수 없습니다.',
      });
    return stay;
  }
  private checkVersions(
    stay: StayWithAccess,
    input: StayAccessVersionsInput,
  ): void {
    if (
      stay.currentRevision !== input.expectedStayRevision ||
      (stay.property.accessSettings?.version ?? 0) !==
        input.expectedSettingsVersion ||
      (stay.accessCode?.version ?? 0) !== input.expectedCodeVersion
    )
      throw this.changed();
  }
  private changed(): ConflictException {
    return new ConflictException({
      code: 'STAY_ACCESS_CHANGED',
      message:
        '예약 또는 비밀번호가 변경되었습니다. 최신 상태를 확인해 주세요.',
    });
  }
  private safeError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    return new InternalServerErrorException(
      'Reservation access operation failed.',
    );
  }
}
