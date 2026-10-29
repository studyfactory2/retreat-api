import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ChecklistType,
  Prisma,
  Role,
  SubmissionStatus,
  type StaffDeactivation,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type { StaffDto } from '../../libs/dto/user/staff';
import type { DeactivateStaffInput } from '../../libs/dto/user/staff-deactivation.input';
import type {
  StaffDeactivationAuditDto,
  StaffDeactivationPreviewDto,
  StaffDeactivationResultDto,
  StaffHandoverAssignmentDto,
} from '../../libs/dto/user/staff-deactivation';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { staffSelect } from './admin-users.service';

@Injectable()
export class StaffDeactivationService {
  constructor(private readonly prisma: PrismaService) {}

  public async preview(id: string): Promise<StaffDeactivationPreviewDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const state = await this.readState(tx, id.toLowerCase());
        const latest = await tx.staffDeactivation.findFirst({
          where: { staffUserId: state.staff.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return {
          staff: state.staff,
          expectedStateToken: state.token,
          properties: state.properties.map((property) => ({
            id: property.id,
            name: property.name,
            region: property.region,
            isActive: property.isActive,
            unfinishedDraftCount: state.tokens.filter(
              (row) =>
                row.propertyId === property.id &&
                row.status === SubmissionStatus.DRAFT,
            ).length,
          })),
          unfinishedDraftCount: state.unfinishedDraftCount,
          latestDeactivation: latest ? this.toAuditDto(latest) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async deactivate(
    id: string,
    input: DeactivateStaffInput,
    actor: AuthenticatedUser,
  ): Promise<StaffDeactivationResultDto> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const state = await this.readState(tx, id.toLowerCase());
      if (!state.staff.isActive) {
        throw new ConflictException({
          code: 'STAFF_ALREADY_INACTIVE',
          message:
            '이미 비활성화된 직원입니다. 처리 결과를 다시 확인해 주세요.',
        });
      }
      if (input.expectedStateToken !== state.token) throw this.changed();

      const requested = new Map(
        input.assignments.map((assignment) => [
          assignment.propertyId.toLowerCase(),
          assignment.replacementStaffId?.toLowerCase() ?? null,
        ]),
      );
      if (
        requested.size !== input.assignments.length ||
        requested.size !== state.properties.length ||
        state.properties.some(
          (property) =>
            !requested.has(property.id) ||
            (property.isActive
              ? requested.get(property.id) === null ||
                requested.get(property.id) === state.staff.id
              : requested.get(property.id) !== null),
        )
      ) {
        throw new BadRequestException({
          code: 'STAFF_HANDOVER_ASSIGNMENTS_INVALID',
          message:
            '운영 중인 모든 휴양소의 후임 직원을 선택해 주세요. 비활성 휴양소는 배정이 해제됩니다.',
        });
      }

      const replacementIds = [...new Set([...requested.values()])].filter(
        (value): value is string => value !== null,
      );
      const replacements = await tx.user.findMany({
        where: { id: { in: replacementIds }, role: Role.STAFF, isActive: true },
        select: { id: true, name: true },
      });
      if (replacements.length !== replacementIds.length) {
        throw new ConflictException({
          code: 'STAFF_REPLACEMENT_UNAVAILABLE',
          message:
            '선택한 후임 직원의 상태가 변경되었습니다. 다시 선택해 주세요.',
        });
      }
      const currentActor = await tx.user.findFirst({
        where: { id: actor.id, role: Role.ADMIN, isActive: true },
        select: { id: true, name: true },
      });
      if (!currentActor) throw new UnauthorizedException();

      const now = new Date(
        Math.max(Date.now(), state.staff.updatedAt.getTime() + 1),
      );
      const assignments: StaffHandoverAssignmentDto[] = [];
      for (const property of state.properties) {
        const replacementStaffId = requested.get(property.id) ?? null;
        const replacement = replacements.find(
          (candidate) => candidate.id === replacementStaffId,
        );
        const changed = await tx.property.updateMany({
          where: {
            id: property.id,
            staffUserId: state.staff.id,
            isActive: property.isActive,
            updatedAt: property.updatedAt,
          },
          data: {
            staffUserId: replacementStaffId,
            // Property QR authenticates whoever is currently assigned. Old
            // copies must stop working before the replacement is exposed.
            staffQrTokenHash: null,
            staffQrRotatedAt: new Date(
              Math.max(
                now.getTime(),
                (property.staffQrRotatedAt?.getTime() ?? 0) + 1,
              ),
            ),
          },
        });
        if (changed.count !== 1) throw this.changed();
        assignments.push({
          propertyId: property.id,
          propertyName: property.name,
          propertyRegion: property.region,
          isActive: property.isActive,
          replacementStaffId,
          replacementStaffName: replacement?.name ?? null,
        });
      }

      // This credential-only SQL intentionally does NOT write updatedAt:
      // completed maintenance validates it against its immutable snapshot.
      // Keep expiry too so the existing expired-draft cleanup can still run.
      // Revoke receipts as well as drafts across every property, including
      // formerly assigned properties, so reactivation cannot resurrect access.
      const revoked = await tx.$executeRaw(Prisma.sql`
        UPDATE "ChecklistSubmission"
        SET "privateTokenHash" = NULL
        WHERE "authorUserId" = ${state.staff.id}
          AND "type" = ${ChecklistType.MAINTENANCE}::"ChecklistType"
          AND "privateTokenHash" IS NOT NULL
      `);
      if (revoked !== state.tokens.length) throw this.changed();

      const changed = await tx.user.updateMany({
        where: {
          id: state.staff.id,
          role: Role.STAFF,
          isActive: true,
          updatedAt: state.staff.updatedAt,
        },
        data: { isActive: false, updatedAt: now },
      });
      if (changed.count !== 1) throw this.changed();

      const audit = await tx.staffDeactivation.create({
        data: {
          staffUserId: state.staff.id,
          actorUserId: currentActor.id,
          actorSnapshot: currentActor,
          staffSnapshot: { id: state.staff.id, name: state.staff.name },
          assignments: assignments.map((assignment) => ({ ...assignment })),
          revokedDraftCount: state.unfinishedDraftCount,
          createdAt: now,
        },
      });
      const updated = await tx.user.findFirst({
        where: { id: state.staff.id, role: Role.STAFF },
        select: staffSelect,
      });
      if (!updated) throw this.changed();
      return {
        staff: { ...updated, role: Role.STAFF },
        ...this.toAuditDto(audit),
      };
    });
  }

  private async readState(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findFirst({
      where: { id, role: Role.STAFF },
      select: staffSelect,
    });
    if (!user) {
      throw new NotFoundException({
        code: 'STAFF_NOT_FOUND',
        message: '직원 정보를 찾을 수 없습니다.',
      });
    }
    const staff: StaffDto = { ...user, role: Role.STAFF };
    const properties = await tx.property.findMany({
      where: { staffUserId: id },
      select: {
        id: true,
        name: true,
        region: true,
        isActive: true,
        updatedAt: true,
        staffQrTokenHash: true,
        staffQrRotatedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    const tokens = await tx.checklistSubmission.findMany({
      where: {
        authorUserId: id,
        type: ChecklistType.MAINTENANCE,
        privateTokenHash: { not: null },
      },
      select: {
        id: true,
        propertyId: true,
        status: true,
        updatedAt: true,
        currentRevision: true,
        privateTokenHash: true,
      },
      orderBy: { id: 'asc' },
    });
    const token = createHash('sha256')
      .update(JSON.stringify({ version: 1, staff, properties, tokens }))
      .digest('hex');
    return {
      staff,
      properties,
      tokens,
      token,
      unfinishedDraftCount: tokens.filter(
        (row) => row.status === SubmissionStatus.DRAFT,
      ).length,
    };
  }

  private toAuditDto(audit: StaffDeactivation): StaffDeactivationAuditDto {
    const actor = audit.actorSnapshot;
    if (
      !actor ||
      typeof actor !== 'object' ||
      Array.isArray(actor) ||
      typeof actor.id !== 'string' ||
      typeof actor.name !== 'string' ||
      !Array.isArray(audit.assignments)
    )
      throw new InternalServerErrorException();
    const assignments = audit.assignments.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.propertyId !== 'string' ||
        typeof value.propertyName !== 'string' ||
        (value.propertyRegion !== null &&
          typeof value.propertyRegion !== 'string') ||
        typeof value.isActive !== 'boolean' ||
        (value.replacementStaffId !== null &&
          typeof value.replacementStaffId !== 'string') ||
        (value.replacementStaffName !== null &&
          typeof value.replacementStaffName !== 'string')
      )
        throw new InternalServerErrorException();
      return {
        propertyId: value.propertyId,
        propertyName: value.propertyName,
        propertyRegion: value.propertyRegion as string | null,
        isActive: value.isActive,
        replacementStaffId: value.replacementStaffId as string | null,
        replacementStaffName: value.replacementStaffName as string | null,
      };
    });
    const reassignedPropertyIds = assignments
      .filter((assignment) => assignment.replacementStaffId !== null)
      .map((assignment) => assignment.propertyId);
    return {
      id: audit.id,
      deactivatedAt: audit.createdAt,
      actor: { id: actor.id, name: actor.name },
      assignments,
      revokedDraftCount: audit.revokedDraftCount,
      reassignedPropertyIds,
      clearedPropertyIds: assignments
        .filter((assignment) => assignment.replacementStaffId === null)
        .map((assignment) => assignment.propertyId),
      staffQrReissuePropertyIds: reassignedPropertyIds,
    };
  }

  private changed(): ConflictException {
    return new ConflictException({
      code: 'STAFF_HANDOVER_CHANGED',
      message:
        '직원 정보, 담당 휴양소 또는 작성 중인 기록이 변경되었습니다. 최신 정보를 확인해 주세요.',
    });
  }
}
