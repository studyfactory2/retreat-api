import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActorSource,
  ChecklistType,
  Prisma,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { RuntimeEnvironment } from '../../config/environment';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import { QrFlow } from '../../libs/dto/qr/qr';
import type { StartStayGuestDraftInput } from '../../libs/dto/guest-stay/guest-stay.input';
import type {
  SaveDraftInput,
  StartGuestDraftInput,
  StartStaffDraftInput,
} from '../../libs/dto/submission-draft/submission-draft.input';
import type {
  DraftAuthorSnapshot,
  DraftTemplateSnapshot,
  StartDraftDto,
  SubmissionDraftDto,
} from '../../libs/dto/submission-draft/submission-draft';
import { parseChecklistDefinition } from '../checklist-templates/checklist-definition';
import { QrService } from '../qr/qr.service';
import { StayAccessService } from '../stay-access/stay-access.service';
import { buildDraftAnswers, parseDraftAnswers } from './draft-answers';

// Initial draft policy; this does not define the future submitted-link lifetime.
const DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const draftSelect = {
  id: true,
  propertyId: true,
  type: true,
  templateId: true,
  templateVersion: true,
  templateSnapshot: true,
  stayId: true,
  stayLinkVersion: true,
  authorUserId: true,
  authorSnapshot: true,
  authorSource: true,
  visitDate: true,
  status: true,
  draftAnswers: true,
  startedAt: true,
  submittedAt: true,
  cancelledAt: true,
  currentRevision: true,
  privateTokenHash: true,
  privateTokenExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  property: {
    select: {
      id: true,
      name: true,
      region: true,
      isActive: true,
      staffUserId: true,
    },
  },
  author: { select: { id: true, role: true, isActive: true } },
} satisfies Prisma.ChecklistSubmissionSelect;
export type DraftRecord = Prisma.ChecklistSubmissionGetPayload<{
  select: typeof draftSelect;
}>;

@Injectable()
export class SubmissionDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
    private readonly config: ConfigService<RuntimeEnvironment, true>,
    private readonly stayAccess: StayAccessService,
  ) {}

  public async startGuestDraft(
    authorization: string | undefined,
    input: StartGuestDraftInput,
  ): Promise<StartDraftDto> {
    const visitDate = this.parseVisitDate(input.visitDate);
    return await this.startDraft(async (tx) => {
      const property = await this.qrService.resolveProperty(
        tx,
        QrFlow.GUEST,
        authorization,
      );
      return {
        propertyId: property.id,
        requestKey: input.requestKey.toLowerCase(),
        type: input.type,
        visitDate,
        authorUserId: null,
        authorSource: ActorSource.GUEST_QR,
        authorSnapshot: {
          schemaVersion: 1,
          role: 'GUEST',
          name: input.guestName,
          company: input.company ?? null,
          department: input.department ?? null,
          phone: input.phone ?? null,
        },
        startedAt: null,
      };
    });
  }

  public async startStayGuestDraft(
    authorization: string | undefined,
    input: StartStayGuestDraftInput,
  ): Promise<StartDraftDto> {
    if (
      input.type !== ChecklistType.CHECK_IN &&
      input.type !== ChecklistType.CHECK_OUT
    ) {
      throw new BadRequestException({
        code: 'INVALID_CHECKLIST_TYPE',
        message: '입실 또는 퇴실 체크리스트를 선택해 주세요.',
      });
    }
    return await this.startDraft(async (tx) => {
      const stay = await this.stayAccess.resolveStay(tx, authorization);
      const visitAt =
        input.type === ChecklistType.CHECK_IN
          ? stay.checkInAt
          : stay.checkOutAt;
      const visitDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(visitAt);
      return {
        propertyId: stay.propertyId,
        stayId: stay.id,
        stayLinkVersion: stay.guestLinkVersion,
        accessExpiresAt: stay.guestLinkExpiresAt,
        requestKey: input.requestKey.toLowerCase(),
        type: input.type,
        visitDate: this.parseVisitDate(visitDate),
        authorUserId: null,
        authorSource: ActorSource.PRIVATE_LINK,
        authorSnapshot: {
          schemaVersion: 1,
          role: 'GUEST',
          name: stay.guestName,
          company: stay.company,
          department: stay.department,
          phone: stay.phone,
        },
        startedAt: null,
      };
    });
  }

  public async startStaffDraft(
    authorization: string | undefined,
    input: StartStaffDraftInput,
  ): Promise<StartDraftDto> {
    return await this.startDraft(async (tx) => {
      const property = await this.qrService.resolveProperty(
        tx,
        QrFlow.STAFF,
        authorization,
      );
      const staff = property.staffUserId
        ? await tx.user.findFirst({
            where: {
              id: property.staffUserId,
              role: Role.STAFF,
              isActive: true,
            },
            select: { id: true, name: true },
          })
        : null;
      if (!staff || staff.id !== input.confirmedStaffId.toLowerCase()) {
        throw new ConflictException({
          code: 'STAFF_ASSIGNMENT_CHANGED',
          message: '현재 정비 담당자를 다시 확인해 주세요.',
        });
      }
      const now = new Date();
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
      return {
        propertyId: property.id,
        requestKey: input.requestKey.toLowerCase(),
        type: ChecklistType.MAINTENANCE,
        visitDate: this.parseVisitDate(day),
        authorUserId: staff.id,
        authorSource: ActorSource.STAFF_QR,
        authorSnapshot: {
          schemaVersion: 1,
          role: 'STAFF',
          name: staff.name,
          company: null,
          department: null,
          phone: null,
        },
        startedAt: now,
      };
    });
  }

  public async getDraft(
    authorization: string | undefined,
  ): Promise<SubmissionDraftDto> {
    return await this.prisma.$transaction(
      async (tx) => {
        return this.toDto(await this.resolveDraft(tx, authorization));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async saveDraft(
    authorization: string | undefined,
    input: SaveDraftInput,
  ): Promise<SubmissionDraftDto> {
    return await runSerializableTransaction(this.prisma, async (tx) => {
      const draft = await this.resolveDraft(tx, authorization);
      if (draft.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw this.staleDraft();
      const template = this.readTemplate(draft);
      const answers = buildDraftAnswers(
        input.items,
        input.generalNote,
        template.definition,
        draft.type === ChecklistType.MAINTENANCE,
      );
      const updatedAt = new Date(
        Math.max(Date.now(), draft.updatedAt.getTime() + 1),
      );
      const result = await tx.checklistSubmission.updateMany({
        where: {
          id: draft.id,
          status: SubmissionStatus.DRAFT,
          updatedAt: draft.updatedAt,
          privateTokenHash: draft.privateTokenHash,
          privateTokenExpiresAt: { gt: new Date() },
        },
        data: { draftAnswers: answers, updatedAt },
      });
      if (result.count !== 1) throw this.staleDraft();
      return this.toDto({ ...draft, draftAnswers: answers, updatedAt });
    });
  }

  private async startDraft(
    resolve: (tx: Prisma.TransactionClient) => Promise<{
      propertyId: string;
      stayId?: string;
      stayLinkVersion?: number;
      accessExpiresAt?: Date;
      requestKey: string;
      type: ChecklistType;
      visitDate: Date;
      authorUserId: string | null;
      authorSource: ActorSource;
      authorSnapshot: DraftAuthorSnapshot;
      startedAt: Date | null;
    }>,
  ): Promise<StartDraftDto> {
    const token = randomBytes(32).toString('base64url');
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const { accessExpiresAt, ...context } = await resolve(tx);
        // A request key deduplicates creation; it never authorizes token recovery.
        const existing = await tx.checklistSubmission.findUnique({
          where: { requestKey: context.requestKey },
          select: { id: true },
        });
        if (existing) throw this.duplicateRequest();
        const template = await tx.checklistTemplate.findFirst({
          where: {
            propertyId: context.propertyId,
            type: context.type,
            isActive: true,
          },
          select: {
            id: true,
            title: true,
            type: true,
            version: true,
            definition: true,
          },
        });
        if (!template)
          throw new ConflictException({
            code: 'CHECKLIST_UNAVAILABLE',
            message:
              '사용 가능한 체크리스트가 없습니다. 관리자에게 문의해 주세요.',
          });
        const snapshot: DraftTemplateSnapshot = {
          schemaVersion: 1,
          ...template,
          definition: parseChecklistDefinition(template.definition),
        };
        const expiresAt = new Date(
          Math.min(
            Date.now() + DRAFT_LIFETIME_MS,
            accessExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
          ),
        );
        if (expiresAt.getTime() <= Date.now()) throw this.invalidAccess();
        const draft = await tx.checklistSubmission.create({
          data: {
            ...context,
            templateId: template.id,
            templateVersion: template.version,
            templateSnapshot: snapshot,
            status: SubmissionStatus.DRAFT,
            draftAnswers: { schemaVersion: 1, items: [], generalNote: null },
            privateTokenHash: this.hashToken(token),
            privateTokenExpiresAt: expiresAt,
          },
          select: draftSelect,
        });
        const url = new URL(
          '/draft',
          this.config.get('FRONTEND_URL', { infer: true }),
        );
        url.hash = new URLSearchParams({ token }).toString();
        return {
          draft: this.toDto(draft),
          accessToken: token,
          url: url.toString(),
          expiresAt,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('requestKey')
      ) {
        throw this.duplicateRequest();
      }
      throw error;
    }
  }

  public async resolveDraft(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ): Promise<DraftRecord> {
    const draft = await this.resolvePrivateSubmission(tx, authorization);
    if (draft.status !== SubmissionStatus.DRAFT) throw this.invalidAccess();
    return draft;
  }

  // Completed callers apply their own receipt or guest-view restrictions.
  // Draft mutation callers keep resolveDraft.
  public async resolvePrivateSubmission(
    tx: Prisma.TransactionClient,
    authorization: string | undefined,
  ): Promise<DraftRecord> {
    const match =
      typeof authorization === 'string' && authorization.length <= 100
        ? /^Bearer +([A-Za-z0-9_-]{43})$/i.exec(authorization)
        : null;
    if (
      !match ||
      Buffer.from(match[1], 'base64url').toString('base64url') !== match[1]
    )
      throw this.invalidAccess();
    const draft = await tx.checklistSubmission.findUnique({
      where: { privateTokenHash: this.hashToken(match[1]) },
      select: draftSelect,
    });
    if (
      !draft ||
      (draft.status !== SubmissionStatus.DRAFT &&
        draft.status !== SubmissionStatus.SUBMITTED) ||
      !draft.property.isActive ||
      !draft.privateTokenExpiresAt ||
      draft.privateTokenExpiresAt.getTime() <= Date.now()
    )
      throw this.invalidAccess();
    if (
      draft.type === ChecklistType.MAINTENANCE &&
      (!draft.authorUserId ||
        draft.property.staffUserId !== draft.authorUserId ||
        draft.author?.role !== Role.STAFF ||
        !draft.author.isActive)
    )
      throw this.invalidAccess();
    if (draft.stayLinkVersion !== null) {
      if (
        !draft.stayId ||
        draft.type === ChecklistType.MAINTENANCE ||
        draft.authorSource !== ActorSource.PRIVATE_LINK
      )
        throw this.invalidAccess();
      const stay = await this.stayAccess.resolveLinkedStay(
        tx,
        draft.stayId,
        draft.stayLinkVersion,
      );
      if (stay.propertyId !== draft.propertyId) throw this.invalidAccess();
    } else if (draft.authorSource === ActorSource.PRIVATE_LINK) {
      throw this.invalidAccess();
    }
    return draft;
  }

  private toDto(draft: DraftRecord): SubmissionDraftDto {
    const template = this.readTemplate(draft);
    if (!draft.privateTokenExpiresAt) throw new InternalServerErrorException();
    return {
      id: draft.id,
      property: {
        id: draft.property.id,
        name: draft.property.name,
        region: draft.property.region,
      },
      type: draft.type,
      status: 'DRAFT',
      visitDate: draft.visitDate.toISOString().slice(0, 10),
      author: this.readAuthor(draft),
      template,
      answers: parseDraftAnswers(
        draft.draftAnswers,
        template.definition,
        draft.type === ChecklistType.MAINTENANCE,
      ),
      startedAt: draft.startedAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      expiresAt: draft.privateTokenExpiresAt,
    };
  }

  public readTemplate(draft: DraftRecord): DraftTemplateSnapshot {
    const value = draft.templateSnapshot;
    if (
      !this.isObject(value) ||
      Object.keys(value).length !== 6 ||
      value.schemaVersion !== 1 ||
      value.id !== draft.templateId ||
      value.type !== draft.type ||
      value.version !== draft.templateVersion ||
      typeof value.title !== 'string' ||
      !value.title.trim() ||
      [...value.title].length > 150 ||
      value.definition === undefined
    )
      throw new InternalServerErrorException();
    return {
      schemaVersion: 1,
      id: draft.templateId,
      type: draft.type,
      title: value.title,
      version: draft.templateVersion,
      definition: parseChecklistDefinition(value.definition),
    };
  }

  public readAuthor(draft: DraftRecord): DraftAuthorSnapshot {
    const value = draft.authorSnapshot;
    const role = draft.type === ChecklistType.MAINTENANCE ? 'STAFF' : 'GUEST';
    if (
      !this.isObject(value) ||
      Object.keys(value).length !== 6 ||
      value.schemaVersion !== 1 ||
      value.role !== role ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      [...value.name].length > 100 ||
      !this.isNullableText(value.company, 150) ||
      !this.isNullableText(value.department, 150) ||
      !this.isNullableText(value.phone, 50)
    )
      throw new InternalServerErrorException();
    return {
      schemaVersion: 1,
      role,
      name: value.name,
      company: value.company,
      department: value.department,
      phone: value.phone,
    };
  }

  private isObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private isNullableText(
    value: Prisma.JsonValue | undefined,
    limit: number,
  ): value is string | null {
    return (
      value === null ||
      (typeof value === 'string' && [...value].length <= limit)
    );
  }

  private parseVisitDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value ||
      value < '1900-01-01' ||
      value > '2100-12-31'
    )
      throw new BadRequestException({
        code: 'INVALID_VISIT_DATE',
        message: '이용 날짜를 확인해 주세요.',
      });
    return date;
  }

  private hashToken(token: string): string {
    return createHash('sha256')
      .update(`submission-draft:${token}`)
      .digest('hex');
  }

  private invalidAccess(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_DRAFT_ACCESS',
      message:
        '작성 링크를 사용할 수 없습니다. 링크와 이용 상태를 확인해 주세요.',
    });
  }

  private staleDraft(): ConflictException {
    return new ConflictException({
      code: 'DRAFT_CHANGED',
      message: '작성 내용이 변경되었습니다. 다시 불러온 뒤 저장해 주세요.',
    });
  }

  private duplicateRequest(): ConflictException {
    return new ConflictException({
      code: 'DRAFT_REQUEST_EXISTS',
      message: '이미 사용한 작성 요청입니다. 보관한 작성 링크를 이용해 주세요.',
    });
  }
}
