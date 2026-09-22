import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { SaveAdminPropertyGuideInput } from '../../libs/dto/admin-property-guide/admin-property-guide.input';
import type { AdminPropertyGuideDto } from '../../libs/dto/admin-property-guide/admin-property-guide';

const guideSelect = {
  title: true,
  content: true,
  isPublished: true,
  version: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PropertyGuideSelect;

const propertySelect = {
  id: true,
  name: true,
  region: true,
  isActive: true,
  guide: { select: guideSelect },
} satisfies Prisma.PropertySelect;

@Injectable()
export class AdminPropertyGuidesService {
  constructor(private readonly prisma: PrismaService) {}

  public async getGuide(propertyId: string): Promise<AdminPropertyGuideDto> {
    propertyId = propertyId.toLowerCase();
    const { guide, ...property } = await this.findProperty(
      this.prisma,
      propertyId,
    );
    return { property, guide };
  }

  public async saveGuide(
    propertyId: string,
    input: SaveAdminPropertyGuideInput,
    actorId: string,
  ): Promise<AdminPropertyGuideDto> {
    propertyId = propertyId.toLowerCase();
    try {
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
        ) {
          throw new UnauthorizedException({
            code: 'UNAUTHENTICATED',
            message: '로그인이 필요합니다. 다시 로그인해 주세요.',
          });
        }

        const { guide, ...property } = await this.findProperty(tx, propertyId);
        if ((guide?.version ?? 0) !== input.expectedVersion)
          throw this.changed();
        if (guide && guide.version >= 2147483647) throw this.changed();

        // Inactive properties can be prepared by an admin, but guest access stays blocked.
        const data = {
          title: input.title,
          content: input.content,
          isPublished: input.isPublished,
          updatedByUserId: actorId,
        };
        if (!guide) {
          const created = await tx.propertyGuide.create({
            data: { propertyId, ...data },
            select: guideSelect,
          });
          return { property, guide: created };
        }

        const updated = await tx.propertyGuide.updateMany({
          where: { propertyId, version: input.expectedVersion },
          data: {
            ...data,
            version: { increment: 1 },
            updatedAt: new Date(
              Math.max(Date.now(), guide.updatedAt.getTime() + 1),
            ),
          },
        });
        if (updated.count !== 1) throw this.changed();
        return {
          property,
          guide: await tx.propertyGuide.findUniqueOrThrow({
            where: { propertyId },
            select: guideSelect,
          }),
        };
      });
    } catch (error) {
      // Concurrent first saves must never overwrite the first published content.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.changed();
      throw error;
    }
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

  private changed(): ConflictException {
    return new ConflictException({
      code: 'PROPERTY_GUIDE_CHANGED',
      message:
        '안내문이 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
    });
  }
}
