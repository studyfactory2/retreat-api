import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type PropertyRoomCodeMode } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import { PropertyAccessCodeKind } from '../../libs/dto/admin-property-access/admin-property-access';
import type {
  GuestStayAccessCodesDto,
  RevealedGuestStayAccessCodeDto,
} from '../../libs/dto/guest-stay-access-codes/guest-stay-access-codes';
import type { RevealGuestStayAccessCodeInput } from '../../libs/dto/guest-stay-access-codes/guest-stay-access-codes.input';
import { PropertyAccessCodeVault } from '../admin-property-access/property-access-code-vault';
import { AdminStayAccessService } from '../admin-stay-access/admin-stay-access.service';
import {
  StayAccessService,
  type GuestAccessibleStay,
} from '../stay-access/stay-access.service';

const RELEASE_LEAD_MS = 7 * 24 * 60 * 60 * 1000;
const REVEAL_DURATION_MS = 30_000;

interface GuestCodeContext {
  stay: GuestAccessibleStay;
  eligibilityChecked: boolean;
  roomMode: PropertyRoomCodeMode | null;
  roomCode: string | null;
  entranceCiphertext: string | null;
  fingerprint: string | null;
}

@Injectable()
export class GuestStayCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StayAccessService,
    private readonly reservationCodes: AdminStayAccessService,
    private readonly propertyVault: PropertyAccessCodeVault,
  ) {}

  public async get(
    authorization: string | undefined,
  ): Promise<GuestStayAccessCodesDto> {
    try {
      let context = await runSerializableTransaction(this.prisma, (tx) =>
        this.readContext(tx, authorization),
      );
      // If a read started just before release, perform one fresh authorized
      // read instead of presenting a ready code as unavailable at the boundary.
      if (
        !context.eligibilityChecked &&
        this.window(context.stay, new Date()) === 'AVAILABLE'
      )
        context = await runSerializableTransaction(this.prisma, (tx) =>
          this.readContext(tx, authorization),
        );
      // The transaction can cross checkout or invitation expiry. Recheck at
      // response construction, using server time rather than the device clock.
      return this.metadata(context, new Date());
    } catch (error) {
      throw this.safeError(error);
    }
  }

  public async reveal(
    authorization: string | undefined,
    input: RevealGuestStayAccessCodeInput,
  ): Promise<RevealedGuestStayAccessCodeDto> {
    try {
      const result = await runSerializableTransaction(
        this.prisma,
        async (tx) => {
          const context = await this.readContext(tx, authorization);
          const metadata = this.metadata(context, new Date());
          if (
            metadata.state !== 'AVAILABLE' ||
            (input.kind === 'ENTRANCE' && !metadata.entranceAvailable) ||
            (input.kind !== 'ENTRANCE' && input.kind !== 'ROOM')
          )
            throw this.notAvailable();
          if (metadata.fingerprint !== input.fingerprint)
            throw new ConflictException({
              code: 'GUEST_ACCESS_CODE_CHANGED',
              message: '비밀번호 정보가 변경되었습니다. 다시 확인해 주세요.',
            });
          const code =
            input.kind === 'ROOM'
              ? context.roomCode
              : this.propertyVault.open(
                  context.entranceCiphertext,
                  context.stay.propertyId,
                  PropertyAccessCodeKind.ENTRANCE,
                );
          if (!code) throw this.notAvailable();
          return { context, code };
        },
      );
      const serverTime = new Date();
      const metadata = this.metadata(result.context, serverTime);
      if (metadata.state !== 'AVAILABLE') throw this.notAvailable();
      return {
        stayId: metadata.stayId,
        propertyId: metadata.propertyId,
        kind: input.kind,
        code: result.code,
        fingerprint: metadata.fingerprint,
        serverTime,
        visibleUntil: new Date(
          Math.min(
            serverTime.getTime() + REVEAL_DURATION_MS,
            metadata.closesAt.getTime(),
            result.context.stay.guestLinkExpiresAt.getTime(),
          ),
        ),
      };
    } catch (error) {
      throw this.safeError(error);
    }
  }

  private async readContext(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ): Promise<GuestCodeContext> {
    // Resolve the reservation exclusively from the private invitation token.
    // Caller-provided property/stay IDs and shared QR credentials are not used.
    const stay = await this.access.resolveStay(tx, authorization);
    const context: GuestCodeContext = {
      stay,
      eligibilityChecked: false,
      roomMode: null,
      roomCode: null,
      entranceCiphertext: null,
      fingerprint: null,
    };
    if (this.window(stay, new Date()) !== 'AVAILABLE') return context;
    context.eligibilityChecked = true;
    const settings = await tx.propertyAccessSettings.findUnique({
      where: { propertyId: stay.propertyId },
      select: { version: true, roomMode: true, entranceCodeCiphertext: true },
    });
    if (!settings) return context;
    context.roomMode = settings.roomMode;
    const prepared = await this.reservationCodes.readContext(tx, stay.id);
    // Reuse the reservation's source, policy, restoration and neighboring-code
    // review rules. Neither a vacancy code nor the next guest's code is used.
    if (
      prepared.dto.state !== 'PREPARED' ||
      prepared.dto.blockedReason ||
      !prepared.dto.code ||
      !prepared.code
    )
      return context;
    context.roomCode = prepared.code;
    context.entranceCiphertext = settings.entranceCodeCiphertext;
    context.fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'guest-stay-codes-v1',
          stay.id,
          stay.propertyId,
          stay.currentRevision,
          stay.guestLinkVersion,
          stay.guestLinkExpiresAt.toISOString(),
          stay.checkInAt.toISOString(),
          stay.checkOutAt.toISOString(),
          settings.version,
          prepared.dto.code.version,
          settings.roomMode,
        ]),
      )
      .digest('hex');
    return context;
  }

  private metadata(
    context: GuestCodeContext,
    serverTime: Date,
  ): GuestStayAccessCodesDto {
    const { stay } = context;
    if (stay.guestLinkExpiresAt.getTime() <= serverTime.getTime())
      throw new UnauthorizedException({
        code: 'INVALID_STAY_ACCESS',
        message:
          '이용 링크를 사용할 수 없습니다. 관리자에게 새 링크를 요청해 주세요.',
      });
    const window = this.window(stay, serverTime);
    const state =
      window !== 'AVAILABLE'
        ? window
        : context.fingerprint && context.roomCode
          ? 'AVAILABLE'
          : 'UNAVAILABLE';
    const ready = state === 'AVAILABLE';
    return {
      stayId: stay.id,
      propertyId: stay.propertyId,
      state,
      opensAt: new Date(stay.checkInAt.getTime() - RELEASE_LEAD_MS),
      closesAt: stay.checkOutAt,
      serverTime,
      entranceAvailable: ready && Boolean(context.entranceCiphertext),
      roomAvailable: ready,
      roomMode: window === 'AVAILABLE' ? context.roomMode : null,
      fingerprint: ready ? context.fingerprint : null,
    };
  }

  private window(
    stay: GuestAccessibleStay,
    now: Date,
  ): 'SCHEDULED' | 'AVAILABLE' | 'ENDED' {
    if (now.getTime() >= stay.checkOutAt.getTime()) return 'ENDED';
    if (now.getTime() < stay.checkInAt.getTime() - RELEASE_LEAD_MS)
      return 'SCHEDULED';
    return 'AVAILABLE';
  }

  private notAvailable(): ForbiddenException {
    return new ForbiddenException({
      code: 'GUEST_ACCESS_CODE_NOT_AVAILABLE',
      message: '현재 비밀번호를 확인할 수 없습니다. 최신 상태를 확인해 주세요.',
    });
  }

  private safeError(error: unknown): HttpException {
    if (error instanceof HttpException && error.getStatus() < 500) return error;
    // Crypto/database diagnostic messages can contain internal details. Never
    // return or log them, code values, ciphertext, invitation tokens or IDs.
    return new ServiceUnavailableException({
      code: 'GUEST_ACCESS_CODE_UNAVAILABLE',
      message: '비밀번호를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}
