import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, StayStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { RuntimeEnvironment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  IssueStayGuestLinkInput,
  RevokeStayGuestLinkInput,
} from '../../libs/dto/admin-stay-link/admin-stay-link.input';
import type {
  AdminStayLinkStatusDto,
  IssueStayGuestLinkDto,
} from '../../libs/dto/admin-stay-link/admin-stay-link';
import {
  hashGuestStayToken,
  STAY_LINK_GRACE_MS,
} from '../stay-access/stay-link-policy';
import { AccessLinkVault } from '../access-link-vault/access-link-vault.service';

const stayLinkSelect = {
  id: true,
  status: true,
  checkOutAt: true,
  currentRevision: true,
  guestLinkTokenHash: true,
  guestLinkTokenCiphertext: true,
  guestLinkExpiresAt: true,
  guestLinkVersion: true,
  guestLinkStayRevision: true,
  guestLinkUpdatedAt: true,
  property: { select: { isActive: true } },
} satisfies Prisma.StaySelect;

type StayLinkRow = Prisma.StayGetPayload<{ select: typeof stayLinkSelect }>;

@Injectable()
export class AdminStayLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<RuntimeEnvironment, true>,
    private readonly vault: AccessLinkVault,
  ) {}

  public async getStayGuestLinkStatus(
    id: string,
  ): Promise<AdminStayLinkStatusDto> {
    const stay = await this.prisma.stay.findUnique({
      where: { id },
      select: stayLinkSelect,
    });
    if (!stay) throw this.stayNotFound();
    return this.toDto(stay);
  }

  public async getCurrentStayGuestLink(
    id: string,
    adminId: string,
  ): Promise<IssueStayGuestLinkDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      await this.requireAdministrator(tx, adminId);
      const stay = await this.findStay(tx, id);
      const status = this.toDto(stay);
      if (!status.enabled || !stay.guestLinkTokenHash) {
        throw new ConflictException({
          code: 'STAY_LINK_DISABLED',
          message:
            '현재 사용할 수 없는 이용 링크입니다. 최신 상태를 확인해 주세요.',
        });
      }
      if (!stay.guestLinkTokenCiphertext) {
        throw new ConflictException({
          code: 'STAY_LINK_NOT_RECOVERABLE',
          message:
            '이전에 발급한 링크는 다시 볼 수 없습니다. 보관 중인 링크는 계속 사용할 수 있습니다.',
        });
      }
      const token = this.vault.open(
        stay.guestLinkTokenCiphertext,
        this.vaultContext(id, stay.guestLinkTokenHash),
      );
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        Buffer.from(token, 'base64url').toString('base64url') !== token ||
        hashGuestStayToken(token) !== stay.guestLinkTokenHash
      ) {
        throw new ServiceUnavailableException({
          code: 'ACCESS_LINK_UNAVAILABLE',
          message:
            '이용 링크를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
        });
      }
      return { ...status, url: this.linkUrl(token) };
    });
  }

  public async issueStayGuestLink(
    id: string,
    input: IssueStayGuestLinkInput,
    adminId: string,
  ): Promise<IssueStayGuestLinkDto> {
    const token = randomBytes(32).toString('base64url');
    const hash = hashGuestStayToken(token);
    const ciphertext = this.vault.seal(token, this.vaultContext(id, hash));

    return await runSerializableTransaction(this.prisma, async (tx) => {
      await this.requireAdministrator(tx, adminId);
      const stay = await this.findStay(tx, id);
      this.requireVersions(stay, input);
      if (stay.status !== StayStatus.ACTIVE) {
        throw new ConflictException({
          code: 'STAY_CANCELLED',
          message: '취소된 이용 일정에는 게스트 링크를 발급할 수 없습니다.',
        });
      }
      if (!stay.property.isActive) {
        throw new ConflictException({
          code: 'PROPERTY_INACTIVE',
          message: '비활성 휴양소에는 게스트 링크를 발급할 수 없습니다.',
        });
      }
      const expiresAt = new Date(
        stay.checkOutAt.getTime() + STAY_LINK_GRACE_MS,
      );
      if (expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({
          code: 'STAY_LINK_EXPIRED',
          message: '게스트 링크를 발급할 수 있는 기간이 지났습니다.',
        });
      }
      const updatedAt = this.nextUpdatedAt(stay);
      const data = {
        guestLinkTokenHash: hash,
        guestLinkTokenCiphertext: ciphertext,
        guestLinkExpiresAt: expiresAt,
        guestLinkVersion: stay.guestLinkVersion + 1,
        guestLinkStayRevision: stay.currentRevision,
        guestLinkUpdatedAt: updatedAt,
      };
      const result = await tx.stay.updateMany({
        where: {
          id,
          currentRevision: input.expectedRevision,
          guestLinkVersion: input.expectedLinkVersion,
          status: StayStatus.ACTIVE,
          property: { isActive: true },
        },
        data,
      });
      if (result.count !== 1) throw this.changed();
      return { ...this.toDto({ ...stay, ...data }), url: this.linkUrl(token) };
    });
  }

  public async revokeStayGuestLink(
    id: string,
    input: RevokeStayGuestLinkInput,
    adminId: string,
  ): Promise<AdminStayLinkStatusDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      await this.requireAdministrator(tx, adminId);
      const stay = await this.findStay(tx, id);
      this.requireVersions(stay, input);
      const data = {
        guestLinkTokenHash: null,
        guestLinkTokenCiphertext: null,
        guestLinkExpiresAt: null,
        guestLinkVersion: stay.guestLinkVersion + 1,
        guestLinkStayRevision: null,
        guestLinkUpdatedAt: this.nextUpdatedAt(stay),
      };
      const result = await tx.stay.updateMany({
        where: {
          id,
          currentRevision: input.expectedRevision,
          guestLinkVersion: input.expectedLinkVersion,
          status: stay.status,
          property: { isActive: stay.property.isActive },
        },
        data,
      });
      if (result.count !== 1) throw this.changed();
      return this.toDto({ ...stay, ...data });
    });
  }

  private vaultContext(id: string, hash: string): string {
    return `stay:${id.toLowerCase()}:${hash}`;
  }

  private linkUrl(token: string): string {
    const url = new URL(
      '/guest/stay',
      this.config.get('FRONTEND_URL', { infer: true }),
    );
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  }

  private async findStay(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<StayLinkRow> {
    const stay = await tx.stay.findUnique({
      where: { id },
      select: stayLinkSelect,
    });
    if (!stay) throw this.stayNotFound();
    return stay;
  }

  private async requireAdministrator(
    tx: Prisma.TransactionClient,
    adminId: string,
  ): Promise<void> {
    const actor = await tx.user.findUnique({
      where: { id: adminId },
      select: { role: true, isActive: true, loginId: true, passwordHash: true },
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
  }

  private requireVersions(
    stay: StayLinkRow,
    input: IssueStayGuestLinkInput | RevokeStayGuestLinkInput,
  ): void {
    if (
      stay.currentRevision !== input.expectedRevision ||
      stay.guestLinkVersion !== input.expectedLinkVersion ||
      stay.guestLinkVersion >= 2147483647
    ) {
      throw this.changed();
    }
  }

  private nextUpdatedAt(stay: StayLinkRow): Date {
    return new Date(
      Math.max(Date.now(), (stay.guestLinkUpdatedAt?.getTime() ?? 0) + 1),
    );
  }

  private toDto(stay: StayLinkRow): AdminStayLinkStatusDto {
    return {
      stayId: stay.id,
      issued: stay.guestLinkTokenHash !== null,
      canReopen: Boolean(
        stay.guestLinkTokenHash && stay.guestLinkTokenCiphertext,
      ),
      enabled:
        stay.guestLinkTokenHash !== null &&
        stay.guestLinkExpiresAt !== null &&
        stay.guestLinkExpiresAt.getTime() > Date.now() &&
        stay.status === StayStatus.ACTIVE &&
        stay.property.isActive &&
        stay.guestLinkStayRevision === stay.currentRevision,
      version: stay.guestLinkVersion,
      stayRevision: stay.currentRevision,
      issuedForRevision: stay.guestLinkStayRevision,
      expiresAt: stay.guestLinkExpiresAt,
      updatedAt: stay.guestLinkUpdatedAt,
    };
  }

  private stayNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'STAY_NOT_FOUND',
      message: '이용 일정을 찾을 수 없습니다.',
    });
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'STAY_LINK_CHANGED',
      message:
        '이용 일정 또는 게스트 링크가 변경되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.',
    });
  }
}
