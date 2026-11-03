import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, PropertyRoomCodeMode, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import {
  PropertyAccessCodeKind,
  type AdminPropertyAccessSettingsDto,
  type RevealedPropertyAccessCodeDto,
} from '../../libs/dto/admin-property-access/admin-property-access';
import type {
  RevealAdminPropertyAccessCodeInput,
  SaveAdminPropertyAccessSettingsInput,
} from '../../libs/dto/admin-property-access/admin-property-access.input';
import { PropertyAccessCodeVault } from './property-access-code-vault';

const settingsSelect = {
  version: true,
  roomMode: true,
  entranceCodeCiphertext: true,
  fixedRoomCodeCiphertext: true,
  vacancyCodeCiphertext: true,
  updatedAt: true,
} satisfies Prisma.PropertyAccessSettingsSelect;

const propertySelect = {
  id: true,
  name: true,
  region: true,
  isActive: true,
  accessSettings: { select: settingsSelect },
} satisfies Prisma.PropertySelect;

type PropertyWithSettings = Prisma.PropertyGetPayload<{
  select: typeof propertySelect;
}>;
type CiphertextChanges = {
  entranceCodeCiphertext?: string | null;
  fixedRoomCodeCiphertext?: string | null;
  vacancyCodeCiphertext?: string | null;
};

@Injectable()
export class AdminPropertyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: PropertyAccessCodeVault,
  ) {}

  public async getSettings(
    propertyId: string,
  ): Promise<AdminPropertyAccessSettingsDto> {
    try {
      return this.toDto(
        await this.findProperty(this.prisma, propertyId.toLowerCase()),
      );
    } catch (error) {
      throw this.safeError(error);
    }
  }

  public async saveSettings(
    propertyId: string,
    input: SaveAdminPropertyAccessSettingsInput,
    actorId: string,
  ): Promise<AdminPropertyAccessSettingsDto> {
    propertyId = propertyId.toLowerCase();
    try {
      const changes = this.sealChanges(propertyId, input);
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: {
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
            message: '로그인이 필요합니다. 다시 로그인해 주세요.',
          });

        const property = await this.findProperty(tx, propertyId);
        const current = property.accessSettings;
        if (
          (current?.version ?? 0) !== input.expectedVersion ||
          (current?.version ?? 0) >= 2147483647
        )
          throw this.changed();

        const fixedRoomCode =
          changes.fixedRoomCodeCiphertext === undefined
            ? current?.fixedRoomCodeCiphertext
            : changes.fixedRoomCodeCiphertext;
        if (input.roomMode === PropertyRoomCodeMode.FIXED && !fixedRoomCode)
          throw new BadRequestException({
            code: 'FIXED_ROOM_CODE_REQUIRED',
            message: '고정 방식에서는 객실 비밀번호를 입력해 주세요.',
          });

        const data = {
          roomMode: input.roomMode,
          ...changes,
          updatedByUserId: actorId,
        };
        if (!current) {
          await tx.propertyAccessSettings.create({
            data: { propertyId, ...data },
            select: { propertyId: true },
          });
        } else {
          const updated = await tx.propertyAccessSettings.updateMany({
            where: { propertyId, version: input.expectedVersion },
            data: {
              ...data,
              version: { increment: 1 },
              updatedAt: new Date(
                Math.max(Date.now(), current.updatedAt.getTime() + 1),
              ),
            },
          });
          if (updated.count !== 1) throw this.changed();
        }
        return this.toDto(await this.findProperty(tx, propertyId));
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

  public async revealCode(
    propertyId: string,
    input: RevealAdminPropertyAccessCodeInput,
  ): Promise<RevealedPropertyAccessCodeDto> {
    propertyId = propertyId.toLowerCase();
    try {
      const { accessSettings: settings } = await this.findProperty(
        this.prisma,
        propertyId,
      );
      if ((settings?.version ?? 0) !== input.expectedVersion)
        throw this.changed();
      const envelope =
        input.kind === PropertyAccessCodeKind.ENTRANCE
          ? settings?.entranceCodeCiphertext
          : input.kind === PropertyAccessCodeKind.FIXED_ROOM
            ? settings?.fixedRoomCodeCiphertext
            : settings?.vacancyCodeCiphertext;
      if (!settings || !envelope)
        throw new NotFoundException({
          code: 'ACCESS_CODE_NOT_SET',
          message: '저장된 비밀번호가 없습니다.',
        });
      return {
        kind: input.kind,
        code: this.vault.open(envelope, propertyId, input.kind),
        version: settings.version,
      };
    } catch (error) {
      throw this.safeError(error);
    }
  }

  private sealChanges(
    propertyId: string,
    input: SaveAdminPropertyAccessSettingsInput,
  ): CiphertextChanges {
    const changes: CiphertextChanges = {};
    if (input.entranceCode !== undefined)
      changes.entranceCodeCiphertext =
        input.entranceCode === null
          ? null
          : this.vault.seal(
              input.entranceCode,
              propertyId,
              PropertyAccessCodeKind.ENTRANCE,
            );
    if (input.fixedRoomCode !== undefined)
      changes.fixedRoomCodeCiphertext =
        input.fixedRoomCode === null
          ? null
          : this.vault.seal(
              input.fixedRoomCode,
              propertyId,
              PropertyAccessCodeKind.FIXED_ROOM,
            );
    if (input.vacancyCode !== undefined)
      changes.vacancyCodeCiphertext =
        input.vacancyCode === null
          ? null
          : this.vault.seal(
              input.vacancyCode,
              propertyId,
              PropertyAccessCodeKind.VACANCY,
            );
    return changes;
  }

  private async findProperty(tx: Prisma.TransactionClient, id: string) {
    const property = await tx.property.findUnique({
      where: { id },
      select: propertySelect,
    });
    if (!property)
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: '휴양소를 찾을 수 없습니다.',
      });
    return property;
  }

  private toDto(
    property: PropertyWithSettings,
  ): AdminPropertyAccessSettingsDto {
    const settings = property.accessSettings;
    return {
      property: {
        id: property.id,
        name: property.name,
        region: property.region,
        isActive: property.isActive,
      },
      settings: {
        version: settings?.version ?? 0,
        roomMode: settings?.roomMode ?? null,
        hasEntranceCode: Boolean(settings?.entranceCodeCiphertext),
        hasFixedRoomCode: Boolean(settings?.fixedRoomCodeCiphertext),
        hasVacancyCode: Boolean(settings?.vacancyCodeCiphertext),
        updatedAt: settings?.updatedAt ?? null,
      },
    };
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'ACCESS_SETTINGS_CHANGED',
      message: '설정이 변경되었습니다. 최신 내용을 확인해 주세요.',
    });
  }

  private safeError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    return new InternalServerErrorException(
      'Property access operation failed.',
    );
  }
}
